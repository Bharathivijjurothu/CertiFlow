import { Router, Request, Response } from 'express';
import { verifyCertificate } from '../services/verification.service';
import { publicRateLimiter } from '../middleware/rateLimiter';

export const verifyRouter = Router();

// Apply public rate limiting middleware (60 req/min per IP)
verifyRouter.use(publicRateLimiter());

/**
 * GET /api/verify/:identifier
 * Public verification endpoint for Certificate Number or QR verification token.
 * No authentication required.
 */
verifyRouter.get('/:identifier', async (req: Request, res: Response) => {
  try {
    const { identifier } = req.params;
    const result = await verifyCertificate(identifier);

    return res.json({
      success: true,
      ...result
    });
  } catch (error: any) {
    console.error('Public verification error:', error);
    return res.status(500).json({
      success: false,
      status: 'INVALID',
      valid: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred during certificate verification. Please try again.'
    });
  }
});

/**
 * POST /api/verify
 * Public verification endpoint accepting JSON payload { identifier: string }
 */
verifyRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { identifier } = req.body;
    const result = await verifyCertificate(identifier);

    return res.json({
      success: true,
      ...result
    });
  } catch (error: any) {
    console.error('Public verification error:', error);
    return res.status(500).json({
      success: false,
      status: 'INVALID',
      valid: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred during certificate verification. Please try again.'
    });
  }
});
