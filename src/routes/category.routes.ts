import { Router } from "express";
import { authenticate } from "@/middleware/auth.middleware.js";
import { validateRequest } from "@/middleware/validate.middleware.js";
import { idParamSchema } from "@/validators/common.validator.js";
import { createCategorySchema } from "@/validators/category.validator.js";
import {
  getCategoriesController,
  createCategoryController,
  deleteCategoryController,
} from "@/controllers/category.controller.js";

const router = Router();

router.use(authenticate);

router.get("/", getCategoriesController);
router.post(
  "/",
  validateRequest({ body: createCategorySchema }),
  createCategoryController
);
router.delete(
  "/:id",
  validateRequest({ params: idParamSchema }),
  deleteCategoryController
);

export default router;
