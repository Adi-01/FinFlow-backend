import { Router } from "express";
import { authenticate } from "@/middleware/auth.middleware.js";
import { validateRequest } from "@/middleware/validate.middleware.js";
import {
  getAllowanceQuerySchema,
  setAllowanceSchema,
} from "@/validators/allowance.validator.js";
import {
  getAllowanceController,
  setAllowanceController,
  getAllowanceSummaryController,
} from "@/controllers/allowance.controller.js";

const router = Router();

router.use(authenticate);

router.get(
  "/summary",
  validateRequest({ query: getAllowanceQuerySchema }),
  getAllowanceSummaryController,
);
router.get(
  "/",
  validateRequest({ query: getAllowanceQuerySchema }),
  getAllowanceController,
);
router.post(
  "/",
  validateRequest({ body: setAllowanceSchema }),
  setAllowanceController,
);

export default router;
