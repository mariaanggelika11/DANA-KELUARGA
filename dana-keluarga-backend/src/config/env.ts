import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  PAYMENT_PROVIDER: z.enum(['sandbox', 'midtrans']).default('sandbox'),
  MIDTRANS_SERVER_KEY: z.string().optional(),
  MIDTRANS_IS_PRODUCTION: z.coerce.boolean().default(false),
  WHATSAPP_ENABLED: z.coerce.boolean().default(false),
  WHATSAPP_SESSION_PATH: z.string().default('.wwebjs_auth'),
});

export const env = schema.parse(process.env);
