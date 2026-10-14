import type { Request, Response } from "express";
import {
  createIncomeService,
  getIncomesService,
  updateIncomeService,
  deleteIncomeService,
} from "@/services/income.service.js";
import { UnauthorizedError } from "@/errors/UnauthorizedError.js";
import type {
  CreateIncomeInput,
  GetIncomesQueryInput,
  UpdateIncomeInput,
} from "@/validators/income.validator.js";

export const createIncomeController = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User not authenticated.",
    });
  }

  const originClientId = (req.headers["x-client-id"] as string) || undefined;
  const income = await createIncomeService(
    req.user.id,
    req.body as CreateIncomeInput,
    originClientId,
  );
  return res.success("Income logged successfully.", income, 201);
};

export const getIncomesController = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User not authenticated.",
    });
  }

  const query = req.query as unknown as GetIncomesQueryInput;
  const result = await getIncomesService(req.user.id, query);
  return res.success("Incomes retrieved successfully.", result);
};

export const updateIncomeController = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User not authenticated.",
    });
  }

  const id = typeof req.params.id === "string" ? req.params.id : "";
  const originClientId = (req.headers["x-client-id"] as string) || undefined;
  const income = await updateIncomeService(
    req.user.id,
    id,
    req.body as UpdateIncomeInput,
    originClientId,
  );
  return res.success("Income updated successfully.", income);
};

export const deleteIncomeController = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User not authenticated.",
    });
  }

  const id = typeof req.params.id === "string" ? req.params.id : "";
  const originClientId = (req.headers["x-client-id"] as string) || undefined;
  await deleteIncomeService(req.user.id, id, originClientId);
  return res.success("Income deleted successfully.", null);
};
