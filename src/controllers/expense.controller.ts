import type { Request, Response } from "express";
import {
  createExpenseService,
  getExpensesService,
  updateExpenseService,
  deleteExpenseService,
} from "@/services/expense.service.js";
import { UnauthorizedError } from "@/errors/UnauthorizedError.js";
import type {
  CreateExpenseInput,
  GetExpensesQueryInput,
  UpdateExpenseInput,
} from "@/validators/expense.validator.js";

export const createExpenseController = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User not authenticated.",
    });
  }

  const expense = await createExpenseService(
    req.user.id,
    req.body as CreateExpenseInput,
  );
  return res.success("Expense logged successfully.", expense, 201);
};

export const getExpensesController = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User not authenticated.",
    });
  }

  const query = req.query as unknown as GetExpensesQueryInput;
  const result = await getExpensesService(req.user.id, query);
  return res.success("Expenses retrieved successfully.", result);
};

export const updateExpenseController = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User not authenticated.",
    });
  }

  const id = typeof req.params.id === "string" ? req.params.id : "";
  const expense = await updateExpenseService(
    req.user.id,
    id,
    req.body as UpdateExpenseInput,
  );
  return res.success("Expense updated successfully.", expense);
};

export const deleteExpenseController = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User not authenticated.",
    });
  }

  const id = typeof req.params.id === "string" ? req.params.id : "";
  await deleteExpenseService(req.user.id, id);
  return res.success("Expense deleted successfully.", null);
};
