import { v2 as cloudinary } from "cloudinary";
import { Readable } from "node:stream";
import { env } from "@/config/env.js";
import { logger } from "@/lib/logger.js";
import { ApiError } from "@/errors/ApiError.js";

// Initialize Cloudinary
cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

export interface UploadResult {
  secureUrl: string;
  publicId: string;
}

/**
 * Checks if Cloudinary credentials are configured
 */
export const isCloudinaryConfigured = (): boolean => {
  return Boolean(
    env.CLOUDINARY_CLOUD_NAME &&
      env.CLOUDINARY_API_KEY &&
      env.CLOUDINARY_API_SECRET,
  );
};

/**
 * Streams an image buffer directly to Cloudinary using in-memory upload stream
 * with a 20-second timeout guard.
 */
export const uploadImageStream = (
  buffer: Buffer,
  folder = "finflow/avatars",
): Promise<UploadResult> => {
  if (!isCloudinaryConfigured()) {
    throw new ApiError({
      statusCode: 500,
      code: "CLOUDINARY_NOT_CONFIGURED",
      message: "Cloud storage service is currently misconfigured.",
    });
  }

  return new Promise((resolve, reject) => {
    let hasFinished = false;

    const timeout = setTimeout(() => {
      if (!hasFinished) {
        hasFinished = true;
        reject(
          new ApiError({
            statusCode: 504,
            code: "UPLOAD_TIMEOUT",
            message: "Image upload timed out. Please try again.",
          }),
        );
      }
    }, 20000);

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        allowed_formats: ["jpg", "jpeg", "png", "webp"],
        transformation: [
          {
            width: 400,
            height: 400,
            crop: "fill",
            gravity: "face",
            quality: "auto",
          },
        ],
      },
      (error, result) => {
        if (hasFinished) return;
        hasFinished = true;
        clearTimeout(timeout);

        if (error || !result) {
          logger.error("Cloudinary upload failed", {
            error: error?.message || "Unknown error",
          });
          return reject(
            new ApiError({
              statusCode: 502,
              code: "CLOUDINARY_UPLOAD_FAILED",
              message: "Failed to upload image to cloud storage.",
            }),
          );
        }

        // Ensure URL includes fixed dimension transformation so viewing direct URL does not take full screen
        let transformedUrl = result.secure_url;
        if (!transformedUrl.includes("w_400,h_400")) {
          transformedUrl = transformedUrl.replace(
            "/image/upload/",
            "/image/upload/c_fill,w_400,h_400/",
          );
        }

        resolve({
          secureUrl: transformedUrl,
          publicId: result.public_id,
        });
      },
    );

    Readable.from(buffer).pipe(uploadStream);
  });
};

/**
 * Destroys an image in Cloudinary by its public ID.
 * Non-blocking / graceful: does not throw if asset is already deleted.
 */
export const deleteCloudinaryImage = async (
  publicId: string | null | undefined,
): Promise<void> => {
  if (!publicId || !isCloudinaryConfigured()) {
    return;
  }

  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: "image",
      invalidate: true,
    });
    logger.debug(`Cloudinary image destroyed: ${publicId}`, { result });
  } catch (error) {
    logger.warn(`Failed to destroy Cloudinary image: ${publicId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

