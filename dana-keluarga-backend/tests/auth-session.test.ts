import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  db: {
    user: { findUnique: vi.fn() },
    refreshToken: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  },
  verify: vi.fn(),
  hash: vi.fn(),
}));
vi.mock("../src/config/prisma", () => ({ prisma: mocks.db }));
vi.mock("argon2", () => ({
  default: { verify: mocks.verify, hash: mocks.hash },
}));
import {
  createSession,
  rotateRefreshToken,
} from "../src/modules/auth/auth.service";
const sessionId = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.hash.mockResolvedValue("hashed-token");
  mocks.verify.mockResolvedValue(true);
  mocks.db.refreshToken.findMany.mockResolvedValue([
    { id: sessionId, userId: "user", tokenHash: "hash" },
  ]);
  mocks.db.refreshToken.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.user.findUnique.mockResolvedValue({
    id: "user",
    name: "Rani",
    isActive: true,
    systemRole: "USER",
    memberships: [
      { familyId: "a", role: "ADMIN", family: { name: "A" } },
      { familyId: "b", role: "MEMBER", family: { name: "B" } },
    ],
  });
});
describe("refresh token handling", () => {
  it("creates indexed tokens while persisting only their hash", async () => {
    const result = await createSession("user", "a", "ADMIN", "USER");
    expect(result.refreshToken).toMatch(/^[0-9a-f-]{36}\.[0-9a-f]{96}$/);
    expect(mocks.db.refreshToken.create.mock.calls[0][0].data.tokenHash).toBe(
      "hashed-token",
    );
    expect(mocks.db.refreshToken.create.mock.calls[0][0].data.id).toBe(
      result.refreshToken.split(".")[0],
    );
  });
  it("preserves the selected family and uses the current database role", async () => {
    const result = await rotateRefreshToken(`${sessionId}.secret`, "b");
    expect(result?.user).toMatchObject({ familyId: "b", familyRole: "MEMBER" });
    expect(mocks.db.refreshToken.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: sessionId, revokedAt: null }),
      }),
    );
  });
  it("does not create another session when a concurrent refresh already claimed the token", async () => {
    mocks.db.refreshToken.updateMany.mockResolvedValue({ count: 0 });
    expect(await rotateRefreshToken(`${sessionId}.secret`)).toBeNull();
    expect(mocks.db.refreshToken.create).not.toHaveBeenCalled();
  });
  it("does not grant a family context without active membership", async () => {
    const result = await rotateRefreshToken(
      `${sessionId}.secret`,
      "other-family",
    );
    expect(result?.user.familyId).toBeUndefined();
  });
  it("rejects invalid tokens and inactive users", async () => {
    mocks.verify.mockResolvedValue(false);
    expect(await rotateRefreshToken(`${sessionId}.secret`)).toBeNull();
    mocks.verify.mockResolvedValue(true);
    mocks.db.user.findUnique.mockResolvedValue({
      isActive: false,
      memberships: [],
    });
    expect(await rotateRefreshToken(`${sessionId}.secret`)).toBeNull();
    expect(mocks.db.refreshToken.create).not.toHaveBeenCalled();
  });
});
