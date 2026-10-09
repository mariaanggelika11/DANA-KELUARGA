import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../../middleware/auth";
import { cashSummary, contribute, requestFunds } from "./cash.service";
import {
  listContributions,
  reviewContribution,
  reverseContribution,
} from "./contribution.service";
import {
  contributionSchema,
  fundRequestSchema,
  withdrawalSchema,
} from "./cash.schemas";
export const cashRouter = Router();
cashRouter.use(requireAuth);
cashRouter.post("/contributions/:id/reverse", async (req: AuthRequest, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { reason } = z
    .object({ reason: z.string().trim().min(5).max(500) })
    .strict()
    .parse(req.body);
  res.json({
    success: true,
    data: await reverseContribution(req.auth!, id, reason),
    message:
      "Setoran dikoreksi. Kas dan kontribusi diperbarui; riwayat asli tetap tersimpan.",
  });
});
cashRouter.get("/", async (req: AuthRequest, res) =>
  res.json({
    success: true,
    data: await cashSummary(
      req.auth!,
      z.coerce
        .number()
        .int()
        .min(1)
        .max(100000)
        .default(1)
        .parse(req.query.page),
    ),
  }),
);
cashRouter.post("/contributions", async (req: AuthRequest, res) =>
  res.status(201).json({
    success: true,
    data: await contribute(req.auth!, contributionSchema.parse(req.body)),
    message:
      "Laporan setoran menunggu pemeriksaan pengelola dana. Kas belum berubah.",
  }),
);
cashRouter.post("/requests", async (req: AuthRequest, res) =>
  res.status(201).json({
    success: true,
    data: await requestFunds(req.auth!, fundRequestSchema.parse(req.body)),
  }),
);

for (const [path, intent] of [
  ["/withdrawals", "WITHDRAWAL"],
  ["/loan-requests", "LOAN"],
] as const) {
  cashRouter.post(path, async (req: AuthRequest, res) => {
    const { expectedWithdrawal, ...input } = withdrawalSchema.parse(req.body);
    res.status(201).json({
      success: true,
      data: await requestFunds(req.auth!, input, intent, expectedWithdrawal),
    });
  });
}

cashRouter.get("/contributions", async (req: AuthRequest, res) =>
  res.json({
    success: true,
    data: await listContributions(
      req.auth!,
      z.coerce
        .number()
        .int()
        .min(1)
        .max(100000)
        .default(1)
        .parse(req.query.page),
    ),
  }),
);
for (const action of ["confirm", "reject"] as const) {
  cashRouter.post(
    `/contributions/:id/${action}`,
    async (req: AuthRequest, res) => {
      const id = z.string().uuid().parse(req.params.id);
      const { notes } = z
        .object({ notes: z.string().trim().max(500).default("") })
        .strict()
        .parse(req.body);
      res.json({
        success: true,
        data: await reviewContribution(req.auth!, id, action, notes),
        message:
          action === "confirm"
            ? "Dana masuk dikonfirmasi. Kas dan kontribusi diperbarui."
            : "Laporan setoran ditolak. Kas belum berubah.",
      });
    },
  );
}
