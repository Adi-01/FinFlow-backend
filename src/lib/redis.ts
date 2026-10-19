import { Redis, type RedisOptions } from "ioredis";
import { env } from "@/config/env.js";
import { logger } from "@/lib/logger.js";

const redisOptions = {
  maxRetriesPerRequest: 5,
  retryStrategy(times: number) {
    const delay = Math.min(times * 200, 3000);
    return delay;
  },
  lazyConnect: false,
};

// 60-second inactivity timeout: drops the persistent TCP socket to Redis,
// enabling Railway scale-to-zero (serverless sleep) for both API and Redis containers.
const IDLE_TIMEOUT_MS = 60 * 1000;

let client: Redis | null = null;
let idleTimer: NodeJS.Timeout | null = null;
const registeredListeners: Array<{
  event: string | symbol;
  listener: (...args: any[]) => void;
}> = [];

const resetIdleTimer = (): void => {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  idleTimer = setTimeout(async () => {
    if (client) {
      const c = client;
      client = null;
      idleTimer = null;
      try {
        await c.quit();
      } catch {
        try {
          c.disconnect();
        } catch {}
      }
      logger.info(
        "[Redis] Inactive for 60s. Disconnected Redis TCP socket for serverless scale-to-zero.",
      );
    }
  }, IDLE_TIMEOUT_MS);
  idleTimer.unref();
};

export const getClient = (): Redis => {
  if (!client || client.status === "end" || client.status === "close") {
    client = new Redis(env.REDIS_URL, redisOptions);

    client.on("connect", () => {
      if (env.NODE_ENV !== "test") {
        logger.info("Connected to Redis successfully");
      }
    });

    client.on("error", (err: Error) => {
      if (env.NODE_ENV !== "test") {
        logger.error("Redis connection error", { error: err.message });
      }
    });

    for (const { event, listener } of registeredListeners) {
      client.on(event as any, listener);
    }
  }

  resetIdleTimer();
  return client;
};

export const redis: Redis = new Proxy({} as Redis, {
  get(target, prop, receiver) {
    if (prop === "then") {
      return undefined;
    }
    if (prop === "status") {
      return client ? client.status : "close";
    }
    if (prop === "options") {
      return redisOptions;
    }
    if (prop === "quit") {
      return async () => {
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
        if (!client || client.status === "end" || client.status === "close") {
          return "OK";
        }
        const c = client;
        client = null;
        return c.quit();
      };
    }
    if (prop === "disconnect") {
      return (reconnect?: boolean) => {
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
        if (!client || client.status === "end" || client.status === "close") {
          return;
        }
        const c = client;
        client = null;
        c.disconnect(reconnect);
      };
    }
    if (prop === "duplicate") {
      return (overrideOptions?: Partial<RedisOptions>) => {
        return new Redis(env.REDIS_URL, {
          ...redisOptions,
          ...overrideOptions,
        } as any);
      };
    }
    if (prop === "on" || prop === "addListener") {
      return (event: string | symbol, listener: (...args: any[]) => void) => {
        registeredListeners.push({ event, listener });
        if (client) {
          client.on(event as any, listener);
        }
        return receiver;
      };
    }
    if (prop === "off" || prop === "removeListener") {
      return (event: string | symbol, listener: (...args: any[]) => void) => {
        const idx = registeredListeners.findIndex(
          (l) => l.event === event && l.listener === listener,
        );
        if (idx !== -1) {
          registeredListeners.splice(idx, 1);
        }
        if (client) {
          client.off(event as any, listener);
        }
        return receiver;
      };
    }

    if (prop in Redis.prototype && typeof (Redis.prototype as any)[prop] === "function") {
      return (...args: any[]) => {
        const currentClient = getClient();
        return (currentClient as any)[prop](...args);
      };
    }

    const currentClient = getClient();
    const val = (currentClient as any)[prop];
    if (typeof val === "function") {
      return (...args: any[]) => {
        const c = getClient();
        return (c as any)[prop](...args);
      };
    }
    return val;
  },
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
