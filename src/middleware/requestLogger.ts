import type { Request, Response, NextFunction } from "express";
import { logger } from "@/lib/logger.js";

const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const logPayload = {
      requestId: req.requestId,
      method: req.method,
      route: req.originalUrl,
      status: res.statusCode,
      durationMs,
    };

    if (res.statusCode >= 500) {
      logger.error("HTTP Request Failed", logPayload);
    } else if (res.statusCode >= 400) {
      logger.warn("HTTP Client Error", logPayload);
    } else {
      logger.info("HTTP Request Completed", logPayload);
    }
  });

  next();
};

export default requestLogger;
