import { BatchStatus, DeliveryStatus, Role } from '@prisma/client';
import { prisma } from '../config/db';
import { AuthUser } from '../types/express';
import { StateMachineError } from './stateMachine.service';
import { WhatsAppSimulator, maskPhoneNumber } from './whatsappSimulator.service';

export interface BatchDeliverySummary {
  success: boolean;
  batchId: string;
  totalEligible: number;
  queuedCount: number;
  alreadySentCount: number;
  failedCount: number;
}

export interface BatchDeliveryStatusResponse {
  batchId: string;
  totalEligible: number;
  stats: {
    queued: number;
    processing: number;
    sent: number;
    failed: number;
    notQueued: number;
  };
  deliveries: Array<{
    id: string;
    certificateId: string;
    certificateNumber: string;
    studentId: string;
    studentName: string;
    maskedPhone: string;
    status: DeliveryStatus;
    attempts: number;
    maxAttempts: number;
    lastAttemptAt: string | null;
    sentAt: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    simulatedMessageId: string | null;
  }>;
}

/**
 * Validates whether user is authorized to perform delivery actions for a batch.
 */
function validateDeliveryAccess(user: AuthUser, batch: { trainingCentreId: string; districtId: string }): void {
  if (user.role === Role.TRAINING_CENTRE && user.trainingCentreId !== batch.trainingCentreId) {
    throw new StateMachineError(
      'Access denied: You can only deliver certificates for your own training centre.',
      403,
      'FORBIDDEN'
    );
  }
  if (user.role === Role.DISTRICT_OFFICER && user.districtId !== batch.districtId) {
    throw new StateMachineError(
      `Access denied: You can only deliver certificates from your district (${user.districtId}).`,
      403,
      'FORBIDDEN'
    );
  }
}

/**
 * Queues WhatsApp certificate notifications for an entire issued batch.
 */
export async function queueBatchDelivery(
  batchId: string,
  user: AuthUser,
  options?: { failSimulated?: boolean }
): Promise<BatchDeliverySummary> {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: {
      certificates: {
        include: {
          student: true,
          deliveries: true
        }
      }
    }
  });

  if (!batch) {
    throw new StateMachineError('Batch not found', 404, 'NOT_FOUND');
  }

  // 1. Role Scope Check
  validateDeliveryAccess(user, batch);

  // 2. Batch Eligibility Check: Batch must be ISSUED
  if (batch.status !== BatchStatus.ISSUED && batch.status !== BatchStatus.APPROVED) {
    throw new StateMachineError(
      `Cannot send certificates: Batch is in '${batch.status}' status. Only ISSUED batches can be queued for delivery.`,
      400,
      'BATCH_NOT_ISSUED'
    );
  }

  const certificates = batch.certificates;
  if (!certificates || certificates.length === 0) {
    throw new StateMachineError(
      'Cannot queue delivery: Batch has no generated certificates.',
      400,
      'NO_CERTIFICATES'
    );
  }

  let queuedCount = 0;
  let alreadySentCount = 0;
  let failedCount = 0;

  for (const cert of certificates) {
    const existingDelivery = cert.deliveries.find((d) => d.channel === 'WHATSAPP');

    if (existingDelivery && existingDelivery.status === DeliveryStatus.SENT) {
      alreadySentCount++;
      continue;
    }

    const recipientPhone = cert.student.phone || '';
    const masked = maskPhoneNumber(recipientPhone);

    // Upsert delivery record to QUEUED status
    const delivery = await prisma.certificateDelivery.upsert({
      where: {
        certificateId_channel: {
          certificateId: cert.id,
          channel: 'WHATSAPP'
        }
      },
      create: {
        certificateId: cert.id,
        studentId: cert.studentId,
        batchId: cert.batchId,
        recipientPhone,
        maskedPhone: masked,
        status: DeliveryStatus.QUEUED,
        maxAttempts: 3
      },
      update: {
        status: DeliveryStatus.QUEUED,
        recipientPhone,
        maskedPhone: masked
      }
    });

    // Execute delivery simulation
    try {
      const result = await deliverSingleCertificate(cert.id, {
        failSimulated: options?.failSimulated
      });

      if (result.status === DeliveryStatus.SENT) {
        queuedCount++;
      } else if (result.status === DeliveryStatus.FAILED) {
        failedCount++;
      }
    } catch {
      failedCount++;
    }
  }

  return {
    success: true,
    batchId,
    totalEligible: certificates.length,
    queuedCount,
    alreadySentCount,
    failedCount
  };
}

