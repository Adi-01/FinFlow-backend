import { Router } from "express";
import { authenticate } from "@/middleware/auth.middleware.js";
import { validateRequest } from "@/middleware/validate.middleware.js";
import { idParamSchema } from "@/validators/common.validator.js";
import {
  createExpenseSchema,
  updateExpenseSchema,
  getExpensesQuerySchema,
} from "@/validators/expense.validator.js";
import {
  createExpenseController,
  getExpensesController,
  updateExpenseController,
  deleteExpenseController,
} from "@/controllers/expense.controller.js";

const router = Router();

router.use(authenticate);

router.post(
  "/",
  validateRequest({ body: createExpenseSchema }),
  createExpenseController,
);
router.get(
  "/",
  validateRequest({ query: getExpensesQuerySchema }),
  getExpensesController,
);
router.patch(
  "/:id",
  validateRequest({ params: idParamSchema, body: updateExpenseSchema }),
  updateExpenseController,
);
router.delete(
  "/:id",
  validateRequest({ params: idParamSchema }),
  deleteExpenseController,
);

export default router;
