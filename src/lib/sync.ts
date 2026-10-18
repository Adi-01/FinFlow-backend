import type { Response } from "express";
import { redis } from "@/lib/redis.js";
import { logger } from "@/lib/logger.js";
import type { SyncEvent } from "@/types/sync.js";

export interface SSEClient {
  id: string;
  clientId: string;
  res: Response;
}

// In-memory registry: userId -> Set of active SSEClient connections
const activeConnections = new Map<string, Set<SSEClient>>();

// Dedicated Redis subscriber instance created lazily ONLY when clients exist
let subscriber: ReturnType<typeof redis.duplicate> | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;
let isSubscriberInitialized = false;

const getTotalActiveConnections = (): number => {
  let count = 0;
  for (const set of activeConnections.values()) {
    count += set.size;
  }
  return count;
};

/**
 * Start Redis subscriber and heartbeat ONLY when active clients connect.
 */
export const startSyncSubscriber = async (): Promise<void> => {
  if (isSubscriberInitialized || subscriber) return;

  try {
    subscriber = redis.duplicate({
      lazyConnect: true,
    });

    await subscriber.connect();
    await subscriber.psubscribe("user:sync:*");
    isSubscriberInitialized = true;
    logger.info("SSE Redis Pub/Sub subscriber connected and listening on user:sync:*");

    subscriber.on("pmessage", (_pattern: string, channel: string, message: string) => {
      try {
        const userId = channel.replace("user:sync:", "");
        const clients = activeConnections.get(userId);

        if (!clients || clients.size === 0) return;

        const event = JSON.parse(message) as SyncEvent;

        for (const client of clients) {
          // Exclude the client that originated the mutation
          if (event.originClientId && client.clientId === event.originClientId) {
            continue;
          }

          client.res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      } catch (err) {
        logger.error("Failed to dispatch SSE sync event from Redis message", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    subscriber.on("error", (err: Error) => {
      logger.error("SSE Redis subscriber error", { error: err.message });
    });

    // Send SSE comment ping every 25s only while active connections exist
    if (!heartbeatInterval) {
      heartbeatInterval = setInterval(() => {
        for (const [, clients] of activeConnections) {
          for (const client of clients) {
            try {
              client.res.write(": ping\n\n");
            } catch {
              // Socket will be cleaned up on 'close' event
            }
          }
        }
      }, 25000);
    }
  } catch (err) {
    logger.error("Failed to initialize SSE Redis Pub/Sub subscriber", {
      error: err instanceof Error ? err.message : String(err),
    });
    if (subscriber) {
      try {
        subscriber.disconnect();
      } catch {}
      subscriber = null;
    }
    isSubscriberInitialized = false;
  }
};

/**
 * Stop Redis subscriber and heartbeat when all clients disconnect.
 * Drops the TCP socket to Redis, enabling Railway scale-to-zero.
 */
export const stopSyncSubscriber = async (): Promise<void> => {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  if (subscriber) {
    const sub = subscriber;
    subscriber = null;
    isSubscriberInitialized = false;

    try {
      await sub.punsubscribe("user:sync:*");
      await sub.quit();
      logger.info(
        "Closed SSE Redis Pub/Sub subscriber (0 active connections - ready for scale-to-zero)",
      );
    } catch (err) {
      try {
        sub.disconnect();
      } catch {}
      logger.warn("Forced disconnect of SSE Redis subscriber", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
};

// Backwards-compatibility alias
export const initSyncSubscriber = startSyncSubscriber;

/**
 * Register a newly connected SSE client
 */
export const registerClient = (
  userId: string,
  clientId: string,
  res: Response,
): SSEClient => {
  const wasEmpty = getTotalActiveConnections() === 0;

  if (!activeConnections.has(userId)) {
    activeConnections.set(userId, new Set());
  }

  const client: SSEClient = {
    id: crypto.randomUUID(),
    clientId,
    res,
  };

  activeConnections.get(userId)!.add(client);

  logger.debug("Registered SSE client connection", {
    userId,
    clientId,
    activeCount: getTotalActiveConnections(),
  });

  if (wasEmpty) {
    startSyncSubscriber().catch((err) => {
      logger.error("Failed to start sync subscriber on first client connection", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return client;
};

/**
 * Unregister a disconnected SSE client
 */
export const removeClient = (userId: string, client: SSEClient): void => {
  const clients = activeConnections.get(userId);
  if (!clients) return;

  clients.delete(client);

  if (clients.size === 0) {
    activeConnections.delete(userId);
  }

  const remaining = getTotalActiveConnections();

  logger.debug("Removed SSE client connection", {
    userId,
    clientId: client.clientId,
    remainingCount: remaining,
  });

  if (remaining === 0) {
    stopSyncSubscriber().catch((err) => {
      logger.error(
        "Failed to stop sync subscriber when active connections reached 0",
        {
          error: err instanceof Error ? err.message : String(err),
        },
      );
    });
  }
};

/**
 * Publish a sync event to Redis for a specific user
 */
export const publishSyncEvent = async (
  userId: string,
  event: Omit<SyncEvent, "timestamp">,
): Promise<void> => {
  try {
    const fullEvent: SyncEvent = {
      ...event,
      timestamp: Date.now(),
    };

    const channel = `user:sync:${userId}`;
    await redis.publish(channel, JSON.stringify(fullEvent));

    logger.debug("Published SSE sync event to Redis", {
      channel,
      scope: fullEvent.scope,
      originClientId: fullEvent.originClientId,
    });
  } catch (err) {
    // Non-blocking resilience
    logger.error("Failed to publish SSE sync event to Redis", {
      error: err instanceof Error ? err.message : String(err),
      userId,
      scope: event.scope,
    });
  }
};

/**
 * Gracefully close subscriber and active connections during server shutdown
 */
export const closeSyncSubscriber = async (): Promise<void> => {
  for (const [, clients] of activeConnections) {
    for (const client of clients) {
      try {
        client.res.write("event: shutdown\ndata: {}\n\n");
        client.res.end();
      } catch {
        // Ignored
      }
    }
  }
  activeConnections.clear();
  await stopSyncSubscriber();
};
