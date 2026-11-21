import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { redis } from '../config/redis';
import { config } from '../config/env';

export const healthRouter = Router();

const startTime = Date.now();

healthRouter.get('/', async (_req: Request, res: Response) => {
  let dbStatus = 'disconnected';
  let dbLatencyMs: number | null = null;
  let redisStatus = 'disconnected';
  let redisLatencyMs: number | null = null;

  // Test PostgreSQL
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - dbStart;
    dbStatus = 'connected';
  } catch (error) {
    dbStatus = 'error: ' + (error instanceof Error ? error.message : String(error));
  }

  // Test Redis
  try {
    const redisStart = Date.now();
    if (redis.status === 'wait') {
      await redis.connect();
    }
    const pong = await redis.ping();
    if (pong === 'PONG') {
      redisLatencyMs = Date.now() - redisStart;
      redisStatus = 'connected';
    }
  } catch (error) {
    redisStatus = 'error: ' + (error instanceof Error ? error.message : String(error));
  }

  const isHealthy = dbStatus === 'connected' && redisStatus === 'connected';
  const statusCode = isHealthy ? 200 : 503;

  return res.status(statusCode).json({
    status: isHealthy ? 'healthy' : 'degraded',
    service: 'certiflow-backend',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    environment: config.nodeEnv,
    services: {
      api: {
        status: 'healthy'
      },
      database: {
        status: dbStatus,
        latencyMs: dbLatencyMs
      },
      redis: {
        status: redisStatus,
        latencyMs: redisLatencyMs
      }
    }
  });
});
