import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  db: {
    $transaction: vi.fn(),
    user: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    family: { findUnique: vi.fn(), create: vi.fn() },
    familyMember: { findUnique: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  hash: vi.fn(),
}));
vi.mock("../src/config/prisma", () => ({ prisma: mocks.db }));
vi.mock("argon2", () => ({ default: { hash: mocks.hash } }));
import { registrationSchema } from "../src/modules/management/registration.schema";
import { registerFamilyAccess } from "../src/modules/management/registration.service";
const familyId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const actor = {
  sub: "admin",
  systemRole: "SUPER_ADMIN",
  familyId,
  familyRole: "ADMIN",
};
const person = {
  name: "Rani",
  email: "RANI@EXAMPLE.COM",
  phone: "081234567890",
  password: "safe-password",
  confirmPassword: "safe-password",
};
const member = () =>
  registrationSchema.parse({ ...person, type: "NEW_MEMBER", familyId });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.hash.mockResolvedValue("hash");
  mocks.db.$transaction.mockImplementation((run) => run(mocks.db));
  mocks.db.family.findUnique.mockResolvedValue({
    id: familyId,
    name: "Keluarga",
    code: "FAM",
  });
  mocks.db.family.create.mockResolvedValue({
    id: familyId,
    name: "Keluarga",
    code: "FAM",
  });
  mocks.db.user.create.mockResolvedValue({
    id: otherId,
    name: person.name,
    email: "rani@example.com",
    phone: "6281234567890",
  });
});
describe("registration contracts", () => {
  it("requires a login email, normalizes phone/email, and strips sensitive role injection", () => {
    expect(member()).toMatchObject({
      email: "rani@example.com",
      phone: "6281234567890",
      role: "MEMBER",
    });
    expect(
      registrationSchema.safeParse({
        ...person,
        email: "",
        type: "NEW_MEMBER",
        familyId,
      }).success,
    ).toBe(false);
    expect(
      registrationSchema.parse({
        ...person,
        type: "NEW_MEMBER",
        familyId,
        systemRole: "SUPER_ADMIN",
      }),
    ).not.toHaveProperty("systemRole");
  });
  it.each(["letters", "123", "621234567890", "+1 234 567 8900"])(
    "rejects invalid phone number %s",
    (phone) => {
      expect(
        registrationSchema.safeParse({
          ...person,
          phone,
          type: "NEW_MEMBER",
          familyId,
        }).success,
      ).toBe(false);
    },
  );
  it("requires matching passwords only when creating an account", () => {
    expect(
      registrationSchema.safeParse({
        ...person,
        confirmPassword: "different",
        type: "NEW_MEMBER",
        familyId,
      }).success,
    ).toBe(false);
    expect(
      registrationSchema.safeParse({
        type: "EXISTING_MEMBER",
        familyId,
        existingUserId: otherId,
      }).success,
    ).toBe(true);
  });
  it("does not accept unknown or platform roles as family assignments", () => {
    for (const role of ["UNKNOWN", "SUPER_ADMIN"])
      expect(
        registrationSchema.safeParse({
          ...person,
          role,
          type: "NEW_MEMBER",
          familyId,
        }).success,
      ).toBe(false);
  });
});
describe("registration authorization and audit", () => {
  it("creates an account and membership together and excludes credentials from response/audit", async () => {
    const result = await registerFamilyAccess(actor, member());
    expect(mocks.db.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.db.familyMember.create).toHaveBeenCalledWith({
      data: { familyId, userId: otherId, role: "MEMBER" },
    });
    expect(result.user).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(mocks.db.auditLog.create.mock.calls)).not.toContain(
      "safe-password",
    );
    expect(mocks.db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: actor.sub,
          action: "NEW_MEMBER",
        }),
      }),
    );
  });
  it("creates family with its actual creator and an automatic family admin", async () => {
    mocks.db.family.findUnique.mockResolvedValue(null);
    await registerFamilyAccess(
      actor,
      registrationSchema.parse({
        ...person,
        type: "NEW_FAMILY",
        familyName: "Keluarga Baru",
        familyCode: "new-family",
      }),
    );
    expect(mocks.db.family.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          createdById: actor.sub,
          code: "NEW-FAMILY",
        }),
      }),
    );
    expect(mocks.db.familyMember.create).toHaveBeenCalledWith({
      data: { familyId, userId: otherId, role: "ADMIN" },
    });
  });
  it("rejects ordinary members and cross-family admins before account creation", async () => {
    for (const denied of [
      { ...actor, systemRole: "USER", familyRole: "MEMBER" },
      { ...actor, systemRole: "USER", familyId: otherId },
    ]) {
      await expect(
        registerFamilyAccess(denied, member()),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(mocks.hash).not.toHaveBeenCalled();
  });
  it("rechecks active family admin access inside the transaction", async () => {
    mocks.db.familyMember.findUnique.mockResolvedValue({
      role: "MEMBER",
      status: "ACTIVE",
    });
    await expect(
      registerFamilyAccess({ ...actor, systemRole: "USER" }, member()),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.db.user.create).not.toHaveBeenCalled();
  });
  it("rejects duplicate email/phone before writing account or membership", async () => {
    mocks.db.user.findFirst.mockResolvedValue({ id: otherId });
    await expect(registerFamilyAccess(actor, member())).rejects.toMatchObject({
      code: "EMAIL_AND_PHONE_ALREADY_USED",
    });
    expect(mocks.db.user.create).not.toHaveBeenCalled();
    expect(mocks.db.familyMember.create).not.toHaveBeenCalled();
  });
  it("refuses inactive and Super Admin accounts when linking", async () => {
    const input = registrationSchema.parse({
      type: "EXISTING_MEMBER",
      familyId,
      existingUserId: otherId,
    });
    for (const candidate of [
      { isActive: false, systemRole: "USER" },
      { isActive: true, systemRole: "SUPER_ADMIN" },
    ]) {
      mocks.db.user.findUnique.mockResolvedValue(candidate);
      await expect(registerFamilyAccess(actor, input)).rejects.toMatchObject({
        code: "INVALID_MEMBER",
      });
    }
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.db.familyMember.create).not.toHaveBeenCalled();
  });
  it("links existing accounts without password changes and refuses repeated membership", async () => {
    mocks.db.user.findUnique.mockResolvedValue({
      id: otherId,
      name: "Rani",
      email: person.email,
      phone: person.phone,
      systemRole: "USER",
      isActive: true,
    });
    const input = registrationSchema.parse({
      type: "EXISTING_MEMBER",
      familyId,
      existingUserId: otherId,
    });
    await registerFamilyAccess(actor, input);
    expect(mocks.db.user.create).not.toHaveBeenCalled();
    expect(mocks.hash).not.toHaveBeenCalled();
    mocks.db.familyMember.findUnique.mockResolvedValue({ id: "existing" });
    await expect(registerFamilyAccess(actor, input)).rejects.toMatchObject({
      code: "ALREADY_FAMILY_MEMBER",
    });
  });
});

