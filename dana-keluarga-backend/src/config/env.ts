import "dotenv/config";
import { z } from "zod";

export const booleanEnv = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  EMAIL_MODE: z.enum(["disabled", "simulation", "smtp"]).default("disabled"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: booleanEnv.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default("Dana Keluarga <no-reply@localhost>"),
  PAYMENT_PROVIDER: z.enum(["sandbox", "midtrans"]).default("sandbox"),
  MIDTRANS_SERVER_KEY: z.string().optional(),
  MIDTRANS_IS_PRODUCTION: booleanEnv.default(false),
  REMINDER_HOUR_WIB: z.coerce.number().int().min(0).max(23).default(9),
  NOTIFICATION_POLL_MS: z.coerce.number().int().min(1000).default(30000),
});

export const env = schema.parse(process.env);

if (
  env.EMAIL_MODE === "smtp" &&
  (!env.SMTP_HOST || env.SMTP_FROM.includes("@localhost"))
)
  throw new Error(
    "SMTP_HOST dan SMTP_FROM wajib diatur untuk pengiriman email nyata.",
  );
