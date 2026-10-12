import type { Request, Response } from "express";
import { getDashboardMetricsService } from "@/services/dashboard.service.js";
import { UnauthorizedError } from "@/errors/UnauthorizedError.js";
import type { GetDashboardQueryInput } from "@/validators/dashboard.validator.js";

export const getDashboardController = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError({
      code: "UNAUTHORIZED",
      message: "User not authenticated.",
    });
  }

  const query = req.query as unknown as GetDashboardQueryInput;
  const result = await getDashboardMetricsService(req.user.id, {
    year: query.year,
    month: query.month,
  });

  return res.success("Dashboard metrics retrieved successfully.", result);
};
