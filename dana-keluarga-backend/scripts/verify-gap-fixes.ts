import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import {
  createSession,
  revokeRefreshToken,
  rotateRefreshToken,
} from "../src/modules/auth/auth.service";
import {
  requestPasswordReset,
  resetPassword,
} from "../src/modules/auth/password-reset.service";
import { changePassword } from "../src/modules/auth/password.service";
import {
  contribute,
  listContributions,
  reviewContribution,
  reverseContribution,
} from "../src/modules/cash/contribution.service";
import { cashSummary } from "../src/modules/cash/cash.service";
import { type WorkflowActor } from "../src/modules/approvals/approval.rules";
import { type OutgoingEmail } from "../src/modules/email/email.service";

const schema = new URL(process.env.DATABASE_URL!).searchParams.get("schema");
if (
  !schema?.startsWith("cash_test_") ||
  process.env.EMAIL_MODE !== "simulation"
)
  throw Error("Isolated test schema required");
const oldPassword = "Gap-fixture-password-123";
const newPassword = "Recovered-fixture-password-456";
async function main() {
  const passwordHash = await argon2.hash(oldPassword);
  const roles = [
    "ADMIN",
    "TREASURER",
    "MEMBER",
    "SUPER_ADMIN",
    "UNAFFILIATED",
    "ROLLBACK",
  ] as const;
  const users = await Promise.all(
    roles.map((role, index) =>
      prisma.user.create({
        data: {
          name: `Gap fixture ${role}`,
          email: `gap-fix-${role.toLowerCase()}@example.invalid`,
          phone: `628888883000${index}`,
          passwordHash,
          systemRole: role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "USER",
        },
      }),
    ),
  );
  const family = await prisma.family.create({
    data: {
      name: "Gap fixtures",
      code: randomUUID(),
      createdById: users[0].id,
    },
  });
  await prisma.familyMember.createMany({
    data: users.slice(0, 3).map((user, index) => ({
      userId: user.id,
      familyId: family.id,
      role: (["ADMIN", "TREASURER", "MEMBER"] as const)[index],
    })),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  const request = (path: string, accessToken?: string, body?: unknown) =>
    fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    const first = await createSession(users[2].id, family.id);
    const other = await createSession(users[2].id, family.id);
    const rotated = await rotateRefreshToken(first.refreshToken, family.id);
    assert(rotated);
    assert.equal((await request("/auth/me", first.accessToken)).status, 200);
    assert.equal(
      (
        await request("/auth/logout", undefined, {
          refreshToken: first.refreshToken,
        })
      ).status,
      200,
    );
    assert.equal((await request("/auth/me", first.accessToken)).status, 401);
    assert.equal(
      (await request("/auth/me", rotated.tokens.accessToken)).status,
      401,
    );
    assert.equal(await rotateRefreshToken(rotated.tokens.refreshToken), null);
    assert.equal((await request("/auth/me", other.accessToken)).status, 200);
    await revokeRefreshToken(first.refreshToken);
    for (let i = 0; i < 3; i++) {
      const session = await createSession(users[2].id);
      const [refresh] = await Promise.all([
        rotateRefreshToken(session.refreshToken),
        revokeRefreshToken(session.refreshToken),
      ]);
      assert.equal(
        (await request("/auth/me", session.accessToken)).status,
        401,
      );
      if (refresh) {
        assert.equal(
          (await request("/auth/me", refresh.tokens.accessToken)).status,
          401,
        );
        assert.equal(
          await rotateRefreshToken(refresh.tokens.refreshToken),
          null,
        );
      }
    }
    console.log(
      "PASS: logout immediately revokes old/rotated access tokens, preserves other devices, and wins refresh races.",
    );

    const accessOnly = await createSession(users[2].id);
    assert.equal(
      (
        await request("/auth/logout", accessOnly.accessToken, {
          refreshToken: null,
        })
      ).status,
      200,
    );
    assert.equal(
      (await request("/auth/me", accessOnly.accessToken)).status,
      401,
    );
    assert.equal(await rotateRefreshToken(accessOnly.refreshToken), null);
    console.log("PASS: access-only logout also revokes its refresh session.");

    // Simulate an old API INSERT that omits the new sessionId column.
    const legacyId = randomUUID();
    const legacyToken = `legacy-${randomUUID()}-${randomUUID()}`;
    const legacyHash = await argon2.hash(legacyToken);
    const legacyExpiry = new Date(Date.now() + 24 * 60 * 60_000);
    await prisma.$executeRaw`INSERT INTO "RefreshToken" ("id", "userId", "tokenHash", "expiresAt") VALUES (${legacyId}::uuid, ${users[2].id}::uuid, ${legacyHash}, ${legacyExpiry})`;
    const legacyRecord = await prisma.refreshToken.findUniqueOrThrow({
      where: { id: legacyId },
    });
    assert.equal(legacyRecord.sessionId, legacyId);
    const upgraded = await rotateRefreshToken(legacyToken, family.id);
    assert(upgraded);
    assert.equal(
      (await request("/auth/me", upgraded.tokens.accessToken)).status,
      200,
    );
    await revokeRefreshToken(legacyToken);
    assert.equal(
      (await request("/auth/me", upgraded.tokens.accessToken)).status,
      401,
    );
    const duplicateId = randomUUID();
    await assert.rejects(
      prisma.$executeRaw`INSERT INTO "RefreshToken" ("id", "userId", "tokenHash", "expiresAt") VALUES (${duplicateId}::uuid, ${users[2].id}::uuid, ${legacyHash}, ${legacyExpiry})`,
    );
    assert.equal(
      await prisma.authSession.findUnique({ where: { id: duplicateId } }),
      null,
    );
    console.log(
      "PASS: old API refresh INSERTs remain compatible; opaque tokens upgrade to stable sessions and failed INSERTs leave no orphan session.",
    );

    const deliveries: OutgoingEmail[] = [];
    const sender = async (email: OutgoingEmail) => {
      deliveries.push(email);
    };
    const emailCount = await prisma.emailMessage.count();
    for (const user of users.slice(0, 5)) {
      const previous = await createSession(user.id);
      await requestPasswordReset(user.email!, sender);
      const email = deliveries.at(-1)!;
      assert.equal(email.to, user.email);
      const url = new URL(email.text.match(/https?:\/\/[^\s]+/)![0]);
      assert.equal(url.searchParams.get("view"), "reset-password");
      const token = url.searchParams.get("token")!;
      assert.match(token, /^[0-9a-f]{64}$/);
      const stored = await prisma.passwordResetToken.findFirstOrThrow({
        where: { userId: user.id, usedAt: null },
      });
      assert.notEqual(stored.tokenHash, token);
      assert(
        stored.expiresAt.getTime() - stored.createdAt.getTime() <= 30 * 60_000,
      );
      const input = { token, newPassword, confirmPassword: newPassword };
      const result = await request("/auth/reset-password", undefined, input);
      assert.equal(result.status, 200);
      await assert.rejects(resetPassword(input), {
        code: "RESET_TOKEN_INVALID",
      });
      assert.equal(
        (await request("/auth/me", previous.accessToken)).status,
        401,
      );
      assert.equal(await rotateRefreshToken(previous.refreshToken), null);
      assert.equal(
        (
          await request("/auth/login", undefined, {
            email: user.email,
            password: oldPassword,
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await request("/auth/login", undefined, {
            email: user.email,
            password: newPassword,
          })
        ).status,
        200,
      );
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { actorId: user.id, action: "PASSWORD_RESET" },
      });
      assert(!JSON.stringify(audit).includes(token));
      assert(!JSON.stringify(audit).includes(newPassword));
    }
    assert.equal(await prisma.emailMessage.count(), emailCount);
    const count = deliveries.length;
    await requestPasswordReset("unregistered-gap@example.invalid", sender);
    await requestPasswordReset(users[2].email!, sender);
    assert.equal(deliveries.length, count);
    const unknownResponse = await request("/auth/forgot-password", undefined, {
      email: "unregistered-gap@example.invalid",
    });
    const existingResponse = await request("/auth/forgot-password", undefined, {
      email: users[2].email,
    });
    assert.deepEqual(
      await unknownResponse.json(),
      await existingResponse.json(),
    );
    console.log(
      "PASS: password recovery works for every account role without a family dependency, expires in 30 minutes, conceals account existence, and stores only digests.",
    );

    const rollbackUser = users[5];
    await requestPasswordReset(rollbackUser.email!, sender);
    const rollbackToken = new URL(
      deliveries.at(-1)!.text.match(/https?:\/\/[^\s]+/)![0],
    ).searchParams.get("token")!;
    const input = {
      token: rollbackToken,
      newPassword,
      confirmPassword: newPassword,
    };
    const prior = await createSession(rollbackUser.id);
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION "${schema}".reject_gap_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'PASSWORD_RESET' THEN RAISE EXCEPTION 'Fixture rollback'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER reject_gap_audit BEFORE INSERT ON "${schema}"."AuditLog" FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_gap_audit()`,
    );
    await assert.rejects(resetPassword(input));
    assert.equal((await request("/auth/me", prior.accessToken)).status, 200);
    const unchanged = await prisma.user.findUniqueOrThrow({
      where: { id: rollbackUser.id },
    });
    assert.equal(unchanged.authVersion, 0);
    assert.equal(unchanged.passwordHash, passwordHash);
    assert.equal(
      (
        await prisma.passwordResetToken.findFirstOrThrow({
          where: { userId: rollbackUser.id },
        })
      ).usedAt,
      null,
    );
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER reject_gap_audit ON "${schema}"."AuditLog"`,
    );
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION "${schema}".reject_gap_audit()`,
    );
    const races = await Promise.allSettled([
      resetPassword(input),
      resetPassword(input),
    ]);
    assert.equal(races.filter((item) => item.status === "fulfilled").length, 1);
    console.log(
      "PASS: recovery is atomic on audit failure and a single token has exactly one winner under concurrency.",
    );
    await prisma.passwordResetToken.updateMany({
      where: { userId: rollbackUser.id },
      data: { createdAt: new Date(Date.now() - 61_000) },
    });
    await requestPasswordReset(rollbackUser.email!, sender);
    const expiredToken = new URL(
      deliveries.at(-1)!.text.match(/https?:\/\/[^\s]+/)![0],
    ).searchParams.get("token")!;
    await prisma.passwordResetToken.updateMany({
      where: { userId: rollbackUser.id, usedAt: null },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    await assert.rejects(resetPassword({ ...input, token: expiredToken }), {
      code: "RESET_TOKEN_INVALID",
    });
    await prisma.passwordResetToken.updateMany({
      where: { userId: rollbackUser.id },
      data: { createdAt: new Date(Date.now() - 61_000) },
    });
    await requestPasswordReset(rollbackUser.email!, sender);
    const changedToken = new URL(
      deliveries.at(-1)!.text.match(/https?:\/\/[^\s]+/)![0],
    ).searchParams.get("token")!;
    await changePassword(rollbackUser.id, 1, {
      currentPassword: newPassword,
      newPassword: oldPassword,
      confirmPassword: oldPassword,
    });
    await assert.rejects(resetPassword({ ...input, token: changedToken }), {
      code: "RESET_TOKEN_INVALID",
    });
    await prisma.passwordResetToken.updateMany({
      where: { userId: rollbackUser.id },
      data: { createdAt: new Date(Date.now() - 61_000) },
    });
    await requestPasswordReset(rollbackUser.email!, async () => {
      throw Error("Fixture delivery failure");
    });
    assert.equal(
      await prisma.passwordResetToken.count({
        where: { userId: rollbackUser.id, usedAt: null },
      }),
      0,
    );
    console.log(
      "PASS: expired links, prior-password links, reused tokens, and failed-delivery links cannot reset passwords.",
    );

    const actor = (index: number): WorkflowActor => ({
      sub: users[index].id,
      familyId: family.id,
      systemRole: "USER",
      familyRole: (["ADMIN", "TREASURER", "MEMBER"] as const)[index],
    });
    const treasury = actor(1);
    const member = actor(2);
    await prisma.familyBankAccount.create({
      data: {
        familyId: family.id,
        version: 1,
        bankName: "Fixture bank",
        accountNumber: "1234567",
        accountHolder: "Fixture",
        createdById: users[1].id,
      },
    });
    const report = await contribute(member, {
      amount: "1000",
      purpose: "Correction fixture",
      idempotencyKey: randomUUID(),
    });
    await assert.rejects(
      reverseContribution(treasury, report.id, "Not confirmed"),
      { code: "CONTRIBUTION_NOT_CONFIRMED" },
    );
    await reviewContribution(
      treasury,
      report.id,
      "confirm",
      "Verified fixture",
    );
    assert.equal(
      (await cashSummary(member)).contribution.available.toString(),
      "1000",
    );
    await assert.rejects(
      reverseContribution(member, report.id, "Unauthorized fixture"),
      { code: "FORBIDDEN" },
    );
    await assert.rejects(reverseContribution(treasury, report.id, "bad"), {
      code: "REVERSAL_REASON_REQUIRED",
    });
    const treasurySession = await createSession(users[1].id, family.id);
    const body = { reason: "Setoran keliru dikonfirmasi" };
    const reversalResponses = await Promise.all([
      request(
        `/cash/contributions/${report.id}/reverse`,
        treasurySession.accessToken,
        body,
      ),
      request(
        `/cash/contributions/${report.id}/reverse`,
        treasurySession.accessToken,
        body,
      ),
    ]);
    assert.deepEqual(
      reversalResponses.map((item) => item.status),
      [200, 200],
    );
    assert.equal(
      await prisma.ledgerEntry.count({
        where: {
          referenceType: "CONTRIBUTION_REVERSAL",
          referenceId: report.id,
        },
      }),
      1,
    );
    const summary = await cashSummary(member);
    assert.equal(summary.balance.toString(), "0");
    assert.equal(summary.contribution.available.toString(), "0");
    const updated = await prisma.contributionReport.findUniqueOrThrow({
      where: { id: report.id },
    });
    assert.equal(updated.status, "REVERSED");
    assert.equal(updated.reversalReason, body.reason);
    assert(updated.reviewedAt && updated.reversedAt);
    assert.equal(
      (await listContributions(treasury)).items.find(
        (item) => item.id === report.id,
      )?.canReverse,
      false,
    );
    assert.equal(
      await prisma.auditLog.count({
        where: { entityId: report.id, action: "CONTRIBUTION_REVERSED" },
      }),
      1,
    );
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: report.id, action: "CONTRIBUTION_REVERSED" },
    });
    assert.equal((audit.after as { reason: string }).reason, body.reason);
    await assert.rejects(
      reverseContribution(treasury, report.id, "Changed reason"),
      { code: "CONTRIBUTION_ALREADY_REVERSED" },
    );
    console.log(
      "PASS: audited contribution correction reverses cash and member contribution exactly once, including concurrent retries.",
    );

    const guarded = await contribute(member, {
      amount: "1000",
      purpose: "Reserved fixture",
      idempotencyKey: randomUUID(),
    });
    await reviewContribution(treasury, guarded.id, "confirm", "");
    const reservation = await prisma.fundRequest.create({
      data: {
        familyId: family.id,
        userId: users[2].id,
        amount: "1",
        withdrawalAmount: "1",
        loanAmount: "0",
        purpose: "Fixture reservation",
        tenorMonths: 1,
        idempotencyKey: randomUUID(),
      },
    });
    await assert.rejects(
      reverseContribution(treasury, guarded.id, "Reserved funds fixture"),
      { code: "CONTRIBUTION_CORRECTION_BLOCKED" },
    );
    await prisma.fundRequest.update({
      where: { id: reservation.id },
      data: { status: "CANCELLED" },
    });
    await prisma.ledgerEntry.create({
      data: {
        familyId: family.id,
        type: "EXPENSE",
        direction: "OUT",
        amount: "1",
        description: "Spent fixture",
        createdById: users[1].id,
      },
    });
    await assert.rejects(
      reverseContribution(
        treasury,
        guarded.id,
        "Insufficient liquidity fixture",
      ),
      { code: "INSUFFICIENT_FAMILY_CASH" },
    );
    assert.equal(
      (
        await prisma.contributionReport.findUniqueOrThrow({
          where: { id: guarded.id },
        })
      ).status,
      "CONFIRMED",
    );
    assert.equal(
      await prisma.ledgerEntry.count({
        where: { referenceId: guarded.id, type: "CONTRIBUTION_REVERSAL" },
      }),
      0,
    );
    console.log(
      "PASS: correction cannot make cash/contribution negative or spend reserved funds; a blocked correction leaves financial data intact.",
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
main()
  .catch((error) => {
    console.error(
      "Gap checks failed:",
      error instanceof assert.AssertionError
        ? error.message
        : String(error.message || error.code || error.name).replaceAll(
            process.env.DATABASE_URL!,
            "[database]",
          ),
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
