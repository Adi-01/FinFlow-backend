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

  const originClientId = (req.headers["x-client-id"] as string) || undefined;
  const category = await createCategoryService(
    req.user.id,
    req.body as CreateCategoryInput,
    originClientId,
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
  const originClientId = (req.headers["x-client-id"] as string) || undefined;
  await deleteCategoryService(req.user.id, id as string, originClientId);
  return res.success("Category deleted successfully.", null, 200);
};
