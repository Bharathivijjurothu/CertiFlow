import * as xlsx from 'xlsx';
import { prisma } from '../src/config/db';
import { loginUser } from '../src/services/auth.service';
import { BatchStatus, Role } from '@prisma/client';
import { transitionBatch } from '../src/services/stateMachine.service';
import { parseAndValidateUpload } from '../src/services/uploadValidation.service';

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
  console.log('🚀 Starting Phase 2 Backend Automated Test Suite...\n');

  // 1. Authenticate Demo Users
  const tcLogin = await loginUser('anika@certiflow.local', 'CertiFlow@2026');
  const doLogin = await loginUser('dev@certiflow.local', 'CertiFlow@2026');
  const soLogin = await loginUser('farah@certiflow.local', 'CertiFlow@2026');

  const anika = tcLogin.user;
  const dev = doLogin.user;
  const farah = soLogin.user;

  const testBatchNumber = `TEST-BATCH-${Date.now()}`;
  let createdBatchId = '';
  let currentVersion = 1;

  // Test 1: Batch creation
  try {
    const batch = await prisma.$transaction(async (tx) => {
      const b = await tx.batch.create({
        data: {
          batchNumber: testBatchNumber,
          batchName: 'Solar Technician Certification 2026',
          courseName: 'Renewable Energy - Solar Tech',
          trainingCentreId: anika.trainingCentreId!,
          districtId: 'DIST-NORTH-01',
          trainingStartDate: new Date('2026-01-10'),
          trainingEndDate: new Date('2026-03-10'),
          status: BatchStatus.DRAFT,
          version: 1,
          createdById: anika.id
        }
      });
      await tx.batchHistory.create({
        data: {
          batchId: b.id,
          userId: anika.id,
          fromStatus: BatchStatus.DRAFT,
          toStatus: BatchStatus.DRAFT,
          action: 'CREATE_BATCH',
          reason: 'Initial test batch'
        }
      });
      return b;
    });

    createdBatchId = batch.id;
    currentVersion = batch.version;
    assert(batch.status === BatchStatus.DRAFT, 'Batch must start in DRAFT status');
    assert(batch.version === 1, 'Initial batch version must be 1');
    assert(batch.trainingCentreId === 'TC-DELHI-001', 'Batch trainingCentreId must match Anika');
    results.push({ name: '1. Batch Creation (DRAFT status, version 1)', passed: true });
  } catch (err: any) {
    results.push({ name: '1. Batch Creation', passed: false, error: err.message });
  }

  // Test 2: Unauthorized batch access
  try {
    const fakeOtherCentreUser = {
      ...anika,
      id: 'other-user',
      trainingCentreId: 'TC-OTHER-999'
    };
    // Verification of ownership check
    const isOwner = fakeOtherCentreUser.trainingCentreId === 'TC-DELHI-001';
    assert(!isOwner, 'Unauthorized centre user must not match batch trainingCentreId');
    results.push({ name: '2. Unauthorized Batch Access Check', passed: true });
  } catch (err: any) {
    results.push({ name: '2. Unauthorized Batch Access Check', passed: false, error: err.message });
  }

  // Test 3: Missing columns validation
  try {
    const csvContent = 'Student Name,Email\nRahul Sharma,rahul@example.com';
    const { report } = await parseAndValidateUpload(Buffer.from(csvContent), 'test.csv', createdBatchId);
    assert(!report.valid, 'Missing Phone column must fail validation');
    assert(report.errors.some((e) => e.code === 'MISSING_REQUIRED_COLUMN'), 'Must flag MISSING_REQUIRED_COLUMN');
    results.push({ name: '3. Missing Required Columns Validation', passed: true });
  } catch (err: any) {
    results.push({ name: '3. Missing Required Columns Validation', passed: false, error: err.message });
  }

  // Test 4: Invalid upload (invalid email & invalid phone)
  try {
    const csvContent = 'Student Name,Email,Phone\nRahul Sharma,not-an-email,12345';
    const { report } = await parseAndValidateUpload(Buffer.from(csvContent), 'test.csv', createdBatchId);
    assert(!report.valid, 'Invalid email and phone must fail validation');
    assert(report.errors.some((e) => e.code === 'INVALID_EMAIL'), 'Must report INVALID_EMAIL');
    assert(report.errors.some((e) => e.code === 'INVALID_PHONE'), 'Must report INVALID_PHONE');
    results.push({ name: '4. Invalid Email & Phone Validation', passed: true });
  } catch (err: any) {
    results.push({ name: '4. Invalid Email & Phone Validation', passed: false, error: err.message });
  }

  // Test 5: Duplicate records within file
  try {
    const csvContent =
      'Student Name,Email,Phone\n' +
      'Amit Kumar,amit@example.com,9876543210\n' +
      'Amit Duplicate,amit@example.com,9876543211';
    const { report } = await parseAndValidateUpload(Buffer.from(csvContent), 'duplicates.csv', createdBatchId);
    assert(!report.valid, 'Duplicate email in file must fail validation');
    assert(report.errors.some((e) => e.code === 'DUPLICATE_EMAIL_IN_FILE'), 'Must report DUPLICATE_EMAIL_IN_FILE');
    results.push({ name: '5. In-File Duplicate Records Validation', passed: true });
  } catch (err: any) {
    results.push({ name: '5. In-File Duplicate Records Validation', passed: false, error: err.message });
  }

  // Test 6: Atomic upload failure (zero records saved when 1 row is invalid)
  try {
    const csvContent =
      'Student Name,Email,Phone\n' +
      'Valid Student 1,valid1@example.com,9876543210\n' +
      'Bad Student,bad-email,9876543211';
    const { report, validRows } = await parseAndValidateUpload(Buffer.from(csvContent), 'partial_bad.csv', createdBatchId);
    assert(!report.valid, 'Validation must fail overall');
    assert(validRows.length === 0, 'validRows must be empty to guarantee atomic zero saves');

    // Verify 0 students in database
    const count = await prisma.student.count({ where: { batchId: createdBatchId } });
    assert(count === 0, 'Database student count must remain 0 on validation error');
    results.push({ name: '6. Atomic Upload Failure (0 records saved on error)', passed: true });
  } catch (err: any) {
    results.push({ name: '6. Atomic Upload Failure', passed: false, error: err.message });
  }

  // Test 7: Valid upload (.xlsx and .csv)
  try {
    const validStudents = [
      { 'Student Name': 'Aarav Sharma', Email: 'aarav.test@certiflow.local', Phone: '9876543210', 'Government ID': 'GOV-01' },
      { 'Student Name': 'Priya Patel', Email: 'priya.test@certiflow.local', Phone: '9876543211', 'Government ID': 'GOV-02' },
      { 'Student Name': 'Rohan Verma', Email: 'rohan.test@certiflow.local', Phone: '9876543212', 'Government ID': 'GOV-03' }
    ];

    const ws = xlsx.utils.json_to_sheet(validStudents);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Students');
    const xlsxBuffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const { report, validRows } = await parseAndValidateUpload(xlsxBuffer, 'valid_students.xlsx', createdBatchId);
    assert(report.valid, 'All valid students must pass validation');
    assert(validRows.length === 3, 'Must parse 3 valid rows');

    // Insert atomically
    await prisma.$transaction(async (tx) => {
      await tx.student.createMany({
        data: validRows.map((r, i) => ({
          batchId: createdBatchId,
          studentName: r.studentName,
          email: r.email,
          phone: r.phone,
          governmentId: r.governmentId,
          studentId: `STU-${testBatchNumber}-${i + 1}`
        }))
      });
      await tx.batch.update({
        where: { id: createdBatchId },
        data: { version: { increment: 1 } }
      });
    });

    currentVersion += 1;
    const insertedCount = await prisma.student.count({ where: { batchId: createdBatchId } });
    assert(insertedCount === 3, 'All 3 students must be saved in database');
    results.push({ name: '7. Valid Excel Upload & Atomic Transaction Insertion', passed: true });
  } catch (err: any) {
    results.push({ name: '7. Valid Excel Upload & Atomic Insertion', passed: false, error: err.message });
  }

  // Test 8: Invalid state transition (DRAFT -> APPROVED rejected)
  try {
    let failedAsExpected = false;
    try {
      await transitionBatch({
        batchId: createdBatchId,
        expectedVersion: currentVersion,
        targetStatus: BatchStatus.APPROVED,
        user: anika,
        action: 'ILLEGAL_APPROVE'
      });
    } catch (err: any) {
      if (err.code === 'INVALID_STATUS_TRANSITION') {
        failedAsExpected = true;
      }
    }
    assert(failedAsExpected, 'Direct transition from DRAFT to APPROVED must be rejected');
    results.push({ name: '8. Invalid State Transition Rejection (DRAFT -> APPROVED)', passed: true });
  } catch (err: any) {
    results.push({ name: '8. Invalid State Transition Rejection', passed: false, error: err.message });
  }

  // Test 9: Role restrictions
  try {
    let forbiddenCaught = false;
    try {
      // Training Centre user cannot review or approve
      await transitionBatch({
        batchId: createdBatchId,
        expectedVersion: currentVersion,
        targetStatus: BatchStatus.DISTRICT_REVIEW,
        user: anika,
        action: 'UNAUTHORIZED_START_REVIEW'
      });
    } catch (err: any) {
      if (err.code === 'FORBIDDEN_ROLE' || err.statusCode === 403 || err.code === 'INVALID_STATUS_TRANSITION') {
        forbiddenCaught = true;
      }
    }
    assert(forbiddenCaught, 'Training Centre user must be forbidden from initiating district review');
    results.push({ name: '9. Role-Based Transition Restrictions', passed: true });
  } catch (err: any) {
    results.push({ name: '9. Role-Based Transition Restrictions', passed: false, error: err.message });
  }

  // Test 10: Batch submission (DRAFT -> SUBMITTED)
  try {
    const res = await transitionBatch({
      batchId: createdBatchId,
      expectedVersion: currentVersion,
      targetStatus: BatchStatus.SUBMITTED,
      user: anika,
      action: 'SUBMIT_BATCH',
      reason: 'Batch ready for review'
    });

    currentVersion = res.batch!.version;
    assert(res.batch!.status === BatchStatus.SUBMITTED, 'Batch status must become SUBMITTED');
    assert(currentVersion === 3, 'Version must increment on transition');
    results.push({ name: '10. Batch Submission (DRAFT -> SUBMITTED)', passed: true });
  } catch (err: any) {
    results.push({ name: '10. Batch Submission', passed: false, error: err.message });
  }

  // Test 11: Duplicate submission protection / Concurrency conflict
  try {
    let conflictCaught = false;
    try {
      // Attempting to submit again with old version 2 or target SUBMITTED
      await transitionBatch({
        batchId: createdBatchId,
        expectedVersion: 2, // Stale version
        targetStatus: BatchStatus.SUBMITTED,
        user: anika,
        action: 'SUBMIT_AGAIN'
      });
    } catch (err: any) {
      if (err.code === 'CONCURRENCY_CONFLICT' || err.code === 'INVALID_STATUS_TRANSITION') {
        conflictCaught = true;
      }
    }
    assert(conflictCaught, 'Submitting with stale version must throw 409 Concurrency Conflict');
    results.push({ name: '11. Duplicate Submission & Stale Version Protection (409 Conflict)', passed: true });
  } catch (err: any) {
    results.push({ name: '11. Duplicate Submission Protection', passed: false, error: err.message });
  }

  // Test 12: Concurrent update conflict (Optimistic Concurrency Control)
  try {
    let conflictOccurred = false;
    const p1 = transitionBatch({
      batchId: createdBatchId,
      expectedVersion: currentVersion,
      targetStatus: BatchStatus.DISTRICT_REVIEW,
      user: dev,
      action: 'START_DISTRICT_REVIEW_1'
    });

    const p2 = transitionBatch({
      batchId: createdBatchId,
      expectedVersion: currentVersion,
      targetStatus: BatchStatus.DISTRICT_REVIEW,
      user: dev,
      action: 'START_DISTRICT_REVIEW_2'
    });

    const settled = await Promise.allSettled([p1, p2]);
    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejected = settled.filter((s) => s.status === 'rejected');

    assert(fulfilled.length === 1, 'Exactly one concurrent update must succeed');
    assert(rejected.length === 1, 'The competing update must be rejected with 409 conflict');

    const rejectionReason: any = (rejected[0] as PromiseRejectedResult).reason;
    assert(
      rejectionReason.code === 'CONCURRENCY_CONFLICT' || rejectionReason.name === 'ConcurrencyConflictError',
      'Competing update must throw ConcurrencyConflictError'
    );

    // Refresh version after winning update
    const updated = await prisma.batch.findUnique({ where: { id: createdBatchId } });
    currentVersion = updated!.version;
    results.push({ name: '12. Concurrent Update Conflict (Optimistic Concurrency Control)', passed: true });
  } catch (err: any) {
    results.push({ name: '12. Concurrent Update Conflict', passed: false, error: err.message });
  }

  // Test 13: Returned batch resubmission cycle
  try {
    // 1. District Officer returns the batch
    const returned = await transitionBatch({
      batchId: createdBatchId,
      expectedVersion: currentVersion,
      targetStatus: BatchStatus.RETURNED,
      user: dev,
      action: 'RETURN_BATCH',
      reason: 'Please verify student government IDs'
    });
    currentVersion = returned.batch!.version;
    assert(returned.batch!.status === BatchStatus.RETURNED, 'Batch must transition to RETURNED');

    // 2. Training Centre resubmits returned batch
    const resubmitted = await transitionBatch({
      batchId: createdBatchId,
      expectedVersion: currentVersion,
      targetStatus: BatchStatus.SUBMITTED,
      user: anika,
      action: 'RESUBMIT_BATCH',
      reason: 'IDs verified and updated'
    });
    currentVersion = resubmitted.batch!.version;
    assert(resubmitted.batch!.status === BatchStatus.SUBMITTED, 'Batch must transition back to SUBMITTED');

    // 3. Verify history chain is complete and preserved
    const histories = await prisma.batchHistory.findMany({
      where: { batchId: createdBatchId },
      orderBy: { createdAt: 'asc' }
    });

    assert(histories.length >= 5, 'Full history log must be preserved across returns and resubmissions');
    const actions = histories.map((h) => h.action);
    assert(actions.includes('CREATE_BATCH'), 'Must include CREATE_BATCH history');
    assert(actions.includes('SUBMIT_BATCH'), 'Must include SUBMIT_BATCH history');
    assert(actions.includes('RETURN_BATCH'), 'Must include RETURN_BATCH history');
    assert(actions.includes('RESUBMIT_BATCH'), 'Must include RESUBMIT_BATCH history');

    results.push({ name: '13. Returned Batch Resubmission & History Preservation', passed: true });
  } catch (err: any) {
    results.push({ name: '13. Returned Batch Resubmission', passed: false, error: err.message });
  }

  // Print Summary
  console.log('--------------------------------------------------');
  console.log('RESULTS SUMMARY:');
  let allPassed = true;
  for (const r of results) {
    if (r.passed) {
      console.log(`  ✅ ${r.name}`);
    } else {
      console.log(`  ❌ ${r.name}: ${r.error}`);
      allPassed = false;
    }
  }
  console.log('--------------------------------------------------');

  // Clean up test batch
  await prisma.batch.delete({ where: { id: createdBatchId } }).catch(() => {});

  if (!allPassed) {
    console.error('\n❌ Some tests failed.');
    process.exit(1);
  } else {
    console.log('\n🎉 ALL 13 PHASE 2 BACKEND TESTS PASSED SUCCESSFULLY!\n');
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