describe("precise registration conflicts", () => {
  it("permits the same name when email and phone are new", async () => {
    mocks.db.user.findFirst.mockResolvedValue(null);
    await expect(registerFamilyAccess(actor, member())).resolves.toHaveProperty(
      "user",
    );
    expect(
      mocks.db.user.findFirst.mock.calls.every(
        ([query]) => !("name" in query.where),
      ),
    ).toBe(true);
  });
  it.each([
    [true, false, "EMAIL_ALREADY_USED"],
    [false, true, "PHONE_ALREADY_USED"],
    [true, true, "EMAIL_AND_PHONE_ALREADY_USED"],
  ])("reports exact conflicting fields %s/%s", async (email, phone, code) => {
    mocks.db.user.findFirst.mockImplementation(({ where }) =>
      Promise.resolve((where.email ? email : phone) ? { id: otherId } : null),
    );
    await expect(registerFamilyAccess(actor, member())).rejects.toMatchObject({
      code,
    });
    expect(mocks.db.user.create).not.toHaveBeenCalled();
  });
  it("recognizes local and international forms of the same phone", () => {
    const local = member().type === "NEW_MEMBER" ? member() : null;
    const international = registrationSchema.parse({
      ...person,
      phone: "+62 812-3456-7890",
      type: "NEW_MEMBER",
      familyId,
    });
    expect(international).toMatchObject({
      phone: local && "phone" in local ? local.phone : undefined,
    });
  });
});

it("reports the actual unique field when concurrent registration wins the race", async () => {
  mocks.db.user.findFirst.mockResolvedValue(null);
  mocks.db.user.create.mockRejectedValue(
    new Prisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: "6",
      meta: { modelName: "User", target: ["phone"] },
    }),
  );
  await expect(registerFamilyAccess(actor, member())).rejects.toMatchObject({
    code: "PHONE_ALREADY_USED",
  });
});

it("registers a new member as treasurer", async () => {
  const input = registrationSchema.parse({ ...person, type: "NEW_MEMBER", familyId, role: "TREASURER" });
  await registerFamilyAccess(actor, input);
  expect(mocks.db.familyMember.create).toHaveBeenCalledWith({ data: { familyId, userId: otherId, role: "TREASURER" } });
});
it("accepts treasurer when linking an existing account", () => {
  expect(registrationSchema.parse({ type: "EXISTING_MEMBER", familyId, existingUserId: otherId, role: "TREASURER" })).toHaveProperty("role", "TREASURER");
});
