/* Browser regression audit. All API responses are fixtures; never writes production data. */
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE || "playwright-core",
);
const assert = require("node:assert/strict");
const base = process.env.AUDIT_BASE_URL || "http://127.0.0.1:5176";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw new Error("Audit fixture browser must target localhost");
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let role = "SUPER_ADMIN",
      writes = [],
      refreshes = 0,
      expired = false,
      contributionAvailable = "4000000";
    const user = () => ({
      id: uid(1),
      name: "Maria",
      email: "admin@example.test",
      phone: "6281234567890",
      systemRole: role,
      familyRole: "ADMIN",
      familyId: uid(2),
      familyName: "Keluarga Dani",
      families: [{ id: uid(2), name: "Keluarga Dani", role: "ADMIN" }],
    });
    let families = [{ id: uid(2), name: "Keluarga Dani", code: "DANI" }];
    await page.route("**/api/v1/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        p = url.pathname.replace("/api/v1", "");
      let data = [];
      if (p === "/cash")
        data = {
          balance: "10000000",
          availableCash: "10000000",
          reserved: "0",
          contribution: {
            deposited: "4000000",
            withdrawn: "0",
            reserved: "0",
            available: contributionAvailable,
            withdrawable: contributionAvailable,
          },
          loanTotal: "0",
          repaid: "0",
          outstanding: "0",
          familyLoanTotals: { loanTotal: "0", repaid: "0", outstanding: "0" },
          contributions: [],
          requests: [],
          requestsTotal: 0,
        };
      if (p === "/auth/login")
        return route.fulfill({
          status: 401,
          json: { success: false, error: { message: "Unauthorized" } },
        });
      if (p === "/auth/refresh") {
        refreshes++;
        return route.fulfill({
          json: {
            success: true,
            data: {
              accessToken: "fresh",
              refreshToken: "refresh-new",
              user: user(),
            },
          },
        });
      }
      if (expired && req.headers().authorization === "Bearer expired")
        return route.fulfill({
          status: 401,
          json: { success: false, error: { code: "TOKEN_EXPIRED" } },
        });
      if (p === "/auth/me") data = user();
      else if (p === "/cash/contributions") data = { items: [], total: 0 };
      else if (p === "/management/families") data = families;
      else if (
        p === "/management/registrations" ||
        (p === "/management/members" && req.method() === "POST")
      ) {
        const body = req.postDataJSON();
        writes.push(body);
        if (body.type === "NEW_FAMILY")
          families.push({
            id: uid(3),
            name: body.familyName,
            code: body.familyCode,
          });
        data = {
          family: body.type === "NEW_FAMILY" ? families[1] : families[0],
          user: {
            id: uid(5),
            name: body.name || "Rani",
            email: body.email || "rani@example.test",
            phone: body.phone,
          },
          role: "ADMIN",
        };
        return route.fulfill({
          json: {
            success: true,
            data,
            message:
              body.type === "NEW_FAMILY"
                ? "Keluarga dan akun admin berhasil dibuat."
                : "Anggota berhasil ditambahkan.",
          },
        });
      } else if (p === "/management/users")
        data = [
          {
            id: uid(5),
            name: "Rani",
            email: "rani@example.test",
            phone: "6281234567890",
          },
        ];
      else if (p === "/notifications/inbox/unread-count")
        data = { unreadCount: 0 };
      else if (p === "/notifications/inbox")
        data = { items: [], total: 0, unreadCount: 0, page: 1 };
      else if (p === "/notifications/preferences")
        data = {
          phone: "6281234567890",
          email: "admin@example.test",
          mode: "simulation",
        };
      else if (p === "/notifications")
        data = { messages: [], total: 0, page: 1, mode: "simulation" };
      else if (p === "/dashboard/summary")
        data = { balance: 10000000, loans: 0, installments: 0, members: 4 };
      else if (p === "/approvals") data = { items: [], total: 0 };
      else if (p === "/approvals/permissions")
        data = { configured: true, canCreateLoan: true };
      else if (p === "/approval-policies/families") data = families;
      else if (p.startsWith("/approval-policies/families/"))
        data = { family: families[0], policy: null, members: [], history: [] };
      return route.fulfill({ json: { success: true, data } });
    });
    await page.goto(`${base}/`);
    assert.equal(
      await page
        .locator('label[for="login-email"]')
        .evaluate((e) => getComputedStyle(e).fontWeight),
      "500",
    );
    await page.getByLabel("Email", { exact: true }).fill("invalid");
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    await page.getByText("Email belum valid.", { exact: false }).waitFor();
    await page.getByLabel("Email", { exact: true }).fill("wrong@example.test");
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page
      .getByRole("button", { name: "Tampilkan password", exact: true })
      .click();
    assert.equal(
      await page.locator("#login-password").getAttribute("type"),
      "text",
    );
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    await page
      .getByText("Email atau password yang Anda masukkan tidak sesuai.", {
        exact: true,
      })
      .waitFor();
    await page.evaluate(() => {
      localStorage.setItem("dana_access_token", "fixture");
      localStorage.setItem("dana_refresh_token", "refresh-old");
    });
    await page.goto(`${base}/?view=members`);
    await page
      .getByRole("button", { name: "Tambah anggota", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Buat keluarga baru", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Nama lengkap", { exact: true })
      .fill("Rani Kusuma");
    await dialog.getByLabel("Email", { exact: true }).fill("rani@example.test");
    await dialog
      .getByLabel("Nomor telepon", { exact: true })
      .fill("081234567890");
    await dialog
      .getByLabel("Password awal", { exact: true })
      .fill("password123");
    await dialog
      .getByLabel("Konfirmasi password", { exact: true })
      .fill("password456");
    await dialog
      .getByLabel("Nama keluarga", { exact: true })
      .fill("Keluarga Baru");
    await dialog
      .getByLabel("Kode keluarga", { exact: true })
      .fill("keluarga-baru");
    await dialog
      .getByRole("button", { name: "Buat keluarga dan admin", exact: true })
      .click();
    await dialog
      .getByText("Konfirmasi password belum sama dengan password.", {
        exact: true,
      })
      .waitFor();
    assert.equal(writes.length, 0);
    await dialog
      .getByLabel("Konfirmasi password", { exact: true })
      .fill("password123");
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `overflow ${width}`,
      );
      assert.equal(
        await dialog.evaluate(
          (e) => e.getBoundingClientRect().width > innerWidth,
        ),
        false,
        `dialog ${width}`,
      );
    }
    await page.screenshot({
      path: "/tmp/dana-registration-mobile.png",
      fullPage: true,
    });
    await dialog
      .getByRole("button", { name: "Buat keluarga dan admin", exact: true })
      .click();
    await page.getByText(/Keluarga dan akun admin berhasil dibuat/).waitFor();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].type, "NEW_FAMILY");
    await page
      .getByRole("button", { name: "Tambah anggota", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Hubungkan akun", exact: true })
      .first()
      .click();
    await page
      .getByRole("combobox", { name: "Keluarga tujuan", exact: true })
      .fill("Dani");
    const familySearch = page.getByRole("combobox", {
      name: "Keluarga tujuan",
      exact: true,
    });
    await familySearch.fill("tidak-ada-hasil");
    await page.getByText("Keluarga tidak ditemukan", { exact: true }).waitFor();
    await familySearch.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 1);
    assert.equal(await familySearch.getAttribute("aria-expanded"), "false");
    await familySearch.fill("Dani");
    await familySearch.press("ArrowDown");
    await familySearch.press("Enter");
    assert.equal(await familySearch.inputValue(), "Keluarga Dani · DANI");
    assert.equal(await familySearch.getAttribute("aria-expanded"), "false");
    await page.getByLabel("Cari akun", { exact: true }).fill("Rani");
    await page.getByRole("button", { name: /Rani.*rani@example.test/ }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Hubungkan akun", exact: true })
      .last()
      .click();
    await page.getByText(/Akun tetap memakai email/).waitFor();
    assert.equal(writes[1].type, "EXISTING_MEMBER");
    assert.equal("password" in writes[1], false);
    role = "USER";
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const view of [
      "summary",
      "ledger",
      "loans",
      "installments",
      "members",
      "notifications",
      "settings",
      "help",
      "hierarchy",
      "approvals",
    ]) {
      await page.goto(`${base}/?view=${view}`);
      await page.getByRole("main").waitFor();
      await page.waitForTimeout(100);
      for (const width of [1440, 1024, 768, 390]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
          `page ${view} width ${width}`,
        );
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${base}/?view=loans`);
    await page
      .getByRole("button", { name: "Ajukan pinjaman", exact: true })
      .click();
    assert.equal(new URL(page.url()).searchParams.get("view"), "loans");
    await page
      .getByRole("dialog")
      .getByLabel("Total dana yang dibutuhkan", { exact: true })
      .fill("0");
    await page
      .getByRole("dialog")
      .getByLabel("Keterangan / tujuan")
      .fill("Biaya keluarga");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Kirim pengajuan" })
      .click();
    await page
      .getByText("Nominal harus lebih dari Rp0.", { exact: true })
      .first()
      .waitFor();
    const nominal = page
      .getByRole("dialog")
      .getByLabel("Total dana yang dibutuhkan", { exact: true });
    await nominal.fill("");
    await nominal.pressSequentially("1000000");
    assert.equal(await nominal.inputValue(), "1.000.000");
    await nominal.evaluate((e) => e.setSelectionRange(2, 2));
    await nominal.press("Backspace");
    assert.equal(await nominal.inputValue(), "0");
    await nominal.fill("1234567");
    await nominal.evaluate((e) => e.setSelectionRange(1, 1));
    await nominal.press("Delete");
    assert.equal(await nominal.inputValue(), "134.567");
    await nominal.evaluate((e) => {
      e.select();
      const data = new DataTransfer();
      data.setData("text/plain", "Rp6.000.000");
      e.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    assert.equal(await nominal.inputValue(), "6.000.000");
    await page
      .getByRole("dialog")
      .getByText("Pinjaman baru yang harus dikembalikan", { exact: true })
      .waitFor();
    await nominal.evaluate((e) => {
      e.select();
      const data = new DataTransfer();
      data.setData("text/plain", "-1000");
      e.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    assert.equal(await nominal.inputValue(), "6.000.000");
    assert.notEqual(await nominal.evaluate((e) => e.validationMessage), "");
    await nominal.fill("11000000");
    await page
      .getByRole("dialog")
      .getByText("Kas keluarga yang tersedia belum mencukupi", { exact: false })
      .waitFor();
    assert.equal(
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Kirim pengajuan" })
        .isDisabled(),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    await page
      .getByRole("button", { name: "Ajukan pinjaman", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("Total dana yang dibutuhkan", { exact: true })
      .fill("3000000");
    assert.equal(
      await page
        .getByRole("button", { name: "Kirim pengajuan", exact: true })
        .isDisabled(),
      true,
    );
    await page
      .getByRole("button", {
        name: "Gunakan penarikan kontribusi",
        exact: true,
      })
      .click();
    assert.equal(
      await page
        .getByRole("button", { name: "Tarik kontribusi", exact: true })
        .isEnabled(),
      true,
    );
    assert.equal(new URL(page.url()).searchParams.get("view"), "loans");
    await page.keyboard.press("Escape");
    contributionAvailable = "0";
    await page.goto(`${base}/?view=ledger`);
    await page
      .getByRole("button", { name: "Tarik kontribusi", exact: true })
      .click();
    await page
      .getByText("Anda belum memiliki kontribusi yang bisa ditarik.", {
        exact: false,
      })
      .waitFor();
    assert.equal(
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Tarik kontribusi", exact: true })
        .isDisabled(),
      true,
    );
    await page.keyboard.press("Escape");
    contributionAvailable = "4000000";
    expired = true;
    await page.evaluate(() => {
      localStorage.setItem("dana_access_token", "expired");
      localStorage.setItem("dana_refresh_token", "refresh-old");
    });
    await page.goto(`${base}/?view=loans`);
    await page
      .getByRole("button", { name: "Ajukan pinjaman", exact: true })
      .waitFor();
    assert.equal(refreshes, 1);
    await page.goto(`${base}/?view=members`);
    await page
      .getByRole("button", { name: "Tambah anggota", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("Nama lengkap", { exact: true })
      .fill("Draft");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Batal", exact: true })
      .click();
    await page.getByRole("dialog", { name: "Tutup pendaftaran?" }).waitFor();
    await page
      .getByRole("dialog", { name: "Tutup pendaftaran?" })
      .getByRole("button", { name: "Batal", exact: true })
      .click();
    assert.equal(await page.getByRole("dialog").count(), 1);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Batal", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Tutup tanpa menyimpan", exact: true })
      .click();
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: login typography/validation, complete new-family registration, password confirmation, linking without password, 4 viewport widths, 10 pages, cash validation, currency typing/caret/backspace/delete/paste, loan split preview, modal Escape, and refresh session.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
