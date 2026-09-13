import 'dotenv/config';
import { z } from 'zod';

export const booleanEnv = z.enum(['true', 'false']).transform((value) => value === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  PAYMENT_PROVIDER: z.enum(['sandbox', 'midtrans']).default('sandbox'),
  MIDTRANS_SERVER_KEY: z.string().optional(),
  MIDTRANS_IS_PRODUCTION: booleanEnv.default(false),
  WHATSAPP_ENABLED: booleanEnv.default(false),
  // Intended sender identity; provider registration is still required before real delivery.
  WHATSAPP_SENDER_PHONE: z.preprocess((value) => value === '' ? undefined : value, z.string().regex(/^62[1-9]\d{7,12}$/).optional()),
  WHATSAPP_MODE: z.enum(['simulation', 'disabled']).default('simulation'),
  REMINDER_HOUR_WIB: z.coerce.number().int().min(0).max(23).default(9),
  NOTIFICATION_POLL_MS: z.coerce.number().int().min(1000).default(30000),
  WHATSAPP_SESSION_PATH: z.string().default('.wwebjs_auth'),
});

export const env = schema.parse(process.env);
if (env.WHATSAPP_ENABLED) throw new Error('Pengiriman WhatsApp nyata belum tersedia. Gunakan WHATSAPP_ENABLED=false dan WHATSAPP_MODE=simulation.');
