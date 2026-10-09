import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: { findFirst: vi.fn(), findUnique: vi.fn() },
  passwordResetToken: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
  },
  transaction: vi.fn(),
}));
vi.mock("../src/config/prisma", () => ({
  prisma: { ...mocks, $transaction: mocks.transaction },
}));
vi.mock("../src/modules/auth/auth.service", () => ({
  lockSessionUser: vi.fn(),
  revokeAccountSessions: vi.fn(),
}));
import { requestPasswordReset } from "../src/modules/auth/password-reset.service";
beforeEach(() => {
  vi.resetAllMocks();
  const account = {
    id: "account",
    email: "user@example.com",
    isActive: true,
    authVersion: 1,
  };
  mocks.user.findFirst.mockResolvedValue(account);
  mocks.user.findUnique.mockResolvedValue(account);
  mocks.passwordResetToken.findFirst.mockResolvedValue(null);
  mocks.passwordResetToken.create.mockResolvedValue({ id: "reset" });
  mocks.transaction.mockImplementation((fn) => fn(mocks));
});
describe("password reset delivery", () => {
  it("rejects missing delivery before account lookup", async () => {
    await expect(
      requestPasswordReset("user@example.com", null),
    ).rejects.toMatchObject({
      code: "PASSWORD_RESET_UNAVAILABLE",
      status: 503,
    });
    expect(mocks.user.findFirst).not.toHaveBeenCalled();
  });
  it("sends a recovery token while storing only its digest", async () => {
    const sender = vi.fn().mockResolvedValue(undefined);
    await requestPasswordReset("user@example.com", sender);
    const email = sender.mock.calls[0][0];
    const token = new URL(
      email.text.match(/https?:\/\/[^\s]+/)[0],
    ).searchParams.get("token");
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(email.to).toBe("user@example.com");
    expect(
      mocks.passwordResetToken.create.mock.calls[0][0].data.tokenHash,
    ).not.toBe(token);
    expect(mocks.passwordResetToken.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ usedAt: null }),
      }),
    );
  });
  it("reports provider failure and invalidates its token", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      requestPasswordReset(
        "user@example.com",
        vi.fn().mockRejectedValue(new Error("secret")),
      ),
    ).rejects.toMatchObject({
      code: "PASSWORD_RESET_DELIVERY_FAILED",
      status: 503,
    });
    expect(mocks.passwordResetToken.updateMany).toHaveBeenLastCalledWith({
      where: { id: "reset", usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    log.mockRestore();
  });
  it("does not send to an unknown account", async () => {
    mocks.user.findFirst.mockResolvedValue(null);
    const sender = vi.fn();
    await requestPasswordReset("unknown@example.com", sender);
    expect(sender).not.toHaveBeenCalled();
  });
  it("enforces the cooldown for pending tokens", async () => {
    mocks.passwordResetToken.findFirst.mockResolvedValue({ id: "recent" });
    const sender = vi.fn();
    await requestPasswordReset("user@example.com", sender);
    expect(sender).not.toHaveBeenCalled();
    expect(mocks.passwordResetToken.create).not.toHaveBeenCalled();
  });
});
