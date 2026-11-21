import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';

export const usersRouter = Router();

// GET /api/demo-users
usersRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        districtId: true,
        trainingCentreId: true,
        createdAt: true
      },
      orderBy: { name: 'asc' }
    });

    return res.json({
      success: true,
      count: users.length,
      users
    });
  } catch (error) {
    console.error('Failed to retrieve demo users:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve demo users',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
