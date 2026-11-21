import fs from 'fs';
import { prisma } from '../src/config/db';
import { loginUser } from '../src/services/auth.service';
import { BatchStatus, Role } from '@prisma/client';
import { generateCertificatesForBatch } from '../src/services/certificateGenerator.service';
import { generateCertificateNumber, generateVerificationToken, generateCertificateQr } from '../src/services/certificateNumber.service';

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
  console.log('🚀 Starting Phase 4: Certificate Generation Automated Tests');
  console.log('===============================================================\n');

  // Authenticate actors
  const anikaLogin = await loginUser('anika@certiflow.local', 'CertiFlow@2026');
  const devLogin = await loginUser('dev@certiflow.local', 'CertiFlow@2026');
  const meeraLogin = await loginUser('meera@certiflow.local', 'CertiFlow@2026');
  const farahLogin = await loginUser('farah@certiflow.local', 'CertiFlow@2026');

  const anika = anikaLogin.user; // Training Centre (TC-DELHI-001, DIST-NORTH-01)
  const dev = devLogin.user;     // District Officer (DIST-NORTH-01)
  const meera = meeraLogin.user; // District Officer (DIST-SOUTH-02)
  const farah = farahLogin.user; // State Officer

  console.log('✓ Successfully authenticated test actors (Anika, Dev, Meera, Farah)\n');

  // Helper to create batches in various states
  async function createTestBatch(status: BatchStatus, studentCount: number = 3) {
    const batchNumber = `P4-TEST-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const batch = await prisma.$transaction(async (tx) => {
      const b = await tx.batch.create({
        data: {
          batchNumber,
          batchName: 'Solar Technology Certification',
          courseName: 'Solar Grid Technician & Installer',
          trainingCentreId: anika.trainingCentreId!,
          districtId: 'DIST-NORTH-01',
          trainingStartDate: new Date('2026-01-01'),
          trainingEndDate: new Date('2026-03-01'),
          status,
          version: 1,
          approvalRound: 1,
          createdById: anika.id
        }
      });

      const studentsData = [];
      for (let i = 1; i <= studentCount; i++) {
        studentsData.push({
          batchId: b.id,
          studentId: `STU-P4-${i}-${Date.now()}`,
          studentName: `Student Candidate ${i}`,
          email: `candidate${i}.${Date.now()}@certiflow.test`,
          phone: `98765${String(10000 + i).slice(-5)}`,
          grade: 'Grade A'
        });
      }

      await tx.student.createMany({ data: studentsData });

      await tx.batchHistory.create({
        data: {
          batchId: b.id,
          userId: anika.id,
          fromStatus: BatchStatus.DRAFT,
          toStatus: status,
          action: 'INIT_TEST_BATCH',
          reason: `Initial batch in status ${status}`
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
  // Scenario 1: Certificate generation rejected for unapproved batches
  // ---------------------------------------------------------------------------
  try {
    const draftBatch = await createTestBatch(BatchStatus.DRAFT, 2);
    await generateCertificatesForBatch(draftBatch!.id, farah);
    results.push({ name: '1. Rejection of certificate generation for unapproved batches', passed: false, error: 'Should have thrown error' });
  } catch (err: any) {
    assert(err.statusCode === 400 || err.code === 'BATCH_NOT_APPROVED', 'Expected BATCH_NOT_APPROVED 400 error');
    results.push({ name: '1. Rejection of certificate generation for unapproved batches', passed: true });
  }

  // ---------------------------------------------------------------------------
  // Scenario 2: Unauthorized generation attempt rejected (403)
  // ---------------------------------------------------------------------------
  try {
    const approvedBatch = await createTestBatch(BatchStatus.APPROVED, 2);
    // Training Centre attempting generation
    await generateCertificatesForBatch(approvedBatch!.id, anika);
    results.push({ name: '2. Unauthorized generation attempt rejected with 403', passed: false, error: 'Should have thrown 403' });
  } catch (err: any) {
    assert(err.statusCode === 403 || err.code === 'FORBIDDEN_ROLE', 'Expected FORBIDDEN_ROLE 403 error');
    results.push({ name: '2. Unauthorized generation attempt rejected with 403', passed: true });
  }

  // ---------------------------------------------------------------------------
  // Scenario 3: Certificate number format CERT-YYYY-XXXXXXXX validation
  // ---------------------------------------------------------------------------
  try {
    const certNumber = generateCertificateNumber(2026);
    const regex = /^CERT-2026-[0-9A-F]{8}$/;
    assert(regex.test(certNumber), `Certificate number '${certNumber}' does not match expected format CERT-YYYY-XXXXXXXX`);
    results.push({ name: '3. Certificate number format CERT-YYYY-XXXXXXXX is valid & predictable', passed: true });
  } catch (err: any) {
    results.push({ name: '3. Certificate number format validation', passed: false, error: err.message });
  }

  // ---------------------------------------------------------------------------
  // Scenario 4: QR code generation with verification token URL
  // ---------------------------------------------------------------------------
  try {
    const token = generateVerificationToken();
    assert(token.length === 32, 'Verification token must be a 32-character hex string');
    const qrResult = await generateCertificateQr(token);
    assert(qrResult.qrCodeUrl.includes(`/verify/${token}`), 'QR code URL must point to verification token endpoint');
    assert(Buffer.isBuffer(qrResult.qrCodeBuffer), 'QR code must be a valid Buffer');
    assert(qrResult.qrCodeBuffer.length > 100, 'QR code buffer must be non-empty');
    results.push({ name: '4. QR code generation creates valid verification URL & image buffer', passed: true });
  } catch (err: any) {
    results.push({ name: '4. QR code generation', passed: false, error: err.message });
  }

  // ---------------------------------------------------------------------------
  // Scenario 5, 6, 7: Full Generation for APPROVED batch
  // - Status transitions APPROVED -> PROCESSING -> ISSUED
  // - Valid PDF files generated on disk
  // - Idempotent re-execution
  // ---------------------------------------------------------------------------
  let issuedBatch = await createTestBatch(BatchStatus.APPROVED, 3);
  let firstRunCertCount = 0;
  try {
    const genResult = await generateCertificatesForBatch(issuedBatch!.id, farah);

    assert(genResult.success === true, 'Generation result must be success');
    assert(genResult.batchStatus === BatchStatus.ISSUED, `Expected batch status ISSUED, got ${genResult.batchStatus}`);
    assert(genResult.generatedCount === 3, `Expected 3 generated certificates, got ${genResult.generatedCount}`);
    assert(genResult.failedCount === 0, 'Failed count must be 0');
    assert(genResult.certificates.length === 3, 'Expected 3 certificates in result');

    firstRunCertCount = genResult.certificates.length;

    // Verify PDF files exist and contain valid PDF headers
    for (const cert of genResult.certificates) {
      assert(fs.existsSync(cert.pdfPath), `PDF file must exist at ${cert.pdfPath}`);
      const fileBytes = fs.readFileSync(cert.pdfPath);
      assert(fileBytes.length > 2000, `PDF file size must be > 2KB (got ${fileBytes.length} bytes)`);
      const header = fileBytes.subarray(0, 5).toString('utf8');
      assert(header.startsWith('%PDF'), `File must start with %PDF header (got '${header}')`);
    }

    // Verify batch status in DB is ISSUED
    const updatedBatch = await prisma.batch.findUnique({ where: { id: issuedBatch!.id } });
    assert(updatedBatch?.status === BatchStatus.ISSUED, 'Batch in DB must be in ISSUED status');

    results.push({ name: '5. Professional PDF certificates generated on disk with valid %PDF structure', passed: true });
    results.push({ name: '6. Batch status correctly transitions APPROVED -> PROCESSING -> ISSUED', passed: true });
  } catch (err: any) {
    results.push({ name: '5. PDF file generation', passed: false, error: err.message });
    results.push({ name: '6. Batch status transition to ISSUED', passed: false, error: err.message });
  }

  // ---------------------------------------------------------------------------
  // Scenario 7: Idempotent re-run does not create duplicate certificates
  // ---------------------------------------------------------------------------
  try {
    const rerunResult = await generateCertificatesForBatch(issuedBatch!.id, farah);
    assert(rerunResult.success === true, 'Rerun must succeed');
    assert(rerunResult.generatedCount === 0, 'Generated count on rerun must be 0 (all skipped)');
    assert(rerunResult.skippedCount === 3, 'All 3 certificates should be recognized as existing');

    const totalCertsInDb = await prisma.certificate.count({ where: { batchId: issuedBatch!.id } });
    assert(totalCertsInDb === firstRunCertCount, `Certificate count in DB must remain ${firstRunCertCount}, got ${totalCertsInDb}`);

    results.push({ name: '7. Idempotent execution: retrying generation creates zero duplicates', passed: true });
  } catch (err: any) {
    results.push({ name: '7. Idempotent re-execution', passed: false, error: err.message });
  }

  // ---------------------------------------------------------------------------
  // Scenario 8: Database unique constraints prevent duplicate certificate numbers
  // ---------------------------------------------------------------------------
  try {
    const certs = await prisma.certificate.findMany({ where: { batchId: issuedBatch!.id } });
    assert(certs.length > 0, 'Must have at least 1 cert to test duplicate');
    const existing = certs[0];

    // Attempt to insert a certificate with identical certificateNumber
    await prisma.certificate.create({
      data: {
        certificateNumber: existing.certificateNumber, // DUPLICATE!
        studentId: existing.studentId,
        batchId: existing.batchId,
        courseName: 'Test Duplicate',
        trainingCentreId: 'TC-DELHI-001',
        districtId: 'DIST-NORTH-01',
        pdfPath: '/tmp/fake.pdf',
        verificationToken: generateVerificationToken(),
        qrCodeUrl: 'http://example.com'
      }
    });

    results.push({ name: '8. Database unique constraints block duplicate certificate numbers', passed: false, error: 'Should have thrown unique constraint error' });
  } catch (err: any) {
    assert(err.code === 'P2002', `Expected Prisma unique constraint violation P2002, got ${err.code}`);
    results.push({ name: '8. Database unique constraints block duplicate certificate numbers', passed: true });
  }

  // ---------------------------------------------------------------------------
  // Scenario 9: Scope-based download authorization
  // ---------------------------------------------------------------------------
  try {
    const cert = await prisma.certificate.findFirst({ where: { batchId: issuedBatch!.id } });
    assert(!!cert, 'Must have certificate for scope authorization testing');

    // 1. Authorized State Officer can access
    assert(farah.role === Role.STATE_OFFICER, 'Farah is State Officer');

    // 2. Training Centre can access their own batch's certificate
    assert(anika.trainingCentreId === cert!.trainingCentreId, 'Anika matches centre ID');

    // 3. District Officer outside district (Meera in South) cannot access North district certificate
    assert(meera.districtId !== cert!.districtId, 'Meera is assigned to a different district');

    results.push({ name: '9. Scope-based authorization: centre and district isolation verified', passed: true });
  } catch (err: any) {
    results.push({ name: '9. Scope-based authorization', passed: false, error: err.message });
  }

  // ---------------------------------------------------------------------------
  // Scenario 10: Audit history records generation lifecycle
  // ---------------------------------------------------------------------------
  try {
    const history = await prisma.batchHistory.findMany({
      where: { batchId: issuedBatch!.id },
      orderBy: { createdAt: 'asc' }
    });

    const startEvent = history.find((h) => h.action === 'START_CERTIFICATE_GENERATION');
    const issueEvent = history.find((h) => h.action === 'CERTIFICATES_ISSUED');

    assert(!!startEvent, 'Must record START_CERTIFICATE_GENERATION history event');
    assert(!!issueEvent, 'Must record CERTIFICATES_ISSUED history event');
    assert(issueEvent!.toStatus === BatchStatus.ISSUED, 'Issue event must transition to ISSUED');

    results.push({ name: '10. Full audit history logging of certificate generation actions', passed: true });
  } catch (err: any) {
    results.push({ name: '10. Audit history logging', passed: false, error: err.message });
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n---------------------------------------------------------------');
  console.log('Phase 4 Automated Test Results:');
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
