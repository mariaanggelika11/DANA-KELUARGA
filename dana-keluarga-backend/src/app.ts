import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { prisma } from './config/prisma';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { authRouter } from './modules/auth/auth.routes';
import { loanRouter } from './modules/loans/loan.routes';
import { managementRouter } from './modules/management/management.routes';
import { registrationRouter } from './modules/management/registration.routes';
import { paymentRouter } from './modules/payments/payment.routes';
import { ledgerRouter } from './modules/ledger/ledger.routes';

export const app = express();
app.use(helmet());
app.use(cors({ origin: env.FRONTEND_URL }));
app.use(rateLimit({ windowMs: 60_000, limit: 120 }));
app.use(express.json());
app.use('/api/v1/dashboard', dashboardRouter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/loans', loanRouter);
app.use('/api/v1/management', managementRouter);
app.use('/api/v1/management/registrations', registrationRouter);
app.use('/api/v1/payments', paymentRouter);
app.use('/api/v1/ledger', ledgerRouter);
app.get('/health', (_req, res) => res.json({ success: true, data: { status: 'ok' } }));
app.get('/ready', async (_req, res) => {
  try { await prisma.$queryRaw`SELECT 1`; res.json({ success: true, data: { status: 'ready' } }); }
  catch { res.status(503).json({ success: false, error: { code: 'DATABASE_UNAVAILABLE', message: 'Database belum tersedia' } }); }
});
