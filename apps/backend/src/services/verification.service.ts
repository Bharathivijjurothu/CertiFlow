import { BatchStatus, CertificateStatus, Role } from '@prisma/client';
import { prisma } from '../config/db';
import { AuthUser } from '../types/express';
import { StateMachineError } from './stateMachine.service';

export type PublicVerificationStatus = 'VALID' | 'CANCELLED' | 'INVALID';

export interface VerificationResult {
  status: PublicVerificationStatus;
  valid: boolean;
  message: string;
  certificateNumber?: string;
  studentName?: string;
  courseName?: string;
  trainingCentreId?: string;
  districtId?: string;
  issueDate?: string;
  grade?: string;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
}

/**
 * Public certificate verification service.
 * Supports lookups by Certificate Number (e.g., CERT-2026-XXXXXXXX) or 32-char hex Verification Token.
 * Enforces privacy: internal database IDs, file storage paths, and private candidate PII are never returned.
 */
export async function verifyCertificate(rawIdentifier: string): Promise<VerificationResult> {
  const identifier = (rawIdentifier || '').trim();

  if (!identifier) {
    return {
      status: 'INVALID',
      valid: false,
      message: 'Please provide a certificate number or QR verification token.'
    };
  }

  // Format validation
  const isCertNumberFormat = /^CERT-\d{4}-[A-F0-9]{8}$/i.test(identifier);
  const isTokenFormat = /^[a-f0-9]{32}$/i.test(identifier);

  if (!isCertNumberFormat && !isTokenFormat) {
    return {
      status: 'INVALID',
      valid: false,
      message: 'Invalid certificate format. Expected CERT-YYYY-XXXXXXXX or a 32-character QR verification token.'
    };
  }

  // Lookup certificate in database
  const cert = await prisma.certificate.findFirst({
    where: {
      OR: [
        { certificateNumber: { equals: identifier, mode: 'insensitive' } },
        { verificationToken: identifier }
      ]
    },
    include: {
      student: {
        select: {
          studentName: true,
          grade: true
        }
      },
      batch: {
        select: {
          status: true
        }
      }
    }
  });

  if (!cert) {
    return {
      status: 'INVALID',
      valid: false,
      message: 'No certificate found matching the provided identifier. Please check the credential details.'
    };
  }

  // Requirement 5: Ensure certificates from unapproved or unissued batches cannot be verified as valid
  if (cert.batch.status !== BatchStatus.ISSUED && cert.batch.status !== BatchStatus.APPROVED) {
    return {
      status: 'INVALID',
      valid: false,
      message: `Certificate belongs to an unissued batch (status: ${cert.batch.status}). Unapproved certificates cannot be verified.`
    };
  }

  // Check cancellation status
  if (cert.status === CertificateStatus.CANCELLED || cert.status === CertificateStatus.REVOKED) {
    return {
      status: 'CANCELLED',
      valid: false,
      certificateNumber: cert.certificateNumber,
      courseName: cert.courseName,
      trainingCentreId: cert.trainingCentreId,
      districtId: cert.districtId,
      issueDate: cert.issueDate.toISOString(),
      cancelledAt: cert.cancelledAt ? cert.cancelledAt.toISOString() : null,
      cancellationReason: cert.cancellationReason || 'Certificate was cancelled by the issuing State Authority.',
      message: 'This certificate was officially cancelled and is no longer valid.'
    };
  }

  // Valid Active Certificate
  return {
    status: 'VALID',
    valid: true,
    certificateNumber: cert.certificateNumber,
    studentName: cert.student.studentName,
    courseName: cert.courseName,
    trainingCentreId: cert.trainingCentreId,
    districtId: cert.districtId,
    issueDate: cert.issueDate.toISOString(),
    grade: cert.student.grade || 'Certified',
    message: 'Official Certificate is authentic, verified, and in good standing.'
  };
}

/**
 * State Officer Certificate Cancellation Service.
 * Allows an authorized State Officer to cancel a certificate with mandatory reason and immutable audit history.
 */
export async function cancelCertificate(certificateId: string, reason: string, user: AuthUser) {
  // 1. Authorization check: Only STATE_OFFICER can cancel certificates
  if (user.role !== Role.STATE_OFFICER) {
    throw new StateMachineError(
      'Access denied: Only authorized State Officers can cancel issued certificates.',
      403,
      'FORBIDDEN_ROLE'
    );
  }

  // 2. Input validation: Reason is mandatory
  const cleanReason = (reason || '').trim();
  if (!cleanReason || cleanReason.length < 5) {
    throw new StateMachineError(
      'Cancellation reason is mandatory and must be at least 5 characters long.',
      422,
      'VALIDATION_FAILED'
    );
  }

  const cert = await prisma.certificate.findUnique({
    where: { id: certificateId },
    include: { batch: true, student: true }
  });

  if (!cert) {
    throw new StateMachineError('Certificate not found.', 404, 'NOT_FOUND');
  }

  // 3. Status check: Prevent double cancellation
  if (cert.status === CertificateStatus.CANCELLED || cert.status === CertificateStatus.REVOKED) {
    throw new StateMachineError(
      `Certificate '${cert.certificateNumber}' is already cancelled.`,
      400,
      'ALREADY_CANCELLED'
    );
  }

  // 4. Execute cancellation and audit creation inside transaction
  const cancelledAt = new Date();
  const updatedCert = await prisma.$transaction(async (tx) => {
    // Update certificate status
    const updated = await tx.certificate.update({
      where: { id: cert.id },
      data: {
        status: CertificateStatus.CANCELLED,
        cancellationReason: cleanReason,
        cancelledAt,
        cancelledById: user.id
      }
    });

    // Create Certificate Audit Log
    await tx.certificateAuditLog.create({
      data: {
        certificateId: cert.id,
        action: 'CANCELLED',
        performedById: user.id,
        reason: cleanReason,
        metadata: JSON.stringify({
          previousStatus: cert.status,
          certificateNumber: cert.certificateNumber,
          cancelledByEmail: user.email
        })
      }
    });

    // Create Batch History Log
    await tx.batchHistory.create({
      data: {
        batchId: cert.batchId,
        userId: user.id,
        fromStatus: cert.batch.status,
        toStatus: cert.batch.status,
        action: 'CERTIFICATE_CANCELLED',
        reason: `Certificate ${cert.certificateNumber} (${cert.student.studentName}) cancelled by ${user.name}: "${cleanReason}"`
      }
    });

    return updated;
  });

  return updatedCert;
}

/**
 * Retrieves audit history for a certificate.
 */
export async function getCertificateAuditHistory(certificateId: string) {
  return await prisma.certificateAuditLog.findMany({
    where: { certificateId },
    include: {
      performedBy: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
}
