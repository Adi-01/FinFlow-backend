import {
  monthQuerySchema,
  dateQuerySchema,
  amountQuerySchema,
} from "@/validators/common.validator.js";
import z from "zod";

export const getTransactionsQuerySchema = z.object({
  month: monthQuerySchema,
  type: z.enum(["ALL", "INCOME", "EXPENSE"]).optional().default("ALL"),
  category: z.string().optional(),
  paymentMethod: z.string().optional(),
  minAmount: amountQuerySchema,
  maxAmount: amountQuerySchema,
  startDate: dateQuerySchema,
  endDate: dateQuerySchema,
  search: z.string().optional(),
  sortBy: z.enum(["date", "amount"]).optional().default("date"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});


export type GetTransactionsQueryInput = z.infer<
  typeof getTransactionsQuerySchema
>;
