import { Queue, Worker, Job } from 'bullmq';
import { config } from '../config/env';
import { deliverSingleCertificate } from './deliveryService';

const QUEUE_NAME = 'whatsapp-delivery';

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

let deliveryQueue: Queue | null = null;
let deliveryWorker: Worker | null = null;

try {
  deliveryQueue = new Queue(QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      },
      removeOnComplete: 200,
      removeOnFail: 500
    }
  });

  deliveryWorker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      const { certificateId } = job.data;
      return await deliverSingleCertificate(certificateId);
    },
    { connection: redisConnection }
  );

  deliveryWorker.on('completed', (job: Job) => {
    console.log(`[BullMQ] WhatsApp delivery completed for cert ${job.data?.certificateId}`);
  });

  deliveryWorker.on('failed', (job: Job | undefined, err: Error) => {
    console.error(`[BullMQ] WhatsApp delivery job failed for cert ${job?.data?.certificateId}:`, err.message);
  });
} catch (err: any) {
  console.warn('[BullMQ] WhatsApp delivery queue initialization deferred:', err.message);
}

export { deliveryQueue, deliveryWorker };
