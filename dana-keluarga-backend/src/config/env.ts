import "dotenv/config";
import { z } from "zod";

export const booleanEnv = z
  .enum(["true", "false"])
  .transform((value) => value === "true");
const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  // smtp (e.g. Brevo) and resend both deliver real email; switch by changing EMAIL_MODE.
  EMAIL_MODE: z
    .enum(["disabled", "simulation", "smtp", "resend"])
    .default("disabled"),
  EMAIL_FROM: optionalString,
  EMAIL_REPLY_TO: optionalString,
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: booleanEnv.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  // Deprecated alias of EMAIL_FROM, kept so existing .env files keep working.
  SMTP_FROM: optionalString,
  RESEND_API_KEY: optionalString,
  REMINDER_HOUR_WIB: z.coerce.number().int().min(0).max(23).default(9),
  NOTIFICATION_POLL_MS: z.coerce.number().int().min(1000).default(30000),
});

const parsed = schema.parse(process.env);
export const env = {
  ...parsed,
  EMAIL_FROM:
    parsed.EMAIL_FROM ??
    parsed.SMTP_FROM ??
    "Dana Keluarga <no-reply@localhost>",
};

const realEmail = env.EMAIL_MODE === "smtp" || env.EMAIL_MODE === "resend";
if (realEmail && env.EMAIL_FROM.includes("@localhost"))
  throw new Error("EMAIL_FROM wajib diatur untuk pengiriman email nyata.");
if (env.EMAIL_MODE === "smtp" && !env.SMTP_HOST)
  throw new Error("SMTP_HOST wajib diatur untuk EMAIL_MODE=smtp.");
if (env.EMAIL_MODE === "smtp" && (!env.SMTP_USER?.trim() || !env.SMTP_PASSWORD))
  throw new Error(
    "SMTP_USER dan SMTP_PASSWORD wajib diatur untuk EMAIL_MODE=smtp.",
  );
if (env.EMAIL_MODE === "resend" && !env.RESEND_API_KEY)
  throw new Error("RESEND_API_KEY wajib diatur untuk EMAIL_MODE=resend.");
