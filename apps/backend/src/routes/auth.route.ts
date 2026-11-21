import { Router, Request, Response } from 'express';
import { loginUser } from '../services/auth.service';
import { authenticateToken } from '../middleware/auth.middleware';

export const authRouter = Router();

// POST /api/auth/login
authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'BAD_REQUEST',
        message: 'Email and password are required'
      });
    }

    const result = await loginUser(email, password);
    return res.json({
      success: true,
      token: result.token,
      user: result.user
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Authentication failed';
    return res.status(401).json({
      success: false,
      error: 'AUTHENTICATION_FAILED',
      message: msg
    });
  }
});

// GET /api/auth/me
authRouter.get('/me', authenticateToken, (req: Request, res: Response) => {
  return res.json({
    success: true,
    user: req.user
  });
});
