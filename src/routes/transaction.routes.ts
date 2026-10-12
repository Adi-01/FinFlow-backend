import { Router } from "express";
import { authenticate } from "@/middleware/auth.middleware.js";
import { validateRequest } from "@/middleware/validate.middleware.js";
import { getTransactionsQuerySchema } from "@/validators/transaction.validator.js";
import {
  getTransactionsController,
  exportTransactionsCSVController,
} from "@/controllers/transaction.controller.js";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  validateRequest({ query: getTransactionsQuerySchema }),
  getTransactionsController,
);
router.get(
  "/export",
  validateRequest({ query: getTransactionsQuerySchema }),
  exportTransactionsCSVController,
);

export default router;
