import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  db: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    refreshToken: { updateMany: vi.fn() },
    authSession: { updateMany: vi.fn() },
    passwordResetToken: { updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
  verify: vi.fn(),
  hash: vi.fn(),
}));
vi.mock("../src/config/prisma", () => ({ prisma: mocks.db }));
vi.mock("argon2", () => ({
  default: { verify: mocks.verify, hash: mocks.hash },
}));
import { changePasswordSchema } from "../src/modules/auth/auth.schemas";
import { changePassword } from "../src/modules/auth/password.service";

const input = {
  currentPassword: "old-password",
  newPassword: "new-password",
  confirmPassword: "new-password",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.db.$transaction.mockImplementation((fn) => fn(mocks.db));
  mocks.db.user.findUnique.mockResolvedValue({
    id: "user",
    isActive: true,
    authVersion: 0,
    passwordHash: "old-hash",
  });
  mocks.verify.mockResolvedValue(true);
  mocks.hash.mockResolvedValue("new-hash");
  mocks.db.refreshToken.updateMany.mockResolvedValue({ count: 2 });
});

describe("password input validation", () => {
  it("preserves deliberate spaces in a valid password", () => {
    const value = " new-password ";
    expect(
      changePasswordSchema.parse({
        ...input,
        newPassword: value,
        confirmPassword: value,
      }).newPassword,
    ).toBe(value);
  });
  for (const invalid of [
    { ...input, currentPassword: "" },
    { ...input, newPassword: "short", confirmPassword: "short" },
    { ...input, newPassword: " ".repeat(8), confirmPassword: " ".repeat(8) },
    { ...input, confirmPassword: "different-password" },
    {
      ...input,
      newPassword: input.currentPassword,
      confirmPassword: input.currentPassword,
    },
    {
      ...input,
      newPassword: "a".repeat(129),
      confirmPassword: "a".repeat(129),
    },
    { ...input, currentPassword: "a".repeat(129) },
    { ...input, userId: "another-user" },
  ])
    it(`rejects invalid input ${JSON.stringify(Object.keys(invalid))}`, () => {
      expect(changePasswordSchema.safeParse(invalid).success).toBe(false);
    });
});

describe("password change and session revocation", () => {
  it("hashes the new password, revokes all refresh sessions and audits without secrets", async () => {
    await changePassword("user", 0, input);
    expect(mocks.verify).toHaveBeenCalledWith(
      "old-hash",
      input.currentPassword,
    );
    expect(mocks.hash).toHaveBeenCalledWith(input.newPassword);
    expect(mocks.db.$queryRaw).toHaveBeenCalled();
    expect(mocks.db.user.update).toHaveBeenCalledWith({
      where: { id: "user" },
      data: { passwordHash: "new-hash", authVersion: { increment: 1 } },
    });
    expect(mocks.db.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    const audit = mocks.db.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({
      actorId: "user",
      entityId: "user",
      action: "PASSWORD_CHANGED",
      after: { authVersion: 1, sessionsRevoked: 2 },
    });
    for (const secret of [...Object.values(input), "old-hash", "new-hash"])
      expect(JSON.stringify(audit)).not.toContain(secret);
  });
  it("keeps a wrong current password as an input error without logging the user out", async () => {
    mocks.verify.mockResolvedValue(false);
    await expect(changePassword("user", 0, input)).rejects.toMatchObject({
      code: "CURRENT_PASSWORD_INCORRECT",
      status: 400,
    });
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
  it("rejects an inactive account before hashing", async () => {
    mocks.db.user.findUnique.mockResolvedValue({
      isActive: false,
      authVersion: 0,
    });
    await expect(changePassword("user", 0, input)).rejects.toMatchObject({
      code: "SESSION_REVOKED",
      status: 401,
    });
    expect(mocks.hash).not.toHaveBeenCalled();
  });
  it("rejects an already revoked access session", async () => {
    await expect(changePassword("user", 1, input)).rejects.toMatchObject({
      code: "SESSION_REVOKED",
    });
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
  it("rechecks account state after acquiring the lock", async () => {
    mocks.db.user.findUnique
      .mockResolvedValueOnce({
        isActive: true,
        authVersion: 0,
        passwordHash: "old-hash",
      })
      .mockResolvedValueOnce({
        isActive: true,
        authVersion: 1,
        passwordHash: "concurrent-hash",
      });
    await expect(changePassword("user", 0, input)).rejects.toMatchObject({
      code: "SESSION_REVOKED",
    });
    expect(mocks.db.user.update).not.toHaveBeenCalled();
    expect(mocks.db.auditLog.create).not.toHaveBeenCalled();
  });
  it("does not report success if session revocation fails", async () => {
    mocks.db.refreshToken.updateMany.mockRejectedValue(
      new Error("database unavailable"),
    );
    await expect(changePassword("user", 0, input)).rejects.toThrow(
      "database unavailable",
    );
    expect(mocks.db.auditLog.create).not.toHaveBeenCalled();
  });
});
