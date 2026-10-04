import { updateMemberRole } from "./member-role.service";
import { Router } from "express";
import { z } from "zod";
import { SystemRole } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { requireAuth, type AuthRequest } from "../../middleware/auth";
import { requireSystemRole } from "../../middleware/roles";
import { registrationSchema } from "./registration.schema";
import { registerFamilyAccess } from "./registration.service";
import { WorkflowError } from "../approvals/approval.rules";

export const managementRouter = Router();

managementRouter.get(
  "/families",
  requireAuth,
  requireSystemRole(SystemRole.SUPER_ADMIN),
  async (_req, res) => {
    const families = await prisma.family.findMany({
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    });
    return res.json({ success: true, data: families });
  },
);

managementRouter.get(
  "/users",
  requireAuth,
  requireSystemRole(SystemRole.SUPER_ADMIN),
  async (req, res) => {
    const search = String(req.query.search ?? "").trim();
    if (search.length < 2) return res.json({ success: true, data: [] });
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        systemRole: "USER",
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
          { phone: { contains: search } },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        systemRole: true,
      },
      take: 10,
      orderBy: { name: "asc" },
    });
    return res.json({ success: true, data: users });
  },
);

managementRouter.post(
  "/families",
  requireAuth,
  requireSystemRole(SystemRole.SUPER_ADMIN),
  async (req: AuthRequest, res) => {
    const body = req.body ?? {};
    const input = registrationSchema.parse({
      ...body.admin,
      type: "NEW_FAMILY",
      familyName: body.name,
      familyCode: body.code,
      description: body.description,
    });
    const data = await registerFamilyAccess(req.auth!, input);
    res.status(201).json({
      success: true,
      data,
      message: "Keluarga dan akun admin berhasil dibuat.",
    });
  },
);
managementRouter.post(
  "/members",
  requireAuth,
  async (req: AuthRequest, res) => {
    if (
      req.auth!.systemRole !== "SUPER_ADMIN" &&
      req.auth!.familyRole !== "ADMIN"
    )
      throw new WorkflowError(
        "FORBIDDEN",
        "Hanya admin yang dapat menambahkan anggota.",
        403,
      );
    const body = req.body ?? {};
    const familyId =
      req.auth!.systemRole === "SUPER_ADMIN"
        ? body.familyId
        : req.auth!.familyId;
    const input = registrationSchema.parse({
      ...body,
      familyId,
      type: body.existingUserId ? "EXISTING_MEMBER" : "NEW_MEMBER",
    });
    const data = await registerFamilyAccess(req.auth!, input);
    res
      .status(201)
      .json({ success: true, data, message: "Anggota berhasil ditambahkan." });
  },
);

managementRouter.get("/members", requireAuth, async (req: AuthRequest, res) => {
  const familyId =
    req.auth!.systemRole === "SUPER_ADMIN"
      ? z
          .string()
          .uuid("Pilih keluarga untuk melihat anggotanya.")
          .optional()
          .parse(req.query.familyId)
      : req.auth!.familyId;
  if (!familyId && req.auth!.systemRole !== "SUPER_ADMIN")
    throw new WorkflowError(
      "FAMILY_REQUIRED",
      "Pilih keluarga untuk melihat daftar anggota.",
      400,
    );
  const members = await prisma.familyMember.findMany({
    where: familyId ? { familyId } : {},
    select: {
      family: { select: { id: true, name: true, code: true } },
      id: true,
      role: true,
      status: true,
      joinedAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          isActive: true,
          systemRole: true,
        },
      },
    },
    orderBy: { joinedAt: "asc" },
  });
  return res.json({ success: true, data: members });
});

managementRouter.patch("/members/:id/role", requireAuth, async (req: AuthRequest, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { role } = z.object({ role: z.enum(["ADMIN", "MEMBER", "TREASURER"]) }).strict().parse(req.body);
  const data = await updateMemberRole(req.auth!, id, role);
  res.json({ success: true, data, message: "Peran anggota berhasil diperbarui." });
});
