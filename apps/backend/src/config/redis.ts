import Redis from 'ioredis';
import { config } from './env';

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    return Math.min(times * 100, 3000);
  },
  lazyConnect: true
});

redis.on('error', (err) => {
  console.warn('Redis connection notice:', err.message);
});
