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

// Fast in-memory deduplication set to avoid double-dispatching to local clients
const recentlyDispatched = new Set<string>();

const getTotalActiveConnections = (): number => {
  let count = 0;
  for (const set of activeConnections.values()) {
    count += set.size;
  }
  return count;
};

/**
 * Dispatch an event immediately to local in-memory clients with 0ms buffering.
 */
const dispatchToLocalClients = (userId: string, event: SyncEvent): void => {
  const clients = activeConnections.get(userId);
  if (!clients || clients.size === 0) return;

  const payload = `data: ${JSON.stringify(event)}\n\n`;

  for (const client of clients) {
    // Exclude the client that originated the mutation
    if (event.originClientId && client.clientId === event.originClientId) {
      continue;
    }

    try {
      client.res.write(payload);
      // Flush socket buffers immediately so client receives data in real-time
      if (typeof (client.res as any).flush === "function") {
        (client.res as any).flush();
      }
    } catch (err) {
      logger.error("[SSE Sync] Error writing event to client socket", { error: err });
    }
  }
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
    logger.info("[SSE Sync] Redis Pub/Sub subscriber connected and listening on user:sync:*");

    subscriber.on("pmessage", (_pattern: string, channel: string, message: string) => {
      try {
        const userId = channel.replace("user:sync:", "");
        const clients = activeConnections.get(userId);

        if (!clients || clients.size === 0) return;

        const event = JSON.parse(message) as SyncEvent;

        // Skip if this instance already dispatched this event to local clients
        if (event.id && recentlyDispatched.has(event.id)) {
          return;
        }

        dispatchToLocalClients(userId, event);
      } catch (err) {
        logger.error("[SSE Sync] Failed to dispatch SSE event from Redis message", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    subscriber.on("error", (err: Error) => {
      logger.error("[SSE Sync] Redis subscriber error", { error: err.message });
    });

    // Send SSE comment ping every 25s only while active connections exist
    if (!heartbeatInterval) {
      heartbeatInterval = setInterval(() => {
        for (const [, clients] of activeConnections) {
          for (const client of clients) {
            try {
              client.res.write(": ping\n\n");
              if (typeof (client.res as any).flush === "function") {
                (client.res as any).flush();
              }
            } catch {
              // Socket will be cleaned up on 'close' event
            }
          }
        }
      }, 25000);
    }
  } catch (err) {
    logger.error("[SSE Sync] Failed to initialize Redis Pub/Sub subscriber", {
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
        "[SSE Sync] Count is zero, closing the pub/sub stream. Dropped Redis subscriber TCP socket.",
      );
    } catch (err) {
      try {
        sub.disconnect();
      } catch {}
      logger.warn("[SSE Sync] Forced disconnect of Redis subscriber", {
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
  const total = getTotalActiveConnections();

  logger.info(`[SSE Sync] Client connected. Total active connections: ${total}`, {
    userId,
    clientId,
    totalActiveConnections: total,
  });

  if (wasEmpty) {
    startSyncSubscriber().catch((err) => {
      logger.error("[SSE Sync] Failed to start sync subscriber on first client connection", {
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

  logger.info(`[SSE Sync] Client disconnected. Total active connections: ${remaining}`, {
    userId,
    clientId: client.clientId,
    totalActiveConnections: remaining,
  });

  if (remaining === 0) {
    logger.info("[SSE Sync] Total active connections is zero. Count is zero, closing the pub/sub stream.");
    stopSyncSubscriber().catch((err) => {
      logger.error(
        "[SSE Sync] Failed to stop sync subscriber when active connections reached 0",
        {
          error: err instanceof Error ? err.message : String(err),
        },
      );
    });
  }
};

/**
 * Publish a sync event: dispatches immediately to local clients (0ms latency)
 * and relays to Redis for multi-instance scaling.
 */
export const publishSyncEvent = async (
  userId: string,
  event: Omit<SyncEvent, "timestamp">,
): Promise<void> => {
  try {
    const eventId = (event as any).id || crypto.randomUUID();
    const fullEvent: SyncEvent = {
      ...event,
      id: eventId,
      timestamp: Date.now(),
    };

    // 1. Instant local in-memory dispatch to locally connected clients (0ms latency, zero buffering)
    dispatchToLocalClients(userId, fullEvent);

    // Track eventId so this instance skips duplicate dispatch when Redis echoes it
    recentlyDispatched.add(eventId);
    setTimeout(() => {
      recentlyDispatched.delete(eventId);
    }, 4000);

    // 2. Publish to Redis for cross-instance sync
    const channel = `user:sync:${userId}`;
    await redis.publish(channel, JSON.stringify(fullEvent));

    logger.debug("[SSE Sync] Dispatched and published sync event", {
      channel,
      scope: fullEvent.scope,
      originClientId: fullEvent.originClientId,
      totalLocalClients: activeConnections.get(userId)?.size ?? 0,
    });
  } catch (err) {
    // Non-blocking resilience
    logger.error("[SSE Sync] Failed to publish SSE sync event to Redis", {
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
