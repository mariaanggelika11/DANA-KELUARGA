import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({
  db: {
    authSession: { findFirst: vi.fn(), updateMany: vi.fn() },
    refreshToken: { updateMany: vi.fn() },
    fundRequest: {
      aggregate: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    loanInstallment: {
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      createMany: vi.fn(),
    },
    payment: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    familyBankAccount: { findFirst: vi.fn(), create: vi.fn() },
    emailMessage: {
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      createMany: vi.fn(),
    },
    notification: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    family: { findUnique: vi.fn() },
    familyMember: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    loan: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    approvalPolicy: { findFirst: vi.fn() },
    approvalRequest: {
      findUnique: vi.fn(),
      create: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    approvalStep: { update: vi.fn() },
    approvalAction: { findFirst: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
    ledgerEntry: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      groupBy: vi.fn(),
      create: vi.fn(),
    },
  },
}));
vi.mock("../src/config/prisma", () => ({ prisma: mocks.db }));
import { app } from "../src/app";
import { env } from "../src/config/env";
const userId = "00000000-0000-4000-8000-000000000001";
const familyId = "00000000-0000-4000-8000-000000000002";
const installmentId = "00000000-0000-4000-8000-000000000003";
let server: Server;
let base: string;
let role = "MEMBER";
let memberships = true;
let active = true;
let systemRole = "USER";
const token = () =>
  jwt.sign(
    {
      sub: userId,
      sid: userId,
      familyId,
      familyRole: "ADMIN",
      systemRole: "SUPER_ADMIN",
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: "1h" },
  );
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  authenticated = true,
) {
  return fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(authenticated ? { Authorization: `Bearer ${token()}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeAll(async () => {
  server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    listener.on("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test server unavailable");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.db.authSession.findFirst.mockResolvedValue({ id: userId });
  role = "MEMBER";
  memberships = true;
  active = true;
  systemRole = "USER";
  mocks.db.fundRequest.aggregate.mockResolvedValue({
    _sum: {
      amount: new Prisma.Decimal(0),
      withdrawalAmount: new Prisma.Decimal(0),
    },
  });
  mocks.db.fundRequest.create.mockResolvedValue({ id: installmentId });
  mocks.db.fundRequest.update.mockResolvedValue({ id: installmentId });
  env.NODE_ENV = "test";
  mocks.db.familyBankAccount.findFirst.mockResolvedValue(null);
  mocks.db.familyMember.findUnique.mockImplementation(async () => ({
    status: "ACTIVE",
    role,
    user: { isActive: true, systemRole: "USER" },
  }));
  mocks.db.user.findUnique.mockImplementation(async () => ({
    id: userId,
    isActive: active,
    systemRole,
    memberships: memberships ? [{ familyId, role }] : [],
  }));
  mocks.db.$transaction.mockImplementation(async (input) =>
    typeof input === "function" ? input(mocks.db) : Promise.all(input),
  );
  mocks.db.emailMessage.createMany.mockResolvedValue({ count: 1 });
  mocks.db.notification.findMany.mockResolvedValue([]);
  mocks.db.notification.count.mockResolvedValue(2);
  mocks.db.notification.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.emailMessage.findMany.mockResolvedValue([]);
  mocks.db.emailMessage.count.mockResolvedValue(0);
});

describe("HTTP authorization and retired payment routes", () => {
  it("requires login to open an installment link", async () => {
    expect(
      (
        await request(
          `/payments/installments/${installmentId}`,
          "GET",
          undefined,
          false,
        )
      ).status,
    ).toBe(401);
    expect(mocks.db.loanInstallment.findFirst).not.toHaveBeenCalled();
  });
  it("limits members to their own installments even with stale admin claims", async () => {
    mocks.db.loanInstallment.findFirst.mockResolvedValue(null);
    expect(
      (await request(`/payments/installments/${installmentId}`)).status,
    ).toBe(404);
    expect(mocks.db.loanInstallment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: installmentId, loan: { familyId, borrowerId: userId } },
      }),
    );
  });
  it("limits family administrators to their family", async () => {
    role = "ADMIN";
    mocks.db.loanInstallment.findFirst.mockResolvedValue(null);
    await request(`/payments/installments/${installmentId}`);
    expect(mocks.db.loanInstallment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: installmentId, loan: { familyId } },
      }),
    );
  });
  it("rejects inactive accounts", async () => {
    active = false;
    expect((await request("/notifications")).status).toBe(401);
  });
  it("rejects loan access after membership is removed", async () => {
    memberships = false;
    expect((await request("/loans")).status).toBe(403);
  });
  it("retires provider callbacks without changing payments", async () => {
    const response = await request(
      "/payments/webhooks/sandbox",
      "POST",
      { status: "SUCCESS" },
      false,
    );
    expect(response.status).toBe(410);
    expect(mocks.db.payment.update).not.toHaveBeenCalled();
  });
  it("removes simulation confirmation for all roles", async () => {
    role = "TREASURER";
    expect(
      (await request(`/payments/${installmentId}/simulate-success`, "POST"))
        .status,
    ).toBe(404);
    expect(mocks.db.payment.update).not.toHaveBeenCalled();
  });
  it("scopes notification previews to the member or managing family", async () => {
    await request("/notifications");
    expect(mocks.db.emailMessage.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { userId } }),
    );
    role = "ADMIN";
    await request("/notifications");
    expect(mocks.db.emailMessage.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { familyId } }),
    );
  });
  it("returns only the current account email settings", async () => {
    mocks.db.user.findUniqueOrThrow.mockResolvedValue({
      email: "account@example.com",
    });
    const response = await request("/notifications/preferences");
    expect(response.status).toBe(200);
    expect(mocks.db.user.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: userId },
      select: { email: true },
    });
  });
});

describe("loan journey through HTTP routes", () => {
  const loanId = "00000000-0000-4000-8000-000000000004";
  const fixture = {
    id: loanId,
    familyId,
    borrowerId: userId,
    principalAmount: new Prisma.Decimal(3000000),
    tenorMonths: 6,
    purpose: "Renovasi rumah",
    borrower: { id: userId, name: "Rani", phone: "6281234567890" },
    family: { name: "Keluarga A" },
    installments: [
      {
        id: installmentId,
        principalAmount: new Prisma.Decimal(500000),
        dueDate: new Date("2026-10-12T09:00:00+07:00"),
      },
    ],
  };
  beforeEach(() => {
    mocks.db.$queryRaw.mockResolvedValue([{ id: loanId }]);
    mocks.db.approvalPolicy.findFirst.mockResolvedValue({
      id: "policy",
      assignments: [
        { userId, permission: "MAKER", sequence: 1 },
        { userId: "approver", permission: "APPROVER", sequence: 1 },
        { userId: "releaser", permission: "RELEASER", sequence: 2 },
      ],
    });
    mocks.db.approvalRequest.create.mockResolvedValue({ id: "request" });
    mocks.db.familyMember.count.mockResolvedValue(2);
    mocks.db.family.findUnique.mockResolvedValue({ id: familyId });
    mocks.db.familyMember.findUnique.mockResolvedValue({
      status: "ACTIVE",
      role: "MEMBER",
      user: { isActive: true, systemRole: "USER" },
    });
    mocks.db.familyMember.findFirst.mockResolvedValue({ id: userId, userId });
    mocks.db.familyMember.findMany.mockResolvedValue([]);
    mocks.db.loan.findUniqueOrThrow.mockResolvedValue(fixture);
    mocks.db.loan.create.mockResolvedValue({ ...fixture, status: "PENDING" });
    mocks.db.loan.update.mockResolvedValue(fixture);
    mocks.db.loan.updateMany.mockResolvedValue({ count: 1 });
    mocks.db.ledgerEntry.groupBy.mockResolvedValue([
      { direction: "IN", _sum: { amount: new Prisma.Decimal(5000000) } },
    ]);
  });
  it("creates an application and its outbox in one transaction without requesting password fields", async () => {
    mocks.db.loan.findFirst.mockResolvedValue(null);
    const response = await request("/loans", "POST", {
      idempotencyKey: installmentId,
      amount: 3000000,
      tenorMonths: 6,
      purpose: "Renovasi rumah",
    });
    expect(response.status).toBe(201);
    expect(mocks.db.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.db.loan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          borrowerId: userId,
          principalAmount: "3000000",
        }),
      }),
    );
    expect(mocks.db.emailMessage.createMany).toHaveBeenCalled();
    expect(mocks.db.approvalRequest.create).toHaveBeenCalled();
    expect(mocks.db.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "approver" }),
      }),
    );
  });
  it("rejects a second application after acquiring the member lock", async () => {
    mocks.db.loan.findFirst.mockResolvedValue({ id: loanId });
    const response = await request("/loans", "POST", {
      idempotencyKey: installmentId,
      amount: 3000000,
      tenorMonths: 6,
      purpose: "Renovasi rumah",
    });
    expect(response.status).toBe(409);
    expect(mocks.db.$queryRaw).toHaveBeenCalled();
    expect(mocks.db.loan.create).not.toHaveBeenCalled();
  });
  it("requires a configured hierarchy for new applications", async () => {
    mocks.db.loan.findFirst.mockResolvedValue(null);
    mocks.db.approvalPolicy.findFirst.mockResolvedValue(null);
    const response = await request("/loans", "POST", {
      idempotencyKey: installmentId,
      amount: 3000000,
      tenorMonths: 6,
      purpose: "Renovasi rumah",
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("WORKFLOW_NOT_CONFIGURED");
  });
  it("prevents old URLs from bypassing missing historical workflows", async () => {
    role = "ADMIN";
    mocks.db.loan.findFirst.mockResolvedValue({
      ...fixture,
      status: "APPROVED",
    });
    for (const action of ["approve", "reject", "disburse"]) {
      const response = await request(`/loans/${loanId}/${action}`, "POST", {
        reason: "Tidak memenuhi syarat",
      });
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe(
        "LEGACY_WORKFLOW_REQUIRED",
      );
    }
    expect(mocks.db.ledgerEntry.create).not.toHaveBeenCalled();
  });
  it("blocks Super Admin financial operations even with family ADMIN membership", async () => {
    role = "ADMIN";
    systemRole = "SUPER_ADMIN";
    for (const path of [
      "/loans",
      `/loans/${loanId}/approve`,
      `/payments/${installmentId}/confirm`,
      "/ledger",
    ]) {
      expect(
        (
          await request(path, "POST", {
            idempotencyKey: installmentId,
            amount: 3000000,
            tenorMonths: 6,
            purpose: "Renovasi rumah",
          })
        ).status,
      ).toBe(403);
    }
    expect(mocks.db.ledgerEntry.create).not.toHaveBeenCalled();
    expect(mocks.db.payment.update).not.toHaveBeenCalled();
  });
  it("rejects hierarchy writes by ordinary members and malformed configuration", async () => {
    const input = {
      expectedVersion: 0,
      makerIds: [userId],
      approverIds: [installmentId],
      releaserId: loanId,
      reason: "Penetapan awal",
    };
    mocks.db.familyMember.findUnique.mockResolvedValue({
      status: "ACTIVE",
      role: "MEMBER",
    });
    expect(
      (await request(`/approval-policies/families/${familyId}`, "PUT", input))
        .status,
    ).toBe(403);
    expect(
      (
        await request(`/approval-policies/families/${familyId}`, "PUT", {
          ...input,
          approverIds: [],
        })
      ).status,
    ).toBe(400);
  });
});

describe("personal notification inbox API", () => {
  it("limits inbox and unread count to the current account, including admins", async () => {
    role = "ADMIN";
    const response = await request("/notifications/inbox?unread=true&page=2");
    expect(response.status).toBe(200);
    expect(mocks.db.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId, isRead: false },
        skip: 20,
        take: 20,
      }),
    );
    expect((await response.json()).data.unreadCount).toBe(2);
    await request("/notifications/inbox/unread-count");
    expect(mocks.db.notification.count).toHaveBeenLastCalledWith({
      where: { userId, isRead: false },
    });
  });
  it("marks only the current account notifications as read", async () => {
    expect(
      (await request("/notifications/inbox/read-all", "PATCH")).status,
    ).toBe(200);
    expect(mocks.db.notification.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { userId, isRead: false },
        data: expect.objectContaining({ isRead: true }),
      }),
    );
    expect(
      (await request(`/notifications/inbox/${installmentId}/read`, "PATCH"))
        .status,
    ).toBe(200);
    expect(mocks.db.notification.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: installmentId, userId } }),
    );
  });
  it("does not permit marking another account notification as read", async () => {
    mocks.db.notification.updateMany.mockResolvedValue({ count: 0 });
    expect(
      (await request(`/notifications/inbox/${installmentId}/read`, "PATCH"))
        .status,
    ).toBe(404);
  });
  it("rejects malformed filters and notification IDs", async () => {
    expect((await request("/notifications/inbox?page=-1")).status).toBe(400);
    expect((await request("/notifications/inbox?unread=maybe")).status).toBe(
      400,
    );
    expect(
      (await request("/notifications/inbox/not-an-id/read", "PATCH")).status,
    ).toBe(400);
    expect(mocks.db.notification.updateMany).not.toHaveBeenCalled();
  });
});

describe("explicit active-family context", () => {
  it("issues a token only for an active membership and keeps its role", async () => {
    mocks.db.user.findUnique.mockResolvedValue({
      id: userId,
      name: "Anggota",
      authVersion: 0,
      isActive: true,
      systemRole: "USER",
      memberships: [
        { familyId, role: "MEMBER", family: { name: "Keluarga A" } },
      ],
    });
    const response = await request("/auth/active-family", "POST", { familyId });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(
      jwt.verify(payload.data.accessToken, env.JWT_ACCESS_SECRET),
    ).toMatchObject({ familyId, familyRole: "MEMBER", systemRole: "USER" });
    expect(payload.data.user.families).toEqual([
      { id: familyId, role: "MEMBER", name: "Keluarga A" },
    ]);
  });
  it("rejects a switch to another family without active membership", async () => {
    mocks.db.user.findUnique.mockResolvedValue({
      id: userId,
      name: "Anggota",
      authVersion: 0,
      isActive: true,
      systemRole: "USER",
      memberships: [
        { familyId, role: "MEMBER", family: { name: "Keluarga A" } },
      ],
    });
    expect(
      (
        await request("/auth/active-family", "POST", {
          familyId: installmentId,
        })
      ).status,
    ).toBe(403);
  });
});

describe("loan submission permission lookup", () => {
  it("requires a configured maker assignment without a decision-role conflict", async () => {
    for (const [policy, configured, canCreateLoan] of [
      [null, false, false],
      [{ assignments: [{ permission: "MAKER" }] }, true, true],
      [
        { assignments: [{ permission: "MAKER" }, { permission: "APPROVER" }] },
        true,
        false,
      ],
      [{ assignments: [] }, true, false],
    ] as const) {
      mocks.db.approvalPolicy.findFirst.mockResolvedValue(policy);
      const response = await request("/approvals/permissions");
      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual({
        configured,
        canCreateLoan,
      });
      expect(mocks.db.approvalPolicy.findFirst).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { familyId, transactionType: "LOAN", active: true },
        }),
      );
    }
  });
});

describe("registration and financial validation through HTTP", () => {
  it("requires administrator access before attempting to create accounts", async () => {
    expect((await request("/management/members", "POST", {})).status).toBe(403);
    expect(
      (await request("/management/registrations", "POST", {})).status,
    ).toBe(403);
  });
  it("returns localized validation details for missing registration fields", async () => {
    role = "ADMIN";
    const response = await request("/management/members", "POST", {
      name: "Rani",
      phone: "081234567890",
      password: "password123",
      confirmPassword: "different",
    });
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload).toMatchObject({
      success: false,
      error: { code: "INVALID_INPUT" },
    });
    expect(payload.error.message).not.toMatch(/Invalid|undefined|expected/);
    expect(payload.error.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "email" })]),
    );
  });
  it("rejects zero, negative, fractional and unsafe cash amounts", async () => {
    role = "ADMIN";
    for (const amount of [0, -100, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        (
          await request("/ledger", "POST", {
            idempotencyKey: installmentId,
            direction: "IN",
            amount,
            description: "Setoran keluarga",
          })
        ).status,
      ).toBe(400);
    }
    expect(mocks.db.ledgerEntry.create).not.toHaveBeenCalled();
  });
  it("rejects expenses greater than the locked family cash balance", async () => {
    role = "ADMIN";
    mocks.db.ledgerEntry.groupBy.mockResolvedValue([]);
    const response = await request("/ledger", "POST", {
      idempotencyKey: installmentId,
      direction: "OUT",
      amount: 1000,
      description: "Pengeluaran keluarga",
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("INSUFFICIENT_FAMILY_CASH");
    expect(mocks.db.ledgerEntry.create).not.toHaveBeenCalled();
  });
  it("returns a consistent JSON envelope for unknown endpoints", async () => {
    const response = await request("/missing-endpoint");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      success: false,
      error: { code: "NOT_FOUND" },
    });
  });
});

describe("login failure distinctions", () => {
  it("identifies an email that has not been registered", async () => {
    mocks.db.user.findFirst.mockResolvedValue(null);
    const response = await request(
      "/auth/login",
      "POST",
      { email: "missing@example.com", password: "wrong-password" },
      false,
    );
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe(
      "AUTH_EMAIL_NOT_REGISTERED",
    );
  });
  it("identifies an incorrect password for a registered account", async () => {
    const argon2 = await import("argon2");
    mocks.db.user.findFirst.mockResolvedValue({
      isActive: true,
      passwordHash: await argon2.hash("test-correct-password"),
    });
    const response = await request(
      "/auth/login",
      "POST",
      { email: "registered@example.com", password: "wrong-password" },
      false,
    );
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("AUTH_PASSWORD_INCORRECT");
  });
  it("does not describe an inactive account as unregistered", async () => {
    mocks.db.user.findFirst.mockResolvedValue({ isActive: false });
    const response = await request(
      "/auth/login",
      "POST",
      { email: "inactive@example.com", password: "wrong-password" },
      false,
    );
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("AUTH_ACCOUNT_INACTIVE");
  });
});

describe("member family filters", () => {
  it("allows Super Admin to list members across all families", async () => {
    systemRole = "SUPER_ADMIN";
    mocks.db.familyMember.findMany.mockResolvedValue([]);
    expect((await request("/management/members")).status).toBe(200);
    expect(mocks.db.familyMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        select: expect.objectContaining({ family: expect.anything() }),
      }),
    );
  });
  it("filters a selected family for Super Admin", async () => {
    systemRole = "SUPER_ADMIN";
    mocks.db.familyMember.findMany.mockResolvedValue([]);
    expect(
      (await request(`/management/members?familyId=${familyId}`)).status,
    ).toBe(200);
    expect(mocks.db.familyMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { familyId } }),
    );
  });
  it("does not let ordinary members override their family scope", async () => {
    mocks.db.familyMember.findMany.mockResolvedValue([]);
    expect(
      (await request(`/management/members?familyId=${installmentId}`)).status,
    ).toBe(200);
    expect(mocks.db.familyMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { familyId } }),
    );
  });
  it("rejects malformed family filters for Super Admin", async () => {
    systemRole = "SUPER_ADMIN";
    expect((await request("/management/members?familyId=invalid")).status).toBe(
      400,
    );
    expect(mocks.db.familyMember.findMany).not.toHaveBeenCalled();
  });
});

describe("family ledger pages and managing role access", () => {
  it.each(["ADMIN", "TREASURER", "MEMBER"])(
    "scopes %s loan lists to their permitted family and borrower",
    async (memberRole) => {
      role = memberRole;
      mocks.db.loan.findMany.mockResolvedValue([]);
      expect((await request("/loans")).status).toBe(200);
      expect(mocks.db.loan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            familyId,
            ...(memberRole === "MEMBER" ? { borrowerId: userId } : {}),
          },
        }),
      );
    },
  );
  it("pages ledger history beyond its old 100 row limit, without losing family scope", async () => {
    mocks.db.ledgerEntry.findMany.mockResolvedValue([]);
    mocks.db.ledgerEntry.count.mockResolvedValue(125);
    const response = await request("/ledger?page=6");
    expect(response.status).toBe(200);
    expect((await response.json()).pagination).toEqual({
      page: 6,
      pageSize: 20,
      total: 125,
    });
    expect(mocks.db.ledgerEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { familyId }, skip: 100, take: 20 }),
    );
    expect(mocks.db.ledgerEntry.count).toHaveBeenCalledWith({
      where: { familyId },
    });
  });
  it("rejects invalid ledger pages before querying the database", async () => {
    expect((await request("/ledger?page=0")).status).toBe(400);
    expect(mocks.db.ledgerEntry.findMany).not.toHaveBeenCalled();
  });
  it("keeps a member's fund history private when paging past 100 records", async () => {
    mocks.db.familyMember.findUnique.mockResolvedValue({
      status: "ACTIVE",
      role: "MEMBER",
      user: { isActive: true, systemRole: "USER" },
    });
    mocks.db.familyMember.findMany.mockResolvedValue([]);
    mocks.db.ledgerEntry.groupBy.mockResolvedValue([]);
    mocks.db.loan.findMany.mockResolvedValue([]);
    mocks.db.fundRequest.findMany.mockResolvedValue([]);
    mocks.db.fundRequest.count.mockResolvedValue(125);
    const response = await request("/cash?page=6");
    expect(response.status).toBe(200);
    expect((await response.json()).data.requestsTotal).toBe(125);
    expect(mocks.db.fundRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { familyId, userId },
        skip: 100,
        take: 20,
      }),
    );
  });
  it("rejects reassignment management by members", async () => {
    expect(
      (await request(`/approvals/${installmentId}/reassignments`)).status,
    ).toBe(403);
  });
});

describe("manual transfer HTTP permissions", () => {
  const loanId = "00000000-0000-4000-8000-000000000004";
  const accountId = "00000000-0000-4000-8000-000000000005";
  const paymentId = "00000000-0000-4000-8000-000000000006";
  const report = {
    idempotencyKey: paymentId,
    bankAccountId: accountId,
    amount: "500000",
    transferredAt: "2026-01-02T03:00:00Z",
    transferReference: "REF-123",
    transferNotes: "Dari rekening peminjam",
  };
  beforeEach(() => {
    mocks.db.familyBankAccount.findFirst.mockResolvedValue({
      id: accountId,
      familyId,
      version: 1,
      bankName: "BCA",
      accountNumber: "0012345678",
      accountHolder: "Keluarga A",
    });
    mocks.db.familyMember.findMany.mockResolvedValue([
      { userId: "other-manager" },
    ]);
  });
  it("accepts one-click reporting with server-controlled amount and pending status", async () => {
    mocks.db.loanInstallment.findFirst.mockResolvedValue({
      id: installmentId,
      remainingAmount: new Prisma.Decimal(500000),
      loan: { status: "ACTIVE" },
    });
    mocks.db.payment.create.mockImplementation(async ({ data }) => ({
      id: paymentId,
      ...data,
    }));
    const response = await request(
      `/payments/loans/${loanId}/installments/${installmentId}`,
      "POST",
      {
        idempotencyKey: paymentId,
        bankAccountId: accountId,
        expectedRemainingAmount: "500000",
      },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      status: "PENDING",
      amount: "500000",
      transferredAt: null,
      transferReference: null,
    });
    expect(mocks.db.ledgerEntry.create).not.toHaveBeenCalled();
  });
  it.each(["MEMBER", "TREASURER"])(
    "returns the same waiting status in detail and schedule for %s",
    async (memberRole) => {
      role = memberRole;
      const own = memberRole === "MEMBER";
      const installment = {
        id: installmentId,
        remainingAmount: new Prisma.Decimal(500000),
        paidAmount: new Prisma.Decimal(0),
        dueDate: new Date("2999-01-01"),
        status: "UNPAID",
        loan: { status: "ACTIVE", borrowerId: own ? userId : "another-user" },
        payments: [
          {
            provider: "MANUAL",
            status: "PENDING",
            bankAccount: { id: accountId },
            bankAccountId: accountId,
          },
        ],
      };
      mocks.db.loanInstallment.findFirst.mockResolvedValue(installment);
      mocks.db.loan.findMany.mockResolvedValue([
        { id: loanId, installments: [installment] },
      ]);
      const detailResponse = await request(
        `/payments/installments/${installmentId}`,
      );
      expect(detailResponse.status).toBe(200);
      const detail = (await detailResponse.json()).data;
      expect(detail.paymentStatus).toBe("PENDING_REVIEW");
      expect(detail.canReport).toBe(false);
      expect(detail.canReview).toBe(!own);
      const listResponse = await request("/loans");
      expect(listResponse.status).toBe(200);
      expect(
        (await listResponse.json()).data[0].installments[0].paymentStatus,
      ).toBe(detail.paymentStatus);
    },
  );
  it("does not allow extra payment evidence or status in a one-click request", async () => {
    const minimal = { idempotencyKey: paymentId, bankAccountId: accountId };
    for (const extra of [
      { status: "SUCCESS" },
      { amount: "1" },
      { transferredAt: "2026-01-01" },
    ]) {
      expect(
        (
          await request(
            `/payments/loans/${loanId}/installments/${installmentId}`,
            "POST",
            { ...minimal, ...extra },
          )
        ).status,
      ).toBe(400);
    }
    expect(mocks.db.payment.create).not.toHaveBeenCalled();
  });
  it("lets a borrower report a transfer in production without gateway configuration", async () => {
    env.NODE_ENV = "production";
    mocks.db.loanInstallment.findFirst.mockResolvedValue({
      id: installmentId,
      remainingAmount: new Prisma.Decimal(500000),
      loan: {
        status: "ACTIVE",
        familyId,
        borrowerId: userId,
        disbursedAt: new Date("2026-01-01"),
      },
    });
    mocks.db.payment.create.mockImplementation(async ({ data }) => ({
      id: paymentId,
      ...data,
    }));
    const response = await request(
      `/payments/loans/${loanId}/installments/${installmentId}`,
      "POST",
      report,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data.provider).toBe("MANUAL");
    expect(mocks.db.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payerId: userId,
        familyId,
        bankAccountId: accountId,
      }),
    });
    expect(mocks.db.ledgerEntry.create).not.toHaveBeenCalled();
  });
  it.each(["ADMIN", "TREASURER", "MEMBER"])(
    "does not let %s report another borrower's installment",
    async (memberRole) => {
      role = memberRole;
      mocks.db.loanInstallment.findFirst.mockResolvedValue(null);
      expect(
        (
          await request(
            `/payments/loans/${loanId}/installments/${installmentId}`,
            "POST",
            report,
          )
        ).status,
      ).toBe(403);
      expect(mocks.db.loanInstallment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: installmentId,
            loanId,
            loan: { familyId, borrowerId: userId },
          },
        }),
      );
      expect(mocks.db.payment.create).not.toHaveBeenCalled();
    },
  );
  it.each(["ADMIN", "MEMBER"])(
    "denies confirmation and bank editing to %s",
    async (memberRole) => {
      role = memberRole;
      expect(
        (
          await request(`/payments/${paymentId}/confirm`, "POST", {
            notes: "Sesuai mutasi bank",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await request("/payments/bank-account", "PUT", {
            expectedVersion: 1,
            bankName: "BCA",
            accountNumber: "0012345678",
            accountHolder: "Keluarga A",
          })
        ).status,
      ).toBe(403);
      expect(mocks.db.payment.update).not.toHaveBeenCalled();
    },
  );
  it("keeps the confirmation queue within the active family and excludes the manager's own loans", async () => {
    role = "TREASURER";
    mocks.db.payment.findMany.mockResolvedValue([]);
    mocks.db.payment.count.mockResolvedValue(25);
    const response = await request("/payments/pending?page=2");
    expect(response.status).toBe(200);
    expect((await response.json()).data.total).toBe(25);
    expect(mocks.db.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          familyId,
          provider: "MANUAL",
          status: "PENDING",
          payerId: { not: userId },
          loan: { borrowerId: { not: userId } },
        }),
        skip: 20,
        take: 20,
      }),
    );
  });
  it("denies a forged success field on a borrower report", async () => {
    expect(
      (
        await request(
          `/payments/loans/${loanId}/installments/${installmentId}`,
          "POST",
          { ...report, status: "SUCCESS" },
        )
      ).status,
    ).toBe(400);
    expect(mocks.db.payment.create).not.toHaveBeenCalled();
  });
  it("blocks operational payment changes by Super Admin", async () => {
    systemRole = "SUPER_ADMIN";
    expect(
      (
        await request(`/payments/${paymentId}/confirm`, "POST", {
          notes: "Sesuai mutasi bank",
        })
      ).status,
    ).toBe(403);
    expect(mocks.db.payment.update).not.toHaveBeenCalled();
  });
});

it("rejects an access token immediately when logout revoked its session", async () => {
  mocks.db.authSession.findFirst.mockResolvedValue(null);
  const response = await request("/notifications");
  expect(response.status).toBe(401);
  expect((await response.json()).error.code).toBe("SESSION_REVOKED");
  expect(mocks.db.notification.findMany).not.toHaveBeenCalled();
});

it("can logout with a valid access token when the refresh token is missing", async () => {
  const response = await request("/auth/logout", "POST", {
    refreshToken: null,
  });
  expect(response.status).toBe(200);
  expect(mocks.db.authSession.updateMany).toHaveBeenCalledWith({
    where: { id: userId, userId, revokedAt: null },
    data: { revokedAt: expect.any(Date) },
  });
});
