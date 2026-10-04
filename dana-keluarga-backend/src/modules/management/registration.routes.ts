import { Router } from "express";
import { requireAuth, type AuthRequest } from "../../middleware/auth";
import { requireSystemRole } from "../../middleware/roles";
import { registrationSchema } from "./registration.schema";
import { registerFamilyAccess } from "./registration.service";

export const registrationRouter = Router();
registrationRouter.post(
  "/",
  requireAuth,
  requireSystemRole("SUPER_ADMIN"),
  async (req: AuthRequest, res) => {
    const input = registrationSchema.parse(req.body);
    const data = await registerFamilyAccess(req.auth!, input);
    res.status(201).json({
      success: true,
      data,
      message:
        input.type === "NEW_FAMILY"
          ? "Keluarga dan akun admin berhasil dibuat."
          : "Anggota berhasil ditambahkan.",
    });
  },
);
