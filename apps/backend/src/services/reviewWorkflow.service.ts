import { BatchStatus, ReviewDecision, ReviewStage, Role } from '@prisma/client';
import { prisma } from '../config/db';
import { config } from '../config/env';
import { AuthUser } from '../types/express';
import { ConcurrencyConflictError, StateMachineError } from './stateMachine.service';

export interface SubmitReviewInput {
  batchId: string;
  expectedVersion: number;
  decision: ReviewDecision;
  comment?: string;
  user: AuthUser;
}

export interface ReviewProgress {
  currentRound: number;
  currentStatus: BatchStatus;
  studentCount: number;
  district: {
    required: number;
    approvedCount: number;
    isComplete: boolean;
    approvals: Array<{
      reviewerId: string;
      reviewerName: string;
      createdAt: string;
    }>;
    alreadyApprovedByCurrentUser: boolean;
    canCurrentUserApprove: boolean;
  };
  quality: {
    required: boolean;
    threshold: number;
    isComplete: boolean;
    approval: {
      reviewerId: string;
      reviewerName: string;
      createdAt: string;
    } | null;
  };
  state: {
    isComplete: boolean;
    approval: {
      reviewerId: string;
      reviewerName: string;
      createdAt: string;
    } | null;
  };
  allReviews: any[];
}

export async function getReviewProgress(batchId: string, currentUser?: AuthUser): Promise<ReviewProgress> {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: {
      _count: { select: { students: true } },
      reviews: {
        include: {
          reviewer: { select: { id: true, name: true, email: true, role: true } }
        },
        orderBy: { createdAt: 'desc' }
      }
    }
  });

  if (!batch) {
    throw new StateMachineError('Batch not found', 404, 'NOT_FOUND');
  }

  const currentRound = batch.approvalRound;
  const currentRoundReviews = batch.reviews.filter((r) => r.round === currentRound);

  // District Approvals for current round
  const districtApprovals = currentRoundReviews.filter(
    (r) => r.stage === ReviewStage.DISTRICT && r.decision === ReviewDecision.APPROVED
  );

  const alreadyApprovedByCurrentUser = currentUser
    ? districtApprovals.some((r) => r.reviewerId === currentUser.id)
    : false;

  const canCurrentUserApprove = currentUser
    ? currentUser.role === Role.DISTRICT_OFFICER &&
      currentUser.districtId === batch.districtId &&
      !alreadyApprovedByCurrentUser &&
      currentUser.id !== batch.createdById &&
      (batch.status === BatchStatus.SUBMITTED || batch.status === BatchStatus.DISTRICT_REVIEW)
    : false;

  // Quality requirement
  const qualityRequired = batch._count.students >= config.qualityReviewThreshold;
  const qualityApproval = currentRoundReviews.find(
    (r) => r.stage === ReviewStage.QUALITY && r.decision === ReviewDecision.APPROVED
  );

  // State approval
  const stateApproval = currentRoundReviews.find(
    (r) => r.stage === ReviewStage.STATE && r.decision === ReviewDecision.APPROVED
  );

  return {
    currentRound,
    currentStatus: batch.status,
    studentCount: batch._count.students,
    district: {
      required: 2,
      approvedCount: districtApprovals.length,
      isComplete: districtApprovals.length >= 2,
      approvals: districtApprovals.map((r) => ({
        reviewerId: r.reviewerId,
        reviewerName: r.reviewer.name,
        createdAt: r.createdAt.toISOString()
      })),
      alreadyApprovedByCurrentUser,
      canCurrentUserApprove
    },
    quality: {
      required: qualityRequired,
      threshold: config.qualityReviewThreshold,
      isComplete: !qualityRequired || !!qualityApproval,
      approval: qualityApproval
        ? {
            reviewerId: qualityApproval.reviewerId,
            reviewerName: qualityApproval.reviewer.name,
            createdAt: qualityApproval.createdAt.toISOString()
          }
        : null
    },
    state: {
      isComplete: !!stateApproval,
      approval: stateApproval
        ? {
            reviewerId: stateApproval.reviewerId,
            reviewerName: stateApproval.reviewer.name,
            createdAt: stateApproval.createdAt.toISOString()
          }
        : null
    },
    allReviews: batch.reviews
  };
}

