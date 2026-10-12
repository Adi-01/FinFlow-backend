import type { Request, Response, NextFunction } from "express";
import { getCurrentUser } from "@/services/user.service.js";
import { UnauthorizedError } from "@/errors/UnauthorizedError.js";

export const getMeController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) {
      throw new UnauthorizedError({
        code: "UNAUTHORIZED",
        message: "User context not found.",
      });
    }
    const user = await getCurrentUser(req.user.id);
    return res.success("User profile fetched successfully.", user, 200);
  } catch (error) {
    next(error);
  }
};