/**
 * Delivers a single certificate notification via WhatsApp Simulator.
 * Enforces idempotency: does not re-send if already SENT unless forceRetry is set.
 */
export async function deliverSingleCertificate(
  certificateId: string,
  options?: { forceRetry?: boolean; failSimulated?: boolean }
) {
  const cert = await prisma.certificate.findUnique({
    where: { id: certificateId },
    include: {
      student: true,
      batch: true,
      deliveries: {
        where: { channel: 'WHATSAPP' }
      }
    }
  });

  if (!cert) {
    throw new StateMachineError('Certificate not found', 404, 'NOT_FOUND');
  }

  const existingDelivery = cert.deliveries[0];

  // Idempotency: If already SENT and not forceRetry, return existing record
  if (existingDelivery && existingDelivery.status === DeliveryStatus.SENT && !options?.forceRetry) {
    return existingDelivery;
  }

  const recipientPhone = cert.student.phone || '';
  const masked = maskPhoneNumber(recipientPhone);
  const currentAttempts = existingDelivery ? existingDelivery.attempts : 0;
  const maxAttempts = existingDelivery?.maxAttempts || 3;

  // Ensure delivery record exists in PROCESSING status
  const delivery = await prisma.certificateDelivery.upsert({
    where: {
      certificateId_channel: {
        certificateId: cert.id,
        channel: 'WHATSAPP'
      }
    },
    create: {
      certificateId: cert.id,
      studentId: cert.studentId,
      batchId: cert.batchId,
      recipientPhone,
      maskedPhone: masked,
      status: DeliveryStatus.PROCESSING,
      lastAttemptAt: new Date(),
      maxAttempts
    },
    update: {
      status: DeliveryStatus.PROCESSING,
      lastAttemptAt: new Date()
    }
  });

  // Call WhatsApp Simulator
  const simResult = await WhatsAppSimulator.sendMessage({
    recipientPhone,
    studentName: cert.student.studentName,
    courseName: cert.courseName,
    certificateNumber: cert.certificateNumber,
    accessUrl: cert.qrCodeUrl,
    failSimulated: options?.failSimulated
  });

  const nextAttemptNumber = currentAttempts + 1;

  if (simResult.success) {
    // Record Success
    const updated = await prisma.certificateDelivery.update({
      where: { id: delivery.id },
      data: {
        status: DeliveryStatus.SENT,
        attempts: nextAttemptNumber,
        sentAt: simResult.deliveredAt || new Date(),
        simulatedMessageId: simResult.messageId,
        errorCode: null,
        errorMessage: null
      }
    });

    await prisma.deliveryAttemptLog.create({
      data: {
        deliveryId: delivery.id,
        attemptNumber: nextAttemptNumber,
        status: DeliveryStatus.SENT,
        simulatedMessageId: simResult.messageId
      }
    });

    return updated;
  } else {
    // Record Failure
    const isPermanent = simResult.isPermanent || nextAttemptNumber >= maxAttempts;
    const nextStatus = isPermanent ? DeliveryStatus.FAILED : DeliveryStatus.QUEUED;

    const updated = await prisma.certificateDelivery.update({
      where: { id: delivery.id },
      data: {
        status: nextStatus,
        attempts: nextAttemptNumber,
        errorCode: simResult.errorCode || 'DELIVERY_ERROR',
        errorMessage: simResult.error || 'Failed to deliver message'
      }
    });

    await prisma.deliveryAttemptLog.create({
      data: {
        deliveryId: delivery.id,
        attemptNumber: nextAttemptNumber,
        status: DeliveryStatus.FAILED,
        errorMessage: simResult.error
      }
    });

    return updated;
  }
}

