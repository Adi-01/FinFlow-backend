import { z } from "zod";
import {
  notFutureMonthRefine,
  notFutureMonthError,
} from "@/validators/common.validator.js";

export const getAllowanceQuerySchema = z
  .object({
    year: z.coerce.number().int().min(2000).max(2100),
    month: z.coerce.number().int().min(1).max(12),
  })
  .refine(notFutureMonthRefine, notFutureMonthError);

export const setAllowanceSchema = z
  .object({
    year: z.number().int().min(2000).max(2100),
    month: z.number().int().min(1).max(12),
    amount: z
      .number({ required_error: "Allowance amount is required." })
      .min(0, "Allowance amount cannot be negative.")
      .max(10_000_000, "Allowance amount cannot exceed 10,000,000.")
      .refine(
        (val) => /^\d+(\.\d{1,2})?$/.test(val.toString()),
        "Allowance amount cannot have more than 2 decimal places.",
      ),
  })
  .refine(notFutureMonthRefine, notFutureMonthError);

export type GetAllowanceQueryInput = z.infer<typeof getAllowanceQuerySchema>;
export type SetAllowanceInput = z.infer<typeof setAllowanceSchema>;
