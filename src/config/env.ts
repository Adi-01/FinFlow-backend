import { z } from "zod";
import "dotenv/config";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().default(5000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  JWT_REFRESH_SECRET: z
    .string()
    .optional()
    .default("default_jwt_refresh_secret_change_in_production"),
  REDIS_URL: z.string().optional().default("redis://localhost:6379"),
  GEMINI_API_KEY: z.string().optional().default(""),
  ENABLE_VERBOSE_LOGS: z
    .preprocess(
      (val) => val === "true" || val === "1" || val === true,
      z.boolean().default(false),
    ),
  TZ: z.string().optional().default("Asia/Kolkata"),
  CLOUDINARY_CLOUD_NAME: z.string().optional().default(""),
  CLOUDINARY_API_KEY: z.string().optional().default(""),
  CLOUDINARY_API_SECRET: z.string().optional().default(""),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "❌ Invalid environment variables:",
    JSON.stringify(parsed.error.format(), null, 2),
  );
  process.exit(1);
}

export const env = parsed.data;
