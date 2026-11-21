import { prisma } from '../src/config/db';
import { loginUser } from '../src/services/auth.service';
import { BatchStatus, CertificateStatus, Role } from '@prisma/client';
import { generateCertificatesForBatch } from '../src/services/certificateGenerator.service';
import { generateCertificateQr } from '../src/services/certificateNumber.service';
import { verifyCertificate, cancelCertificate, getCertificateAuditHistory } from '../src/services/verification.service';
import { publicRateLimiter, resetRateLimiterStore } from '../src/middleware/rateLimiter';
import { config } from '../src/config/env';

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
  console.log('🚀 Starting Phase 6: Public Certificate Verification & Cancellation Tests');
  console.log('===============================================================\n');

  // Authenticate actors
  const anikaLogin = await loginUser('anika@certiflow.local', 'CertiFlow@2026');
  const devLogin = await loginUser('dev@certiflow.local', 'CertiFlow@2026');
  const nehaLogin = await loginUser('neha@certiflow.local', 'CertiFlow@2026');
  const farahLogin = await loginUser('farah@certiflow.local', 'CertiFlow@2026');

  const anika = anikaLogin.user; // TC
  const dev = devLogin.user;     // DO
  const neha = nehaLogin.user;   // QO
  const farah = farahLogin.user; // SO (State Officer)

  console.log('✓ Successfully authenticated test actors (Anika, Dev, Neha, Farah)\n');

  // Helper to create test batch
  async function createIssuedBatch() {
    const batchNumber = `P6-TEST-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const batch = await prisma.$transaction(async (tx) => {
      const b = await tx.batch.create({
        data: {
          batchNumber,
          batchName: 'Precision Solar Cell Fabrication',
          courseName: 'Solar Photovoltaic Specialist',
          trainingCentreId: anika.trainingCentreId!,
          districtId: 'DIST-NORTH-01',
          trainingStartDate: new Date('2026-01-15'),
          trainingEndDate: new Date('2026-03-25'),
          status: BatchStatus.APPROVED,
          version: 1,
          approvalRound: 1,
          createdById: anika.id
        }
      });

      await tx.student.create({
        data: {
          batchId: b.id,
          studentId: `STU-P6-${Date.now()}`,
          studentName: 'Priya Sundaram',
          email: `priya.${Date.now()}@certiflow.test`,
          phone: '9876543210',
          grade: 'Distinction'
        }
      });

      await tx.batchHistory.create({
        data: {
          batchId: b.id,
          userId: farah.id,
          fromStatus: BatchStatus.STATE_REVIEW,
          toStatus: BatchStatus.APPROVED,
          action: 'FINAL_APPROVAL',
          reason: 'Batch fully approved for issuance'
        }
      });

      return b;
    });

    // Generate certificates (transitions to ISSUED)
    await generateCertificatesForBatch(batch.id, farah);

    return await prisma.certificate.findFirst({
      where: { batchId: batch.id },
      include: { student: true, batch: true }
    });
  }

  const validCert = await createIssuedBatch();
  assert(validCert !== null, 'Failed to create test certificate');

  // ---------------------------------------------------------------------------
  // Scenario 1: Public verification via Certificate Number (without login)
  // ---------------------------------------------------------------------------
  try {
    const result = await verifyCertificate(validCert!.certificateNumber);
    assert(result.status === 'VALID', `Expected status VALID, got ${result.status}`);
    assert(result.valid === true, 'Expected valid to be true');
    assert(result.certificateNumber === validCert!.certificateNumber, 'Certificate number mismatch');
    assert(result.studentName === 'Priya Sundaram', 'Student name mismatch');
    assert(result.courseName === 'Solar Photovoltaic Specialist', 'Course name mismatch');

    results.push({
      name: 'Scenario 1: Public verification via Certificate Number works without login',
      passed: true,
      message: 'Verified authentic certificate status as VALID with candidate name and course'
    });
    console.log('✓ Scenario 1: Public verification via Certificate Number works without login');
  } catch (err: any) {
    results.push({ name: 'Scenario 1', passed: false, error: err.message });
    console.error('✗ Scenario 1 Failed:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Scenario 2: Verification is case-insensitive for certificate numbers
  // ---------------------------------------------------------------------------
  try {
    const lowerNumber = validCert!.certificateNumber.toLowerCase();
    const result = await verifyCertificate(lowerNumber);
    assert(result.status === 'VALID', 'Expected case-insensitive match to return VALID');
    assert(result.certificateNumber === validCert!.certificateNumber, 'Should return canonical upper-case number');

    results.push({
      name: 'Scenario 2: Case-insensitive certificate number verification',
      passed: true,
      message: 'Lower-case input successfully resolved to canonical certificate'
    });
    console.log('✓ Scenario 2: Case-insensitive certificate number verification');
  } catch (err: any) {
    results.push({ name: 'Scenario 2', passed: false, error: err.message });
    console.error('✗ Scenario 2 Failed:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Scenario 3: Public verification via 32-character QR verification token
  // ---------------------------------------------------------------------------
  try {
    const tokenResult = await verifyCertificate(validCert!.verificationToken);
    assert(tokenResult.status === 'VALID', `Expected VALID for token lookup, got ${tokenResult.status}`);
    assert(tokenResult.certificateNumber === validCert!.certificateNumber, 'Token must resolve correct certificate number');
    assert(tokenResult.grade === 'Distinction', 'Grade should match');

    results.push({
      name: 'Scenario 3: Public verification via QR verification token',
      passed: true,
      message: '32-character hexadecimal verification token accurately resolved certificate'
    });
    console.log('✓ Scenario 3: Public verification via QR verification token');
  } catch (err: any) {
    results.push({ name: 'Scenario 3', passed: false, error: err.message });
    console.error('✗ Scenario 3 Failed:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Scenario 4: Privacy protection & sensitive data stripping
  // ---------------------------------------------------------------------------
  try {
    const pubResult: any = await verifyCertificate(validCert!.certificateNumber);

    // Assert internal database identifiers and storage paths are never leaked
    assert(pubResult.id === undefined, 'Internal certificate UUID must not be exposed');
    assert(pubResult.studentId === undefined, 'Internal student UUID must not be exposed');
    assert(pubResult.batchId === undefined, 'Internal batch UUID must not be exposed');
    assert(pubResult.pdfPath === undefined, 'Internal file storage path must not be exposed');
    assert(pubResult.verificationToken === undefined, 'Verification token must not be leaked');

    // Assert candidate sensitive personal PII is not leaked
    assert(pubResult.email === undefined, 'Student email must not be exposed');
    assert(pubResult.phone === undefined, 'Student phone must not be exposed');
    assert(pubResult.governmentId === undefined, 'Student governmentId must not be exposed');
    assert(pubResult.dateOfBirth === undefined, 'Student dateOfBirth must not be exposed');

    results.push({
      name: 'Scenario 4: Privacy protection & sensitive data stripping',
      passed: true,
      message: 'All internal UUIDs, storage paths, and candidate PII strictly excluded from response'
    });
    console.log('✓ Scenario 4: Privacy protection & sensitive data stripping');
  } catch (err: any) {
    results.push({ name: 'Scenario 4', passed: false, error: err.message });
    console.error('✗ Scenario 4 Failed:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Scenario 5: Verification of non-existent certificate returns INVALID
  // ---------------------------------------------------------------------------
  try {
    const bogusCert = 'CERT-2026-DEADBEEF';
    const result = await verifyCertificate(bogusCert);
    assert(result.status === 'INVALID', `Expected INVALID for bogus cert, got ${result.status}`);
    assert(result.valid === false, 'Valid flag must be false');
    assert(result.message.includes('No certificate found'), 'Message must indicate certificate not found');

    results.push({
      name: 'Scenario 5: Non-existent certificate returns status INVALID',
      passed: true,
      message: 'Unknown certificate numbers cleanly return status INVALID with helpful error message'
    });
    console.log('✓ Scenario 5: Non-existent certificate returns status INVALID');
  } catch (err: any) {
    results.push({ name: 'Scenario 5', passed: false, error: err.message });
    console.error('✗ Scenario 5 Failed:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Scenario 6: Malformed input format rejected as INVALID
  // ---------------------------------------------------------------------------
  try {
    const invalidInputs = [
      '',
      '   ',
      'NOT-A-CERT',
      'SELECT * FROM certificates;',
      '<script>alert(1)</script>',
      'CERT-99-SHORT'
    ];

    for (const input of invalidInputs) {
      const res = await verifyCertificate(input);
      assert(res.status === 'INVALID', `Input '${input}' expected INVALID, got ${res.status}`);
      assert(res.valid === false, 'Valid must be false for malformed input');
    }

    results.push({
      name: 'Scenario 6: Malformed input formats gracefully rejected as INVALID',
      passed: true,
      message: 'Format validation guards against malformed identifiers and injection payloads'
    });
    console.log('✓ Scenario 6: Malformed input formats gracefully rejected as INVALID');
  } catch (err: any) {
    results.push({ name: 'Scenario 6', passed: false, error: err.message });
    console.error('✗ Scenario 6 Failed:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Scenario 7: Certificates from unapproved or unissued batches cannot be verified
  // ---------------------------------------------------------------------------
  try {
    // Create draft batch with manual certificate record (simulating illegal bypass)
    const draftBatch = await prisma.batch.create({
      data: {
        batchNumber: `P6-UNISSUED-${Date.now()}`,
        batchName: 'Unapproved Renewable Energy Batch',
        courseName: 'Wind Energy Tech',
        trainingCentreId: anika.trainingCentreId!,
        districtId: 'DIST-NORTH-01',
        trainingStartDate: new Date('2026-01-01'),
        trainingEndDate: new Date('2026-03-01'),
        status: BatchStatus.DRAFT,
        version: 1,
        approvalRound: 1,
        createdById: anika.id
      }
    });

    const stu = await prisma.student.create({
      data: {
        batchId: draftBatch.id,
        studentName: 'Unapproved Candidate',
        email: `unapproved.${Date.now()}@test.local`,
        phone: '9876543299'
      }
    });

    const unissuedCert = await prisma.certificate.create({
      data: {
        certificateNumber: `CERT-2026-${Math.random().toString(16).substring(2, 10).toUpperCase()}`,
        studentId: stu.id,
        batchId: draftBatch.id,
        courseName: draftBatch.courseName,
        trainingCentreId: draftBatch.trainingCentreId,
        districtId: draftBatch.districtId,
        pdfPath: '/storage/certificates/fake.pdf',
        verificationToken: `fake${Date.now()}${Math.random().toString(16).substring(2, 10)}`.substring(0, 32),
        qrCodeUrl: 'http://localhost:5173/verify/fake',
        status: CertificateStatus.GENERATED
      }
    });

    const result = await verifyCertificate(unissuedCert.certificateNumber);
    assert(result.status === 'INVALID', `Expected INVALID for unissued batch cert, got ${result.status}`);
    assert(result.valid === false, 'Valid must be false for unissued batch cert');
    assert(result.message.includes('unissued batch'), 'Error message must note unissued batch status');

    results.push({
      name: 'Scenario 7: Certificates from unapproved/unissued batches rejected as INVALID',
      passed: true,
      message: 'Batch status verification strictly blocks unissued and unapproved certificate validity'
    });
    console.log('✓ Scenario 7: Certificates from unapproved/unissued batches rejected as INVALID');
  } catch (err: any) {
    results.push({ name: 'Scenario 7', passed: false, error: err.message });
    console.error('✗ Scenario 7 Failed:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Scenario 8: State Officer can cancel certificate with mandatory reason
  // ---------------------------------------------------------------------------
  try {
    const reason = 'Student failed practical assessment re-audit conducted by State Board.';
    const cancelledCert = await cancelCertificate(validCert!.id, reason, farah);

    assert(cancelledCert.status === CertificateStatus.CANCELLED, 'Status must be CANCELLED');
    assert(cancelledCert.cancellationReason === reason, 'Cancellation reason mismatch');
    assert(cancelledCert.cancelledById === farah.id, 'CancelledById must point to Farah');
    assert(cancelledCert.cancelledAt !== null, 'CancelledAt timestamp must be recorded');

    results.push({
      name: 'Scenario 8: State Officer can cancel certificate with reason',
      passed: true,
      message: 'State Officer successfully cancelled certificate, updating status to CANCELLED'
    });
    console.log('✓ Scenario 8: State Officer can cancel certificate with reason');
  } catch (err: any) {
    results.push({ name: 'Scenario 8', passed: false, error: err.message });
    console.error('✗ Scenario 8 Failed:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Scenario 9: Cancelled certificate returns status CANCELLED on public lookup
  // ---------------------------------------------------------------------------
  try {
    const verifyCancelled = await verifyCertificate(validCert!.certificateNumber);
    assert(verifyCancelled.status === 'CANCELLED', `Expected CANCELLED, got ${verifyCancelled.status}`);
    assert(verifyCancelled.valid === false, 'Cancelled certificate valid flag must be false');
    assert(verifyCancelled.cancellationReason !== undefined, 'Cancellation reason must be provided');
    assert(verifyCancelled.cancellationReason!.includes('practical assessment'), 'Reason text must match');
    assert(verifyCancelled.cancelledAt !== undefined, 'Cancellation timestamp must be provided');

    results.push({
      name: 'Scenario 9: Cancelled certificate displays status CANCELLED with reason',
      passed: true,
      message: 'Public verification accurately reflects CANCELLED status, timestamp, and official reason'
    });
    console.log('✓ Scenario 9: Cancelled certificate displays status CANCELLED with reason');
  } catch (err: any) {
    results.push({ name: 'Scenario 9', passed: false, error: err.message });
    console.error('✗ Scenario 9 Failed:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Scenario 10: Unauthorized roles cannot cancel certificates (403 Forbidden)
  // ---------------------------------------------------------------------------
  try {
    const anotherCert = await createIssuedBatch();

    // Training Centre cannot cancel
    let tcBlocked = false;
    try {
      await cancelCertificate(anotherCert!.id, 'Centre attempting cancellation', anika);
    } catch (err: any) {
      tcBlocked = true;
      assert(err.statusCode === 403, `Expected 403, got ${err.statusCode}`);
      assert(err.code === 'FORBIDDEN_ROLE', `Expected FORBIDDEN_ROLE, got ${err.code}`);
    }
    assert(tcBlocked, 'Training Centre must be forbidden from cancelling');

    // District Officer cannot cancel
    let doBlocked = false;
    try {
      await cancelCertificate(anotherCert!.id, 'DO attempting cancellation', dev);
    } catch (err: any) {
      doBlocked = true;
      assert(err.statusCode === 403, `Expected 403, got ${err.statusCode}`);
    }
    assert(doBlocked, 'District Officer must be forbidden from cancelling');

    // Quality Officer cannot cancel
    let qoBlocked = false;
    try {
      await cancelCertificate(anotherCert!.id, 'QO attempting cancellation', neha);
    } catch (err: any) {
      qoBlocked = true;
      assert(err.statusCode === 403, `Expected 403, got ${err.statusCode}`);
    }
    assert(qoBlocked, 'Quality Officer must be forbidden from cancelling');

    results.push({
      name: 'Scenario 10: Unauthorized roles cannot cancel certificates (403 Forbidden)',
      passed: true,
      message: 'Role enforcement strictly restricts cancellation to STATE_OFFICER only'
    });
    console.log('✓ Scenario 10: Unauthorized roles cannot cancel certificates (403 Forbidden)');
  } catch (err: any) {
    results.push({ name: 'Scenario 10', passed: false, error: err.message });
    console.error('✗ Scenario 10 Failed:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Scenario 11: Cancellation reason validation (mandatory & min length)
  // ---------------------------------------------------------------------------
  try {
    const anotherCert = await createIssuedBatch();

    let emptyReasonBlocked = false;
    try {
      await cancelCertificate(anotherCert!.id, '', farah);
    } catch (err: any) {
      emptyReasonBlocked = true;
      assert(err.statusCode === 422, `Expected 422, got ${err.statusCode}`);
      assert(err.code === 'VALIDATION_FAILED', `Expected VALIDATION_FAILED, got ${err.code}`);
    }
    assert(emptyReasonBlocked, 'Empty reason must be rejected with 422');

    let shortReasonBlocked = false;
    try {
      await cancelCertificate(anotherCert!.id, 'bad', farah); // < 5 chars
    } catch (err: any) {
      shortReasonBlocked = true;
      assert(err.statusCode === 422, `Expected 422 for short reason, got ${err.statusCode}`);
    }
    assert(shortReasonBlocked, 'Short reason must be rejected with 422');

    results.push({
      name: 'Scenario 11: Cancellation reason validation (mandatory, min 5 chars)',
      passed: true,
      message: 'Empty and sub-5 character cancellation reasons strictly rejected with 422'
    });
    console.log('✓ Scenario 11: Cancellation reason validation');
  } catch (err: any) {
    results.push({ name: 'Scenario 11', passed: false, error: err.message });
    console.error('✗ Scenario 11 Failed:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Scenario 12: Immutable audit history created on cancellation
  // ---------------------------------------------------------------------------
  try {
    const auditLogs = await getCertificateAuditHistory(validCert!.id);
    assert(auditLogs.length > 0, 'Audit logs must exist for cancelled certificate');

    const cancelLog = auditLogs.find((l) => l.action === 'CANCELLED');
    assert(cancelLog !== undefined, 'Cancellation audit log must be recorded');
    assert(cancelLog!.performedById === farah.id, 'Audit log performer must match State Officer');
    assert(cancelLog!.reason!.includes('practical assessment'), 'Audit log reason must match');

    // Verify parent batch history entry
    const batchHistories = await prisma.batchHistory.findMany({
      where: {
        batchId: validCert!.batchId,
        action: 'CERTIFICATE_CANCELLED'
      }
    });
    assert(batchHistories.length > 0, 'Batch history must record certificate cancellation event');

    results.push({
      name: 'Scenario 12: Immutable audit history created on cancellation',
      passed: true,
      message: 'CertificateAuditLog and BatchHistory entries immutably recorded'
    });
    console.log('✓ Scenario 12: Immutable audit history created on cancellation');
  } catch (err: any) {
    results.push({ name: 'Scenario 12', passed: false, error: err.message });
    console.error('✗ Scenario 12 Failed:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Scenario 13: Double cancellation prevention (400 ALREADY_CANCELLED)
  // ---------------------------------------------------------------------------
  try {
    let doubleCancelBlocked = false;
    try {
      await cancelCertificate(validCert!.id, 'Attempting second cancellation', farah);
    } catch (err: any) {
      doubleCancelBlocked = true;
      assert(err.statusCode === 400, `Expected 400, got ${err.statusCode}`);
      assert(err.code === 'ALREADY_CANCELLED', `Expected ALREADY_CANCELLED, got ${err.code}`);
    }
    assert(doubleCancelBlocked, 'Attempting to cancel already cancelled certificate must be rejected');

    results.push({
      name: 'Scenario 13: Double cancellation prevention (ALREADY_CANCELLED)',
      passed: true,
      message: 'Subsequent cancellation calls on already cancelled certificates rejected with 400'
    });
    console.log('✓ Scenario 13: Double cancellation prevention');
  } catch (err: any) {
    results.push({ name: 'Scenario 13', passed: false, error: err.message });
    console.error('✗ Scenario 13 Failed:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Scenario 14: QR code generation URL points to configured public verification URL
  // ---------------------------------------------------------------------------
  try {
    const testToken = 'a1b2c3d4e5f678901234567890abcdef';
    const { qrCodeUrl, qrCodeBuffer } = await generateCertificateQr(testToken);

    const expectedUrl = `${config.verificationBaseUrl}/${testToken}`;
    assert(qrCodeUrl === expectedUrl, `Expected QR URL '${expectedUrl}', got '${qrCodeUrl}'`);
    assert(qrCodeBuffer.length > 100, 'QR Code image buffer must be generated');

    results.push({
      name: 'Scenario 14: QR code points to configured public verification URL',
      passed: true,
      message: `QR code correctly encodes ${config.verificationBaseUrl}/{token}`
    });
    console.log('✓ Scenario 14: QR code points to configured public verification URL');
  } catch (err: any) {
    results.push({ name: 'Scenario 14', passed: false, error: err.message });
    console.error('✗ Scenario 14 Failed:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Scenario 15: Public rate limiter enforcement (HTTP 429 Too Many Requests)
  // ---------------------------------------------------------------------------
  try {
    resetRateLimiterStore();
    const limiter = publicRateLimiter({ windowMs: 10000, maxRequests: 5 });

    let status = 200;
    let jsonBody: any = null;
    const mockRes = {
      setHeader: (_name: string, _val: any) => {},
      status: (code: number) => {
        status = code;
        return {
          json: (body: any) => {
            jsonBody = body;
          }
        };
      }
    };

    const mockReq = {
      headers: {},
      socket: { remoteAddress: '192.168.1.100' }
    };

    let nextCalled = 0;
    const next = () => { nextCalled++; };

    // Send 5 permitted requests
    for (let i = 0; i < 5; i++) {
      limiter(mockReq as any, mockRes as any, next);
    }
    assert(nextCalled === 5, `Expected 5 successful calls, got ${nextCalled}`);

    // Send 6th request (should be throttled with 429)
    limiter(mockReq as any, mockRes as any, next);
    assert(status === 429, `Expected 429 Too Many Requests, got ${status}`);
    assert(jsonBody.error === 'RATE_LIMIT_EXCEEDED', 'Expected RATE_LIMIT_EXCEEDED error code');

    results.push({
      name: 'Scenario 15: Public rate limiter enforcement (HTTP 429 Too Many Requests)',
      passed: true,
      message: 'Rate limiter enforces request limits and returns HTTP 429 with retry information'
    });
    console.log('✓ Scenario 15: Public rate limiter enforcement (HTTP 429 Too Many Requests)');
  } catch (err: any) {
    results.push({ name: 'Scenario 15', passed: false, error: err.message });
    console.error('✗ Scenario 15 Failed:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Summary Report
  // ---------------------------------------------------------------------------
  console.log('\n===============================================================');
  console.log('📊 Phase 6 Test Suite Results Summary');
  console.log('===============================================================');
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;

  results.forEach((r, idx) => {
    const symbol = r.passed ? '✓' : '✗';
    console.log(`${symbol} [${idx + 1}/15] ${r.name}`);
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
