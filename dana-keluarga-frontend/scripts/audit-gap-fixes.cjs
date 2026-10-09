/* API fixtures only: these browser checks never touch application data. */
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE || "playwright-core",
);
const assert = require("node:assert/strict");
const base = process.env.AUDIT_BASE_URL || "http://127.0.0.1:5173";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("Local audit required");
const bank = {
  bankName: "BNI",
  accountNumber: "1234567",
  accountHolder: "Keluarga Contoh",
};
const user = (role = "MEMBER") => ({
  id: "fixture-user",
  name: "Anggota Contoh",
  email: "fixture@example.invalid",
  phone: "6288880000",
  systemRole: "USER",
  familyRole: role,
  familyId: "fixture-family",
  familyName: "Keluarga Contoh",
  families: [],
});
const contribution = {
  deposited: "1000",
  withdrawn: "0",
  reserved: "0",
  available: "1000",
  withdrawable: "1000",
};
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  try {
    for (const width of [1440, 390, 320])
      for (const mode of ["request", "reset", "contribution"]) {
        const context = await browser.newContext({
          viewport: { width, height: 1000 },
        });
        if (mode === "contribution")
          await context.addInitScript(() =>
            localStorage.setItem("dana_access_token", "fixture-only"),
          );
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (err) => errors.push(err.message));
        let posts = 0,
          changed = false;
        const report = () => ({
          id: "fixture-report",
          amount: "1000",
          purpose: "Setoran anggota",
          status: changed ? "REVERSED" : "CONFIRMED",
          createdAt: "2026-10-09T08:00:00Z",
          reviewedAt: "2026-10-09T08:10:00Z",
          reviewNotes: "Dana masuk",
          reviewedBy: { name: "Pengelola Contoh" },
          reversedAt: changed ? "2026-10-09T08:30:00Z" : null,
          reversedBy: changed ? { name: "Pengelola Contoh" } : null,
          reversalReason: changed ? "Setoran salah dikonfirmasi" : null,
          user: { name: "Penyetor Contoh" },
          bankAccount: bank,
          canReview: false,
          canReverse: !changed,
        });
        await page.route("**/api/v1/**", async (route) => {
          const req = route.request(),
            path = new URL(req.url()).pathname.replace("/api/v1", "");
          if (req.method() === "POST") {
            posts++;
            if (mode === "request") {
              assert.equal(path, "/auth/forgot-password");
              assert.deepEqual(req.postDataJSON(), {
                email: "fixture@example.invalid",
              });
            } else if (mode === "reset") {
              assert.equal(path, "/auth/reset-password");
              assert.deepEqual(req.postDataJSON(), {
                token: "a".repeat(64),
                newPassword: "New-fixture-password",
                confirmPassword: "New-fixture-password",
              });
            } else {
              assert.equal(path, "/cash/contributions/fixture-report/reverse");
              assert.deepEqual(req.postDataJSON(), {
                reason: "Setoran salah dikonfirmasi",
              });
              changed = true;
            }
            return route.fulfill({
              json: {
                success: true,
                message:
                  mode === "request"
                    ? "Jika email terdaftar pada akun aktif, tautan pemulihan akan dikirim. Periksa inbox dan folder spam."
                    : mode === "reset"
                      ? "Password berhasil dipulihkan."
                      : "Setoran dikoreksi. Kas dan kontribusi diperbarui; riwayat asli tetap tersimpan.",
              },
            });
          }
          assert.equal(req.method(), "GET");
          let data = [];
          if (path === "/auth/me") data = user("TREASURER");
          if (path === "/cash/contributions")
            data = { items: [report()], total: 1 };
          if (path === "/cash")
            data = {
              balance: changed ? "0" : "1000",
              reserved: "0",
              availableCash: changed ? "0" : "1000",
              contribution: changed
                ? {
                    ...contribution,
                    deposited: "0",
                    available: "0",
                    withdrawable: "0",
                  }
                : contribution,
              loanTotal: "0",
              repaid: "0",
              outstanding: "0",
              familyLoanTotals: {
                loanTotal: "0",
                repaid: "0",
                outstanding: "0",
              },
              contributions: [],
              requests: [],
              requestsTotal: 0,
            };
          if (path === "/dashboard/summary")
            data = {
              balance: "1000",
              loans: "0",
              installments: "0",
              members: 3,
            };
          if (path === "/approvals/permissions")
            data = { configured: true, canCreateLoan: false };
          if (path === "/notifications/inbox/unread-count")
            data = { unreadCount: 0 };
          return route.fulfill({
            json: {
              success: true,
              data,
              pagination: { total: 0, page: 1, pageSize: 20 },
            },
          });
        });
        await page.goto(
          base +
            (mode === "reset"
              ? "/?view=reset-password&token=" + "a".repeat(64)
              : mode === "contribution"
                ? "/?view=ledger"
                : "/"),
        );
        if (mode === "request") {
          await page
            .getByRole("button", { name: "Lupa password?", exact: true })
            .click();
          await page
            .getByLabel("Email akun", { exact: true })
            .fill("fixture@example.invalid");
          await page
            .getByRole("button", {
              name: "Kirim tautan pemulihan",
              exact: true,
            })
            .click();
          await page.getByText(/Jika email terdaftar/).waitFor();
          await page
            .getByRole("button", {
              name: "Kembali ke halaman masuk",
              exact: true,
            })
            .click();
          await page
            .getByRole("heading", { name: "Selamat datang kembali." })
            .waitFor();
        } else if (mode === "reset") {
          await page
            .getByLabel("Password baru", { exact: true })
            .fill("New-fixture-password");
          await page
            .getByLabel("Konfirmasi password baru", { exact: true })
            .fill("Wrong-fixture-password");
          assert(!page.url().includes("token="));
          await page
            .getByRole("button", { name: "Simpan password baru", exact: true })
            .click();
          await page
            .getByText("Konfirmasi password belum sama dengan password baru.", {
              exact: true,
            })
            .waitFor();
          assert.equal(posts, 0);
          await page
            .getByLabel("Konfirmasi password baru", { exact: true })
            .fill("New-fixture-password");
          await page
            .getByRole("button", { name: "Simpan password baru", exact: true })
            .click();
          await page
            .getByRole("heading", { name: "Selamat datang kembali." })
            .waitFor();
          await page
            .getByText("Password berhasil diperbarui", { exact: true })
            .waitFor();
          assert.equal(
            await page.evaluate(() =>
              localStorage.getItem("dana_access_token"),
            ),
            null,
          );
        } else {
          await page
            .getByRole("button", { name: "Koreksi setoran", exact: true })
            .click();
          const dialog = page.getByRole("dialog", {
            name: "Koreksi setoran",
            exact: true,
          });
          assert(
            await dialog
              .getByRole("button", { name: "Koreksi setoran", exact: true })
              .isDisabled(),
          );
          await dialog
            .getByLabel("Alasan koreksi (wajib, minimal 5 karakter)", {
              exact: true,
            })
            .fill("Setoran salah dikonfirmasi");
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
          await page
            .getByText("Alasan koreksi: Setoran salah dikonfirmasi", {
              exact: true,
            })
            .waitFor();
          assert.equal(
            await page
              .getByRole("button", { name: "Koreksi setoran", exact: true })
              .count(),
            0,
          );
        }
        assert.equal(posts, 1);
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
          `PASS: ${mode} at ${width}px; validation, state and layout.`,
        );
        await context.close();
      }
    const context = await browser.newContext();
    await context.addInitScript(() =>
      localStorage.setItem("dana_access_token", "fixture-only"),
    );
    const page = await context.newPage();
    let canCreateLoan = false,
      reads = 0;
    await page.route("**/api/v1/**", async (route) => {
      assert.equal(route.request().method(), "GET");
      const path = new URL(route.request().url()).pathname.replace(
        "/api/v1",
        "",
      );
      let data = [];
      if (path === "/auth/me") data = user();
      if (path === "/dashboard/summary")
        data = { balance: "0", loans: "0", installments: "0", members: 1 };
      if (path === "/notifications/inbox/unread-count")
        data = { unreadCount: 0 };
      if (path === "/approvals/permissions") {
        reads++;
        data = { configured: true, canCreateLoan };
      }
      await route.fulfill({
        json: {
          success: true,
          data,
          pagination: { total: 0, page: 1, pageSize: 20 },
        },
      });
    });
    await page.goto(base + "/?view=loans");
    await page.getByText(/Pengajuan hanya tersedia untuk Maker/).waitFor();
    canCreateLoan = true;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page
      .getByRole("button", { name: "Ajukan pinjaman", exact: true })
      .waitFor();
    assert(reads >= 2);
    canCreateLoan = false;
    await page
      .getByText(/Pengajuan hanya tersedia untuk Maker/)
      .waitFor({ timeout: 20000 });
    assert.equal(
      await page
        .getByRole("button", { name: "Ajukan pinjaman", exact: true })
        .count(),
      0,
    );
    console.log(
      "PASS: maker permission grant/removal refreshes after focus and periodic polling.",
    );
    await context.close();
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
