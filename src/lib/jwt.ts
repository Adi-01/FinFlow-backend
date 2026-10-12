import { SignJWT, jwtVerify } from "jose";
import { UnauthorizedError } from "@/errors/UnauthorizedError.js";
import { env } from "@/config/env.js";

const secretKey = new TextEncoder().encode(env.JWT_SECRET);

export interface JWTPayload {
  id: string; // User.id
  sessionId?: string | undefined;
}

export const signSessionToken = async (payload: JWTPayload): Promise<string> => {
  const sessionId = payload.sessionId || crypto.randomUUID();
  return await new SignJWT({ id: payload.id, type: "session", sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .setJti(sessionId)
    .sign(secretKey);
};

export const verifySessionToken = async (token: string): Promise<JWTPayload> => {
  try {
    const { payload } = await jwtVerify(token, secretKey);
    if (payload.type !== "session") {
      throw new UnauthorizedError({
        code: "INVALID_TOKEN_TYPE",
        message: "Provided token is not a valid session token.",
      });
    }

    return {
      id: payload.id as string,
      sessionId: (payload.sessionId || payload.jti) as string | undefined,
    };
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    throw new UnauthorizedError({
      code: "INVALID_SESSION_TOKEN",
      message: "Session token is invalid or has expired.",
    });
  }
};
