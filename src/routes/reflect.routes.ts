import { Router } from "express";
import { authenticate } from "@/middleware/auth.middleware.js";
import { validateRequest } from "@/middleware/validate.middleware.js";
import {
  reflectGenerateDailyLimiter,
  reflectGenerateCooldownLimiter,
  reflectChatDailyLimiter,
  reflectChatBurstLimiter,
} from "@/middleware/rateLimiter.js";
import {
  generateReflectSchema,
  getReflectQuerySchema,
  chatReflectSchema,
} from "@/validators/reflect.validator.js";
import {
  getReflectReportController,
  generateReflectReportController,
  chatReflectController,
} from "@/controllers/reflect.controller.js";

const router = Router();

router.use(authenticate);

// Get existing report for a specific month
router.get(
  "/",
  validateRequest({ query: getReflectQuerySchema }),
  getReflectReportController,
);

// Generate or regenerate reflection report
router.post(
  "/generate",
  reflectGenerateDailyLimiter,
  reflectGenerateCooldownLimiter,
  validateRequest({ body: generateReflectSchema }),
  generateReflectReportController,
);

// Interactive conversational follow-up chat
router.post(
  "/chat",
  reflectChatDailyLimiter,
  reflectChatBurstLimiter,
  validateRequest({ body: chatReflectSchema }),
  chatReflectController,
);

export default router;
