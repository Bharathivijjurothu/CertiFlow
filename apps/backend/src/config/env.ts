import dotenv from 'dotenv';
import path from 'path';
dotenv.config();

const redisHost = process.env.REDIS_HOST || 'redis';
const redisPort = process.env.REDIS_PORT || '6379';
const defaultRedisUrl = `redis://${redisHost}:${redisPort}`;

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://certiflow:certiflow_secret@localhost:5432/certiflow_db?schema=public',
  redisUrl: process.env.REDIS_URL || defaultRedisUrl,
  jwtSecret: process.env.JWT_SECRET || 'certiflow-jwt-secret-key-phase2-2026',
  maxUploadSizeBytes: parseInt(process.env.MAX_UPLOAD_SIZE_BYTES || '5242880', 10), // 5MB default
  maxUploadRows: parseInt(process.env.MAX_UPLOAD_ROWS || '1000', 10), // 1000 rows max
  qualityReviewThreshold: parseInt(process.env.QUALITY_REVIEW_THRESHOLD || '50', 10), // 50 students
  verificationBaseUrl: process.env.VERIFICATION_BASE_URL || 'http://localhost:5173/verify',
  certificateStorageDir: process.env.CERTIFICATE_STORAGE_DIR || path.resolve(process.cwd(), 'storage/certificates')
};
