import {
  errorHandler,
  normalizeErrorResponse,
} from "./middleware/error-handler";
import { cashRouter } from "./modules/cash/cash.routes";
import express from "express";
import { supportRouter } from "./modules/support/support.routes";
import {
  approvalPolicyRouter,
  approvalRouter,
} from "./modules/approvals/approval.routes";
import { notificationRouter } from "./modules/notifications/notification.routes";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./config/env";
import { prisma } from "./config/prisma";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes";
import { authRouter } from "./modules/auth/auth.routes";
import { loanRouter } from "./modules/loans/loan.routes";
import { managementRouter } from "./modules/management/management.routes";
import { registrationRouter } from "./modules/management/registration.routes";
import { paymentRouter } from "./modules/payments/payment.routes";
import { ledgerRouter } from "./modules/ledger/ledger.routes";

export const app = express();
app.use(helmet());
app.use(cors({ origin: env.FRONTEND_URL }));
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        code: "RATE_LIMITED",
        message: "Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi.",
      },
    },
  }),
);
app.use(express.json({ limit: "100kb" }));
app.use(normalizeErrorResponse);
app.use("/api/v1/dashboard", dashboardRouter);
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/loans", loanRouter);
app.use("/api/v1/approval-policies", approvalPolicyRouter);
app.use("/api/v1/approvals", approvalRouter);
app.use("/api/v1/management", managementRouter);
app.use("/api/v1/management/registrations", registrationRouter);
app.use("/api/v1/payments", paymentRouter);
app.use("/api/v1/ledger", ledgerRouter);
app.use("/api/v1/cash", cashRouter);
app.use("/api/v1/notifications", notificationRouter);
app.use("/api/v1/support", supportRouter);
app.get("/health", (_req, res) =>
  res.json({ success: true, data: { status: "ok" } }),
);
app.get("/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ success: true, data: { status: "ready" } });
  } catch {
    res.status(503).json({
      success: false,
      error: {
        code: "DATABASE_UNAVAILABLE",
        message: "Database belum tersedia",
      },
    });
  }
});

app.use("/api", (_req, res) =>
  res.status(404).json({
    success: false,
    error: {
      code: "NOT_FOUND",
      message: "Halaman atau layanan yang diminta tidak ditemukan.",
    },
  }),
);

app.use(errorHandler);
