import dotenv from 'dotenv';
import path from 'path';

// Load root and local env
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://certiflow:certiflow_secret@localhost:5432/certiflow_db?schema=public';
}

import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']
});
