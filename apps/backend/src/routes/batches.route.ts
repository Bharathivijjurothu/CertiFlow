import { Router, Request, Response } from 'express';
import multer from 'multer';
import { Role, BatchStatus, ReviewDecision } from '@prisma/client';
import { prisma } from '../config/db';
import { authenticateToken, authorizeRoles } from '../middleware/auth.middleware';
import { transitionBatch, StateMachineError, ConcurrencyConflictError } from '../services/stateMachine.service';
import { parseAndValidateUpload, generateTemplate } from '../services/uploadValidation.service';
import { getReviewQueue, getReviewProgress, submitReviewDecision } from '../services/reviewWorkflow.service';
import { generateCertificatesForBatch } from '../services/certificateGenerator.service';
import { queueBatchDelivery, getBatchDeliveryStatus } from '../services/deliveryService';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB memory buffer limit
});

export const batchesRouter = Router();

// All batch endpoints require authentication
batchesRouter.use(authenticateToken);

// GET /api/batches/template - Download upload template
batchesRouter.get('/template', (req: Request, res: Response) => {
  const format = (req.query.format as string)?.toLowerCase() === 'xlsx' ? 'xlsx' : 'csv';
  const { buffer, mimeType, filename } = generateTemplate(format);

  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(buffer);
});

// POST /api/batches - Create batch (Training Centre only)
batchesRouter.post('/', authorizeRoles(Role.TRAINING_CENTRE), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const {
      batchNumber,
      batchName,
      courseName,
      districtId,
      trainingStartDate,
      trainingEndDate
    } = req.body;

    if (!batchNumber || !batchName || !courseName || !districtId || !trainingStartDate || !trainingEndDate) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'All fields are required: batchNumber, batchName, courseName, districtId, trainingStartDate, trainingEndDate'
      });
    }

    if (!user.trainingCentreId) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_CENTRE_ID',
        message: 'User account has no associated trainingCentreId'
      });
    }

    // Check unique batchNumber
    const existing = await prisma.batch.findUnique({
      where: { batchNumber: batchNumber.trim().toUpperCase() }
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'DUPLICATE_BATCH_NUMBER',
        message: `Batch number '${batchNumber}' already exists.`
      });
    }

    const batch = await prisma.$transaction(async (tx) => {
      const created = await tx.batch.create({
        data: {
          batchNumber: batchNumber.trim().toUpperCase(),
          batchName: batchName.trim(),
          courseName: courseName.trim(),
          trainingCentreId: user.trainingCentreId!,
          districtId: districtId.trim(),
          trainingStartDate: new Date(trainingStartDate),
          trainingEndDate: new Date(trainingEndDate),
          status: BatchStatus.DRAFT,
          version: 1,
          createdById: user.id
        }
      });

      // Record initial history
      await tx.batchHistory.create({
        data: {
          batchId: created.id,
          userId: user.id,
          fromStatus: BatchStatus.DRAFT,
          toStatus: BatchStatus.DRAFT,
          action: 'CREATE_BATCH',
          reason: `Batch initialized by Training Centre ${user.trainingCentreId}`
        }
      });

      return created;
    });

    return res.status(201).json({
      success: true,
      batch
    });
  } catch (error) {
    console.error('Error creating batch:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: error instanceof Error ? error.message : 'Failed to create batch'
    });
  }
});

// GET /api/batches - List batches with role-based filtering
batchesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { status, districtId } = req.query;

    const where: any = {};

    // Role-based scoping
    if (user.role === Role.TRAINING_CENTRE) {
      where.trainingCentreId = user.trainingCentreId;
    } else if (user.role === Role.DISTRICT_OFFICER) {
      where.districtId = user.districtId;
    } else if (districtId) {
      where.districtId = String(districtId);
    }

    if (status && Object.values(BatchStatus).includes(status as BatchStatus)) {
      where.status = status as BatchStatus;
    }

    const batches = await prisma.batch.findMany({
      where,
      include: {
        createdBy: {
          select: { id: true, name: true, email: true, role: true }
        },
        _count: {
          select: { students: true, history: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return res.json({
      success: true,
      count: batches.length,
      batches: batches.map((b) => ({
        ...b,
        studentCount: b._count.students,
        historyCount: b._count.history
      }))
    });
  } catch (error) {
    console.error('Error fetching batches:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Failed to retrieve batches'
    });
  }
});

// GET /api/batches/review-queue - Get queue of batches pending review for current officer
batchesRouter.get('/review-queue', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    if (user.role === Role.TRAINING_CENTRE) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: 'Training Centre users do not have an officer review queue.'
      });
    }

    const queue = await getReviewQueue(user);
    return res.json({
      success: true,
      queue,
      total: queue.length
    });
  } catch (error) {
    console.error('Error fetching review queue:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Failed to retrieve review queue'
    });
  }
});

