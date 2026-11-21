import fs from 'fs';
import { prisma } from '../src/config/db';
import { loginUser } from '../src/services/auth.service';
import { BatchStatus, DeliveryStatus, Role } from '@prisma/client';
import { generateCertificatesForBatch } from '../src/services/certificateGenerator.service';
import {
  queueBatchDelivery,
  deliverSingleCertificate,
  retryCertificateDelivery,
  getBatchDeliveryStatus
} from '../src/services/deliveryService';
import { WhatsAppSimulator, maskPhoneNumber } from '../src/services/whatsappSimulator.service';
import { StateMachineError } from '../src/services/stateMachine.service';

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
  console.log('🚀 Starting Phase 5: WhatsApp Certificate Delivery Automated Tests');
  console.log('===============================================================\n');

  // Authenticate test actors
  const anikaLogin = await loginUser('anika@certiflow.local', 'CertiFlow@2026');
  const devLogin = await loginUser('dev@certiflow.local', 'CertiFlow@2026');
  const meeraLogin = await loginUser('meera@certiflow.local', 'CertiFlow@2026');
  const farahLogin = await loginUser('farah@certiflow.local', 'CertiFlow@2026');

  const anika = anikaLogin.user; // Training Centre (TC-DELHI-001, DIST-NORTH-01)
  const dev = devLogin.user;     // District Officer (DIST-NORTH-01)
  const meera = meeraLogin.user; // District Officer (DIST-SOUTH-02)
  const farah = farahLogin.user; // State Officer

  console.log('✓ Successfully authenticated test actors (Anika, Dev, Meera, Farah)\n');

  // Helper to create test batch with custom students
  async function createTestBatch(
    status: BatchStatus,
    studentsInput: Array<{ name: string; phone: string; email?: string }>
  ) {
    const batchNumber = `P5-TEST-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const batch = await prisma.$transaction(async (tx) => {
      const b = await tx.batch.create({
        data: {
          batchNumber,
          batchName: 'Advanced EV Powertrain Diagnostics',
          courseName: 'Electric Vehicle Service Specialist',
          trainingCentreId: anika.trainingCentreId!,
          districtId: 'DIST-NORTH-01',
          trainingStartDate: new Date('2026-01-10'),
          trainingEndDate: new Date('2026-03-20'),
          status,
          version: 1,
          approvalRound: 1,
          createdById: anika.id
        }
      });

      const studentsData = studentsInput.map((s, idx) => ({
        batchId: b.id,
        studentId: `STU-P5-${idx + 1}-${Date.now()}`,
        studentName: s.name,
        email: s.email || `p5student${idx + 1}.${Date.now()}@certiflow.test`,
        phone: s.phone,
        grade: 'Grade A'
      }));

      await tx.student.createMany({ data: studentsData });

      await tx.batchHistory.create({
        data: {
          batchId: b.id,
          userId: anika.id,
          fromStatus: BatchStatus.DRAFT,
          toStatus: status,
          action: 'INIT_TEST_BATCH',
          reason: `Initial test batch created in status ${status}`
        }
      });

      return b;
    });

    return await prisma.batch.findUnique({
      where: { id: batch.id },
      include: { students: true }
    });
  }

  // ---------------------------------------------------------------------------
  // Scenario 1: Delivery eligibility check (unissued batches rejected with 400)
  // ---------------------------------------------------------------------------
  try {
    const draftBatch = await createTestBatch(BatchStatus.DRAFT, [
      { name: 'Aarav Patel', phone: '9876543210' }
    ]);

    let rejected = false;
    try {
      await queueBatchDelivery(draftBatch!.id, farah);
    } catch (err: any) {
      rejected = true;
      assert(err.statusCode === 400, `Expected 400 status code, got ${err.statusCode}`);
      assert(err.code === 'BATCH_NOT_ISSUED', `Expected BATCH_NOT_ISSUED code, got ${err.code}`);
    }

    assert(rejected, 'Expected delivery queueing to be rejected for DRAFT batch');
    results.push({
      name: 'Scenario 1: Delivery eligibility check rejects unissued batch',
      passed: true,
      message: 'Unissued (DRAFT) batch delivery rejected with HTTP 400 and BATCH_NOT_ISSUED'
    });
    console.log('✓ Scenario 1: Delivery eligibility check rejects unissued batch');
  } catch (err: any) {
    results.push({ name: 'Scenario 1', passed: false, error: err.message });
    console.error('✗ Scenario 1 Failed:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Scenario 2: Batch delivery queuing for ISSUED batch
  // ---------------------------------------------------------------------------
  let issuedBatch: any;
  let batchCerts: any[];
  try {
    const approvedBatch = await createTestBatch(BatchStatus.APPROVED, [
      { name: 'Kavya Sharma', phone: '9876543211' },
      { name: 'Rohan Verma', phone: '9876543212' }
    ]);

    // Generate certificates to transition to ISSUED
    const genResult = await generateCertificatesForBatch(approvedBatch!.id, farah);
    assert(genResult.certificates.length === 2, 'Expected 2 certificates generated');

    issuedBatch = await prisma.batch.findUnique({
      where: { id: approvedBatch!.id },
      include: { students: true, certificates: true }
    });
    batchCerts = issuedBatch.certificates;
    assert(issuedBatch.status === BatchStatus.ISSUED, 'Batch must be in ISSUED status');

    // Queue delivery
    const queueResult = await queueBatchDelivery(issuedBatch.id, anika);
    assert(queueResult.success === true, 'Queue result must report success');
    assert(queueResult.totalEligible === 2, `Expected 2 eligible certs, got ${queueResult.totalEligible}`);
    assert(queueResult.queuedCount === 2, `Expected 2 queued/sent, got ${queueResult.queuedCount}`);

    results.push({
      name: 'Scenario 2: Batch delivery queuing for ISSUED batch',
      passed: true,
      message: 'Batch certificates successfully queued and processed via delivery service'
    });
    console.log('✓ Scenario 2: Batch delivery queuing for ISSUED batch');
  } catch (err: any) {
    results.push({ name: 'Scenario 2', passed: false, error: err.message });
    console.error('✗ Scenario 2 Failed:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Scenario 3: Successful simulated delivery & ledger recording
  // ---------------------------------------------------------------------------
  try {
    const cert1 = batchCerts[0];
    const delivery = await prisma.certificateDelivery.findUnique({
      where: {
        certificateId_channel: {
          certificateId: cert1.id,
          channel: 'WHATSAPP'
        }
      }
    });

    assert(delivery !== null, 'Delivery record must exist in database');
    assert(delivery!.status === DeliveryStatus.SENT, `Expected SENT status, got ${delivery!.status}`);
    assert(delivery!.simulatedMessageId !== null, 'Simulated message ID must be present');
    assert(delivery!.simulatedMessageId!.startsWith('WAMID.SIMULATED.'), 'Message ID must follow simulator format');
    assert(delivery!.sentAt !== null, 'sentAt timestamp must be recorded');
    assert(delivery!.attempts === 1, `Expected 1 attempt, got ${delivery!.attempts}`);

    // Verify recent messages ledger
    const recent = WhatsAppSimulator.getRecentMessages();
    const foundMsg = recent.find((m) => m.certificateNumber === cert1.certificateNumber);
    assert(foundMsg !== undefined, 'Message must be recorded in WhatsAppSimulator ledger');
    assert(foundMsg!.status === 'DELIVERED', 'Ledger status must be DELIVERED');
    assert(foundMsg!.body.includes(cert1.certificateNumber), 'Message body must include certificate number');

    results.push({
      name: 'Scenario 3: Successful simulated delivery and ledger recording',
      passed: true,
      message: 'Delivery record marked SENT with simulatedMessageId and ledger entry'
    });
    console.log('✓ Scenario 3: Successful simulated delivery and ledger recording');
  } catch (err: any) {
    results.push({ name: 'Scenario 3', passed: false, error: err.message });
    console.error('✗ Scenario 3 Failed:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Scenario 4: Simulated failure handling (deterministic carrier timeout via 9999)
  // ---------------------------------------------------------------------------
  let failingCert: any;
  try {
    const failBatch = await createTestBatch(BatchStatus.APPROVED, [
      { name: 'Simulated Timeout User', phone: '9876549999' } // ends in 9999 -> triggers simulated timeout
    ]);
    await generateCertificatesForBatch(failBatch!.id, farah);

    failingCert = await prisma.certificate.findFirst({
      where: { batchId: failBatch!.id }
    });
    assert(failingCert !== null, 'Failing certificate must exist');

    const result = await deliverSingleCertificate(failingCert.id);

    // Initial failure should be QUEUED for retry (attempt 1 < maxAttempts 3)
    assert(result.status === DeliveryStatus.QUEUED, `Expected QUEUED status on first timeout, got ${result.status}`);
    assert(result.attempts === 1, `Expected attempts = 1, got ${result.attempts}`);
    assert(result.errorCode === 'GATEWAY_TIMEOUT', `Expected GATEWAY_TIMEOUT error code, got ${result.errorCode}`);
    assert(result.errorMessage !== null && result.errorMessage.includes('SIMULATED_CARRIER_TIMEOUT'), 'Error message must reflect simulated timeout');

    // Verify attempt log
    const logs = await prisma.deliveryAttemptLog.findMany({
      where: { deliveryId: result.id }
    });
    assert(logs.length === 1, `Expected 1 attempt log, got ${logs.length}`);
    assert(logs[0].status === DeliveryStatus.FAILED, 'Attempt log status must be FAILED');

    results.push({
      name: 'Scenario 4: Simulated failure handling (gateway timeout)',
      passed: true,
      message: 'Transient carrier timeout properly recorded as QUEUED with attempt count 1 and attempt log'
    });
    console.log('✓ Scenario 4: Simulated failure handling (gateway timeout)');
  } catch (err: any) {
    results.push({ name: 'Scenario 4', passed: false, error: err.message });
    console.error('✗ Scenario 4 Failed:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Scenario 5: Automatic retry tracking with attempt count increment
  // ---------------------------------------------------------------------------
  try {
    // Perform second delivery attempt
    const secondAttempt = await deliverSingleCertificate(failingCert.id, {
      forceRetry: true,
      failSimulated: true
    });

    assert(secondAttempt.attempts === 2, `Expected attempts = 2, got ${secondAttempt.attempts}`);
    assert(secondAttempt.status === DeliveryStatus.QUEUED, `Expected status QUEUED on attempt 2, got ${secondAttempt.status}`);

    const logs = await prisma.deliveryAttemptLog.findMany({
      where: { deliveryId: secondAttempt.id },
      orderBy: { attemptNumber: 'asc' }
    });
    assert(logs.length === 2, `Expected 2 attempt logs, got ${logs.length}`);
    assert(logs[1].attemptNumber === 2, `Second log attempt number must be 2, got ${logs[1].attemptNumber}`);

    results.push({
      name: 'Scenario 5: Automatic retry tracking with attempt count increment',
      passed: true,
      message: 'Second retry incremented attempt counter to 2 and retained QUEUED status'
    });
    console.log('✓ Scenario 5: Automatic retry tracking with attempt count increment');
  } catch (err: any) {
    results.push({ name: 'Scenario 5', passed: false, error: err.message });
    console.error('✗ Scenario 5 Failed:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Scenario 6: Maximum retry limit (transitions to FAILED)
  // ---------------------------------------------------------------------------
  try {
    // Perform third delivery attempt (reaches maxAttempts = 3)
    const thirdAttempt = await deliverSingleCertificate(failingCert.id, {
      forceRetry: true,
      failSimulated: true
    });

    assert(thirdAttempt.attempts === 3, `Expected attempts = 3, got ${thirdAttempt.attempts}`);
    assert(thirdAttempt.status === DeliveryStatus.FAILED, `Expected status FAILED after max attempts, got ${thirdAttempt.status}`);

    results.push({
      name: 'Scenario 6: Maximum retry limit transitions to FAILED',
      passed: true,
      message: 'Reached max attempts (3/3), delivery status transitioned to permanent FAILED'
    });
    console.log('✓ Scenario 6: Maximum retry limit transitions to FAILED');
  } catch (err: any) {
    results.push({ name: 'Scenario 6', passed: false, error: err.message });
    console.error('✗ Scenario 6 Failed:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Scenario 7: Manual retry functionality (resets attempts & re-delivers)
  // ---------------------------------------------------------------------------
  try {
    // Update student phone so it doesn't deterministically fail
    await prisma.student.update({
      where: { id: failingCert.studentId },
      data: { phone: '9876543299' } // Non-9999 ending
    });

    const manualRetryResult = await retryCertificateDelivery(failingCert.id, anika);
    assert(manualRetryResult.status === DeliveryStatus.SENT, `Expected SENT status on manual retry, got ${manualRetryResult.status}`);
    assert(manualRetryResult.attempts === 1, `Attempts should reset and be 1 on manual retry, got ${manualRetryResult.attempts}`);
    assert(manualRetryResult.errorCode === null, 'Error code must be cleared on successful manual retry');
    assert(manualRetryResult.simulatedMessageId !== null, 'Simulated message ID must be recorded');

    results.push({
      name: 'Scenario 7: Manual retry functionality',
      passed: true,
      message: 'Authorized user manually retried failed delivery, resetting attempts and transitioning to SENT'
    });
    console.log('✓ Scenario 7: Manual retry functionality');
  } catch (err: any) {
    results.push({ name: 'Scenario 7', passed: false, error: err.message });
    console.error('✗ Scenario 7 Failed:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Scenario 8: Duplicate delivery prevention (Idempotency)
  // ---------------------------------------------------------------------------
  try {
    const cert1 = batchCerts[0];
    const prevDelivery = await prisma.certificateDelivery.findUnique({
      where: {
        certificateId_channel: {
          certificateId: cert1.id,
          channel: 'WHATSAPP'
        }
      }
    });
    assert(prevDelivery!.status === DeliveryStatus.SENT, 'Certificate 1 must already be SENT');

    // Calling deliverSingleCertificate without forceRetry must be a no-op
    const noopResult = await deliverSingleCertificate(cert1.id);
    assert(noopResult.attempts === prevDelivery!.attempts, 'Attempts must not increment on duplicate call');
    assert(noopResult.simulatedMessageId === prevDelivery!.simulatedMessageId, 'Message ID must remain unchanged');

    // Queuing batch delivery again should detect alreadySentCount
    const batchRequeue = await queueBatchDelivery(issuedBatch.id, anika);
    assert(batchRequeue.alreadySentCount === 2, `Expected 2 already sent, got ${batchRequeue.alreadySentCount}`);
    assert(batchRequeue.queuedCount === 0, `Expected 0 new queued, got ${batchRequeue.queuedCount}`);

    results.push({
      name: 'Scenario 8: Duplicate delivery prevention (Idempotency)',
      passed: true,
      message: 'Idempotent delivery check prevents duplicate messaging and honors already SENT records'
    });
    console.log('✓ Scenario 8: Duplicate delivery prevention (Idempotency)');
  } catch (err: any) {
    results.push({ name: 'Scenario 8', passed: false, error: err.message });
    console.error('✗ Scenario 8 Failed:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Scenario 9: Invalid phone number detection (immediate permanent failure)
  // ---------------------------------------------------------------------------
  try {
    const invalidBatch = await createTestBatch(BatchStatus.APPROVED, [
      { name: 'Invalid Phone Student', phone: '12345' } // Fewer than 10 digits
    ]);
    await generateCertificatesForBatch(invalidBatch!.id, farah);

    const invalidCert = await prisma.certificate.findFirst({
      where: { batchId: invalidBatch!.id }
    });
    assert(invalidCert !== null, 'Invalid cert must exist');

    const result = await deliverSingleCertificate(invalidCert!.id);

    // Should immediately fail permanently without entering retry queue
    assert(result.status === DeliveryStatus.FAILED, `Expected immediate FAILED status, got ${result.status}`);
    assert(result.errorCode === 'INVALID_PHONE_NUMBER', `Expected INVALID_PHONE_NUMBER, got ${result.errorCode}`);
    assert(result.attempts === 1, `Expected attempts = 1, got ${result.attempts}`);

    results.push({
      name: 'Scenario 9: Invalid phone number detection (Immediate permanent failure)',
      passed: true,
      message: 'Sub-10 digit phone immediately marked FAILED with INVALID_PHONE_NUMBER, skipping retry queue'
    });
    console.log('✓ Scenario 9: Invalid phone number detection');
  } catch (err: any) {
    results.push({ name: 'Scenario 9', passed: false, error: err.message });
    console.error('✗ Scenario 9 Failed:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Scenario 10: Unauthorized delivery requests (Role & scope enforcement)
  // ---------------------------------------------------------------------------
  try {
    // Meera is District Officer for DIST-SOUTH-02, but issuedBatch is DIST-NORTH-01
    let meeraBlocked = false;
    try {
      await queueBatchDelivery(issuedBatch.id, meera);
    } catch (err: any) {
      meeraBlocked = true;
      assert(err.statusCode === 403, `Expected 403 Forbidden, got ${err.statusCode}`);
      assert(err.code === 'FORBIDDEN', `Expected FORBIDDEN code, got ${err.code}`);
    }
    assert(meeraBlocked, 'District Officer from another district must be forbidden');

    // Create an unassigned Training Centre user
    const foreignTCUser = {
      id: 'tc-foreign-user',
      email: 'foreign@certiflow.local',
      role: Role.TRAINING_CENTRE,
      trainingCentreId: 'TC-OTHER-999',
      districtId: null
    };

    let foreignTCBlocked = false;
    try {
      await queueBatchDelivery(issuedBatch.id, foreignTCUser as any);
    } catch (err: any) {
      foreignTCBlocked = true;
      assert(err.statusCode === 403, `Expected 403 Forbidden, got ${err.statusCode}`);
    }
    assert(foreignTCBlocked, 'Training Centre user from another centre must be forbidden');

    results.push({
      name: 'Scenario 10: Unauthorized delivery requests rejected with 403',
      passed: true,
      message: 'Scope checks strictly prevent unauthorized training centre and district access'
    });
    console.log('✓ Scenario 10: Unauthorized delivery requests rejected with 403');
  } catch (err: any) {
    results.push({ name: 'Scenario 10', passed: false, error: err.message });
    console.error('✗ Scenario 10 Failed:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Scenario 11: Batch delivery status aggregation
  // ---------------------------------------------------------------------------
  try {
    const statusData = await getBatchDeliveryStatus(issuedBatch.id, anika);

    assert(statusData.batchId === issuedBatch.id, 'Batch ID must match');
    assert(statusData.totalEligible === 2, `Expected totalEligible = 2, got ${statusData.totalEligible}`);
    assert(statusData.stats.sent === 2, `Expected 2 sent, got ${statusData.stats.sent}`);
    assert(statusData.deliveries.length === 2, `Expected 2 delivery rows, got ${statusData.deliveries.length}`);

    const firstRow = statusData.deliveries[0];
    assert(firstRow.status === DeliveryStatus.SENT, 'Row status must be SENT');
    assert(firstRow.maskedPhone !== undefined, 'Masked phone must be present');
    assert(firstRow.studentName !== undefined, 'Student name must be present');

    results.push({
      name: 'Scenario 11: Batch delivery status aggregation',
      passed: true,
      message: 'Batch delivery statistics aggregated correctly (total, sent, queued, failed, notQueued)'
    });
    console.log('✓ Scenario 11: Batch delivery status aggregation');
  } catch (err: any) {
    results.push({ name: 'Scenario 11', passed: false, error: err.message });
    console.error('✗ Scenario 11 Failed:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Scenario 12: Sensitive phone masking verification
  // ---------------------------------------------------------------------------
  try {
    const raw1 = '9876543210';
    const raw2 = '+91 98765 43210';
    const short = '1234';

    const masked1 = maskPhoneNumber(raw1);
    const masked2 = maskPhoneNumber(raw2);
    const maskedShort = maskPhoneNumber(short);

    assert(masked1 === '98****3210', `Expected '98****3210', got '${masked1}'`);
    assert(masked2 === '91******3210', `Expected '91******3210', got '${masked2}'`);
    assert(maskedShort === '****', `Expected '****', got '${maskedShort}'`);

    // Verify raw phone is never in getBatchDeliveryStatus output
    const statusData = await getBatchDeliveryStatus(issuedBatch.id, anika);
    for (const d of statusData.deliveries) {
      assert(!d.maskedPhone.includes('9876543211'), 'Raw phone must never appear in delivery status list');
      assert(/^\d{2}\*+\d{4}$/.test(d.maskedPhone), `Masked phone format invalid: ${d.maskedPhone}`);
    }

    results.push({
      name: 'Scenario 12: Sensitive phone masking verification',
      passed: true,
      message: 'All recipient phone numbers securely masked (e.g. 98****3210) protecting student PII'
    });
    console.log('✓ Scenario 12: Sensitive phone masking verification');
  } catch (err: any) {
    results.push({ name: 'Scenario 12', passed: false, error: err.message });
    console.error('✗ Scenario 12 Failed:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Summary Report
  // ---------------------------------------------------------------------------
  console.log('\n===============================================================');
  console.log('📊 Phase 5 Test Suite Results Summary');
  console.log('===============================================================');
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;

  results.forEach((r, idx) => {
    const symbol = r.passed ? '✓' : '✗';
    console.log(`${symbol} [${idx + 1}/12] ${r.name}`);
    if (r.message) console.log(`   ${r.message}`);
    if (r.error) console.log(`   Error: ${r.error}`);
  });

  console.log('---------------------------------------------------------------');
  console.log(`Total Scenarios: ${results.length} | Passed: ${passedCount} | Failed: ${failedCount}`);
  console.log('===============================================================\n');

  await prisma.$disconnect();

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch(async (e) => {
  console.error('Fatal test runner exception:', e);
  await prisma.$disconnect();
  process.exit(1);
});
