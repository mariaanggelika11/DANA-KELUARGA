import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import {
  createSession,
  rotateRefreshToken,
} from "../src/modules/auth/auth.service";
import { changePassword } from "../src/modules/auth/password.service";

const schema = new URL(process.env.DATABASE_URL!).searchParams.get("schema");
if (
  !schema?.startsWith("cash_test_") ||
  process.env.EMAIL_MODE !== "simulation"
)
  throw Error("Isolated test schema required");
const oldPassword = "Isolated-old-password-123";
const newPassword = "Isolated-new-password-456";
const input = {
  currentPassword: oldPassword,
  newPassword,
  confirmPassword: newPassword,
};

async function main() {
  const passwordHash = await argon2.hash(oldPassword);
  const users = await Promise.all(
    [
      "ADMIN",
      "TREASURER",
      "MEMBER",
      "SUPER_ADMIN",
      "UNAFFILIATED",
      "CONCURRENT",
      "ROLLBACK",
    ].map((role, index) =>
      prisma.user.create({
        data: {
          name: `Password fixture ${role}`,
          email: `password-${role.toLowerCase()}@example.invalid`,
          phone: `62888888100${index}`,
          passwordHash,
          systemRole: role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "USER",
        },
      }),
    ),
  );
  const family = await prisma.family.create({
    data: {
      name: "Password test only",
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
    assert.equal(
      (await request("/auth/password", undefined, input)).status,
      401,
    );
    for (const user of users.slice(0, 5)) {
      const first = await createSession(user.id);
      const second = await createSession(user.id);
      const wrong = await request("/auth/password", first.accessToken, {
        ...input,
        currentPassword: "Incorrect-password",
      });
      assert.equal(wrong.status, 400);
      assert.equal(
        (await wrong.json()).error.code,
        "CURRENT_PASSWORD_INCORRECT",
      );
      for (const invalid of user.id === users[0].id
        ? [
            { ...input, confirmPassword: "Mismatch-password" },
            { ...input, userId: users[0].id },
            { ...input, newPassword: "short", confirmPassword: "short" },
          ]
        : [])
        assert.equal(
          (await request("/auth/password", first.accessToken, invalid)).status,
          400,
        );
      assert.equal((await request("/auth/me", first.accessToken)).status, 200);
      assert.equal(
        (await request("/auth/password", first.accessToken, input)).status,
        200,
      );
      const changed = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      assert.equal(changed.authVersion, 1);
      assert(await argon2.verify(changed.passwordHash, newPassword));
      assert.equal(
        await argon2.verify(changed.passwordHash, oldPassword),
        false,
      );
      for (const session of [first, second]) {
        assert.equal(
          (await request("/auth/me", session.accessToken)).status,
          401,
        );
        assert.equal(await rotateRefreshToken(session.refreshToken), null);
      }
      // Tokens from before this feature are invalidated too.
      const legacy = jwt.sign(
        { sub: user.id, systemRole: user.systemRole },
        process.env.JWT_ACCESS_SECRET!,
        { expiresIn: "5m" },
      );
      assert.equal((await request("/auth/me", legacy)).status, 401);
      assert.equal(
        (
          await request("/auth/login", undefined, {
            email: user.email,
            password: oldPassword,
          })
        ).status,
        401,
      );
      const login = await request("/auth/login", undefined, {
        email: user.email,
        password: newPassword,
      });
      assert.equal(login.status, 200);
      const loggedIn = await login.json();
      assert.equal(
        (await request("/auth/me", loggedIn.data.accessToken)).status,
        200,
      );
      assert.equal(loggedIn.data.user.passwordHash, undefined);
      const audit = await prisma.auditLog.findMany({
        where: { actorId: user.id, action: "PASSWORD_CHANGED" },
      });
      assert.equal(audit.length, 1);
      for (const secret of [
        oldPassword,
        newPassword,
        passwordHash,
        changed.passwordHash,
      ])
        assert.equal(JSON.stringify(audit).includes(secret), false);
      await assert.rejects(createSession(user.id, undefined, passwordHash), {
        code: "SESSION_REVOKED",
      });
      console.log(
        `PASS password change: ${user.name}, validation, audit, all sessions revoked and new login.`,
      );
    }

    const concurrentUser = users[5];
    const before = await createSession(concurrentUser.id);
    const [changes, refresh] = await Promise.all([
      Promise.allSettled([
        changePassword(concurrentUser.id, 0, input),
        changePassword(concurrentUser.id, 0, {
          ...input,
          newPassword: "Concurrent-password-789",
          confirmPassword: "Concurrent-password-789",
        }),
      ]),
      rotateRefreshToken(before.refreshToken),
    ]);
    assert.equal(
      changes.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      (
        await prisma.user.findUniqueOrThrow({
          where: { id: concurrentUser.id },
        })
      ).authVersion,
      1,
    );
    assert.equal(
      await prisma.refreshToken.count({
        where: { userId: concurrentUser.id, revokedAt: null },
      }),
      0,
    );
    if (refresh) {
      assert.equal(
        (await request("/auth/me", refresh.tokens.accessToken)).status,
        401,
      );
      assert.equal(await rotateRefreshToken(refresh.tokens.refreshToken), null);
    }
    console.log(
      "PASS concurrent password changes and refresh cannot resurrect a revoked session.",
    );

    // A failure after password/session updates must roll the whole transaction back.
    const rollbackUser = users[6];
    const rollbackSession = await createSession(rollbackUser.id);
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION "${schema}".fail_password_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'PASSWORD_CHANGED' THEN RAISE EXCEPTION 'isolated audit failure'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER fail_password_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${schema}".fail_password_audit()`,
    );
    await assert.rejects(changePassword(rollbackUser.id, 0, input));
    const rolledBack = await prisma.user.findUniqueOrThrow({
      where: { id: rollbackUser.id },
    });
    assert.equal(rolledBack.passwordHash, passwordHash);
    assert.equal(rolledBack.authVersion, 0);
    assert.equal(
      (await request("/auth/me", rollbackSession.accessToken)).status,
      200,
    );
    assert.equal(
      await prisma.refreshToken.count({
        where: { userId: rollbackUser.id, revokedAt: null },
      }),
      1,
    );
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER fail_password_audit ON "AuditLog"`,
    );
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION "${schema}".fail_password_audit()`,
    );
    console.log(
      "PASS atomic rollback preserves password and sessions when audit fails.",
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
