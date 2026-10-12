import { z } from "zod";
import { getCurrentUTCMonth } from "@/utils/date.js";

export const idParamSchema = z.object({
  id: z.string().uuid("Invalid ID format. Must be a valid UUID."),
});

/**
 * Reusable validation helper to check that year and month are not in the future
 */
export const notFutureMonthRefine = (data: { year: number; month: number }) => {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  return (
    data.year < currentYear ||
    (data.year === currentYear && data.month <= currentMonth)
  );
};

export const notFutureMonthError = {
  message: "Cannot select or query a future month.",
  path: ["month"],
};

/**
 * Validates YYYY-MM query parameter, defaulting to current UTC month if omitted,
 * and rejecting any future months.
 */
export const monthQuerySchema = z
  .string()
  .regex(
    /^\d{4}-(0[1-9]|1[0-2])$/,
    "Month must be in YYYY-MM format (e.g. 2026-10)",
  )
  .default(() => getCurrentUTCMonth())
  .refine(
    (val) => {
      const parts = val.split("-");
      const year = Number(parts[0]);
      const month = Number(parts[1]);
      if (isNaN(year) || isNaN(month)) return false;
      return notFutureMonthRefine({ year, month });
    },
    { message: "Cannot select or query a future month." },
  );

/**
 * Validates optional date parameter supporting YYYY-MM-DD and ISO 8601 strings
 */
export const dateQuerySchema = z
  .string()
  .refine((val) => !isNaN(Date.parse(val)), {
    message: "Date must be a valid ISO 8601 or YYYY-MM-DD date string.",
  })
  .optional();

/**
 * Validates optional positive amount query parameters
 */
export const amountQuerySchema = z.coerce
  .number()
  .positive("Amount must be greater than 0.")
  .optional();

/**
 * Reusable validation schema for financial transaction amounts
 */
export const transactionAmountSchema = z
  .number({ required_error: "Amount is required." })
  .positive("Amount must be greater than 0.")
  .max(10_000_000, "Amount cannot exceed 10,000,000.")
  .refine(
    (val) => /^\d+(\.\d{1,2})?$/.test(val.toString()),
    "Amount cannot have more than 2 decimal places.",
  );

/**
 * Reusable validation schema for financial transaction dates
 * Disallows dates in future months and enforces a historical floor (2000-01-01).
 */
export const transactionDateSchema = z
  .string({ required_error: "Date is required." })
  .datetime("Date must be a valid ISO string.")
  .refine(
    (val) => {
      const d = new Date(val);
      if (isNaN(d.getTime())) return false;
      const now = new Date();
      const currentYear = now.getUTCFullYear();
      const currentMonth = now.getUTCMonth();
      const dateYear = d.getUTCFullYear();
      const dateMonth = d.getUTCMonth();
      return (
        dateYear < currentYear ||
        (dateYear === currentYear && dateMonth <= currentMonth)
      );
    },
    { message: "Transaction date cannot be in a future month." },
  )
  .refine(
    (val) => {
      const d = new Date(val);
      if (isNaN(d.getTime())) return false;
      return d >= new Date("2000-01-01T00:00:00.000Z");
    },
    { message: "Transaction date cannot be earlier than 2000-01-01." },
  );

/**
 * Reusable validation schema for transaction notes/descriptions
 * Trims whitespace and normalizes empty strings to null.
 */
export const transactionNotesSchema = z
  .string()
  .trim()
  .max(500, "Notes cannot exceed 500 characters.")
  .transform((val) => (val.length === 0 ? null : val))
  .nullable()
  .optional();

export type IdParamInput = z.infer<typeof idParamSchema>;

