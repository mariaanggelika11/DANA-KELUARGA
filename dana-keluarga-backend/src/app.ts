import { cashRouter } from "./modules/cash/cash.routes";
import express from "express";
import { ZodError } from "zod";
import { WorkflowError } from "./modules/approvals/approval.rules";
import {
  approvalPolicyRouter,
  approvalRouter,
} from "./modules/approvals/approval.routes";
import { Prisma } from "@prisma/client";
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
// Keep legacy handlers compatible while returning a consistent error envelope.
app.use((_req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => {
    if (
      res.statusCode >= 400 &&
      body &&
      typeof body === "object" &&
      body.error
    ) {
      const codes: Record<number, string> = {
        400: "INVALID_INPUT",
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        409: "CONFLICT",
        429: "RATE_LIMITED",
        500: "INTERNAL_ERROR",
        503: "SERVICE_UNAVAILABLE",
      };
      body = {
        ...body,
        success: false,
        error: {
          code: codes[res.statusCode] ?? "REQUEST_FAILED",
          ...body.error,
        },
      };
    }
    return json(body);
  };
  next();
});
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

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof WorkflowError)
      return res.status(error.status).json({
        success: false,
        error: { code: error.code, message: error.message },
      });
    if (error instanceof ZodError)
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_INPUT",
          message: "Periksa kembali isian yang ditandai.",
          fields: error.issues.map((item) => ({
            field: item.path.join("."),
            message:
              /^[A-Z][a-z]+ (input|format)|^Too (small|big)|^Invalid/.test(
                item.message,
              )
                ? "Isian belum sesuai. Periksa format dan kelengkapannya."
                : item.message,
          })),
        },
      });
    const code = error instanceof Error ? error.message : "";
    const conflicts: Record<string, string> = {
      LOAN_ALREADY_EXISTS:
        "Masih ada pengajuan atau pinjaman aktif untuk anggota ini.",
      PAYMENT_EXPIRED: "Pembayaran kedaluwarsa. Buat pembayaran baru.",
      PAYMENT_CONFLICT:
        "Status cicilan berubah atau cicilan sudah lunas. Muat ulang halaman.",
      INVALID_PAYMENT_PROVIDER: "Provider pembayaran tidak sesuai.",
      INSUFFICIENT_FAMILY_BALANCE: "Saldo kas keluarga tidak mencukupi.",
    };
    if (conflicts[code])
      return res
        .status(409)
        .json({ success: false, error: { code, message: conflicts[code] } });
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002")
        return res.status(409).json({
          success: false,
          error: {
            code: "DUPLICATE_DATA",
            message:
              "Data tersebut sudah digunakan atau sudah diproses. Periksa data sebelum mencoba lagi.",
          },
        });
      if (["P2025", "P2034"].includes(error.code))
        return res.status(409).json({
          success: false,
          error: {
            code: "DATA_CONFLICT",
            message:
              "Data berubah atau sudah diproses. Muat ulang dan coba lagi.",
          },
        });
      if (error.code === "P2023")
        return res.status(400).json({ error: { message: "ID tidak valid" } });
    }
    if (error instanceof SyntaxError)
      return res
        .status(400)
        .json({ error: { message: "Format JSON tidak valid" } });
    console.error(
      "Permintaan gagal",
      error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code
        : "INTERNAL_ERROR",
    );
    return res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Permintaan belum dapat diproses. Silakan coba lagi.",
      },
    });
  },
);
