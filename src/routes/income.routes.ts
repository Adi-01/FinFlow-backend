import { Router } from "express";
import { authenticate } from "@/middleware/auth.middleware.js";
import { validateRequest } from "@/middleware/validate.middleware.js";
import { idParamSchema } from "@/validators/common.validator.js";
import {
  createIncomeSchema,
  updateIncomeSchema,
  getIncomesQuerySchema,
} from "@/validators/income.validator.js";
import {
  createIncomeController,
  getIncomesController,
  updateIncomeController,
  deleteIncomeController,
} from "@/controllers/income.controller.js";

const router = Router();

router.use(authenticate);

router.post(
  "/",
  validateRequest({ body: createIncomeSchema }),
  createIncomeController,
);
router.get(
  "/",
  validateRequest({ query: getIncomesQuerySchema }),
  getIncomesController,
);
router.patch(
  "/:id",
  validateRequest({ params: idParamSchema, body: updateIncomeSchema }),
  updateIncomeController,
);
router.delete(
  "/:id",
  validateRequest({ params: idParamSchema }),
  deleteIncomeController,
);

export default router;
