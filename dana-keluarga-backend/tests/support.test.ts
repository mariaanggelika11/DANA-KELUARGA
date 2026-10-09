import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ user: { findUnique: vi.fn() } }));
vi.mock("../src/config/prisma", () => ({ prisma: db }));
import {
  sendSupportRequest,
  supportSchema,
} from "../src/modules/support/support.service";
beforeEach(() => {
  vi.resetAllMocks();
  db.user.findUnique.mockResolvedValue({
    name: "Anggota",
    email: "member@example.com",
    isActive: true,
    systemRole: "USER",
    memberships: [
      { familyId: "other", role: "ADMIN", family: { name: "Lain" } },
      { familyId: "family", role: "TREASURER", family: { name: "Keluarga" } },
    ],
  });
});
describe("support requests", () => {
  it("validates content and refuses injected recipients or identities", () => {
    expect(
      supportSchema.parse({ message: "  Kendala membuka kas  " }).message,
    ).toBe("Kendala membuka kas");
    for (const input of [
      { message: " " },
      { message: "short" },
      { message: "x".repeat(5001) },
      { message: "Kendala membuka kas", to: "other@example.com" },
      { message: "Kendala membuka kas", userId: "other" },
    ]) {
      expect(supportSchema.safeParse(input).success).toBe(false);
    }
  });
  it("uses the fixed recipient and trusted account identity with only the active family", async () => {
    const sender = vi.fn().mockResolvedValue(undefined);
    await sendSupportRequest(
      "user",
      "family",
      "Kendala <script>alert(1)</script>",
      sender,
    );
    const email = sender.mock.calls[0][0];
    expect(email).toMatchObject({
      to: "aglkamaria086@gmail.com",
      replyTo: "member@example.com",
      subject: "[Butuh Bantuan] Kendala pengguna Dana Keluarga",
    });
    expect(email.text).toContain("Peran: Pengelola dana");
    expect(email.text).toContain("Keluarga: Keluarga");
    expect(email.text).not.toContain("Keluarga: Lain");
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });
  it("supports logged in accounts without a family", async () => {
    const sender = vi.fn().mockResolvedValue(undefined);
    await sendSupportRequest(
      "user",
      undefined,
      "Kendala membuka aplikasi",
      sender,
    );
    expect(sender.mock.calls[0][0].text).toContain("Tidak ada keluarga aktif");
  });
  it("rejects inactive accounts without sending", async () => {
    db.user.findUnique.mockResolvedValue({ isActive: false });
    const sender = vi.fn();
    await expect(
      sendSupportRequest("user", "family", "Kendala aplikasi", sender),
    ).rejects.toMatchObject({ status: 401 });
    expect(sender).not.toHaveBeenCalled();
  });
  it("does not report success when no real sender is available", async () => {
    await expect(
      sendSupportRequest("user", "family", "Kendala aplikasi", null),
    ).rejects.toMatchObject({ code: "SUPPORT_UNAVAILABLE", status: 503 });
  });
  it("does not expose transport details on failed delivery", async () => {
    await expect(
      sendSupportRequest(
        "user",
        "family",
        "Kendala aplikasi",
        vi.fn().mockRejectedValue(new Error("secret credentials")),
      ),
    ).rejects.toMatchObject({
      code: "SUPPORT_DELIVERY_FAILED",
      status: 503,
      message: "Pesan bantuan belum berhasil dikirim. Silakan coba lagi nanti.",
    });
  });
});
