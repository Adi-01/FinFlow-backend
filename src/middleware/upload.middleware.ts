import multer from "multer";
import type { Request, Response, NextFunction } from "express";
import { BadRequestError } from "@/errors/BadRequestError.js";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype.toLowerCase())) {
      return cb(
        new BadRequestError({
          code: "INVALID_FILE_TYPE",
          message:
            "Invalid file format. Only JPEG, PNG, and WEBP images are allowed.",
        }),
      );
    }
    cb(null, true);
  },
});

const singleAvatarUpload = memoryUpload.single("avatar");

export const uploadAvatarMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  singleAvatarUpload(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return next(
            new BadRequestError({
              code: "FILE_TOO_LARGE",
              message: "File size exceeds the 5MB limit.",
            }),
          );
        }
        if (err.code === "LIMIT_UNEXPECTED_FILE") {
          return next(
            new BadRequestError({
              code: "INVALID_FIELD_NAME",
              message: "Unexpected field name. Expected 'avatar'.",
            }),
          );
        }
        return next(
          new BadRequestError({
            code: "UPLOAD_ERROR",
            message: err.message,
          }),
        );
      }
      return next(err);
    }

    if (!req.file) {
      return next(
        new BadRequestError({
          code: "NO_FILE_PROVIDED",
          message: "No image file provided.",
        }),
      );
    }

    if (!req.file.buffer || req.file.buffer.length === 0) {
      return next(
        new BadRequestError({
          code: "EMPTY_FILE",
          message: "Uploaded file is empty.",
        }),
      );
    }

    next();
  });
};

