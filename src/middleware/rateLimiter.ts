import type { Request, Response, NextFunction } from "express";
import { redis } from "@/lib/redis.js";
import { logger } from "@/lib/logger.js";
import { verifySessionToken } from "@/lib/jwt.js";
import { env } from "@/config/env.js";

interface RateLimitContext {
  remainingSeconds: number;
  humanDuration: string;
  resetDate: Date;
}

interface RateLimiterOptions {
  windowSeconds: number;
  maxRequests: number;
  prefix?: string;
  message?: string | ((context: RateLimitContext) => string);
}

const formatDuration = (seconds: number): string => {
  if (seconds <= 0) return "in a few moments";
  if (seconds < 60) {
    return `in ${seconds} second${seconds === 1 ? "" : "s"}`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) {
    return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `in ${minutes} minute${minutes === 1 ? "" : "s"} and ${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"}`;
};

export const createRateLimiter = (options: RateLimiterOptions) => {
  const {
    windowSeconds,
    maxRequests,
    prefix = "general",
    message = "Too many requests",
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      let identifier: string | undefined = req.user?.id;

      if (!identifier) {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
          const token = authHeader.substring(7);
          try {
            const decoded = await verifySessionToken(token);
            if (decoded?.id) {
              identifier = decoded.id;
            }
          } catch {
            // Ignore token verification errors here and fall back to IP
          }
        }
      }

      if (!identifier) {
        identifier =
          req.ip ||
          (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
          req.socket.remoteAddress ||
          "anonymous";
      }

      const key = `ratelimit:${prefix}:${identifier}`;
      const now = Date.now();
      const windowStart = now - windowSeconds * 1000;
      const member = `${now}:${Math.random().toString(36).substring(2, 9)}`;

      // Sliding window via Redis Sorted Set
      const multi = redis.multi();
      multi.zremrangebyscore(key, "-inf", windowStart);
      multi.zcard(key);
      multi.zadd(key, now, member);
      multi.expire(key, windowSeconds);

      const results = await multi.exec();
      const cardResult = results?.[1];
      const currentCountBeforeAdd = typeof cardResult?.[1] === "number" ? cardResult[1] : 0;
      const current = currentCountBeforeAdd + 1;

      // Calculate accurate reset / retry-after
      let remainingSeconds = windowSeconds;
      const oldestEntries = await redis.zrange(key, 0, "0");
      const oldestEntry = oldestEntries?.[0];
      if (oldestEntry) {
        const oldestTimestamp = Number(oldestEntry.split(":")[0]);
        if (!isNaN(oldestTimestamp)) {
          const diff = Math.ceil((oldestTimestamp + windowSeconds * 1000 - now) / 1000);
          remainingSeconds = Math.max(1, diff);
        }
      }

      const resetDate = new Date(now + remainingSeconds * 1000);
      const resetTimestamp = Math.floor(resetDate.getTime() / 1000);

      const remainingCount = Math.max(0, maxRequests - current);
      res.setHeader("X-RateLimit-Limit", maxRequests);
      res.setHeader("X-RateLimit-Remaining", remainingCount);
      res.setHeader("X-RateLimit-Reset", resetTimestamp);

      if (env.NODE_ENV === "development") {
        logger.debug(
          `[RateLimiter] [${prefix}] ${req.method} ${req.originalUrl} -> Quota: ${current}/${maxRequests} (Remaining: ${remainingCount}) [Reset in ${remainingSeconds}s]${current > maxRequests ? " (DEV: unblocked)" : ""}`,
        );
      }

      if (current > maxRequests) {
        // Remove the rejected entry so it does not count against subsequent window checks
        await redis.zrem(key, member);

        res.setHeader("Retry-After", remainingSeconds);

        const humanDuration = formatDuration(remainingSeconds);
        const dynamicMessage =
          typeof message === "function"
            ? message({ remainingSeconds, humanDuration, resetDate })
            : `${message.trim().replace(/[.,;!?]+$/, "")}. Please try again ${humanDuration}.`;

        logger.warn("Rate limit exceeded", {
          requestId: req.requestId,
          route: req.originalUrl,
          method: req.method,
          identifier,
          current,
          maxRequests,
          retryAfterSeconds: remainingSeconds,
        });

        return res.status(429).json({
          success: false,
          status: 429,
          error: {
            type: "rate_limit_error",
            code: "TOO_MANY_REQUESTS",
            message: dynamicMessage,
            retryAfter: resetDate.toISOString(),
            retryAfterSeconds: remainingSeconds,
          },
        });
      }

      next();
    } catch (error) {
      // Fail-open strategy with structured logging if Redis is unavailable
      logger.warn("Redis rate limiter failed-open due to error", {
        requestId: req.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      next();
    }
  };
};

/**
 * Strict rate limiter for authentication routes (login / register)
 * 10 requests per 15 minutes per IP
 */
export const authRateLimiter = createRateLimiter({
  prefix: "auth",
  windowSeconds: 15 * 60,
  maxRequests: 10,
  message: "Too many authentication attempts",
});

/**
 * General rate limiter across all public & private endpoints
 * 120 requests per minute
 */
export const generalRateLimiter = createRateLimiter({
  prefix: "general",
  windowSeconds: 60,
  maxRequests: 120,
  message: "API rate limit exceeded",
});

/**
 * Reflect report daily cap: 5 generations per 24 hours per user
 */
export const reflectGenerateDailyLimiter = createRateLimiter({
  prefix: "reflect:generate:daily",
  windowSeconds: 24 * 60 * 60,
  maxRequests: 5,
  message: "Daily report generation limit of 5 reached",
});

/**
 * Reflect report generation cooldown: 1 generation per 2 hours (7200 seconds)
 */
export const reflectGenerateCooldownLimiter = createRateLimiter({
  prefix: "reflect:generate:cooldown",
  windowSeconds: 2 * 60 * 60,
  maxRequests: 1,
  message: "Report generation is on cooldown",
});

/**
 * Reflect chat daily cap: 30 messages per 24 hours per user
 */
export const reflectChatDailyLimiter = createRateLimiter({
  prefix: "reflect:chat:daily",
  windowSeconds: 24 * 60 * 60,
  maxRequests: 30,
  message: "Daily chat limit of 30 messages reached",
});

/**
 * Reflect chat burst limiter: 10 messages per minute
 */
export const reflectChatBurstLimiter = createRateLimiter({
  prefix: "reflect:chat:burst",
  windowSeconds: 60,
  maxRequests: 10,
  message: "Too many chat requests",
});

/**
 * Account export limiter: 5 exports per 1 hour per user
 */
export const accountExportRateLimiter = createRateLimiter({
  prefix: "account:export",
  windowSeconds: 60 * 60,
  maxRequests: 5,
  message: "Export limit reached (maximum 5 exports per hour)",
});

/**
 * Change password limiter: 5 attempts per 15 minutes per user
 */
export const changePasswordRateLimiter = createRateLimiter({
  prefix: "account:change-password",
  windowSeconds: 15 * 60,
  maxRequests: 5,
  message: "Too many password change attempts",
});

/**
 * Delete account limiter: 3 attempts per 15 minutes per user
 */
export const deleteAccountRateLimiter = createRateLimiter({
  prefix: "account:delete",
  windowSeconds: 15 * 60,
  maxRequests: 3,
  message: "Too many account deletion attempts",
});

/**
 * Avatar upload limiter: 5 uploads per 2 hours (7200 seconds) per user
 */
export const avatarUploadRateLimiter = createRateLimiter({
  prefix: "profile:avatar:upload",
  windowSeconds: 2 * 60 * 60,
  maxRequests: 5,
  message: "Profile image update limit reached (maximum 5 updates per 2 hours)",
});

/**
 * Inspect active rate limit status for an identifier without consuming quota
 */
export const getRateLimitStatus = async (
  prefix: string,
  identifier: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<{ used: number; limit: number; remaining: number; resetSeconds: number; canProceed: boolean }> => {
  try {
    const key = `ratelimit:${prefix}:${identifier}`;
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;

    // Clean expired entries and query cardinality
    await redis.zremrangebyscore(key, "-inf", windowStart);
    const used = await redis.zcard(key);
    const remaining = Math.max(0, maxRequests - used);

    let resetSeconds = 0;
    if (used >= maxRequests) {
      const oldestEntries = await redis.zrange(key, 0, "0");
      const oldestEntry = oldestEntries?.[0];
      if (oldestEntry) {
        const oldestTimestamp = Number(oldestEntry.split(":")[0]);
        if (!isNaN(oldestTimestamp)) {
          const diff = Math.ceil((oldestTimestamp + windowSeconds * 1000 - now) / 1000);
          resetSeconds = Math.max(1, diff);
        }
      }
    }

    const canProceed = used < maxRequests;

    return {
      used,
      limit: maxRequests,
      remaining,
      resetSeconds,
      canProceed,
    };
  } catch {
    return {
      used: 0,
      limit: maxRequests,
      remaining: maxRequests,
      resetSeconds: 0,
      canProceed: true,
    };
  }
};

/**
 * Refund / roll back the latest rate limit entry for an identifier on operation failure
 */
export const refundRateLimit = async (
  prefix: string,
  identifier: string,
): Promise<void> => {
  try {
    const key = `ratelimit:${prefix}:${identifier}`;
    const latestEntries = await redis.zrange(key, -1, "-1");
    if (latestEntries && latestEntries.length > 0 && latestEntries[0]) {
      await redis.zrem(key, latestEntries[0]);
    }
  } catch (error) {
    logger.warn(`Failed to refund rate limit for ${prefix}:${identifier}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};