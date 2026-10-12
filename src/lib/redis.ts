import { Redis } from "ioredis";
import { env } from "@/config/env.js";
import { logger } from "@/lib/logger.js";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 100, 3000);
    return delay;
  },
  lazyConnect: false,
});

redis.on("connect", () => {
  if (env.NODE_ENV !== "test") {
    logger.info("Connected to Redis successfully");
  }
});

redis.on("error", (err: Error) => {
  if (env.NODE_ENV !== "test") {
    logger.error("Redis connection error", { error: err.message });
  }
});

/**
 * Helper to retrieve and parse JSON from Redis
 */
export const getCache = async <T>(key: string): Promise<T | null> => {
  try {
    const cached = await redis.get(key);
    if (!cached) {
      if (env.NODE_ENV === "development") {
        logger.debug(`[CACHE MISS] ${key}`);
      }
      return null;
    }
    if (env.NODE_ENV === "development") {
      logger.debug(`[CACHE HIT] ${key}`);
    }
    return JSON.parse(cached) as T;
  } catch {
    return null;
  }
};

/**
 * Helper to store stringified JSON into Redis with randomized TTL Jitter
 * to mitigate Cache Avalanche / synchronized mass expiration.
 *
 * @param key Redis cache key
 * @param value Data to serialize
 * @param baseTtlSeconds Base expiration time in seconds (default 300s / 5m)
 * @param jitterRatio Percentage variation (default 0.15 for +/- 15%)
 */
export const setCache = async (
  key: string,
  value: unknown,
  baseTtlSeconds = 300,
  jitterRatio = 0.15,
): Promise<void> => {
  try {
    const jitterRange = baseTtlSeconds * jitterRatio;
    const jitter = Math.floor((Math.random() * 2 - 1) * jitterRange);
    const effectiveTtl = Math.max(1, baseTtlSeconds + jitter);

    await redis.set(key, JSON.stringify(value), "EX", effectiveTtl);
    if (env.NODE_ENV === "development") {
      logger.debug(
        `[CACHE SET] ${key} (TTL: ${effectiveTtl}s [base: ${baseTtlSeconds}s])`,
      );
    }
  } catch {
    // Non-blocking cache failure
  }
};

/**
 * Helper to delete a specific cache key
 */
export const deleteCache = async (key: string): Promise<void> => {
  try {
    await redis.del(key);
    if (env.NODE_ENV === "development") {
      logger.debug(`[CACHE DEL] ${key}`);
    }
  } catch {
    // Non-blocking cache failure
  }
};

/**
 * Helper to delete cache keys matching a pattern (e.g. "cache:dashboard:userId:*")
 */
export const deleteCacheByPattern = async (pattern: string): Promise<void> => {
  try {
    let cursor = "0";
    let deletedCount = 0;
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100,
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
        deletedCount += keys.length;
      }
    } while (cursor !== "0");

    if (env.NODE_ENV === "development") {
      logger.debug(`[CACHE PURGE] ${pattern} (${deletedCount} key(s) invalidated)`);
    }
  } catch {
    // Non-blocking cache failure
  }
};
