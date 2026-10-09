import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createSession } from "../src/modules/auth/auth.service";
import { prisma } from "../src/config/prisma";
import { app } from "../src/app";
const schema = new URL(process.env.DATABASE_URL!).searchParams.get("schema");
if (
  !schema?.startsWith("cash_test_") ||
  process.env.EMAIL_MODE !== "simulation"
)
  throw Error("Isolated audit schema required");
async function main() {
  const users = await Promise.all(
    ["admin", "maker", "approver", "releaser"].map((name, i) =>
      prisma.user.create({
        data: {
          name,
          email: `audit-${name}@example.invalid`,
          phone: `62888888000${i}`,
          passwordHash: "test-only",
        },
      }),
    ),
  );
  const family = await prisma.family.create({
    data: {
      name: "Audit isolated",
      code: randomUUID(),
      createdById: users[0].id,
    },
  });
  await prisma.familyMember.createMany({
    data: users.map((user, i) => ({
      familyId: family.id,
      userId: user.id,
      role: i === 0 || i === 2 ? "ADMIN" : "MEMBER",
    })),
  });
  const { accessToken: token } = await createSession(users[0].id, family.id);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const endpoint = `http://127.0.0.1:${address.port}/api/v1`;
  try {
    for (const route of [
      "ledger",
      "policy",
      "policy-read",
      "cash",
      "registration",
    ]) {
      await prisma.familyMember.update({
        where: {
          familyId_userId: { familyId: family.id, userId: users[0].id },
        },
        data: { role: "ADMIN" },
      });
      let request: Promise<Response> | undefined;
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Family" WHERE id = ${family.id}::uuid FOR UPDATE`;
        assert.equal(
          await tx.familyMember.count({
            where: {
              familyId: family.id,
              userId: { not: users[0].id },
              role: "ADMIN",
              status: "ACTIVE",
            },
          }),
          1,
        );
        await tx.familyMember.update({
          where: {
            familyId_userId: { familyId: family.id, userId: users[0].id },
          },
          data: { role: "MEMBER" },
        });
        const path = route.startsWith("policy")
          ? `/approval-policies/families/${family.id}`
          : route === "registration"
            ? "/management/members"
            : `/${route}`;
        const body =
          route === "registration"
            ? {
                type: "NEW_MEMBER",
                familyId: family.id,
                name: "Queued fixture",
                email: "queued-fixture@example.invalid",
                phone: "6288888820000",
                password: "Temporary-password-123",
                confirmPassword: "Temporary-password-123",
              }
            : route === "ledger"
              ? {
                  idempotencyKey: randomUUID(),
                  direction: "IN",
                  amount: "123",
                  description: "Isolated audit fixture",
                }
              : {
                  expectedVersion: 0,
                  makerIds: [users[1].id],
                  approverIds: [users[2].id],
                  releaserId: users[3].id,
                  reason: "Isolated audit fixture",
                };
        request = fetch(endpoint + path, {
          method:
            route === "cash" || route === "policy-read"
              ? "GET"
              : route === "ledger" || route === "registration"
                ? "POST"
                : "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          ...(route === "cash" || route === "policy-read"
            ? {}
            : { body: JSON.stringify(body) }),
        });
        let waiting = false;
        for (let attempts = 0; attempts < 100; attempts++) {
          const rows = await prisma.$queryRaw<
            { count: bigint }[]
          >`SELECT count(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND state = 'active' AND query LIKE '%Family%FOR UPDATE%'`;
          if (Number(rows[0].count) > 0) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        assert(waiting, "Request did not reach the family lock");
      });
      const response = await request!;
      const payload = await response.json();
      if (route === "registration")
        assert.equal(
          await prisma.user.count({
            where: { email: "queued-fixture@example.invalid" },
          }),
          0,
        );
      if (route === "ledger")
        assert.equal(
          await prisma.ledgerEntry.count({ where: { familyId: family.id } }),
          0,
        );
      if (route.startsWith("policy"))
        assert.equal(
          await prisma.approvalPolicy.count({ where: { familyId: family.id } }),
          0,
        );
      const member = await prisma.familyMember.findUniqueOrThrow({
        where: {
          familyId_userId: { familyId: family.id, userId: users[0].id },
        },
      });
      assert.equal(member.role, "MEMBER");
      assert.equal(response.status, route === "cash" ? 200 : 403);
      if (route !== "cash") assert.equal(payload.error.code, "FORBIDDEN");
      if (route === "cash") assert.equal(payload.data.contributions.length, 1);
      console.log(
        `PASS: ${route} checks current access after the family lock (HTTP ${response.status}).`,
      );
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
main()
  .catch((error) => {
    console.error(
      "Audit failed:",
      error instanceof assert.AssertionError
        ? error.message
        : error.code || error.name,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
