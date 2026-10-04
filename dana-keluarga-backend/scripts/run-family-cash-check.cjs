// Creates and removes only a randomly named test schema. Never seeds the application schema.
require("dotenv/config");
const { PrismaClient } = require("@prisma/client");
const { spawnSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const prisma = new PrismaClient();
(async () => {
  const schema = `cash_test_${randomBytes(6).toString("hex")}`;
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set("schema", schema);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  try {
    const env = {
      ...process.env,
      DATABASE_URL: url.toString(),
      EMAIL_MODE: "simulation",
    };
    for (const [command, args] of [
      ["./node_modules/.bin/prisma", ["migrate", "deploy"]],
      ["./node_modules/.bin/tsx", ["scripts/verify-family-cash.ts"]],
    ]) {
      const result = spawnSync(command, args, {
        env,
        encoding: "utf8",
        timeout: 180000,
      });
      if (result.status !== 0)
        throw new Error(
          `Isolated ${args[0]} failed: ${result.stderr || result.stdout}`,
        );
      console.log(
        args[0] === "migrate"
          ? "Test schema migrations passed"
          : result.stdout.trim(),
      );
    }
  } finally {
    await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    console.log("Test schema removed");
  }
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
