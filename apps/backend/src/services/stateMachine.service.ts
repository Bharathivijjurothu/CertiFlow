import { Batch, BatchStatus, Role } from '@prisma/client';
import { prisma } from '../config/db';
import { config } from '../config/env';
import { AuthUser } from '../types/express';

export class StateMachineError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode: number = 400, code: string = 'STATE_MACHINE_ERROR') {
    super(message);
    this.name = 'StateMachineError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class ConcurrencyConflictError extends StateMachineError {
  constructor(message: string = 'Batch was modified concurrently by another user or session. Please refresh.') {
    super(message, 409, 'CONCURRENCY_CONFLICT');
    this.name = 'ConcurrencyConflictError';
  }
}

export const ALLOWED_TRANSITIONS: Record<BatchStatus, BatchStatus[]> = {
  [BatchStatus.DRAFT]: [BatchStatus.SUBMITTED],
  [BatchStatus.SUBMITTED]: [BatchStatus.DISTRICT_REVIEW],
  [BatchStatus.DISTRICT_REVIEW]: [
    BatchStatus.QUALITY_REVIEW,
    BatchStatus.STATE_REVIEW,
    BatchStatus.RETURNED,
    BatchStatus.REJECTED
  ],
  [BatchStatus.QUALITY_REVIEW]: [
    BatchStatus.STATE_REVIEW,
    BatchStatus.RETURNED,
    BatchStatus.REJECTED
  ],
  [BatchStatus.STATE_REVIEW]: [
    BatchStatus.APPROVED,
    BatchStatus.RETURNED,
    BatchStatus.REJECTED
  ],
  [BatchStatus.APPROVED]: [BatchStatus.PROCESSING],
  [BatchStatus.PROCESSING]: [BatchStatus.ISSUED],
  [BatchStatus.RETURNED]: [BatchStatus.SUBMITTED],
  [BatchStatus.REJECTED]: [],
  [BatchStatus.ISSUED]: []
};

