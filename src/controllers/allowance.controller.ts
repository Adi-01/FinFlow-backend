import type { Request, Response } from "express";
import {
  getOrComputeAllowanceService,
  setOrUpdateAllowanceService,
  getAllowanceSummaryService,
} from "@/services/allowance.service.js";
import { UnauthorizedError } from "@/errors/UnauthorizedError.js";
import type { GetAllowanceQueryInput } from "@/validators/allowance.validator.js";

export const getAllowanceController = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User not authenticated.",
    });
  }

  const query = req.query as unknown as GetAllowanceQueryInput;
  const result = await getOrComputeAllowanceService(req.user.id, {
    year: query.year,
    month: query.month,
  });

  return res.success("Allowance status retrieved successfully.", result);
};

export const setAllowanceController = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User not authenticated.",
    });
  }

  const originClientId = (req.headers["x-client-id"] as string) || undefined;
  const allowance = await setOrUpdateAllowanceService(
    req.user.id,
    req.body,
    originClientId,
  );
  return res.success("Allowance updated successfully.", allowance);
};

export const getAllowanceSummaryController = async (
  req: Request,
  res: Response,
) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User not authenticated.",
    });
  }

  const query = req.query as unknown as GetAllowanceQueryInput;
  const result = await getAllowanceSummaryService(req.user.id, {
    year: query.year,
    month: query.month,
  });

  return res.success("Allowance summary retrieved successfully.", result);
};
