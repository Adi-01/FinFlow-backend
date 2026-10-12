import { z } from "zod";

export const reflectReportDataSchema = z.object({
  personality_reveal: z.object({
    archetype_title: z.string(),
    tagline: z.string(),
    reveal_text: z.string(),
  }),
  at_a_glance: z.object({
    starting_allowance: z.number(),
    total_spent: z.number(),
    extra_income: z.number(),
    remaining_balance: z.number(),
    summary_text: z.string(),
  }),
  where_money_went: z.object({
    summary: z.string(),
    breakdown: z.array(
      z.object({
        category: z.string(),
        amount: z.number(),
        percentage: z.string(),
      }),
    ),
  }),
  spending_habits: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
    }),
  ),
  purchases_to_note: z.array(
    z.object({
      title: z.string(),
      amount: z.number(),
      note: z.string(),
    }),
  ),
  ideas_for_next_month: z.array(
    z.object({
      title: z.string(),
      action: z.string(),
    }),
  ),
  chatHistory: z
    .array(
      z.object({
        role: z.enum(["user", "model"]),
        content: z.string(),
      }),
    )
    .optional()
    .default([]),
  transaction_count: z.number().optional(),
});

export type ReflectReportData = z.infer<typeof reflectReportDataSchema>;

export const generateReflectSchema = z
  .object({
    year: z.number().int().min(2000).max(2100),
    month: z.number().int().min(1).max(12),
    regenerate: z.boolean().optional().default(false),
  })
  .refine(
    (data) => {
      const now = new Date();
      const currentYear = now.getUTCFullYear();
      const currentMonth = now.getUTCMonth() + 1; // 1-12
      return (
        data.year < currentYear ||
        (data.year === currentYear && data.month <= currentMonth)
      );
    },
    {
      message: "Cannot generate reflection report for a future month.",
      path: ["month"],
    },
  );

export type GenerateReflectInput = z.infer<typeof generateReflectSchema>;

import {
  notFutureMonthRefine,
  notFutureMonthError,
} from "@/validators/common.validator.js";

export const getReflectQuerySchema = z
  .object({
    year: z.coerce.number().int().min(2000).max(2100),
    month: z.coerce.number().int().min(1).max(12),
  })
  .refine(notFutureMonthRefine, notFutureMonthError);

export type GetReflectQueryInput = z.infer<typeof getReflectQuerySchema>;

export const chatReflectSchema = z.object({
  reportId: z.string().uuid("Invalid report ID format."),
  message: z
    .string()
    .trim()
    .min(1, "Message is required.")
    .max(1000, "Message cannot exceed 1000 characters."),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "model"]),
        content: z.string().max(2000),
      }),
    )
    .max(10, "History cannot exceed 10 messages.")
    .optional()
    .default([]),
});

export type ChatReflectInput = z.infer<typeof chatReflectSchema>;
