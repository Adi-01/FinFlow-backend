import { z } from "zod";
import {
  monthQuerySchema,
  dateQuerySchema,
  amountQuerySchema,
  transactionAmountSchema,
  transactionDateSchema,
  transactionNotesSchema,
} from "@/validators/common.validator.js";

export const createIncomeSchema = z.object({
  amount: transactionAmountSchema,
  source: z.string().min(1, "Income source is required.").max(50, "Source name too long."),
  date: transactionDateSchema,
  paymentMethod: z.string().min(1, "Payment method is required.").max(50, "Payment method too long."),
  notes: transactionNotesSchema,
});

export const updateIncomeSchema = createIncomeSchema.partial();

export const getIncomesQuerySchema = z.object({
  month: monthQuerySchema,
  minAmount: amountQuerySchema,
  maxAmount: amountQuerySchema,
  startDate: dateQuerySchema,
  endDate: dateQuerySchema,
  source: z.string().optional(),
  paymentMethod: z.string().optional(),
  search: z.string().optional(),
  sortBy: z.enum(["date", "amount"]).optional().default("date"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type CreateIncomeInput = z.infer<typeof createIncomeSchema>;
export type UpdateIncomeInput = z.infer<typeof updateIncomeSchema>;
export type GetIncomesQueryInput = z.infer<typeof getIncomesQuerySchema>;
