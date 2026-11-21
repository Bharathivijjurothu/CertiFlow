import { Router, Request, Response } from 'express';
import { WhatsAppSimulator } from '../services/whatsappSimulator.service';
import { authenticateToken } from '../middleware/auth.middleware';

export const whatsappRouter = Router();

whatsappRouter.use(authenticateToken);

// GET /api/whatsapp/simulator/messages - Retrieve simulated messages ledger
whatsappRouter.get('/simulator/messages', (_req: Request, res: Response) => {
  const messages = WhatsAppSimulator.getRecentMessages(50);
  return res.json({
    success: true,
    count: messages.length,
    messages
  });
});
