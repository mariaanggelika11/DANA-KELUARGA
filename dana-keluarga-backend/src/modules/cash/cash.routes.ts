import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../../middleware/auth";
import { amountSchema } from "../../utils/money";
import { cashSummary, contribute, requestFunds } from "./cash.service";
const schema = z.object({
  amount: amountSchema,
  purpose: z.string().trim().min(3).max(240),
  idempotencyKey: z.string().uuid(),
});
export const fundRequestSchema = schema.extend({
  tenorMonths: z.coerce.number().int().min(1).max(60).default(6),
});
export const cashRouter = Router();
cashRouter.use(requireAuth);
cashRouter.get("/", async (req: AuthRequest, res) =>
  res.json({ success: true, data: await cashSummary(req.auth!) }),
);
cashRouter.post("/contributions", async (req: AuthRequest, res) =>
  res.status(201).json({
    success: true,
    data: await contribute(req.auth!, schema.parse(req.body)),
    message: "Setoran berhasil dicatat sebagai kontribusi Anda.",
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
    const { expectedWithdrawal, ...input } = fundRequestSchema
      .extend({
        expectedWithdrawal: z.string().regex(/^(0|[1-9][0-9]{0,15})$/),
      })
      .parse(req.body);
    res
      .status(201)
      .json({
        success: true,
        data: await requestFunds(req.auth!, input, intent, expectedWithdrawal),
      });
  });
}
