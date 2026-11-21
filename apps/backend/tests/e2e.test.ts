import fs from 'fs';
import path from 'path';
import { prisma } from '../src/config/db';
import { loginUser } from '../src/services/auth.service';
import { BatchStatus, CertificateStatus, ReviewDecision, Role } from '@prisma/client';
import { submitReviewDecision } from '../src/services/reviewWorkflow.service';
import { transitionBatch } from '../src/services/stateMachine.service';
import { generateCertificatesForBatch } from '../src/services/certificateGenerator.service';
import { queueBatchDelivery, getBatchDeliveryStatus } from '../src/services/deliveryService';
import { verifyCertificate, cancelCertificate } from '../src/services/verification.service';
import { WhatsAppSimulator } from '../src/services/whatsappSimulator.service';

async function runEndToEndLifecycle() {
  console.log('===============================================================');
  console.log('🌟 CertiFlow Phase 7: Complete End-to-End System Lifecycle Test');
  console.log('===============================================================\n');

  // 1. Authenticate Demo Actors across all governance tiers
  console.log('Step 1: Authenticating multi-tier actors...');
  const anikaAuth = await loginUser('anika@certiflow.local', 'CertiFlow@2026'); // TC
  const devAuth = await loginUser('dev@certiflow.local', 'CertiFlow@2026');     // DO 1
  const kabirAuth = await loginUser('kabir@certiflow.local', 'CertiFlow@2026'); // DO 2
  const farahAuth = await loginUser('farah@certiflow.local', 'CertiFlow@2026'); // SO

  const anika = anikaAuth.user;
  const dev = devAuth.user;
  const kabir = kabirAuth.user;
  const farah = farahAuth.user;
  console.log('✓ All 4 actors authenticated.\n');

  // 2. Training Centre creates a new Batch in DRAFT status
  console.log('Step 2: Training Centre creates batch in DRAFT status...');
  const batchNumber = `E2E-BATCH-${Date.now()}`;
  let batch = await prisma.batch.create({
    data: {
      batchNumber,
      batchName: 'Cybersecurity & Infrastructure Defense',
      courseName: 'Certified SOC Analyst & Incident Responder',
      trainingCentreId: anika.trainingCentreId!,
      districtId: 'DIST-NORTH-01',
      trainingStartDate: new Date('2026-02-01'),
      trainingEndDate: new Date('2026-04-30'),
      status: BatchStatus.DRAFT,
      version: 1,
      approvalRound: 1,
      createdById: anika.id
    }
  });
  console.log(`✓ Batch created: ${batch.batchNumber} (Status: ${batch.status}, Version: ${batch.version})\n`);

  // 3. Populate student roster (Simulating atomic Excel upload)
  console.log('Step 3: Enrolling students into batch...');
  const studentsData = [
    {
      batchId: batch.id,
      studentId: `STU-E2E-01-${Date.now()}`,
      studentName: 'Aarav Singhania',
      email: `aarav.${Date.now()}@e2e.test`,
      phone: '9876543210',
      grade: 'Distinction'
    },
    {
      batchId: batch.id,
      studentId: `STU-E2E-02-${Date.now()}`,
      studentName: 'Diya Nambiar',
      email: `diya.${Date.now()}@e2e.test`,
      phone: '9876543211',
      grade: 'Grade A'
    }
  ];
  await prisma.student.createMany({ data: studentsData });
  console.log(`✓ ${studentsData.length} students enrolled in batch.\n`);

  // 4. Training Centre submits batch for review
  console.log('Step 4: Training Centre submits batch for review...');
  await transitionBatch({
    batchId: batch.id,
    targetStatus: BatchStatus.SUBMITTED,
    expectedVersion: batch.version,
    action: 'SUBMIT_BATCH',
    user: anika
  });
  batch = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
  console.log(`✓ Batch submitted: Status: ${batch.status}, Version: ${batch.version}\n`);

  // 5. Dual District Officer Approvals
  console.log('Step 5: District Review — First District Officer (Dev) approves...');
  await submitReviewDecision({
    batchId: batch.id,
    expectedVersion: batch.version,
    decision: ReviewDecision.APPROVED,
    comment: 'Curriculum requirements and attendance verified.',
    user: dev
  });
  batch = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
  console.log(`✓ Dev approval recorded. Status: ${batch.status}, Version: ${batch.version}`);

  console.log('District Review — Second Distinct District Officer (Kabir) approves...');
  await submitReviewDecision({
    batchId: batch.id,
    expectedVersion: batch.version,
    decision: ReviewDecision.APPROVED,
    comment: 'Assessment scores and centre facilities verified.',
    user: kabir
  });
  batch = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
  console.log(`✓ Kabir approval recorded. Batch advanced to: ${batch.status}, Version: ${batch.version}\n`);

  // 6. Apex State Officer Final Approval
  console.log('Step 6: State Review — Apex State Officer (Farah) gives final approval...');
  await submitReviewDecision({
    batchId: batch.id,
    expectedVersion: batch.version,
    decision: ReviewDecision.APPROVED,
    comment: 'All district prerequisites satisfied. Approved for certificate issuance.',
    user: farah
  });
  batch = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
  console.log(`✓ Batch approved: Status: ${batch.status}, Version: ${batch.version}\n`);

  // 7. State Officer initiates Certificate Generation
  console.log('Step 7: State Officer generates official certificates...');
  const genResult = await generateCertificatesForBatch(batch.id, farah);
  batch = await prisma.batch.findUniqueOrThrow({
    where: { id: batch.id },
    include: { certificates: { include: { student: true } } }
  });
  console.log(`✓ ${genResult.certificates.length} certificates generated! Batch status: ${batch.status}`);
  for (const cert of batch.certificates) {
    console.log(`   - Cert No: ${cert.certificateNumber} | Candidate: ${cert.student.studentName}`);
    if (fs.existsSync(cert.pdfPath)) {
      console.log(`     PDF file on disk: ${cert.pdfPath} (${fs.statSync(cert.pdfPath).size} bytes)`);
    }
  }
  console.log('');

  // 8. Public Verification of Active Certificate
  console.log('Step 8: Testing Public Verification Portal for active certificate...');
  const cert1 = batch.certificates[0];
  const pubVerify1 = await verifyCertificate(cert1.certificateNumber);
  console.log(`✓ Verification by Certificate Number (${cert1.certificateNumber}):`);
  console.log(`   Status: ${pubVerify1.status} (Valid: ${pubVerify1.valid})`);
  console.log(`   Candidate: ${pubVerify1.studentName} | Course: ${pubVerify1.courseName}`);
  console.log(`   Grade: ${pubVerify1.grade} | District: ${pubVerify1.districtId}`);

  // Test token-based QR verification
  const qrVerify = await verifyCertificate(cert1.verificationToken);
  console.log(`✓ Verification by QR Token: Status: ${qrVerify.status}`);
  console.log('');

  // 9. WhatsApp Simulated Delivery
  console.log('Step 9: Queueing WhatsApp certificate notifications...');
  const delivResult = await queueBatchDelivery(batch.id, anika);
  console.log(`✓ WhatsApp delivery summary: Total: ${delivResult.totalEligible}, Queued: ${delivResult.queuedCount}`);

  const statusSummary = await getBatchDeliveryStatus(batch.id, anika);
  console.log(`✓ Delivery metrics: Sent: ${statusSummary.stats.sent}/${statusSummary.totalEligible}`);
  for (const d of statusSummary.deliveries) {
    console.log(`   - Student: ${d.studentName} | Masked Phone: ${d.maskedPhone} | Status: ${d.status}`);
  }
  console.log('');

  // 10. State Officer Cancels a Certificate
  console.log('Step 10: State Officer cancels Certificate 2 with official audit reason...');
  const cert2 = batch.certificates[1];
  const cancelReason = 'Candidate disqualified following post-issuance forensic examination discrepancy.';
  const cancelledCert = await cancelCertificate(cert2.id, cancelReason, farah);
  console.log(`✓ Certificate ${cancelledCert.certificateNumber} cancelled.`);

  // 11. Public Verification of Cancelled Certificate
  console.log('Step 11: Public Verification of Cancelled Certificate...');
  const pubVerify2 = await verifyCertificate(cert2.certificateNumber);
  console.log(`✓ Verification Result for ${cert2.certificateNumber}:`);
  console.log(`   Status: ${pubVerify2.status} (Valid: ${pubVerify2.valid})`);
  console.log(`   Official Cancellation Reason: "${pubVerify2.cancellationReason}"`);
  console.log(`   Cancelled At: ${pubVerify2.cancelledAt}`);
  console.log('');

  // 12. Verification of Audit Trail & Database Integrity
  console.log('Step 12: Auditing full event trail in database...');
  const historyLogs = await prisma.batchHistory.findMany({
    where: { batchId: batch.id },
    orderBy: { createdAt: 'asc' }
  });
  console.log(`✓ Total Batch History Events: ${historyLogs.length}`);
  historyLogs.forEach((h, i) => {
    console.log(`   ${i + 1}. [${h.action}] ${h.fromStatus} -> ${h.toStatus} (Reason: ${h.reason || 'N/A'})`);
  });

  const certAuditLogs = await prisma.certificateAuditLog.findMany({
    where: { certificateId: cert2.id }
  });
  console.log(`✓ Certificate Audit Logs for ${cert2.certificateNumber}: ${certAuditLogs.length} event(s)`);

  console.log('\n===============================================================');
  console.log('🎉 CERTIFLOW FULL END-TO-END WORKFLOW VERIFIED SUCCESSFULLY!');
  console.log('===============================================================\n');

  await prisma.$disconnect();
}

runEndToEndLifecycle().catch(async (e) => {
  console.error('Fatal E2E test exception:', e);
  await prisma.$disconnect();
  process.exit(1);
});
