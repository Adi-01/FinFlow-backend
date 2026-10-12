import type { Request, Response } from "express";
import {
  getProfileService,
  updateProfileService,
  uploadAvatarService,
  removeAvatarService,
} from "@/services/profile.service.js";
import { UnauthorizedError } from "@/errors/UnauthorizedError.js";
import { BadRequestError } from "@/errors/BadRequestError.js";
import { refundRateLimit } from "@/middleware/rateLimiter.js";
import type { UpdateProfileInput } from "@/validators/profile.validator.js";

export const getProfileController = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User context not found.",
    });
  }

  const profile = await getProfileService(req.user.id);
  return res.success("Profile fetched successfully.", profile, 200);
};

export const updateProfileController = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User context not found.",
    });
  }

  const profile = await updateProfileService(
    req.user.id,
    req.body as UpdateProfileInput,
  );
  return res.success("Profile updated successfully.", profile, 200);
};

export const uploadAvatarController = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User context not found.",
    });
  }

  if (!req.file || !req.file.buffer) {
    throw new BadRequestError({
      code: "NO_FILE_PROVIDED",
      message: "No image file provided.",
    });
  }

  try {
    const profile = await uploadAvatarService(req.user.id, req.file.buffer);
    return res.success("Profile image updated successfully.", profile, 200);
  } catch (error) {
    await refundRateLimit("profile:avatar:upload", req.user.id);
    throw error;
  }
};

export const removeAvatarController = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User context not found.",
    });
  }

  const profile = await removeAvatarService(req.user.id);
  return res.success("Profile image removed successfully.", profile, 200);
};

