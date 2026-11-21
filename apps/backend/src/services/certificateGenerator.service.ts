import fs from 'fs';
import path from 'path';
import { BatchStatus, CertificateStatus, Role } from '@prisma/client';
import { prisma } from '../config/db';
import { config } from '../config/env';
import { AuthUser } from '../types/express';
import { StateMachineError } from './stateMachine.service';
import { generateCertificateNumber, generateVerificationToken, generateCertificateQr } from './certificateNumber.service';
import { generateCertificatePdf } from './pdfGeneration.service';

export interface GenerationResult {
  success: boolean;
  batchId: string;
  batchStatus: BatchStatus;
  totalStudents: number;
  generatedCount: number;
  skippedCount: number; // Idempotently skipped because already generated
  failedCount: number;
  certificates: Array<{
    id: string;
    certificateNumber: string;
    studentId: string;
    studentName: string;
    pdfPath: string;
  }>;
  failures: Array<{
    studentId: string;
    studentName: string;
    error: string;
  }>;
}

/**
 * Generates official certificates for all students belonging to an APPROVED batch.
 * Strictly verifies role authorization and batch approval status.
 * Executes idempotently: rerunning does not create duplicate certificates.
 */
export async function generateCertificatesForBatch(
  batchId: string,
  user: AuthUser
): Promise<GenerationResult> {
  // 1. Role Authorization Check: Only State Officers (or system) can trigger certificate generation
  if (user.role !== Role.STATE_OFFICER) {
    throw new StateMachineError(
      'Unauthorized: Only State Officers can initiate certificate generation.',
      403,
      'FORBIDDEN_ROLE'
    );
  }

  // 2. Fetch Batch and verify eligibility
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: {
      students: {
        orderBy: { createdAt: 'asc' }
      }
    }
  });

  if (!batch) {
    throw new StateMachineError('Batch not found', 404, 'NOT_FOUND');
  }

  // Batch must be in APPROVED status (or PROCESSING / ISSUED if retrying/checking)
  if (
    batch.status !== BatchStatus.APPROVED &&
    batch.status !== BatchStatus.PROCESSING &&
    batch.status !== BatchStatus.ISSUED
  ) {
    throw new StateMachineError(
      `Cannot generate certificates: Batch is in '${batch.status}' status. Only batches in APPROVED, PROCESSING, or ISSUED status are eligible for certificate issuance.`,
      400,
      'BATCH_NOT_APPROVED'
    );
  }

  if (!batch.students || batch.students.length === 0) {
    throw new StateMachineError(
      'Cannot generate certificates: Batch contains zero students.',
      400,
      'NO_STUDENTS_IN_BATCH'
    );
  }

  // 3. Ensure batch status is updated to PROCESSING if starting
  if (batch.status === BatchStatus.APPROVED) {
    await prisma.$transaction(async (tx) => {
      await tx.batch.update({
        where: { id: batchId },
        data: {
          status: BatchStatus.PROCESSING,
          version: { increment: 1 }
        }
      });

      await tx.batchHistory.create({
        data: {
          batchId,
          userId: user.id,
          fromStatus: BatchStatus.APPROVED,
          toStatus: BatchStatus.PROCESSING,
          action: 'START_CERTIFICATE_GENERATION',
          reason: `Certificate generation initiated by State Officer ${user.name}`
        }
      });
    });
  }

  // Ensure storage directory exists
  const storageDir = config.certificateStorageDir;
  fs.mkdirSync(storageDir, { recursive: true });

  const generatedCerts: Array<{
    id: string;
    certificateNumber: string;
    studentId: string;
    studentName: string;
    pdfPath: string;
  }> = [];

  const failures: Array<{
    studentId: string;
    studentName: string;
    error: string;
  }> = [];

  let skippedCount = 0;
  const year = new Date(batch.trainingEndDate).getFullYear() || new Date().getFullYear();

  // 4. Process each student idempotently
  for (const student of batch.students) {
    try {
      // Check if certificate already exists in DB
      const existingCert = await prisma.certificate.findUnique({
        where: {
          batchId_studentId: {
            batchId,
            studentId: student.id
          }
        }
      });

      if (existingCert && fs.existsSync(existingCert.pdfPath)) {
        // Idempotent: already generated
        skippedCount++;
        generatedCerts.push({
          id: existingCert.id,
          certificateNumber: existingCert.certificateNumber,
          studentId: student.id,
          studentName: student.studentName,
          pdfPath: existingCert.pdfPath
        });
        continue;
      }

      // Generate unique certificate number with collision retry loop
      let certificateNumber = '';
      let isUnique = false;
      let attempts = 0;

      while (!isUnique && attempts < 5) {
        attempts++;
        const candidateNumber = generateCertificateNumber(year);
        const collision = await prisma.certificate.findUnique({
          where: { certificateNumber: candidateNumber }
        });
        if (!collision) {
          certificateNumber = candidateNumber;
          isUnique = true;
        }
      }

      if (!certificateNumber) {
        throw new Error('Failed to generate a unique certificate number after multiple attempts.');
      }

      // Generate verification token and QR Code
      const verificationToken = generateVerificationToken();
      const { qrCodeUrl, qrCodeBuffer } = await generateCertificateQr(verificationToken);

      // Define secure PDF file path
      const safeFilename = `${certificateNumber}.pdf`;
      const pdfPath = path.join(storageDir, safeFilename);

      // Render PDF file on disk
      await generateCertificatePdf({
        certificateNumber,
        studentName: student.studentName,
        courseName: batch.courseName,
        batchNumber: batch.batchNumber,
        trainingCentreId: batch.trainingCentreId,
        districtId: batch.districtId,
        trainingStartDate: batch.trainingStartDate,
        trainingEndDate: batch.trainingEndDate,
        issueDate: new Date(),
        grade: student.grade,
        qrCodeBuffer,
        outputPath: pdfPath
      });

      // Upsert record in database
      const createdCert = await prisma.certificate.upsert({
        where: {
          batchId_studentId: {
            batchId,
            studentId: student.id
          }
        },
        create: {
          certificateNumber,
          studentId: student.id,
          batchId,
          courseName: batch.courseName,
          trainingCentreId: batch.trainingCentreId,
          districtId: batch.districtId,
          issueDate: new Date(),
          status: CertificateStatus.GENERATED,
          pdfPath,
          verificationToken,
          qrCodeUrl
        },
        update: {
          certificateNumber,
          pdfPath,
          verificationToken,
          qrCodeUrl,
          status: CertificateStatus.GENERATED
        }
      });

      generatedCerts.push({
        id: createdCert.id,
        certificateNumber: createdCert.certificateNumber,
        studentId: student.id,
        studentName: student.studentName,
        pdfPath: createdCert.pdfPath
      });
    } catch (err: any) {
      console.error(`Error generating certificate for student ${student.studentName} (${student.id}):`, err);
      failures.push({
        studentId: student.id,
        studentName: student.studentName,
        error: err.message || 'Unknown generation failure'
      });
    }
  }

  // 5. Update Batch Status: ISSUED if all succeeded; remains PROCESSING if partial failure
  let finalStatus: BatchStatus = batch.status;
  const isFullySuccessful = failures.length === 0 && (generatedCerts.length === batch.students.length);

  if (isFullySuccessful) {
    finalStatus = BatchStatus.ISSUED;
    if (batch.status !== BatchStatus.ISSUED) {
      await prisma.$transaction(async (tx) => {
        await tx.batch.update({
          where: { id: batchId },
          data: {
            status: BatchStatus.ISSUED,
            version: { increment: 1 }
          }
        });

        await tx.batchHistory.create({
          data: {
            batchId,
            userId: user.id,
            fromStatus: BatchStatus.PROCESSING,
            toStatus: BatchStatus.ISSUED,
            action: 'CERTIFICATES_ISSUED',
            reason: `All ${batch.students.length} certificates successfully generated and officially issued.`
          }
        });
      });
    }
  }

  return {
    success: isFullySuccessful,
    batchId,
    batchStatus: finalStatus,
    totalStudents: batch.students.length,
    generatedCount: generatedCerts.length - skippedCount,
    skippedCount,
    failedCount: failures.length,
    certificates: generatedCerts,
    failures
  };
}
