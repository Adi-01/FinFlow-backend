import type { Request, Response, NextFunction } from "express";
import { verifySessionToken } from "@/lib/jwt.js";
import { prisma } from "@/lib/prisma.js";
import { UnauthorizedError } from "@/errors/UnauthorizedError.js";
import { isSessionRevoked, saveSession } from "@/lib/session.js";

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedError({
        code: "UNAUTHORIZED",
        message: "Authorization token is missing or malformed.",
      });
    }

    const token = authHeader.substring(7);
    const decoded = await verifySessionToken(token);

    if (await isSessionRevoked(decoded.id, decoded.sessionId)) {
      throw new UnauthorizedError({
        code: "UNAUTHORIZED",
        message: "Session has been revoked or expired.",
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        id: decoded.id,
      },
      select: {
        id: true,
        isDeleted: true,
      },
    });

    if (!user || user.isDeleted) {
      throw new UnauthorizedError({
        code: "UNAUTHORIZED",
        message: "User account is no longer active.",
      });
    }

    if (decoded.sessionId) {
      const userAgent =
        (req.headers["x-forwarded-user-agent"] as string) ||
        (req.headers["x-client-device"] as string) ||
        req.headers["user-agent"] ||
        "Unknown Device";
      const ip =
        (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        req.ip ||
        "Unknown IP";
      saveSession(decoded.id, decoded.sessionId, { userAgent, ip }).catch(
        () => {},
      );
    }

    req.user = decoded;
    next();
  } catch (error) {
    next(error);
  }
};
