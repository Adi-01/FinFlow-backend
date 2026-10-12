import type { Response, Request } from "express";

export interface AuthUser {
  id: string; // User.id
  sessionId?: string | undefined;
}

declare global {
  namespace Express {
    interface Response {
      success(message?: string, data?: unknown, status?: number): Response;
    }
    interface Request {
      user?: AuthUser;
      requestId?: string;
    }
  }
}

export {};