// GET /api/batches/:id - Get batch details, students, and full history
batchesRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;

    const batch = await prisma.batch.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true, role: true, trainingCentreId: true }
        },
        students: {
          orderBy: { createdAt: 'asc' }
        },
        history: {
          include: {
            user: {
              select: { id: true, name: true, email: true, role: true }
            }
          },
          orderBy: { createdAt: 'asc' }
        },
        reviews: {
          include: {
            reviewer: {
              select: { id: true, name: true, email: true, role: true }
            }
          },
          orderBy: { createdAt: 'asc' }
        },
        certificates: {
          include: {
            student: true
          },
          orderBy: { createdAt: 'asc' }
        },
        _count: {
          select: { students: true, certificates: true }
        }
      }
    });

    if (!batch) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Batch not found'
      });
    }

    // Ownership & District validation
    if (user.role === Role.TRAINING_CENTRE && batch.trainingCentreId !== user.trainingCentreId) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: 'Access denied: You can only view batches from your own training centre.'
      });
    }

    if (user.role === Role.DISTRICT_OFFICER && batch.districtId !== user.districtId) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: `Access denied: You can only view batches from your assigned district (${user.districtId}).`
      });
    }

    return res.json({
      success: true,
      batch: {
        ...batch,
        studentCount: batch._count.students
      }
    });
  } catch (error) {
    console.error('Error retrieving batch details:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Failed to retrieve batch details'
    });
  }
});

// PUT /api/batches/:id - Edit draft or returned batch
batchesRouter.put('/:id', authorizeRoles(Role.TRAINING_CENTRE), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const {
      batchName,
      courseName,
      districtId,
      trainingStartDate,
      trainingEndDate,
      expectedVersion
    } = req.body;

    if (expectedVersion === undefined || expectedVersion === null) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_VERSION',
        message: 'expectedVersion is required for optimistic concurrency check.'
      });
    }

    const batch = await prisma.batch.findUnique({ where: { id } });
    if (!batch) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Batch not found' });
    }

    if (batch.trainingCentreId !== user.trainingCentreId) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: 'You can only edit batches belonging to your own training centre.'
      });
    }

    if (batch.status !== BatchStatus.DRAFT && batch.status !== BatchStatus.RETURNED) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_STATUS',
        message: `Cannot edit batch in status '${batch.status}'. Only DRAFT and RETURNED batches can be edited.`
      });
    }

    if (batch.version !== expectedVersion) {
      return res.status(409).json({
        success: false,
        error: 'CONCURRENCY_CONFLICT',
        message: `Version conflict: Batch version is ${batch.version}, expected ${expectedVersion}. Please reload.`
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.batch.updateMany({
        where: {
          id,
          version: expectedVersion,
          status: batch.status
        },
        data: {
          batchName: batchName ? batchName.trim() : batch.batchName,
          courseName: courseName ? courseName.trim() : batch.courseName,
          districtId: districtId ? districtId.trim() : batch.districtId,
          trainingStartDate: trainingStartDate ? new Date(trainingStartDate) : batch.trainingStartDate,
          trainingEndDate: trainingEndDate ? new Date(trainingEndDate) : batch.trainingEndDate,
          version: { increment: 1 }
        }
      });

      if (updateResult.count === 0) {
        throw new ConcurrencyConflictError();
      }

      await tx.batchHistory.create({
        data: {
          batchId: id,
          userId: user.id,
          fromStatus: batch.status,
          toStatus: batch.status,
          action: 'UPDATE_METADATA',
          reason: 'Batch metadata updated'
        }
      });

      return await tx.batch.findUnique({ where: { id } });
    });

    return res.json({
      success: true,
      batch: updated
    });
  } catch (error) {
    if (error instanceof ConcurrencyConflictError) {
      return res.status(409).json({ success: false, error: error.code, message: error.message });
    }
    return res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Failed to update batch' });
  }
});

