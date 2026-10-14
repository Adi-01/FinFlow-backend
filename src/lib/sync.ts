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

// Dedicated Redis subscriber instance for pub/sub mode
const subscriber = redis.duplicate();
let heartbeatInterval: NodeJS.Timeout | null = null;
let isSubscriberInitialized = false;

/**
 * Initialize Redis Pub/Sub subscription and periodic heartbeat ping
 */
export const initSyncSubscriber = async (): Promise<void> => {
  if (isSubscriberInitialized) return;

  try {
    await subscriber.psubscribe("user:sync:*");
    isSubscriberInitialized = true;
    logger.info("SSE Redis Pub/Sub subscriber listening on user:sync:*");

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

    // Send SSE comment ping every 25s to keep connections alive and prevent proxy timeouts
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
  } catch (err) {
    logger.error("Failed to initialize SSE Redis Pub/Sub subscriber", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

/**
 * Register a newly connected SSE client
 */
export const registerClient = (
  userId: string,
  clientId: string,
  res: Response,
): SSEClient => {
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
    activeCount: activeConnections.get(userId)?.size ?? 0,
  });

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

  logger.debug("Removed SSE client connection", {
    userId,
    clientId: client.clientId,
    remainingCount: activeConnections.get(userId)?.size ?? 0,
  });
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
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  // Gracefully close any active HTTP responses
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

  if (isSubscriberInitialized) {
    try {
      await subscriber.punsubscribe("user:sync:*");
      await subscriber.quit();
      isSubscriberInitialized = false;
      logger.info("Closed SSE Redis Pub/Sub subscriber cleanly");
    } catch (err) {
      logger.error("Error closing SSE Redis subscriber", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
};

