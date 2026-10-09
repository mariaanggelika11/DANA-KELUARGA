import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth, type AuthRequest } from "../../middleware/auth";
import { sendSupportRequest, supportSchema } from "./support.service";

export const supportRouter = Router();
supportRouter.use(requireAuth);
supportRouter.use(
  rateLimit({
    windowMs: 15 * 60_000,
    limit: 5,
    keyGenerator: (req: AuthRequest) => req.auth!.sub,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        code: "RATE_LIMITED",
        message: "Terlalu banyak pesan bantuan. Coba lagi setelah 15 menit.",
      },
    },
  }),
);
supportRouter.post("/", async (req: AuthRequest, res) => {
  const { message } = supportSchema.parse(req.body);
  await sendSupportRequest(req.auth!.sub, req.auth!.familyId, message);
  res.json({
    success: true,
    message: "Pesan bantuan telah dikirim ke Super Admin.",
  });
});
