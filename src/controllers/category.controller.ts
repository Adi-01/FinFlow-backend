import type { Request, Response } from "express";
import { UnauthorizedError } from "@/errors/UnauthorizedError.js";
import {
  getCategoriesService,
  createCategoryService,
  deleteCategoryService,
} from "@/services/category.service.js";
import type { CategoryType, CreateCategoryInput } from "@/validators/category.validator.js";

export const getCategoriesController = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User not authenticated.",
    });
  }

  const typeParam = req.query.type as CategoryType | undefined;
  const data = await getCategoriesService(req.user.id, typeParam);
  return res.success("Categories fetched successfully.", data, 200);
};

export const createCategoryController = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User not authenticated.",
    });
  }

  const category = await createCategoryService(
    req.user.id,
    req.body as CreateCategoryInput
  );
  return res.success("Category created successfully.", category, 201);
};

export const deleteCategoryController = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User not authenticated.",
    });
  }

  const { id } = req.params;
  await deleteCategoryService(req.user.id, id as string);
  return res.success("Category deleted successfully.", null, 200);
};
