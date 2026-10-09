import { z } from "zod";

export class WorkflowError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
export const policySchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    makerIds: z.array(z.string().uuid()).min(1).max(500),
    approverIds: z.array(z.string().uuid()).min(1).max(10),
    releaserId: z.string().uuid(),
    reason: z.string().trim().min(5).max(500),
  })
  .superRefine((data, ctx) => {
    if (
      new Set(data.makerIds).size !== data.makerIds.length ||
      new Set(data.approverIds).size !== data.approverIds.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Nama petugas tidak boleh berulang dalam peran yang sama",
      });
    if (data.approverIds.includes(data.releaserId))
      ctx.addIssue({
        code: "custom",
        message: "Releaser harus berbeda dari seluruh approver",
      });
  });
export type PolicyInput = z.infer<typeof policySchema>;
export type WorkflowActor = {
  sub: string;
  familyId?: string;
  systemRole: string;
  familyRole?: string;
};

export function requireOperationalActor(
  actor: WorkflowActor,
  familyId: string,
) {
  if (actor.systemRole === "SUPER_ADMIN")
    throw new WorkflowError(
      "PLATFORM_ROLE_ONLY",
      "Super Admin mengatur platform dan tidak boleh memproses transaksi keluarga.",
      403,
    );
  if (!actor.familyId || actor.familyId !== familyId)
    throw new WorkflowError(
      "FAMILY_REQUIRED",
      "Pilih keluarga aktif yang sesuai.",
      403,
    );
}
export function assertAssignedActor(
  actorId: string,
  makerId: string,
  assignedId: string,
  permission: "APPROVER" | "RELEASER",
  approverIds: string[],
) {
  if (actorId === makerId)
    throw new WorkflowError(
      permission === "APPROVER"
        ? "SELF_APPROVAL_NOT_ALLOWED"
        : "SELF_RELEASE_NOT_ALLOWED",
      "Pembuat pengajuan tidak boleh menyetujui atau mencairkan pengajuannya sendiri.",
      403,
    );
  if (permission === "RELEASER" && approverIds.includes(actorId))
    throw new WorkflowError(
      "SELF_RELEASE_NOT_ALLOWED",
      "Approver tidak boleh mencairkan transaksi yang sama.",
      403,
    );
  if (actorId !== assignedId)
    throw new WorkflowError(
      `NOT_ASSIGNED_AS_${permission}`,
      "Tindakan hanya dapat dilakukan petugas pada tahap aktif.",
      403,
    );
}