export async function submitReviewDecision(input: SubmitReviewInput) {
  const { batchId, expectedVersion, decision, comment, user } = input;

  // Validate comments for return or reject
  if (decision === ReviewDecision.RETURNED || decision === ReviewDecision.REJECTED) {
    if (!comment || !comment.trim()) {
      throw new StateMachineError(
        `A non-empty reason is required when a batch is ${decision.toLowerCase()}.`,
        422,
        'COMMENT_REQUIRED'
      );
    }
  }

  return await prisma.$transaction(async (tx) => {
    const batch = await tx.batch.findUnique({
      where: { id: batchId },
      include: {
        _count: { select: { students: true } }
      }
    });

    if (!batch) {
      throw new StateMachineError('Batch not found', 404, 'NOT_FOUND');
    }

    // Optimistic Concurrency check
    if (batch.version !== expectedVersion) {
      throw new ConcurrencyConflictError(
        `Batch was modified concurrently. Current version is ${batch.version}, expected ${expectedVersion}. Please reload.`
      );
    }

    if (batch.status === BatchStatus.APPROVED) {
      throw new StateMachineError('Batch has already received final approval.', 400, 'ALREADY_APPROVED');
    }

    if (batch.status === BatchStatus.REJECTED) {
      throw new StateMachineError('Batch has been rejected and cannot be reviewed further.', 400, 'ALREADY_REJECTED');
    }

    const currentRound = batch.approvalRound;
    let nextStatus: BatchStatus = batch.status;
    let reviewStage: ReviewStage;
    let actionLog = '';

    // =========================================================================
    // 1. DISTRICT OFFICER REVIEW
    // =========================================================================
    if (batch.status === BatchStatus.SUBMITTED || batch.status === BatchStatus.DISTRICT_REVIEW) {
      if (user.role !== Role.DISTRICT_OFFICER) {
        throw new StateMachineError(
          `Unauthorized: Only District Officers can review batches in ${batch.status}.`,
          403,
          'FORBIDDEN_ROLE'
        );
      }

      if (user.districtId !== batch.districtId) {
        throw new StateMachineError(
          `Access denied: You are assigned to district '${user.districtId}', but this batch belongs to '${batch.districtId}'.`,
          403,
          'DISTRICT_MISMATCH'
        );
      }

      // Check self-approval conflict
      if (user.id === batch.createdById) {
        throw new StateMachineError(
          'Conflict of interest: A user cannot approve their own batch.',
          403,
          'SELF_APPROVAL_FORBIDDEN'
        );
      }

      reviewStage = ReviewStage.DISTRICT;

      // Duplicate decision in same round check
      const existingReview = await tx.batchReview.findUnique({
        where: {
          batchId_round_stage_reviewerId: {
            batchId,
            round: currentRound,
            stage: reviewStage,
            reviewerId: user.id
          }
        }
      });

      if (existingReview) {
        throw new StateMachineError(
          'You have already submitted a review decision for this batch in the current approval round.',
          409,
          'DUPLICATE_REVIEW_DECISION'
        );
      }

      if (decision === ReviewDecision.RETURNED) {
        nextStatus = BatchStatus.RETURNED;
        actionLog = `DISTRICT_RETURN: Batch returned by District Officer ${user.name}`;
      } else if (decision === ReviewDecision.REJECTED) {
        nextStatus = BatchStatus.REJECTED;
        actionLog = `DISTRICT_REJECT: Batch rejected by District Officer ${user.name}`;
      } else {
        // APPROVE: Count existing distinct approvals in this round
        const priorDistrictApprovals = await tx.batchReview.findMany({
          where: {
            batchId,
            round: currentRound,
            stage: ReviewStage.DISTRICT,
            decision: ReviewDecision.APPROVED
          }
        });

        const newApprovedCount = priorDistrictApprovals.length + 1;

        if (newApprovedCount === 1) {
          // First approval: batch remains in DISTRICT_REVIEW (or moves from SUBMITTED to DISTRICT_REVIEW)
          nextStatus = BatchStatus.DISTRICT_REVIEW;
          actionLog = `DISTRICT_APPROVAL_1: First District Officer approval recorded (1 of 2 required) by ${user.name}`;
        } else if (newApprovedCount >= 2) {
          // Second distinct approval: check quality threshold
          const qualityRequired = batch._count.students >= config.qualityReviewThreshold;
          nextStatus = qualityRequired ? BatchStatus.QUALITY_REVIEW : BatchStatus.STATE_REVIEW;
          actionLog = `DISTRICT_APPROVAL_2: Second District Officer approval recorded by ${user.name}. Advanced to ${nextStatus} (Quality Review required: ${qualityRequired})`;
        }
      }
    }
    // =========================================================================
    // 2. QUALITY OFFICER REVIEW
    // =========================================================================
    else if (batch.status === BatchStatus.QUALITY_REVIEW) {
      if (user.role !== Role.QUALITY_OFFICER) {
        throw new StateMachineError(
          'Unauthorized: Only Quality Officers can review batches in QUALITY_REVIEW.',
          403,
          'FORBIDDEN_ROLE'
        );
      }

      reviewStage = ReviewStage.QUALITY;

      // Duplicate decision in same round check
      const existingReview = await tx.batchReview.findUnique({
        where: {
          batchId_round_stage_reviewerId: {
            batchId,
            round: currentRound,
            stage: reviewStage,
            reviewerId: user.id
          }
        }
      });

      if (existingReview) {
        throw new StateMachineError(
          'Quality review decision has already been submitted for this round.',
          409,
          'DUPLICATE_REVIEW_DECISION'
        );
      }

      if (decision === ReviewDecision.RETURNED) {
        nextStatus = BatchStatus.RETURNED;
        actionLog = `QUALITY_RETURN: Batch returned by Quality Officer ${user.name}`;
      } else if (decision === ReviewDecision.REJECTED) {
        nextStatus = BatchStatus.REJECTED;
        actionLog = `QUALITY_REJECT: Batch rejected by Quality Officer ${user.name}`;
      } else {
        nextStatus = BatchStatus.STATE_REVIEW;
        actionLog = `QUALITY_APPROVAL: Quality Review approved by ${user.name}. Advanced to STATE_REVIEW`;
      }
    }
    // =========================================================================
    // 3. STATE OFFICER FINAL APPROVAL
    // =========================================================================
    else if (batch.status === BatchStatus.STATE_REVIEW) {
      if (user.role !== Role.STATE_OFFICER) {
        throw new StateMachineError(
          'Unauthorized: Only State Officers can give final approval in STATE_REVIEW.',
          403,
          'FORBIDDEN_ROLE'
        );
      }

      reviewStage = ReviewStage.STATE;

      // Verify prerequisite District Approvals (2 distinct DOs in this round)
      const doApprovalCount = await tx.batchReview.count({
        where: {
          batchId,
          round: currentRound,
          stage: ReviewStage.DISTRICT,
          decision: ReviewDecision.APPROVED
        }
      });

      if (doApprovalCount < 2) {
        throw new StateMachineError(
          `Cannot proceed: Batch requires 2 distinct District Officer approvals (found ${doApprovalCount}).`,
          400,
          'INCOMPLETE_DISTRICT_APPROVALS'
        );
      }

      // Verify Quality Review if student count meets threshold
      const qualityRequired = batch._count.students >= config.qualityReviewThreshold;
      if (qualityRequired) {
        const qoApproval = await tx.batchReview.findFirst({
          where: {
            batchId,
            round: currentRound,
            stage: ReviewStage.QUALITY,
            decision: ReviewDecision.APPROVED
          }
        });

        if (!qoApproval) {
          throw new StateMachineError(
            `Cannot proceed: Batch has ${batch._count.students} students and requires Quality Officer approval before final State approval.`,
            400,
            'QUALITY_APPROVAL_REQUIRED'
          );
        }
      }

      if (decision === ReviewDecision.RETURNED) {
        nextStatus = BatchStatus.RETURNED;
        actionLog = `STATE_RETURN: Batch returned by State Officer ${user.name}`;
      } else if (decision === ReviewDecision.REJECTED) {
        nextStatus = BatchStatus.REJECTED;
        actionLog = `STATE_REJECT: Batch rejected by State Officer ${user.name}`;
      } else {
        nextStatus = BatchStatus.APPROVED;
        actionLog = `STATE_FINAL_APPROVAL: Final State Approval granted by ${user.name}. Batch is now APPROVED`;
      }
    } else {
      throw new StateMachineError(
        `Batch status '${batch.status}' is not awaiting review.`,
        400,
        'INVALID_REVIEW_STATE'
      );
    }

    // 1. Record Review Decision in BatchReview table (Enforces DB unique constraint @@unique([batchId, round, stage, reviewerId]))
    const review = await tx.batchReview.create({
      data: {
        batchId,
        reviewerId: user.id,
        reviewerRole: user.role,
        round: currentRound,
        stage: reviewStage,
        decision,
        comment: comment ? comment.trim() : null
      }
    });

    // 2. Conditionally update batch status and increment version
    const updateResult = await tx.batch.updateMany({
      where: {
        id: batchId,
        status: batch.status,
        version: expectedVersion
      },
      data: {
        status: nextStatus,
        version: { increment: 1 }
      }
    });

    if (updateResult.count === 0) {
      throw new ConcurrencyConflictError(
        'Concurrent update conflict: Batch status was changed by another user or session. Please refresh.'
      );
    }

    // 3. Record Audit History
    await tx.batchHistory.create({
      data: {
        batchId,
        userId: user.id,
        fromStatus: batch.status,
        toStatus: nextStatus,
        action: actionLog,
        reason: comment ? comment.trim() : `Decision: ${decision} at stage ${reviewStage}`
      }
    });

    const updatedBatch = await tx.batch.findUnique({
      where: { id: batchId },
      include: {
        createdBy: { select: { id: true, name: true, email: true, role: true } },
        _count: { select: { students: true } }
      }
    });

    return {
      batch: updatedBatch,
      review,
      nextStatus
    };
  });
}