// POST /api/batches/:id/upload - Upload Excel/CSV with strict atomic validation
batchesRouter.post('/:id/upload', authorizeRoles(Role.TRAINING_CENTRE), upload.single('file'), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'NO_FILE_UPLOADED',
        message: 'No file uploaded. Please upload a .xlsx or .csv file with field name "file".'
      });
    }

    const batch = await prisma.batch.findUnique({ where: { id } });
    if (!batch) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Batch not found' });
    }

    if (batch.trainingCentreId !== user.trainingCentreId) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: 'You can only upload student data to batches belonging to your training centre.'
      });
    }

    if (batch.status !== BatchStatus.DRAFT && batch.status !== BatchStatus.RETURNED) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_STATUS',
        message: `Cannot upload students to a batch with status '${batch.status}'. Only DRAFT or RETURNED batches accept uploads.`
      });
    }

    // Parse and strictly validate file
    const { report, validRows } = await parseAndValidateUpload(req.file.buffer, req.file.originalname, id);

    // If any validation error exists: ALL-OR-NOTHING - save 0 student records
    if (!report.valid || report.errors.length > 0) {
      return res.status(422).json({
        success: false,
        error: 'VALIDATION_FAILED',
        message: `Validation failed with ${report.errors.length} error(s). Zero student records were saved.`,
        report
      });
    }

    // All rows valid: insert all records inside a database transaction
    await prisma.$transaction(async (tx) => {
      // Clear previously uploaded students for this batch to ensure clean state
      await tx.student.deleteMany({ where: { batchId: id } });

      // Insert all students atomically
      await tx.student.createMany({
        data: validRows.map((r, idx) => ({
          batchId: id,
          studentId: r.governmentId || `STU-${batch.batchNumber}-${idx + 1}`,
          studentName: r.studentName,
          email: r.email,
          phone: r.phone,
          governmentId: r.governmentId || null,
          dateOfBirth: r.dateOfBirth || null,
          gender: r.gender || null,
          grade: r.grade || null
        }))
      });

      // Increment batch version
      await tx.batch.update({
        where: { id },
        data: {
          version: { increment: 1 }
        }
      });

      // Record history
      await tx.batchHistory.create({
        data: {
          batchId: id,
          userId: user.id,
          fromStatus: batch.status,
          toStatus: batch.status,
          action: 'UPLOAD_STUDENTS',
          reason: `Uploaded ${validRows.length} valid students from file '${req.file?.originalname}'`
        }
      });
    });

    const students = await prisma.student.findMany({
      where: { batchId: id },
      take: 10,
      orderBy: { createdAt: 'asc' }
    });

    return res.json({
      success: true,
      message: `Successfully validated and saved ${validRows.length} students.`,
      report,
      studentsCount: validRows.length,
      preview: students
    });
  } catch (error) {
    console.error('Error during student upload:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: error instanceof Error ? error.message : 'Failed to process student upload'
    });
  }
});

// POST /api/batches/:id/submit - Submit batch (DRAFT/RETURNED -> SUBMITTED)
batchesRouter.post('/:id/submit', authorizeRoles(Role.TRAINING_CENTRE), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { expectedVersion } = req.body;

    if (expectedVersion === undefined || expectedVersion === null) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_VERSION',
        message: 'expectedVersion is required for concurrency safety.'
      });
    }

    const result = await transitionBatch({
      batchId: id,
      expectedVersion,
      targetStatus: BatchStatus.SUBMITTED,
      user,
      action: 'SUBMIT_BATCH',
      reason: 'Batch submitted for District Officer review'
    });

    return res.json({
      success: true,
      message: 'Batch successfully submitted for district review.',
      batch: result.batch,
      history: result.history
    });
  } catch (error) {
    if (error instanceof StateMachineError) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.code,
        message: error.message
      });
    }
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Failed to submit batch'
    });
  }
});

// POST /api/batches/:id/transition - General state transition for reviews
batchesRouter.post('/:id/transition', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { targetStatus, expectedVersion, action, reason } = req.body;

    if (!targetStatus || expectedVersion === undefined) {
      return res.status(400).json({
        success: false,
        error: 'BAD_REQUEST',
        message: 'targetStatus and expectedVersion are required.'
      });
    }

    if (!Object.values(BatchStatus).includes(targetStatus)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_STATUS',
        message: `Unknown status: '${targetStatus}'`
      });
    }

    const result = await transitionBatch({
      batchId: id,
      expectedVersion,
      targetStatus,
      user,
      action: action || `TRANSITION_TO_${targetStatus}`,
      reason: reason || undefined
    });

    return res.json({
      success: true,
      message: `Batch status successfully transitioned to ${targetStatus}.`,
      batch: result.batch,
      history: result.history
    });
  } catch (error) {
    if (error instanceof StateMachineError) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.code,
        message: error.message
      });
    }
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Failed to transition batch status'
    });
  }
});

