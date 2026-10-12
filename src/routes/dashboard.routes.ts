import { Router } from "express";
import { authenticate } from "@/middleware/auth.middleware.js";
import { validateRequest } from "@/middleware/validate.middleware.js";
import { getDashboardQuerySchema } from "@/validators/dashboard.validator.js";
import { getDashboardController } from "@/controllers/dashboard.controller.js";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  validateRequest({ query: getDashboardQuerySchema }),
  getDashboardController,
);

export default router;