export async function getReviewQueue(user: AuthUser) {
  const where: any = {};

  if (user.role === Role.DISTRICT_OFFICER) {
    // Awaiting District Review in their district
    where.districtId = user.districtId;
    where.status = {
      in: [BatchStatus.SUBMITTED, BatchStatus.DISTRICT_REVIEW]
    };
  } else if (user.role === Role.QUALITY_OFFICER) {
    // Awaiting Quality Review state-wide
    where.status = BatchStatus.QUALITY_REVIEW;
  } else if (user.role === Role.STATE_OFFICER) {
    // Awaiting State Review state-wide
    where.status = BatchStatus.STATE_REVIEW;
  } else {
    return [];
  }

  const batches = await prisma.batch.findMany({
    where,
    include: {
      createdBy: { select: { id: true, name: true, email: true, role: true } },
      _count: { select: { students: true } },
      reviews: {
        where: { stage: ReviewStage.DISTRICT, decision: ReviewDecision.APPROVED },
        select: { reviewerId: true, round: true }
      }
    },
    orderBy: { updatedAt: 'desc' }
  });

  return batches.map((b) => {
    const currentRoundApprovals = b.reviews.filter((r) => r.round === b.approvalRound);
    const alreadyApprovedByMe = currentRoundApprovals.some((r) => r.reviewerId === user.id);

    return {
      ...b,
      studentCount: b._count.students,
      districtApprovalCount: currentRoundApprovals.length,
      alreadyApprovedByMe
    };
  });
}
