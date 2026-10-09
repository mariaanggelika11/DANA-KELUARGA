// Real browser -> HTTP API -> isolated PostgreSQL. No real emails or application data.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import argon2 from "argon2";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { requestPasswordReset } from "../src/modules/auth/password-reset.service";
import {
  contribute,
  reviewContribution,
} from "../src/modules/cash/contribution.service";
import { cashSummary } from "../src/modules/cash/cash.service";

const schema = new URL(process.env.DATABASE_URL!).searchParams.get("schema");
if (
  !schema?.startsWith("cash_test_") ||
  process.env.EMAIL_MODE !== "simulation"
)
  throw Error("Isolated browser test schema required");
const web = process.env.AUDIT_BASE_URL ?? "http://localhost:5173";
if (!["localhost", "127.0.0.1"].includes(new URL(web).hostname))
  throw Error("Local frontend required");
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE || "playwright-core",
);
async function main() {
  assert([1440, 390, 320].includes(Number(process.argv[2] ?? 1440)));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const api = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ??
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  try {
    for (const width of [Number(process.argv[2] ?? 1440)]) {
      const password = "Real-browser-fixture-123";
      const recovered = "Real-browser-recovered-456";
      const passwordHash = await argon2.hash(password);
      const member = await prisma.user.create({
        data: {
          name: `Browser member ${width}`,
          email: `browser-member-${width}@example.invalid`,
          phone: `62888111${width}`,
          passwordHash,
        },
      });
      const treasury = await prisma.user.create({
        data: {
          name: `Browser treasury ${width}`,
          email: `browser-treasury-${width}@example.invalid`,
          phone: `62888222${width}`,
          passwordHash,
        },
      });
      const family = await prisma.family.create({
        data: {
          name: `Browser family ${width}`,
          code: randomUUID(),
          createdById: treasury.id,
        },
      });
      await prisma.familyMember.createMany({
        data: [
          { familyId: family.id, userId: member.id, role: "MEMBER" },
          { familyId: family.id, userId: treasury.id, role: "TREASURER" },
        ],
      });
      await prisma.familyBankAccount.create({
        data: {
          familyId: family.id,
          version: 1,
          bankName: "Fixture Bank",
          accountNumber: "1234567",
          accountHolder: "Browser fixture",
          createdById: treasury.id,
        },
      });
      const memberActor = {
        sub: member.id,
        familyId: family.id,
        systemRole: "USER",
        familyRole: "MEMBER",
      };
      const treasuryActor = {
        sub: treasury.id,
        familyId: family.id,
        systemRole: "USER",
        familyRole: "TREASURER",
      };
      const report = await contribute(memberActor, {
        amount: "1000",
        purpose: "Browser fixture deposit",
        idempotencyKey: randomUUID(),
      });
      await reviewContribution(
        treasuryActor,
        report.id,
        "confirm",
        "Fixture verified",
      );
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      // Redirect every browser API call to the isolated server; no fabricated responses.
      await page.route("**/api/v1/**", async (route: any) => {
        const original = new URL(route.request().url());
        const response = await route.fetch({
          url: api + original.pathname + original.search,
        });
        await route.fulfill({ response });
      });
      await page.goto(web);
      await page
        .getByRole("button", { name: "Lupa password?", exact: true })
        .click();
      await page.getByLabel("Email akun", { exact: true }).fill(member.email);
      await page
        .getByRole("button", { name: "Kirim tautan pemulihan", exact: true })
        .click();
      await page.getByText(/Jika email terdaftar pada akun aktif/).waitFor();
      assert.equal(
        await prisma.passwordResetToken.count({
          where: { userId: member.id, usedAt: null },
        }),
        1,
      );
      // Capture a new recovery email with the real service and a test transport.
      await prisma.passwordResetToken.updateMany({
        where: { userId: member.id },
        data: { createdAt: new Date(Date.now() - 61_000) },
      });
      let recoveryLink = "";
      await requestPasswordReset(member.email!, async (email) => {
        recoveryLink = email.text.match(/https?:\/\/[^\s]+/)![0];
      });
      const link = new URL(recoveryLink);
      const token = link.searchParams.get("token")!;
      await page.goto(web + link.pathname + link.search);
      await page.getByLabel("Password baru", { exact: true }).fill(recovered);
      await page
        .getByLabel("Konfirmasi password baru", { exact: true })
        .fill(recovered);
      assert(!page.url().includes(token));
      await page
        .getByRole("button", { name: "Simpan password baru", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Selamat datang kembali." })
        .waitFor();
      await page.getByLabel("Email", { exact: true }).fill(member.email);
      await page.getByLabel("Password", { exact: true }).fill(recovered);
      await page.getByRole("button", { name: "Masuk", exact: true }).click();
      await page.locator(".app-shell").waitFor();
      const accessToken = await page.evaluate(() =>
        localStorage.getItem("dana_access_token"),
      );
      await page.locator(".account-trigger").click();
      await page
        .getByRole("button", { name: "Keluar dari akun", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Selamat datang kembali." })
        .waitFor();
      assert.equal(
        (
          await fetch(api + "/api/v1/auth/me", {
            headers: { Authorization: `Bearer ${accessToken}` },
          })
        ).status,
        401,
      );
      await page.getByLabel("Email", { exact: true }).fill(treasury.email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Masuk", exact: true }).click();
      await page.locator(".app-shell").waitFor();
      await page.goto(web + "/?view=ledger");
      await page
        .getByRole("button", { name: "Koreksi setoran", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Koreksi setoran",
        exact: true,
      });
      await dialog
        .getByLabel("Alasan koreksi (wajib, minimal 5 karakter)", {
          exact: true,
        })
        .fill("Setoran keliru dikonfirmasi pada uji browser");
      await dialog
        .getByRole("button", { name: "Koreksi setoran", exact: true })
        .click();
      await page
        .locator(".confirmation-dialog")
        .getByRole("button", { name: "Koreksi setoran", exact: true })
        .click();
      await page
        .locator(".contribution-reports")
        .getByText("Dikoreksi", { exact: true })
        .waitFor();
      assert.equal(
        (
          await prisma.contributionReport.findUniqueOrThrow({
            where: { id: report.id },
          })
        ).status,
        "REVERSED",
      );
      const summary = await cashSummary(memberActor);
      assert.equal(summary.balance.toString(), "0");
      assert.equal(summary.contribution.available.toString(), "0");
      assert.deepEqual(errors, []);
      assert.equal(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        ),
        false,
      );
      console.log(
        `PASS actual browser/API/database ${width}px: recovery, login, immediate logout, audited contribution reversal and refreshed balances.`,
      );
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
main()
  .catch((error) => {
    console.error("Browser integration failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
