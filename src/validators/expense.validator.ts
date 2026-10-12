import { z } from "zod";
import {
  monthQuerySchema,
  dateQuerySchema,
  amountQuerySchema,
  transactionAmountSchema,
  transactionDateSchema,
  transactionNotesSchema,
} from "@/validators/common.validator.js";

export const createExpenseSchema = z.object({
  amount: transactionAmountSchema,
  category: z.string().min(1, "Expense category is required.").max(50, "Category name too long."),
  date: transactionDateSchema,
  paymentMethod: z.string().min(1, "Payment method is required.").max(50, "Payment method too long."),
  description: transactionNotesSchema,
});

export const updateExpenseSchema = createExpenseSchema.partial();

export const getExpensesQuerySchema = z.object({
  month: monthQuerySchema,
  minAmount: amountQuerySchema,
  maxAmount: amountQuerySchema,
  startDate: dateQuerySchema,
  endDate: dateQuerySchema,
  category: z.string().optional(),
  categories: z.string().optional(), // comma separated
  paymentMethod: z.string().optional(),
  search: z.string().optional(),
  sortBy: z.enum(["date", "amount"]).optional().default("date"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type GetExpensesQueryInput = z.infer<typeof getExpensesQuerySchema>;
