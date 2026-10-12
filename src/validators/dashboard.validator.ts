import { z } from "zod";
import {
  notFutureMonthRefine,
  notFutureMonthError,
} from "@/validators/common.validator.js";

export const getDashboardQuerySchema = z
  .object({
    year: z.coerce.number().int().min(2000).max(2100),
    month: z.coerce.number().int().min(1).max(12),
  })
  .refine(notFutureMonthRefine, notFutureMonthError);

export type GetDashboardQueryInput = z.infer<typeof getDashboardQuerySchema>;
