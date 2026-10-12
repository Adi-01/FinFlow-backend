import { ApiError } from "@/errors/ApiError.js";
import { logger } from "@/lib/logger.js";
import type { Request, Response, NextFunction } from "express";

export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  if (err instanceof ApiError) {
    const errorPayload: Record<string, unknown> = {
      type: err.type,
      code: err.code,
      message: err.message,
    };

    if (
      "details" in err &&
      (err as { details?: unknown }).details !== undefined
    ) {
      errorPayload.details = (err as { details?: unknown }).details;
    }

    return res.status(err.statusCode).json({
      success: false,
      status: err.statusCode,
      error: errorPayload,
    });
  }

  logger.error("Unhandled Exception in Central Error Handler", {
    requestId: req.requestId,
    route: req.originalUrl,
    method: req.method,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });

  return res.status(500).json({
    success: false,
    status: 500,
    error: {
      type: "api_error",
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
    },
  });
};
