import { z } from "zod";

export const updateProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters.")
    .max(50, "Name cannot exceed 50 characters.")
    .optional(),
  dob: z
    .string()
    .trim()
    .refine((val) => !isNaN(Date.parse(val)), {
      message: "Invalid date format for date of birth.",
    })
    .refine((val) => new Date(val).getTime() < Date.now(), {
      message: "Date of birth cannot be in the future.",
    })
    .nullable()
    .optional(),
  currencySymbol: z
    .string()
    .trim()
    .max(5, "Currency symbol cannot exceed 5 characters.")
    .optional(),
  monthlyStartingAllowance: z
    .number({ invalid_type_error: "Monthly starting allowance must be a number." })
    .positive("Monthly starting allowance must be greater than zero.")
    .max(1000000000, "Monthly starting allowance cannot exceed 1,000,000,000.")
    .optional(),
  defaultPaymentMethod: z
    .string()
    .trim()
    .max(100, "Default payment method cannot exceed 100 characters.")
    .nullable()
    .optional(),
  selectedMonth: z
    .string()
    .trim()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Selected month must be in YYYY-MM format.")
    .refine(
      (val) => {
        const parts = val.split("-");
        const y = Number(parts[0]);
        const m = Number(parts[1]);
        if (isNaN(y) || isNaN(m)) return false;
        const now = new Date();
        const currentYear = now.getUTCFullYear();
        const currentMonth = now.getUTCMonth() + 1;
        return y < currentYear || (y === currentYear && m <= currentMonth);
      },
      { message: "Selected month cannot be in a future month." },
    )
    .nullable()
    .optional(),
  isOnboarding: z.boolean().optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required."),
    newPassword: z
      .string()
      .min(6, "New password must be at least 6 characters.")
      .max(72, "New password cannot exceed 72 characters."),
    confirmPassword: z.string().min(1, "Please confirm your new password."),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "New password and confirmation do not match.",
    path: ["confirmPassword"],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const exportDataQuerySchema = z.object({
  format: z.enum(["json", "csv"]).default("json"),
});

export type ExportDataQuery = z.infer<typeof exportDataQuerySchema>;

export const deleteAccountSchema = z.object({
  confirmation: z.literal("DELETE", {
    errorMap: () => ({
      message: "Confirmation string must be exactly 'DELETE'.",
    }),
  }),
  password: z.string().min(1, "Password is required for account deletion."),
});

export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;

export const revokeSessionParamsSchema = z.object({
  sessionId: z.string().min(1, "Session ID is required."),
});

export type RevokeSessionParams = z.infer<typeof revokeSessionParamsSchema>;

