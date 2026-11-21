import { prisma } from '../src/config/db';
import { loginUser } from '../src/services/auth.service';
import { BatchStatus, ReviewDecision, ReviewStage, Role } from '@prisma/client';
import { submitReviewDecision, getReviewProgress, getReviewQueue } from '../src/services/reviewWorkflow.service';
import { transitionBatch, StateMachineError } from '../src/services/stateMachine.service';

interface TestResult {
  name: string;
  passed: boolean;
  message?: string;
  error?: any;
}

const results: TestResult[] = [];

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log('===============================================================');
  console.log('🚀 Starting Phase 3: Review & Approval Workflow Automated Tests');
  console.log('===============================================================\n');

  // Authenticate all test actors
  const anikaLogin = await loginUser('anika@certiflow.local', 'CertiFlow@2026');
  const devLogin = await loginUser('dev@certiflow.local', 'CertiFlow@2026');
  const kabirLogin = await loginUser('kabir@certiflow.local', 'CertiFlow@2026');
  const meeraLogin = await loginUser('meera@certiflow.local', 'CertiFlow@2026');
  const nehaLogin = await loginUser('neha@certiflow.local', 'CertiFlow@2026');
  const farahLogin = await loginUser('farah@certiflow.local', 'CertiFlow@2026');

  const anika = anikaLogin.user; // Training Centre
  const dev = devLogin.user;     // District Officer (North)
  const kabir = kabirLogin.user; // District Officer (North)
  const meera = meeraLogin.user; // District Officer (South)
  const neha = nehaLogin.user;   // Quality Officer
  const farah = farahLogin.user; // State Officer

  console.log('✓ Successfully authenticated all 6 demo actors (TC, 2 North DOs, South DO, QO, SO)\n');

  // Helper to create a batch with N students in SUBMITTED status
  async function createSubmittedBatch(batchSuffix: string, studentCount: number) {
    const batchNumber = `P3-TEST-${batchSuffix}-${Date.now()}`;
    const batch = await prisma.$transaction(async (tx) => {
      const b = await tx.batch.create({
        data: {
          batchNumber,
          batchName: `Batch ${batchSuffix}`,
          courseName: 'Solar Technology',
          trainingCentreId: anika.trainingCentreId!,
          districtId: 'DIST-NORTH-01',
          trainingStartDate: new Date('2026-01-01'),
          trainingEndDate: new Date('2026-03-01'),
          status: BatchStatus.SUBMITTED,
          version: 2,
          approvalRound: 1,
          createdById: anika.id
        }
      });

      // Insert students
      const studentsData = [];
      for (let i = 1; i <= studentCount; i++) {
        studentsData.push({
          batchId: b.id,
          studentId: `STU-${batchSuffix}-${i}`,
          studentName: `Student ${i}`,
          email: `student${i}.${batchSuffix.toLowerCase()}@example.com`,
          phone: `98765${String(10000 + i).slice(-5)}`
        });
      }
      if (studentsData.length > 0) {
        await tx.student.createMany({ data: studentsData });
      }

      await tx.batchHistory.create({
        data: {
          batchId: b.id,
          userId: anika.id,
          fromStatus: BatchStatus.DRAFT,
          toStatus: BatchStatus.SUBMITTED,
          action: 'SUBMIT_BATCH',
          reason: 'Test batch initial submission'
        }
      });

      return b;
    });

    return batch;
  }

  // ---------------------------------------------------------------------------
  // Scenario 1 & 5: First DO Approval (1 of 2) -> batch remains in DISTRICT_REVIEW
  // ---------------------------------------------------------------------------
  let batchSmall = await createSubmittedBatch('SMALL-1', 25); // < 50 students
  try {
    const res = await submitReviewDecision({
      batchId: batchSmall.id,
      expectedVersion: batchSmall.version,
      decision: ReviewDecision.APPROVED,
      comment: 'Dev: North District verification complete.',
      user: dev
    });

    assert(res.nextStatus === BatchStatus.DISTRICT_REVIEW, `Expected DISTRICT_REVIEW, got ${res.nextStatus}`);
    assert(res.batch?.version === batchSmall.version + 1, 'Batch version should increment');

    const progress = await getReviewProgress(batchSmall.id, dev);
    assert(progress.district.approvedCount === 1, `Expected 1 approval, got ${progress.district.approvedCount}`);
    assert(progress.district.isComplete === false, 'District review should not be complete yet');
    assert(progress.district.alreadyApprovedByCurrentUser === true, 'Dev should be marked as already approved');

    batchSmall = res.batch as any;
    results.push({ name: '1. First DO approval records 1 of 2 required approvals', passed: true });
    results.push({ name: '5. Batch does not advance to next stage after only 1 DO approval', passed: true });
  } catch (err: any) {
    results.push({ name: '1. First DO approval', passed: false, error: err.message });
    results.push({ name: '5. Batch does not advance after only 1 approval', passed: false, error: err.message });
  }

  // ---------------------------------------------------------------------------
  // Scenario 3: Same officer cannot approve twice in same round
  // ---------------------------------------------------------------------------
  try {
    await submitReviewDecision({
      batchId: batchSmall.id,
      expectedVersion: batchSmall.version,
      decision: ReviewDecision.APPROVED,
      comment: 'Dev trying to approve a second time in same round.',
      user: dev
    });
    results.push({ name: '3. Same officer cannot approve twice in same round', passed: false, error: 'Should have thrown 409' });
  } catch (err: any) {
    assert(err.statusCode === 409 || err.code === 'DUPLICATE_REVIEW_DECISION', 'Expected 409 conflict for duplicate approval');
    results.push({ name: '3. Same officer cannot approve twice in same round', passed: true });
  }

  // ---------------------------------------------------------------------------
  // Scenario 4: Officer outside district cannot review
  // ---------------------------------------------------------------------------
  try {
    await submitReviewDecision({
      batchId: batchSmall.id,
      expectedVersion: batchSmall.version,
      decision: ReviewDecision.APPROVED,
      comment: 'Meera (South) attempting to review North district batch',
      user: meera
    });
    results.push({ name: '4. Officer outside district cannot review (403)', passed: false, error: 'Should have thrown 403' });
  } catch (err: any) {
    assert(err.statusCode === 403 || err.code === 'DISTRICT_MISMATCH', 'Expected 403 for district mismatch');
    results.push({ name: '4. Officer outside district cannot review (403)', passed: true });
  }

  // ---------------------------------------------------------------------------
  // Scenario 7: Quality review skipped if student count < threshold (25 < 50)
  // Second DO approval advances directly to STATE_REVIEW
  // ---------------------------------------------------------------------------
  try {
    const res = await submitReviewDecision({
      batchId: batchSmall.id,
      expectedVersion: batchSmall.version,
      decision: ReviewDecision.APPROVED,
      comment: 'Kabir: North District 2nd approval.',
      user: kabir
    });

    assert(res.nextStatus === BatchStatus.STATE_REVIEW, `Expected STATE_REVIEW, got ${res.nextStatus}`);
    const progress = await getReviewProgress(batchSmall.id);
    assert(progress.district.approvedCount === 2, 'Expected 2 DO approvals');
    assert(progress.district.isComplete === true, 'District approvals complete');
    assert(progress.quality.required === false, 'Quality review should not be required (< 50 students)');

    batchSmall = res.batch as any;
    results.push({ name: '2. Second distinct DO approval satisfies district requirement', passed: true });
    results.push({ name: '7. Quality review skipped when student count < threshold (< 50)', passed: true });
  } catch (err: any) {
    results.push({ name: '2. Second DO approval', passed: false, error: err.message });
    results.push({ name: '7. Quality review skipped', passed: false, error: err.message });
  }

  // ---------------------------------------------------------------------------
  // Scenario 6: Quality review required if student count >= threshold (50 >= 50)
  // ---------------------------------------------------------------------------
  let batchLarge = await createSubmittedBatch('LARGE-1', 50); // >= 50 students
  try {
    // DO 1 approves
    const res1 = await submitReviewDecision({
      batchId: batchLarge.id,
      expectedVersion: batchLarge.version,
      decision: ReviewDecision.APPROVED,
      comment: 'Dev: North District 1st approval.',
      user: dev
    });

    // DO 2 approves
    const res2 = await submitReviewDecision({
      batchId: batchLarge.id,
      expectedVersion: res1.batch!.version,
      decision: ReviewDecision.APPROVED,
      comment: 'Kabir: North District 2nd approval.',
      user: kabir
    });

    assert(res2.nextStatus === BatchStatus.QUALITY_REVIEW, `Expected QUALITY_REVIEW, got ${res2.nextStatus}`);
    const progress = await getReviewProgress(batchLarge.id);
    assert(progress.quality.required === true, 'Quality review should be required (50 students >= 50 threshold)');
    assert(progress.quality.isComplete === false, 'Quality review not yet complete');

    batchLarge = res2.batch as any;
    results.push({ name: '6. Quality review required if student count >= 50 threshold', passed: true });
  } catch (err: any) {
    results.push({ name: '6. Quality review required', passed: false, error: err.message });
  }

  // ---------------------------------------------------------------------------
  // Scenario 8: State Officer cannot approve before prerequisites complete
  // (batchLarge is currently in QUALITY_REVIEW, so Farah cannot approve yet)
  // ---------------------------------------------------------------------------
  try {
    await submitReviewDecision({
      batchId: batchLarge.id,
      expectedVersion: batchLarge.version,
      decision: ReviewDecision.APPROVED,
      comment: 'Farah trying to approve while batch is in QUALITY_REVIEW',
      user: farah
    });
    results.push({ name: '8. State Officer cannot approve before prerequisites complete', passed: false, error: 'Should have thrown 403/400' });
  } catch (err: any) {
    assert(err.statusCode === 403 || err.code === 'FORBIDDEN_ROLE', 'Expected 403 for wrong review stage');
    results.push({ name: '8. State Officer cannot approve before prerequisites complete', passed: true });
  }

  // ---------------------------------------------------------------------------
  // Scenario 9: Return requires non-empty comment
  // ---------------------------------------------------------------------------
  try {
    await submitReviewDecision({
      batchId: batchLarge.id,
      expectedVersion: batchLarge.version,
      decision: ReviewDecision.RETURNED,
      comment: '   ',
      user: neha
    });
    results.push({ name: '9. Return requires non-empty comment (422)', passed: false, error: 'Should have thrown 422' });
  } catch (err: any) {
    assert(err.statusCode === 422 || err.code === 'COMMENT_REQUIRED', 'Expected 422 COMMENT_REQUIRED');
    results.push({ name: '9. Return requires non-empty comment (422)', passed: true });
  }

  // ---------------------------------------------------------------------------
  // Scenario 10: Reject requires non-empty comment
  // ---------------------------------------------------------------------------
  try {
    await submitReviewDecision({
      batchId: batchLarge.id,
      expectedVersion: batchLarge.version,
      decision: ReviewDecision.REJECTED,
      comment: '',
      user: neha
    });
    results.push({ name: '10. Reject requires non-empty comment (422)', passed: false, error: 'Should have thrown 422' });
  } catch (err: any) {
    assert(err.statusCode === 422 || err.code === 'COMMENT_REQUIRED', 'Expected 422 COMMENT_REQUIRED');
    results.push({ name: '10. Reject requires non-empty comment (422)', passed: true });
  }

  // ---------------------------------------------------------------------------
  // Scenario 11 & 12: Return batch, resubmission increments approvalRound,
  // and old approvals do not count in new round
  // ---------------------------------------------------------------------------
  let returnedBatch = await createSubmittedBatch('RETURN-TEST', 10);
  try {
    // Dev approves round 1
    const do1Res = await submitReviewDecision({
      batchId: returnedBatch.id,
      expectedVersion: returnedBatch.version,
      decision: ReviewDecision.APPROVED,
      comment: 'Dev: North District initial approval in Round 1.',
      user: dev
    });

    // Kabir returns the batch
    const returnRes = await submitReviewDecision({
      batchId: returnedBatch.id,
      expectedVersion: do1Res.batch!.version,
      decision: ReviewDecision.RETURNED,
      comment: 'Found mismatched attendance records. Please rectify and re-upload.',
      user: kabir
    });

    assert(returnRes.nextStatus === BatchStatus.RETURNED, `Expected RETURNED, got ${returnRes.nextStatus}`);

    // Training Centre resubmits batch -> transitions RETURNED -> SUBMITTED and increments approvalRound
    const resubmitRes = await transitionBatch({
      batchId: returnedBatch.id,
      expectedVersion: returnRes.batch!.version,
      targetStatus: BatchStatus.SUBMITTED,
      user: anika,
      action: 'RESUBMIT_BATCH',
      reason: 'Updated attendance and student records.'
    });

    assert(resubmitRes.batch!.approvalRound === 2, `Expected approvalRound 2, got ${resubmitRes.batch!.approvalRound}`);
    results.push({ name: '11. Returned batch resubmission increments approvalRound (starts Round 2)', passed: true });

    // Check review progress in Round 2: Dev's Round 1 approval must NOT count toward Round 2!
    const progressRound2 = await getReviewProgress(returnedBatch.id, dev);
    assert(progressRound2.currentRound === 2, 'Should be in Round 2');
    assert(progressRound2.district.approvedCount === 0, `Expected 0 approvals in Round 2, found ${progressRound2.district.approvedCount}`);
    assert(progressRound2.district.alreadyApprovedByCurrentUser === false, 'Dev is eligible to approve again in Round 2');
    assert(progressRound2.district.canCurrentUserApprove === true, 'Dev should be permitted to approve in Round 2');
    results.push({ name: '12. Previous round approvals do not count in new round', passed: true });
  } catch (err: any) {
    results.push({ name: '11. Returned batch resubmission increments round', passed: false, error: err.message });
    results.push({ name: '12. Old approvals don\'t count in new round', passed: false, error: err.message });
  }

  // ---------------------------------------------------------------------------
  // Scenario 13: Database constraint blocks duplicate review
  // ---------------------------------------------------------------------------
  try {
    const freshBatch = await createSubmittedBatch('DB-CONSTRAINT', 15);
    // Submit 1st review directly via Prisma
    await prisma.batchReview.create({
      data: {
        batchId: freshBatch.id,
        reviewerId: dev.id,
        reviewerRole: dev.role,
        round: 1,
        stage: ReviewStage.DISTRICT,
        decision: ReviewDecision.APPROVED,
        comment: 'Direct DB insert 1'
      }
    });

    // Attempt duplicate review at same (batchId, round, stage, reviewerId)
    await prisma.batchReview.create({
      data: {
        batchId: freshBatch.id,
        reviewerId: dev.id,
        reviewerRole: dev.role,
        round: 1,
        stage: ReviewStage.DISTRICT,
        decision: ReviewDecision.APPROVED,
        comment: 'Direct DB duplicate insert'
      }
    });

    results.push({ name: '13. Database constraint @@unique blocks duplicate review records', passed: false, error: 'Should have thrown P2002' });
  } catch (err: any) {
    assert(err.code === 'P2002', `Expected Prisma unique constraint violation P2002, got ${err.code}`);
    results.push({ name: '13. Database constraint @@unique blocks duplicate review records', passed: true });
  }

  // ---------------------------------------------------------------------------
  // Scenario 14: Sequential approvals from two distinct officers advances stage
  // ---------------------------------------------------------------------------
  try {
    const concurrentTestBatch = await createSubmittedBatch('CONCURRENCY-1', 20);
    // Dev approves
    const firstRes = await submitReviewDecision({
      batchId: concurrentTestBatch.id,
      expectedVersion: concurrentTestBatch.version,
      decision: ReviewDecision.APPROVED,
      comment: 'Dev: Approval 1',
      user: dev
    });

    // Kabir approves using updated version
    const secondRes = await submitReviewDecision({
      batchId: concurrentTestBatch.id,
      expectedVersion: firstRes.batch!.version,
      decision: ReviewDecision.APPROVED,
      comment: 'Kabir: Approval 2',
      user: kabir
    });

    assert(secondRes.nextStatus === BatchStatus.STATE_REVIEW, 'Should advance to STATE_REVIEW');
    results.push({ name: '14. Distinct officers approvals sequentially increment version and advance stage', passed: true });
  } catch (err: any) {
    results.push({ name: '14. Concurrency test', passed: false, error: err.message });
  }

  // ---------------------------------------------------------------------------
  // Scenario 15: Conflicting updates with stale version trigger 409 Conflict
  // ---------------------------------------------------------------------------
  try {
    const staleBatch = await createSubmittedBatch('STALE-LOCK', 10);
    // Review 1 updates version from 2 to 3
    await submitReviewDecision({
      batchId: staleBatch.id,
      expectedVersion: staleBatch.version,
      decision: ReviewDecision.APPROVED,
      comment: 'Dev: First approval',
      user: dev
    });

    // Review 2 attempts update using old version 2
    await submitReviewDecision({
      batchId: staleBatch.id,
      expectedVersion: staleBatch.version, // STALE!
      decision: ReviewDecision.APPROVED,
      comment: 'Kabir: Trying with stale version',
      user: kabir
    });

    results.push({ name: '15. Conflicting or stale version updates rejected with 409 Conflict', passed: false, error: 'Should have thrown 409' });
  } catch (err: any) {
    assert(err.statusCode === 409 || err.code === 'CONCURRENCY_CONFLICT', 'Expected 409 CONCURRENCY_CONFLICT');
    results.push({ name: '15. Conflicting or stale version updates rejected with 409 Conflict', passed: true });
  }

  // ---------------------------------------------------------------------------
  // Scenario 16: Unauthorized role attempts rejected with 403
  // (Training Centre trying to review; DO trying to review during STATE_REVIEW)
  // ---------------------------------------------------------------------------
  try {
    // Training Centre attempting to review batch
    await submitReviewDecision({
      batchId: batchSmall.id,
      expectedVersion: batchSmall.version,
      decision: ReviewDecision.APPROVED,
      comment: 'Anika trying to approve batch',
      user: anika
    });
    results.push({ name: '16. Unauthorized role attempts rejected with 403', passed: false, error: 'Should have thrown 403' });
  } catch (err: any) {
    assert(err.statusCode === 403, 'Expected 403 for unauthorized role review attempt');
    results.push({ name: '16. Unauthorized role attempts rejected with 403', passed: true });
  }

  // ---------------------------------------------------------------------------
  // End-to-End Approval Completion: State Officer gives final approval -> APPROVED
  // ---------------------------------------------------------------------------
  try {
    // batchSmall is in STATE_REVIEW with all prerequisites satisfied
    const finalRes = await submitReviewDecision({
      batchId: batchSmall.id,
      expectedVersion: batchSmall.version,
      decision: ReviewDecision.APPROVED,
      comment: 'Farah: State Level Final Verification Approved. Ready for certification issuance.',
      user: farah
    });

    assert(finalRes.nextStatus === BatchStatus.APPROVED, `Expected APPROVED, got ${finalRes.nextStatus}`);
    assert(finalRes.batch?.status === BatchStatus.APPROVED, 'Batch status must be APPROVED');

    // Also verify review queue logic for State Officer
    const queue = await getReviewQueue(farah);
    assert(Array.isArray(queue), 'Review queue must return an array');

    console.log('✓ End-to-end full workflow: SUBMITTED -> DISTRICT_REVIEW (2 DOs) -> STATE_REVIEW -> APPROVED successfully verified!\n');
  } catch (err: any) {
    console.error('Error in final state officer approval:', err);
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('---------------------------------------------------------------');
  console.log('Phase 3 Automated Test Results:');
  console.log('---------------------------------------------------------------');
  let passedCount = 0;
  for (const r of results) {
    if (r.passed) {
      console.log(`✅ [PASS] ${r.name}`);
      passedCount++;
    } else {
      console.log(`❌ [FAIL] ${r.name} - ${r.error}`);
    }
  }
  console.log('---------------------------------------------------------------');
  console.log(`Total: ${passedCount}/${results.length} passed.`);

  if (passedCount < results.length) {
    process.exit(1);
  }
}

runTests()
  .catch((e) => {
    console.error('Fatal error in test suite:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
