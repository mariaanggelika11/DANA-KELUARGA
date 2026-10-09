import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { requireAuth, type AuthRequest } from "../../middleware/auth";
import { getFamilyPolicy, saveFamilyPolicy } from "./approval-policy.service";
import {
  policySchema,
  requireOperationalActor,
  WorkflowError,
} from "./approval.rules";
import {
  actOnRequest,
  reassignRequest,
  requestInclude,
} from "./approval.service";

export const approvalPolicyRouter = Router();
approvalPolicyRouter.use(requireAuth);
approvalPolicyRouter.get("/families", async (req: AuthRequest, res) => {
  if (
    req.auth!.systemRole !== "SUPER_ADMIN" &&
    req.auth!.familyRole !== "ADMIN"
  )
    throw new WorkflowError("FORBIDDEN", "Akses setup hirarki ditolak.", 403);
  const families = await prisma.family.findMany({
    where:
      req.auth!.systemRole === "SUPER_ADMIN"
        ? {}
        : { id: req.auth!.familyId ?? "00000000-0000-0000-0000-000000000000" },
    select: {
      id: true,
      name: true,
      code: true,
      approvalPolicies: {
        where: { active: true, transactionType: "LOAN" },
        select: { version: true },
      },
    },
    orderBy: { name: "asc" },
  });
  res.json({ success: true, data: families });
});
approvalPolicyRouter.get("/families/:id", async (req: AuthRequest, res) => {
  const id = z.string().uuid().parse(req.params.id);
  res.json({ success: true, data: await getFamilyPolicy(req.auth!, id) });
});
approvalPolicyRouter.put("/families/:id", async (req: AuthRequest, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const input = policySchema.parse(req.body);
  res.json({
    success: true,
    data: await saveFamilyPolicy(req.auth!, id, input),
    message:
      "Hirarki disimpan. Berlaku untuk pengajuan baru; pengajuan berjalan tetap memakai versi sebelumnya.",
  });
});

