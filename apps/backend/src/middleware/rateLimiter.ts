import { Request, Response, NextFunction } from 'express';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const ipRequestMap = new Map<string, RateLimitRecord>();

// Clean up stale IP records periodically every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of ipRequestMap.entries()) {
    if (now > record.resetAt) {
      ipRequestMap.delete(ip);
    }
  }
}, 5 * 60 * 1000);

export interface RateLimitOptions {
  windowMs?: number; // Time window in ms (default: 60,000ms = 1 min)
  maxRequests?: number; // Max requests per window (default: 60)
}

/**
 * In-memory sliding rate limiter for public verification endpoints.
 * Protects against brute-force certificate enumeration and denial-of-service.
 */
export function publicRateLimiter(options?: RateLimitOptions) {
  const windowMs = options?.windowMs || 60 * 1000;
  const maxRequests = options?.maxRequests || 60;

  return (req: Request, res: Response, next: NextFunction) => {
    // Determine client IP (handles standard and proxy headers)
    const forwarded = req.headers['x-forwarded-for'];
    const clientIp = typeof forwarded === 'string'
      ? forwarded.split(',')[0].trim()
      : req.socket.remoteAddress || 'unknown-ip';

    const now = Date.now();
    let record = ipRequestMap.get(clientIp);

    if (!record || now > record.resetAt) {
      record = {
        count: 1,
        resetAt: now + windowMs
      };
      ipRequestMap.set(clientIp, record);
    } else {
      record.count++;
    }

    const remaining = Math.max(0, maxRequests - record.count);
    const resetSeconds = Math.ceil((record.resetAt - now) / 1000);

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetSeconds);

    if (record.count > maxRequests) {
      return res.status(429).json({
        success: false,
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many verification attempts. Please wait a moment before trying again.',
        retryAfterSeconds: resetSeconds
      });
    }

    next();
  };
}

/**
 * Resets the rate limiter store (useful for testing).
 */
export function resetRateLimiterStore() {
  ipRequestMap.clear();
}
