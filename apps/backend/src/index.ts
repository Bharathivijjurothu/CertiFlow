import express from 'express';
import cors from 'cors';
import { config } from './config/env';
import { healthRouter } from './routes/health.route';
import { usersRouter } from './routes/users.route';
import { authRouter } from './routes/auth.route';
import { batchesRouter } from './routes/batches.route';
import { certificatesRouter } from './routes/certificates.route';
import { whatsappRouter } from './routes/whatsapp.route';
import { verifyRouter } from './routes/verify.route';
import { prisma } from './config/db';
import { redis } from './config/redis';

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use('/health', healthRouter);
app.use('/api/demo-users', usersRouter);
app.use('/api/auth', authRouter);
app.use('/api/batches', batchesRouter);
app.use('/api/certificates', certificatesRouter);
app.use('/api/whatsapp', whatsappRouter);
app.use('/api/verify', verifyRouter);
app.use('/api/public/verify', verifyRouter);

app.get('/', (_req, res) => {
  res.json({
    message: 'Welcome to CertiFlow API (Phase 2)',
    healthEndpoint: '/health',
    demoUsersEndpoint: '/api/demo-users',
    authEndpoints: '/api/auth',
    batchesEndpoints: '/api/batches'
  });
});

const server = app.listen(config.port, () => {
  console.log(`🚀 CertiFlow Backend API running on port ${config.port} (${config.nodeEnv})`);
  console.log(`🩺 Health check available at http://localhost:${config.port}/health`);
});

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutting down server gracefully...');
  server.close(async () => {
    try {
      await prisma.$disconnect();
      redis.disconnect();
      console.log('Connections closed. Exiting process.');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;
