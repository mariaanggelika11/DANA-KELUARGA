import { beforeEach, describe, expect, it, vi } from "vitest";
import nodemailer from "nodemailer";
const db = vi.hoisted(() => ({
  emailMessage: { updateMany: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn() },
  loanInstallment: { findUnique: vi.fn() },
}));
vi.mock("../src/config/prisma", () => ({ prisma: db }));
import { processEmails } from "../src/modules/email/email.service";
import { env } from "../src/config/env";
const message = {
  id: "message",
  eventKey: "APPROVAL:request",
  familyId: "family",
  userId: "recipient",
  subject: "Tugas persetujuan baru",
  body: "Total Rp6.000.000; tarikan Rp4.000.000; pinjaman Rp2.000.000.",
  attempts: 0,
};
beforeEach(() => {
  vi.resetAllMocks();
  env.EMAIL_MODE = "simulation";
  db.emailMessage.findMany.mockResolvedValue([message]);
  db.emailMessage.updateMany.mockResolvedValue({ count: 1 });
  db.user.findUnique.mockResolvedValue({
    email: "account@example.invalid",
    isActive: true,
    memberships: [{}],
  });
});
describe("durable email delivery", () => {
  it("uses the account address and marks simulation honestly", async () => {
    const sender = nodemailer.createTransport({ jsonTransport: true });
    const send = vi.spyOn(sender, "sendMail");
    await processEmails(new Date(), sender);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "account@example.invalid",
        subject: message.subject,
        text: message.body,
      }),
    );
    expect(db.emailMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SIMULATED" }),
      }),
    );
  });
  it("retries delivery failure without changing financial records", async () => {
    const sender = nodemailer.createTransport({ jsonTransport: true });
    vi.spyOn(sender, "sendMail").mockRejectedValue(
      new Error("secret SMTP details"),
    );
    await processEmails(new Date(), sender);
    expect(db.emailMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "QUEUED",
          lastError: expect.not.stringContaining("secret"),
        }),
      }),
    );
  });
  it("stops after five failed attempts", async () => {
    db.emailMessage.findMany.mockResolvedValue([{ ...message, attempts: 4 }]);
    const sender = nodemailer.createTransport({ jsonTransport: true });
    vi.spyOn(sender, "sendMail").mockRejectedValue(new Error("offline"));
    await processEmails(new Date(), sender);
    expect(db.emailMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
  });
  it("does not send to an inactive recipient", async () => {
    db.user.findUnique.mockResolvedValue({
      email: "account@example.invalid",
      isActive: false,
      memberships: [{}],
    });
    const sender = nodemailer.createTransport({ jsonTransport: true });
    const send = vi.spyOn(sender, "sendMail");
    await processEmails(new Date(), sender);
    expect(send).not.toHaveBeenCalled();
  });
  it("does not send a reminder after the installment is paid", async () => {
    db.emailMessage.findMany.mockResolvedValue([
      { ...message, eventKey: "INSTALLMENT_DUE:installment:H" },
    ]);
    db.loanInstallment.findUnique.mockResolvedValue({
      status: "PAID",
      loan: { status: "PAID_OFF" },
    });
    const sender = nodemailer.createTransport({ jsonTransport: true });
    const send = vi.spyOn(sender, "sendMail");
    await processEmails(new Date(), sender);
    expect(send).not.toHaveBeenCalled();
  });
  it("does not process another worker’s claimed message", async () => {
    db.emailMessage.updateMany.mockResolvedValue({ count: 0 });
    await processEmails();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
});