/**
 * Manually retries a failed certificate delivery.
 */
export async function retryCertificateDelivery(certificateId: string, user: AuthUser) {
  const cert = await prisma.certificate.findUnique({
    where: { id: certificateId },
    include: {
      batch: true,
      deliveries: { where: { channel: 'WHATSAPP' } }
    }
  });

  if (!cert) {
    throw new StateMachineError('Certificate not found', 404, 'NOT_FOUND');
  }

  validateDeliveryAccess(user, cert.batch);

  const existing = cert.deliveries[0];
  if (!existing) {
    throw new StateMachineError('No delivery record found for this certificate.', 404, 'NO_DELIVERY_RECORD');
  }

  // Reset delivery record for manual retry
  await prisma.certificateDelivery.update({
    where: { id: existing.id },
    data: {
      status: DeliveryStatus.QUEUED,
      attempts: 0, // Reset attempts for authorized manual retry
      errorCode: null,
      errorMessage: null
    }
  });

  return await deliverSingleCertificate(certificateId, { forceRetry: true });
}

/**
 * Retrieves delivery metrics and logs for a batch.
 */
export async function getBatchDeliveryStatus(batchId: string, user: AuthUser): Promise<BatchDeliveryStatusResponse> {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: {
      certificates: {
        include: {
          student: true,
          deliveries: {
            where: { channel: 'WHATSAPP' },
            include: { attemptLogs: { orderBy: { createdAt: 'desc' } } }
          }
        },
        orderBy: { createdAt: 'asc' }
      }
    }
  });

  if (!batch) {
    throw new StateMachineError('Batch not found', 404, 'NOT_FOUND');
  }

  validateDeliveryAccess(user, batch);

  const stats = {
    queued: 0,
    processing: 0,
    sent: 0,
    failed: 0,
    notQueued: 0
  };

  const deliveryList: Array<{
    id: string;
    certificateId: string;
    certificateNumber: string;
    studentId: string;
    studentName: string;
    maskedPhone: string;
    status: DeliveryStatus;
    attempts: number;
    maxAttempts: number;
    lastAttemptAt: string | null;
    sentAt: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    simulatedMessageId: string | null;
  }> = [];

  for (const cert of batch.certificates) {
    const d = cert.deliveries[0];
    const masked = d ? d.maskedPhone : maskPhoneNumber(cert.student.phone || '');

    if (!d) {
      stats.notQueued++;
    } else {
      if (d.status === DeliveryStatus.QUEUED) stats.queued++;
      else if (d.status === DeliveryStatus.PROCESSING) stats.processing++;
      else if (d.status === DeliveryStatus.SENT) stats.sent++;
      else if (d.status === DeliveryStatus.FAILED) stats.failed++;
    }

    deliveryList.push({
      id: d ? d.id : `virtual-${cert.id}`,
      certificateId: cert.id,
      certificateNumber: cert.certificateNumber,
      studentId: cert.studentId,
      studentName: cert.student.studentName,
      maskedPhone: masked,
      status: d ? d.status : ('PENDING' as DeliveryStatus),
      attempts: d ? d.attempts : 0,
      maxAttempts: d ? d.maxAttempts : 3,
      lastAttemptAt: d?.lastAttemptAt ? d.lastAttemptAt.toISOString() : null,
      sentAt: d?.sentAt ? d.sentAt.toISOString() : null,
      errorCode: d ? d.errorCode : null,
      errorMessage: d ? d.errorMessage : null,
      simulatedMessageId: d ? d.simulatedMessageId : null
    });
  }

  return {
    batchId,
    totalEligible: batch.certificates.length,
    stats,
    deliveries: deliveryList
  };
}