export const approvalRouter = Router();
approvalRouter.use(requireAuth, (req: AuthRequest, _res, next) => {
  if (!req.auth!.familyId)
    throw new WorkflowError(
      "FAMILY_REQUIRED",
      "Pilih keluarga aktif untuk membuka persetujuan.",
      403,
    );
  requireOperationalActor(req.auth!, req.auth!.familyId);
  next();
});
approvalRouter.get("/permissions", async (req: AuthRequest, res) => {
  const policy = await prisma.approvalPolicy.findFirst({
    where: {
      familyId: req.auth!.familyId,
      transactionType: "LOAN",
      active: true,
    },
    select: {
      assignments: {
        where: { userId: req.auth!.sub },
        select: { permission: true },
      },
    },
  });
  const permissions = policy?.assignments.map((item) => item.permission) ?? [];
  res.json({
    success: true,
    data: {
      configured: Boolean(policy),
      canCreateLoan:
        permissions.includes("MAKER") &&
        !permissions.some((permission) => permission !== "MAKER"),
    },
  });
});
approvalRouter.get("/", async (req: AuthRequest, res) => {
  const input = z
    .object({
      tab: z.enum(["mine", "processed", "all"]).default("mine"),
      page: z.coerce.number().int().min(1).max(100000).default(1),
    })
    .parse(req.query);
  const userId = req.auth!.sub;
  const where: Prisma.ApprovalRequestWhereInput = {
    familyId: req.auth!.familyId,
  };
  if (input.tab === "mine") {
    // A step is actionable only when its sequence equals the request's currentStep.
    const ids = await prisma.$queryRaw<
      { id: string }[]
    >`SELECT r.id FROM "ApprovalRequest" r JOIN "ApprovalStep" s ON s."requestId" = r.id AND s.sequence = r."currentStep" WHERE r."familyId" = ${req.auth!.familyId}::uuid AND s."assignedUserId" = ${userId}::uuid AND s.status = 'WAITING' AND r.status IN ('PENDING_APPROVAL', 'PENDING_RELEASE')`;
    where.id = { in: ids.map((item) => item.id) };
  } else if (input.tab === "processed")
    where.actions = { some: { actorId: userId, action: { not: "SUBMIT" } } };
  else if (req.auth!.familyRole !== "ADMIN")
    where.OR = [
      { makerId: userId },
      { loan: { borrowerId: userId } },
      { steps: { some: { assignedUserId: userId } } },
    ];
  const [items, total] = await prisma.$transaction([
    prisma.approvalRequest.findMany({
      where,
      include: requestInclude,
      take: 20,
      skip: (input.page - 1) * 20,
      orderBy: { submittedAt: "desc" },
    }),
    prisma.approvalRequest.count({ where }),
  ]);
  res.json({ success: true, data: { items, total, page: input.page } });
});
approvalRouter.get("/:id", async (req: AuthRequest, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const request = await prisma.approvalRequest.findFirst({
    where: {
      id,
      familyId: req.auth!.familyId,
      ...(req.auth!.familyRole === "ADMIN"
        ? {}
        : {
            OR: [
              { makerId: req.auth!.sub },
              { loan: { borrowerId: req.auth!.sub } },
              { steps: { some: { assignedUserId: req.auth!.sub } } },
            ],
          }),
    },
    include: requestInclude,
  });
  if (!request)
    throw new WorkflowError(
      "REQUEST_NOT_FOUND",
      "Pengajuan tidak ditemukan.",
      404,
    );
  res.json({ success: true, data: request });
});
approvalRouter.get("/:id/reassignments", async (req: AuthRequest, res) => {
  if (req.auth!.familyRole !== "ADMIN")
    throw new WorkflowError(
      "FORBIDDEN",
      "Hanya Admin keluarga dapat mengganti petugas.",
      403,
    );
  const id = z.string().uuid().parse(req.params.id);
  const request = await prisma.approvalRequest.findFirst({
    where: { id, familyId: req.auth!.familyId },
    include: { steps: true, loan: true },
  });
  if (!request)
    throw new WorkflowError(
      "REQUEST_NOT_FOUND",
      "Pengajuan tidak ditemukan.",
      404,
    );
  const excluded = [
    request.makerId,
    ...request.steps.map((step) => step.assignedUserId),
    ...(request.loan ? [request.loan.borrowerId] : []),
  ];
  const candidates = await prisma.familyMember.findMany({
    where: {
      familyId: request.familyId,
      status: "ACTIVE",
      userId: { notIn: excluded },
      user: { isActive: true, systemRole: { not: "SUPER_ADMIN" } },
    },
    select: { user: { select: { id: true, name: true } } },
    orderBy: { user: { name: "asc" } },
  });
  const history = await prisma.auditLog.findMany({
    where: {
      familyId: request.familyId,
      entityType: "ApprovalRequest",
      entityId: id,
      action: "APPROVAL_STEP_REASSIGNED",
    },
    select: {
      id: true,
      createdAt: true,
      after: true,
      actor: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  res.json({
    success: true,
    data: { candidates: candidates.map((item) => item.user), history },
  });
});
approvalRouter.post("/:id/reassign", async (req: AuthRequest, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const input = z
    .object({
      userId: z.string().uuid(),
      expectedAssignedUserId: z.string().uuid(),
      reason: z.string().trim().min(5).max(500),
    })
    .parse(req.body);
  res.json({
    success: true,
    data: await reassignRequest(req.auth!, id, input),
  });
});
approvalRouter.post("/:id/:action", async (req: AuthRequest, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const action = z
    .enum(["approve", "reject", "return", "release"])
    .parse(req.params.action);
  const input = z
    .object({ notes: z.string().trim().max(500).optional() })
    .parse(req.body ?? {});
  if (
    ["reject", "return"].includes(action) &&
    (!input.notes || input.notes.length < 3)
  )
    throw new WorkflowError(
      "NOTE_REQUIRED",
      "Alasan minimal tiga karakter wajib diisi.",
      400,
    );
  const result = await actOnRequest(
    req.auth!,
    id,
    action.toUpperCase() as "APPROVE" | "REJECT" | "RETURN" | "RELEASE",
    input.notes,
  );
  res.json({ success: true, data: result });
});
