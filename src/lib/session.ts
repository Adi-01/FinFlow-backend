import { redis } from "@/lib/redis.js";

export interface SessionData {
  sessionId: string;
  userId: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastActive: string;
}

export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export const saveSession = async (
  userId: string,
  sessionId: string,
  details: { userAgent?: string; ip?: string },
): Promise<void> => {
  const now = new Date().toISOString();
  const sessionKey = `user:sessions:${userId}:${sessionId}`;

  let createdAt = now;
  try {
    const existingRaw = await redis.get(sessionKey);
    if (existingRaw) {
      const parsed = JSON.parse(existingRaw);
      if (parsed.createdAt) createdAt = parsed.createdAt;
    }
  } catch {
    // Non-blocking
  }

  const data: SessionData = {
    sessionId,
    userId,
    userAgent: details.userAgent || "Unknown Device",
    ip: details.ip || "Unknown IP",
    createdAt,
    lastActive: now,
  };

  try {
    await redis.set(sessionKey, JSON.stringify(data), "EX", SESSION_TTL_SECONDS);
  } catch {
    // Non-blocking fail-open
  }
};

export const getSession = async (
  userId: string,
  sessionId: string,
): Promise<SessionData | null> => {
  try {
    const raw = await redis.get(`user:sessions:${userId}:${sessionId}`);
    if (!raw) return null;
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
};

export const isSessionRevoked = async (
  userId: string,
  sessionId?: string,
): Promise<boolean> => {
  try {
    const userRevoked = await redis.get(`revoked:user:${userId}`);
    if (userRevoked) return true;

    if (sessionId) {
      const sessionRevoked = await redis.get(`revoked:session:${sessionId}`);
      if (sessionRevoked) return true;
    }
    return false;
  } catch {
    return false;
  }
};

export const getUserSessions = async (
  userId: string,
): Promise<SessionData[]> => {
  try {
    const pattern = `user:sessions:${userId}:*`;
    let cursor = "0";
    const keys: string[] = [];
    do {
      const [nextCursor, matchedKeys] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100,
      );
      cursor = nextCursor;
      keys.push(...matchedKeys);
    } while (cursor !== "0");

    if (keys.length === 0) return [];

    const rawSessions = await redis.mget(...keys);
    const sessions: SessionData[] = [];
    for (const raw of rawSessions) {
      if (raw) {
        try {
          sessions.push(JSON.parse(raw));
        } catch {
          // ignore corrupted session record
        }
      }
    }
    return sessions.sort(
      (a, b) =>
        new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime(),
    );
  } catch {
    return [];
  }
};

export const revokeSession = async (
  userId: string,
  sessionId: string,
): Promise<void> => {
  try {
    await redis.del(`user:sessions:${userId}:${sessionId}`);
    await redis.set(
      `revoked:session:${sessionId}`,
      "true",
      "EX",
      SESSION_TTL_SECONDS,
    );
  } catch {
    // Non-blocking
  }
};

export const revokeAllSessions = async (
  userId: string,
  exceptSessionId?: string,
): Promise<void> => {
  try {
    const sessions = await getUserSessions(userId);
    for (const s of sessions) {
      if (exceptSessionId && s.sessionId === exceptSessionId) {
        continue;
      }
      await revokeSession(userId, s.sessionId);
    }
    if (!exceptSessionId) {
      await redis.set(
        `revoked:user:${userId}`,
        "true",
        "EX",
        SESSION_TTL_SECONDS,
      );
    }
  } catch {
    // Non-blocking
  }
};

