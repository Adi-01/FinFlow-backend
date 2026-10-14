import { env } from "@/config/env.js";
import app from "@/app.js";
import { prisma } from "@/lib/prisma.js";
import { redis } from "@/lib/redis.js";
import { logger } from "@/lib/logger.js";
import { initSyncSubscriber, closeSyncSubscriber } from "@/lib/sync.js";

const server = app.listen(env.PORT, "0.0.0.0", async () => {
  logger.info(`Server running on http://0.0.0.0:${env.PORT}`, {
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
  });

  await initSyncSubscriber();
});

let isShuttingDown = false;

const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}. Initiating graceful shutdown...`);

  // Force exit after 10s if graceful drainage hangs
  const forceExitTimer = setTimeout(() => {
    logger.error("Forced process termination after shutdown timeout");
    process.exit(1);
  }, 10000);
  forceExitTimer.unref();

  server.close(async (err) => {
    if (err) {
      logger.error("Error while closing HTTP server", { error: err.message });
      process.exit(1);
    }

    try {
      logger.info("Closing Prisma, Redis, and SSE Sync subscriber...");
      await Promise.all([
        prisma.$disconnect(),
        closeSyncSubscriber(),
        redis.quit(),
      ]);
      logger.info("Graceful shutdown completed successfully.");
      process.exit(0);
    } catch (cleanupError) {
      logger.error("Error during resource cleanup", {
        error:
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError),
      });
      process.exit(1);
    }
  });
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