export function canTransition(from: BatchStatus, to: BatchStatus): boolean {
  const allowed = ALLOWED_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

export function validateRoleAuthorization(
  user: AuthUser,
  batch: { trainingCentreId: string; districtId: string },
  fromStatus: BatchStatus,
  toStatus: BatchStatus
): void {
  // DRAFT / RETURNED -> SUBMITTED (Training Centre only)
  if (
    (fromStatus === BatchStatus.DRAFT || fromStatus === BatchStatus.RETURNED) &&
    toStatus === BatchStatus.SUBMITTED
  ) {
    if (user.role !== Role.TRAINING_CENTRE) {
      throw new StateMachineError(
        'Only Training Centre users can submit batches.',
        403,
        'FORBIDDEN_ROLE'
      );
    }
    if (user.trainingCentreId !== batch.trainingCentreId) {
      throw new StateMachineError(
        'You can only submit batches belonging to your own training centre.',
        403,
        'CENTRE_OWNERSHIP_MISMATCH'
      );
    }
    return;
  }

  // SUBMITTED -> DISTRICT_REVIEW (District Officer only)
  if (fromStatus === BatchStatus.SUBMITTED && toStatus === BatchStatus.DISTRICT_REVIEW) {
    if (user.role !== Role.DISTRICT_OFFICER) {
      throw new StateMachineError(
        'Only District Officers can start review on submitted batches.',
        403,
        'FORBIDDEN_ROLE'
      );
    }
    if (user.districtId !== batch.districtId) {
      throw new StateMachineError(
        `Access denied. You can only review batches from your assigned district (${user.districtId}).`,
        403,
        'DISTRICT_MISMATCH'
      );
    }
    return;
  }

  // DISTRICT_REVIEW transitions (District Officer only)
  if (fromStatus === BatchStatus.DISTRICT_REVIEW) {
    if (user.role !== Role.DISTRICT_OFFICER) {
      throw new StateMachineError(
        'Only District Officers can review batches in DISTRICT_REVIEW.',
        403,
        'FORBIDDEN_ROLE'
      );
    }
    if (user.districtId !== batch.districtId) {
      throw new StateMachineError(
        `Access denied. You can only review batches from your assigned district (${user.districtId}).`,
        403,
        'DISTRICT_MISMATCH'
      );
    }
    return;
  }

  // QUALITY_REVIEW transitions (Quality Officer only)
  if (fromStatus === BatchStatus.QUALITY_REVIEW) {
    if (user.role !== Role.QUALITY_OFFICER) {
      throw new StateMachineError(
        'Only Quality Officers can perform quality review actions.',
        403,
        'FORBIDDEN_ROLE'
      );
    }
    return;
  }

  // STATE_REVIEW transitions (State Officer only)
  if (fromStatus === BatchStatus.STATE_REVIEW) {
    if (user.role !== Role.STATE_OFFICER) {
      throw new StateMachineError(
        'Only State Officers can approve, return, or reject batches in STATE_REVIEW.',
        403,
        'FORBIDDEN_ROLE'
      );
    }
    return;
  }

  // APPROVED -> PROCESSING -> ISSUED (State Officer or System)
  if (fromStatus === BatchStatus.APPROVED || fromStatus === BatchStatus.PROCESSING) {
    if (user.role !== Role.STATE_OFFICER) {
      throw new StateMachineError(
        'Only State Officers can advance approved batches to processing/issued.',
        403,
        'FORBIDDEN_ROLE'
      );
    }
    return;
  }

  throw new StateMachineError(
    `Unauthorized transition attempt from ${fromStatus} to ${toStatus} for role ${user.role}`,
    403,
    'UNAUTHORIZED_TRANSITION'
  );
}

export interface TransitionBatchInput {
  batchId: string;
  expectedVersion: number;
  targetStatus: BatchStatus;
  user: AuthUser;
  action: string;
  reason?: string;
}

export async function transitionBatch(input: TransitionBatchInput) {
  const { batchId, expectedVersion, targetStatus, user, action, reason } = input;

  return await prisma.$transaction(async (tx) => {
    const batch = await tx.batch.findUnique({
      where: { id: batchId },
      include: {
        _count: {
          select: { students: true }
        }
      }
    });

    if (!batch) {
      throw new StateMachineError('Batch not found', 404, 'NOT_FOUND');
    }

    // Concurrency / Version verification
    if (batch.version !== expectedVersion) {
      throw new ConcurrencyConflictError(
        `Version conflict: Batch version is ${batch.version}, but request specified ${expectedVersion}. Please reload the latest batch state.`
      );
    }

    const currentStatus = batch.status;

    // Validate state transition allowed
    if (!canTransition(currentStatus, targetStatus)) {
      throw new StateMachineError(
        `Invalid status transition from '${currentStatus}' to '${targetStatus}'.`,
        400,
        'INVALID_STATUS_TRANSITION'
      );
    }

    // Submitting requires at least 1 student
    if (targetStatus === BatchStatus.SUBMITTED && batch._count.students === 0) {
      throw new StateMachineError(
        'Cannot submit a batch with 0 students. Please upload student data first.',
        400,
        'EMPTY_BATCH_SUBMISSION'
      );
    }

    // Configurable Quality Review Threshold:
    // Batches meeting or exceeding the threshold must go to QUALITY_REVIEW before STATE_REVIEW
    if (currentStatus === BatchStatus.DISTRICT_REVIEW && targetStatus === BatchStatus.STATE_REVIEW) {
      if (batch._count.students >= config.qualityReviewThreshold) {
        throw new StateMachineError(
          `Batch has ${batch._count.students} students, which meets or exceeds the Quality Review threshold of ${config.qualityReviewThreshold}. It must be forwarded to QUALITY_REVIEW.`,
          400,
          'QUALITY_REVIEW_REQUIRED'
        );
      }
    }

    // Role & ownership check
    validateRoleAuthorization(user, batch, currentStatus, targetStatus);

    // Conditional optimistic update
    const isResubmission = currentStatus === BatchStatus.RETURNED && targetStatus === BatchStatus.SUBMITTED;
    const updateData: any = {
      status: targetStatus,
      version: { increment: 1 }
    };
    if (isResubmission) {
      updateData.approvalRound = { increment: 1 };
    }

    const updateResult = await tx.batch.updateMany({
      where: {
        id: batchId,
        status: currentStatus,
        version: expectedVersion
      },
      data: updateData
    });

    if (updateResult.count === 0) {
      throw new ConcurrencyConflictError(
        'Concurrent update detected: Batch was modified or transitioned by another request.'
      );
    }

    // Record transition history
    const history = await tx.batchHistory.create({
      data: {
        batchId,
        userId: user.id,
        fromStatus: currentStatus,
        toStatus: targetStatus,
        action,
        reason: reason || null
      }
    });

    const updatedBatch = await tx.batch.findUnique({
      where: { id: batchId },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true, role: true }
        },
        _count: {
          select: { students: true }
        }
      }
    });

    return {
      batch: updatedBatch,
      history
    };
  });
}
