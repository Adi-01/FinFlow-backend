import { Router } from "express";
import { authenticate } from "@/middleware/auth.middleware.js";
import { validateRequest } from "@/middleware/validate.middleware.js";
import { idParamSchema } from "@/validators/common.validator.js";
import { createPaymentMethodSchema } from "@/validators/paymentMethod.validator.js";
import {
  getPaymentMethodsController,
  createPaymentMethodController,
  deletePaymentMethodController,
} from "@/controllers/paymentMethod.controller.js";

const router = Router();

router.use(authenticate);

router.get("/", getPaymentMethodsController);
router.post(
  "/",
  validateRequest({ body: createPaymentMethodSchema }),
  createPaymentMethodController
);
router.delete(
  "/:id",
  validateRequest({ params: idParamSchema }),
  deletePaymentMethodController
);

export default router;
