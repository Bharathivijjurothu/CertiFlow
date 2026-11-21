import { Router, Request, Response } from 'express';
import fs from 'fs';
import { Role } from '@prisma/client';
import { prisma } from '../config/db';
import { authenticateToken } from '../middleware/auth.middleware';
import { retryCertificateDelivery } from '../services/deliveryService';
import { cancelCertificate, getCertificateAuditHistory } from '../services/verification.service';
import { StateMachineError } from '../services/stateMachine.service';

export const certificatesRouter = Router();

// All certificate endpoints require authentication
certificatesRouter.use(authenticateToken);

// GET /api/certificates/:id - Retrieve certificate details
certificatesRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;

    const cert = await prisma.certificate.findUnique({
      where: { id },
      include: {
        student: true,
        batch: {
          select: {
            id: true,
            batchNumber: true,
            batchName: true,
            status: true,
            trainingCentreId: true,
            districtId: true
          }
        }
      }
    });

    if (!cert) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Certificate not found'
      });
    }

    // Role-based scope verification
    if (user.role === Role.TRAINING_CENTRE && cert.trainingCentreId !== user.trainingCentreId) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: 'You can only view certificates issued for your training centre.'
      });
    }

    if (user.role === Role.DISTRICT_OFFICER && cert.districtId !== user.districtId) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: `You can only view certificates from your assigned district (${user.districtId}).`
      });
    }

    return res.json({
      success: true,
      certificate: cert
    });
  } catch (error: any) {
    console.error('Error fetching certificate:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Failed to retrieve certificate'
    });
  }
});

// GET /api/certificates/:id/download - Securely download certificate PDF
certificatesRouter.get('/:id/download', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;

    const cert = await prisma.certificate.findUnique({
      where: { id }
    });

    if (!cert) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Certificate not found'
      });
    }

    // Role-based scope authorization
    if (user.role === Role.TRAINING_CENTRE && cert.trainingCentreId !== user.trainingCentreId) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: 'Access denied: You can only download certificates for your training centre.'
      });
    }

    if (user.role === Role.DISTRICT_OFFICER && cert.districtId !== user.districtId) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: `Access denied: You can only download certificates from your district (${user.districtId}).`
      });
    }

    // Verify PDF file exists on storage disk
    if (!fs.existsSync(cert.pdfPath)) {
      return res.status(404).json({
        success: false,
        error: 'FILE_NOT_FOUND',
        message: 'Certificate PDF file not found in secure storage repository.'
      });
    }

    const filename = `certificate-${cert.certificateNumber}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const fileStream = fs.createReadStream(cert.pdfPath);
    return fileStream.pipe(res);
  } catch (error: any) {
    console.error('Error downloading certificate PDF:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Failed to download certificate PDF'
    });
  }
});

// GET /api/certificates/:id/delivery-status - View WhatsApp delivery tracking for a certificate
certificatesRouter.get('/:id/delivery-status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const delivery = await prisma.certificateDelivery.findUnique({
      where: {
        certificateId_channel: {
          certificateId: id,
          channel: 'WHATSAPP'
        }
      },
      include: {
        attemptLogs: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!delivery) {
      return res.json({
        success: true,
        delivery: null,
        status: 'NOT_QUEUED'
      });
    }

    return res.json({
      success: true,
      delivery
    });
  } catch (error: any) {
    console.error('Error fetching certificate delivery status:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Failed to retrieve delivery status'
    });
  }
});

// POST /api/certificates/:id/retry-delivery - Manually retry a failed certificate delivery
certificatesRouter.post('/:id/retry-delivery', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;

    const updated = await retryCertificateDelivery(id, user);

    return res.json({
      success: true,
      message: `Delivery attempt initiated. Status: ${updated.status}`,
      delivery: updated
    });
  } catch (error: any) {
    if (error instanceof StateMachineError) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.code,
        message: error.message
      });
    }
    console.error('Error retrying certificate delivery:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: error.message || 'Failed to retry delivery'
    });
  }
});

// POST /api/certificates/:id/cancel - State Officer Certificate Cancellation
certificatesRouter.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { reason } = req.body;

    const cancelled = await cancelCertificate(id, reason, user);

    return res.json({
      success: true,
      message: `Certificate ${cancelled.certificateNumber} has been officially cancelled.`,
      certificate: cancelled
    });
  } catch (error: any) {
    if (error instanceof StateMachineError) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.code,
        message: error.message
      });
    }
    console.error('Error cancelling certificate:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: error.message || 'Failed to cancel certificate'
    });
  }
});

// GET /api/certificates/:id/audit - View certificate audit history
certificatesRouter.get('/:id/audit', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const auditLogs = await getCertificateAuditHistory(id);

    return res.json({
      success: true,
      count: auditLogs.length,
      auditLogs
    });
  } catch (error: any) {
    console.error('Error fetching certificate audit history:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Failed to retrieve certificate audit history'
    });
  }
});

