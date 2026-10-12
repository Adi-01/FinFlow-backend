import { z } from "zod";
import { validateRequest } from "@/middleware/validate.middleware.js";

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters long")
    .max(100, "Name must not exceed 100 characters"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Invalid email address format")
    .max(100, "Email must not exceed 100 characters"),
  password: z
    .string()
    .min(6, "Password must be at least 6 characters long")
    .max(72, "Password must not exceed 72 characters"),
});

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Invalid email address format")
    .max(100, "Email must not exceed 100 characters"),
  password: z
    .string()
    .min(1, "Password is required")
    .max(72, "Password must not exceed 72 characters"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export const registerValidation = validateRequest(registerSchema);
export const loginValidation = validateRequest(loginSchema);
