import { Queue, Worker, Job } from 'bullmq';
import { config } from '../config/env';
import { AuthUser } from '../types/express';
import { generateCertificatesForBatch, GenerationResult } from './certificateGenerator.service';

const QUEUE_NAME = 'certificate-generation';

// BullMQ connection options parsed from redisUrl
let redisConnection: any = null;
try {
  const url = new URL(config.redisUrl);
  redisConnection = {
    host: url.hostname || 'localhost',
    port: parseInt(url.port || '6379', 10),
    maxRetriesPerRequest: null
  };
} catch {
  redisConnection = {
    host: 'localhost',
    port: 6379,
    maxRetriesPerRequest: null
  };
}

let certQueue: Queue | null = null;
let certWorker: Worker | null = null;

try {
  certQueue = new Queue(QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1500
      },
      removeOnComplete: 100,
      removeOnFail: 200
    }
  });

  certWorker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      const { batchId, user } = job.data;
      return await generateCertificatesForBatch(batchId, user);
    },
    { connection: redisConnection }
  );

  certWorker.on('completed', (job: Job, result: any) => {
    console.log(`[BullMQ] Certificate generation completed for batch ${job.data?.batchId}`);
  });

  certWorker.on('failed', (job: Job | undefined, err: Error) => {
    console.error(`[BullMQ] Certificate generation job failed for batch ${job?.data?.batchId}:`, err.message);
  });
} catch (err: any) {
  console.warn('[BullMQ] Queue initialization deferred or running in direct sync mode:', err.message);
}

/**
 * Enqueues or directly processes certificate generation.
 * Supports synchronous execution for immediate API and test response.
 */
export async function processCertificateGeneration(
  batchId: string,
  user: AuthUser,
  runAsync: boolean = false
): Promise<GenerationResult> {
  if (runAsync && certQueue) {
    const job = await certQueue.add('generate-certificates', { batchId, user });
    return {
      success: true,
      batchId,
      batchStatus: 'PROCESSING' as any,
      totalStudents: 0,
      generatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      certificates: [],
      failures: []
    };
  }

  // Direct synchronous execution
  return await generateCertificatesForBatch(batchId, user);
}
