import type { Request, Response, NextFunction } from "express";
import { registerUser, loginUser } from "@/services/auth.service.js";

export const registerController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userAgent =
      (req.headers["x-forwarded-user-agent"] as string) ||
      (req.headers["x-client-device"] as string) ||
      req.headers["user-agent"] ||
      "Unknown Device";
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.ip ||
      "Unknown IP";

    const result = await registerUser(req.body, { userAgent, ip });
    return res.success("User registered successfully.", result, 201);
  } catch (error) {
    next(error);
  }
};

export const loginController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userAgent =
      (req.headers["x-forwarded-user-agent"] as string) ||
      (req.headers["x-client-device"] as string) ||
      req.headers["user-agent"] ||
      "Unknown Device";
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.ip ||
      "Unknown IP";

    const result = await loginUser(req.body, { userAgent, ip });
    return res.success("Login successful.", result, 200);
  } catch (error) {
    next(error);
  }
};

