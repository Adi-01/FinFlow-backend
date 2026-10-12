import type { Request, Response } from "express";
import {
  getTransactionsService,
  exportTransactionsCSVService,
} from "@/services/transaction.service.js";
import { UnauthorizedError } from "@/errors/UnauthorizedError.js";
import type { GetTransactionsQueryInput } from "@/validators/transaction.validator.js";

export const getTransactionsController = async (
  req: Request,
  res: Response,
) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User not authenticated.",
    });
  }

  const query = req.query as unknown as GetTransactionsQueryInput;
  const result = await getTransactionsService(req.user.id, query);
  return res.success("Transactions retrieved successfully.", result);
};

export const exportTransactionsCSVController = async (
  req: Request,
  res: Response,
) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User not authenticated.",
    });
  }

  const query = req.query as unknown as GetTransactionsQueryInput;
  const csv = await exportTransactionsCSVService(req.user.id, query);

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="transactions_${Date.now()}.csv"`,
  );
  return res.status(200).send(csv);
};
