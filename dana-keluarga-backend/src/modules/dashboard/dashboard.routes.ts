import { Prisma } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../../config/prisma";
import { requireAuth, type AuthRequest } from "../../middleware/auth";

export const dashboardRouter = Router();

dashboardRouter.get("/summary", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.auth?.familyId)
      return res.status(403).json({
        success: false,
        error: {
          code: "FAMILY_REQUIRED",
          message: "Akun belum terhubung ke keluarga",
        },
      });
    const familyId = req.auth.familyId;
    const [incoming, outgoing, activeLoans, dueInstallments, members] =
      await Promise.all([
        prisma.ledgerEntry.aggregate({
          _sum: { amount: true },
          where: { familyId, direction: "IN" },
        }),
        prisma.ledgerEntry.aggregate({
          _sum: { amount: true },
          where: { familyId, direction: "OUT" },
        }),
        prisma.loanInstallment.aggregate({
          _sum: { remainingAmount: true },
          where: { loan: { familyId, status: "ACTIVE" } },
        }),
        prisma.loanInstallment.aggregate({
          _sum: { remainingAmount: true },
          where: {
            loan: { familyId },
            status: { in: ["UNPAID", "PARTIAL", "OVERDUE"] },
          },
        }),
        prisma.familyMember.count({ where: { familyId, status: "ACTIVE" } }),
      ]);
    const balance = new Prisma.Decimal(incoming._sum.amount ?? 0)
      .sub(outgoing._sum.amount ?? 0)
      .toString();
    return res.json({
      success: true,
      data: {
        balance,
        loans: String(activeLoans._sum.remainingAmount ?? 0),
        installments: String(dueInstallments._sum.remainingAmount ?? 0),
        members,
      },
    });
  } catch {
    return res.status(503).json({
      success: false,
      error: {
        code: "DASHBOARD_UNAVAILABLE",
        message: "Ringkasan belum tersedia",
      },
    });
  }
});
