import type { Request, Response } from "express";
import { UnauthorizedError } from "@/errors/UnauthorizedError.js";
import { registerClient, removeClient } from "@/lib/sync.js";

export const sseSyncController = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "Authentication token missing or invalid.",
    });
  }

  // Support clientId passed via query param or header, with resilient fallback
  const rawClientId =
    (req.query.clientId as string)?.trim() ||
    (req.headers["x-client-id"] as string)?.trim();

  // Validate or self-heal clientId (UUID / alphanumeric string up to 64 chars)
  const isValidClientId =
    typeof rawClientId === "string" &&
    rawClientId.length >= 10 &&
    rawClientId.length <= 64 &&
    /^[a-zA-Z0-9_-]+$/.test(rawClientId);

  const clientId = isValidClientId ? rawClientId : crypto.randomUUID();

  // Disable Nagle's algorithm to eliminate TCP packet buffering delays for instant delivery
  req.socket?.setNoDelay(true);
  res.socket?.setNoDelay(true);

  // Set SSE streaming headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  res.flushHeaders();

  const client = registerClient(req.user.id, clientId, res);

  // Send initial handshake confirmation immediately
  res.write(
    `data: ${JSON.stringify({ type: "CONNECTED", clientId, timestamp: Date.now() })}\n\n`,
  );
  if (typeof (res as any).flush === "function") {
    (res as any).flush();
  }

  // Robustly handle connection termination across all socket and HTTP lifecycle events
  let isCleanedUp = false;
  const cleanup = () => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    removeClient(req.user!.id, client);
  };

  req.on("close", cleanup);
  res.on("close", cleanup);
  res.on("finish", cleanup);
  req.socket?.on("close", cleanup);
  res.socket?.on("close", cleanup);
};