// GET /api/batches/:id/review-progress - Detailed approval workflow progress
batchesRouter.get('/:id/review-progress', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;

    const progress = await getReviewProgress(id, user);
    return res.json({
      success: true,
      progress
    });
  } catch (error: any) {
    if (error instanceof StateMachineError) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.code,
        message: error.message
      });
    }
    console.error('Error fetching review progress:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Failed to retrieve review progress'
    });
  }
});

// POST /api/batches/:id/review - Submit review decision (APPROVE, RETURN, REJECT)
batchesRouter.post('/:id/review', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { expectedVersion, decision, comment } = req.body;

    if (expectedVersion === undefined || expectedVersion === null) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_VERSION',
        message: 'expectedVersion is required for concurrency safety.'
      });
    }

    if (!decision || !Object.values(ReviewDecision).includes(decision)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_DECISION',
        message: `Invalid review decision: '${decision}'. Must be one of: ${Object.values(ReviewDecision).join(', ')}`
      });
    }

    const result = await submitReviewDecision({
      batchId: id,
      expectedVersion,
      decision,
      comment,
      user
    });

    return res.json({
      success: true,
      message: `Review decision '${decision}' successfully recorded.`,
      batch: result.batch,
      review: result.review,
      nextStatus: result.nextStatus
    });
  } catch (error: any) {
    if (error instanceof StateMachineError) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.code,
        message: error.message
      });
    }
    // Handle Prisma unique constraint violation (e.g. concurrent duplicate decision)
    if (error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        error: 'DUPLICATE_REVIEW_DECISION',
        message: 'You have already submitted a review decision for this stage in the current round.'
      });
    }
    console.error('Error submitting review decision:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: error.message || 'Failed to submit review decision'
    });
  }
});

// POST /api/batches/:id/generate-certificates - Generate official certificates for approved batch
batchesRouter.post('/:id/generate-certificates', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;

    const result = await generateCertificatesForBatch(id, user);

    return res.json({
      success: result.success,
      message: result.success
        ? `Successfully generated ${result.generatedCount} certificates (${result.skippedCount} already existed). Batch status is now ISSUED.`
        : `Certificate generation completed with ${result.failedCount} failures.`,
      result
    });
  } catch (error: any) {
    if (error instanceof StateMachineError) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.code,
        message: error.message
      });
    }
    console.error('Error generating certificates:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: error.message || 'Failed to generate certificates'
    });
  }
});

// GET /api/batches/:id/certificates - Get all certificates for a batch
batchesRouter.get('/:id/certificates', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;

    const batch = await prisma.batch.findUnique({
      where: { id },
      select: { id: true, trainingCentreId: true, districtId: true }
    });

    if (!batch) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Batch not found'
      });
    }

    // Role-based scope checks
    if (user.role === Role.TRAINING_CENTRE && batch.trainingCentreId !== user.trainingCentreId) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: 'Access denied: You can only view certificates for your own centre.'
      });
    }

    if (user.role === Role.DISTRICT_OFFICER && batch.districtId !== user.districtId) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: `Access denied: You can only view certificates from your district (${user.districtId}).`
      });
    }

    const certificates = await prisma.certificate.findMany({
      where: { batchId: id },
      include: {
        student: true,
        deliveries: {
          where: { channel: 'WHATSAPP' }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    return res.json({
      success: true,
      count: certificates.length,
      certificates
    });
  } catch (error: any) {
    console.error('Error fetching certificates for batch:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Failed to retrieve certificates'
    });
  }
});

// POST /api/batches/:id/send-certificates - Queue WhatsApp certificate delivery
batchesRouter.post('/:id/send-certificates', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { failSimulated } = req.body || {};

    const summary = await queueBatchDelivery(id, user, { failSimulated });

    return res.json({
      success: true,
      message: `WhatsApp certificate delivery queued for batch: ${summary.queuedCount} queued, ${summary.alreadySentCount} already delivered.`,
      summary
    });
  } catch (error: any) {
    if (error instanceof StateMachineError) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.code,
        message: error.message
      });
    }
    console.error('Error queuing certificate delivery:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: error.message || 'Failed to queue certificate delivery'
    });
  }
});

// GET /api/batches/:id/delivery-status - Delivery progress and attempt tracking
batchesRouter.get('/:id/delivery-status', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;

    const statusReport = await getBatchDeliveryStatus(id, user);

    return res.json({
      success: true,
      ...statusReport
    });
  } catch (error: any) {
    if (error instanceof StateMachineError) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.code,
        message: error.message
      });
    }
    console.error('Error fetching delivery status:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Failed to retrieve delivery status'
    });
  }
});
