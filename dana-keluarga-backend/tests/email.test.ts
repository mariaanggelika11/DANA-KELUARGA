import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({
  db: {
    emailMessage: {
      updateMany: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      createMany: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    loanInstallment: { findUnique: vi.fn() },
  },
  resendSend: vi.fn(),
  sendMail: vi.fn(),
}));
const db = mocks.db;
vi.mock("../src/config/prisma", () => ({ prisma: mocks.db }));
// Never reach a real provider from tests.
vi.mock("resend", () => ({
  Resend: vi.fn(() => ({ emails: { send: mocks.resendSend } })),
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: mocks.sendMail })) },
}));
import {
  EmailDeliveryError,
  defaultSender,
  processEmails,
  queueEmail,
  resendSender,
  smtpSender,
} from "../src/modules/email/email.service";
import { renderEmail } from "../src/modules/email/email.templates";
import { env } from "../src/config/env";
const message = {
  id: "message",
  eventKey: "APPROVAL:request",
  familyId: "family",
  userId: "recipient",
  subject: "Tugas persetujuan baru",
  body: "Total Rp6.000.000; tarikan Rp4.000.000; pinjaman Rp2.000.000. http://localhost:5173/?view=approvals",
  attempts: 0,
};
const lastUpdate = () => db.emailMessage.update.mock.calls.at(-1)![0].data;
beforeEach(() => {
  vi.resetAllMocks();
  env.EMAIL_MODE = "simulation";
  env.EMAIL_FROM = "Dana Keluarga <no-reply@example.com>";
  env.EMAIL_REPLY_TO = undefined;
  env.PUBLIC_APP_URL = undefined;
  db.emailMessage.findMany.mockResolvedValue([message]);
  db.emailMessage.updateMany.mockResolvedValue({ count: 1 });
  db.emailMessage.createMany.mockResolvedValue({ count: 1 });
  db.user.findUnique.mockResolvedValue({
    email: "account@example.invalid",
    isActive: true,
    memberships: [{}],
  });
});

describe("durable email delivery", () => {
  it("records simulation honestly without contacting a provider", async () => {
    await processEmails(new Date(), null);
    expect(lastUpdate()).toMatchObject({ status: "SIMULATED" });
    expect(mocks.sendMail).not.toHaveBeenCalled();
    expect(mocks.resendSend).not.toHaveBeenCalled();
  });
  it("sends HTML and text to the account address with the event key as idempotency key", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await processEmails(new Date(), send);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "account@example.invalid",
        subject: message.subject,
        text: message.body,
        html: expect.stringContaining(
          'href="http://localhost:5173/?view=approvals"',
        ),
        idempotencyKey: message.eventKey,
      }),
    );
    expect(lastUpdate()).toMatchObject({ status: "SENT", lastError: null });
  });
  it("retries delivery failure without storing raw provider details", async () => {
    await processEmails(
      new Date(),
      vi.fn().mockRejectedValue(new Error("secret SMTP details")),
    );
    expect(lastUpdate()).toMatchObject({
      status: "QUEUED",
      lastError: expect.not.stringContaining("secret"),
    });
  });
  it("stops after five failed attempts", async () => {
    db.emailMessage.findMany.mockResolvedValue([{ ...message, attempts: 4 }]);
    await processEmails(
      new Date(),
      vi.fn().mockRejectedValue(new Error("offline")),
    );
    expect(lastUpdate()).toMatchObject({ status: "FAILED" });
  });
  it("fails permanent provider errors immediately", async () => {
    await processEmails(
      new Date(),
      vi
        .fn()
        .mockRejectedValue(
          new EmailDeliveryError("Resend validation_error: bad sender", true),
        ),
    );
    expect(lastUpdate()).toMatchObject({
      status: "FAILED",
      lastError: "Resend validation_error: bad sender",
    });
  });
  it("does not send to an inactive recipient", async () => {
    db.user.findUnique.mockResolvedValue({
      email: "account@example.invalid",
      isActive: false,
      memberships: [{}],
    });
    const send = vi.fn();
    await processEmails(new Date(), send);
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
    const send = vi.fn();
    await processEmails(new Date(), send);
    expect(send).not.toHaveBeenCalled();
  });
  it("does not process another worker’s claimed message", async () => {
    db.emailMessage.updateMany.mockResolvedValue({ count: 0 });
    await processEmails();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
  it("does not mark real delivery as simulated when the sender is missing", async () => {
    env.EMAIL_MODE = "smtp";
    await expect(processEmails(new Date(), null)).rejects.toMatchObject({
      permanent: true,
    });
    expect(db.emailMessage.update).not.toHaveBeenCalled();
  });
  it("cancels a queued reminder while the transfer is awaiting review", async () => {
    db.emailMessage.findMany.mockResolvedValue([
      { ...message, eventKey: "INSTALLMENT_DUE:installment:H" },
    ]);
    db.loanInstallment.findUnique.mockResolvedValue({
      status: "UNPAID",
      loan: { status: "ACTIVE" },
      payments: [{ id: "pending-payment" }],
    });
    const send = vi.fn();
    await processEmails(new Date(), send);
    expect(send).not.toHaveBeenCalled();
    expect(lastUpdate()).toMatchObject({
      status: "CANCELLED",
      lastError: "Pembayaran menunggu pemeriksaan pengelola dana.",
    });
  });
  it("scopes a real email check to its own outbox record", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await processEmails(new Date(), send, { messageId: "test-message" });
    expect(db.emailMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "test-message",
          status: "QUEUED",
        }),
      }),
    );
    expect(db.emailMessage.updateMany.mock.calls[0][0].where.id).toBe(
      "test-message",
    );
  });
});

describe("email scope", () => {
  const tx = db as unknown as Prisma.TransactionClient;
  const data = {
    eventKey: "e",
    familyId: "f",
    userId: "u",
    subject: "s",
    body: "b",
  };
  it("keeps family cash events in the inbox only", async () => {
    await queueEmail(tx, data, "CONTRIBUTION");
    await queueEmail(tx, { ...data, eventKey: "w" }, "WITHDRAWAL");
    expect(
      db.emailMessage.createMany.mock.calls.map(
        ([args]) => args.data[0].status,
      ),
    ).toEqual(["CANCELLED", "CANCELLED"]);
  });
  it("queues billing, loan request and approval emails", async () => {
    for (const kind of [
      "INSTALLMENT_DUE",
      "LOAN_REQUESTED",
      "LOAN_APPROVED",
      "PAYMENT_REPORTED",
      "PAYMENT_REJECTED",
      undefined,
    ])
      await queueEmail(tx, { ...data, eventKey: String(kind) }, kind);
    expect(
      db.emailMessage.createMany.mock.calls.map(
        ([args]) => args.data[0].status,
      ),
    ).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("provider selection", () => {
  it("picks the sender from EMAIL_MODE", () => {
    env.EMAIL_MODE = "smtp";
    expect(defaultSender()).toBe(smtpSender);
    env.EMAIL_MODE = "resend";
    expect(defaultSender()).toBe(resendSender);
    env.EMAIL_MODE = "simulation";
    expect(defaultSender()).toBeNull();
  });
});

describe("SMTP adapter (Brevo)", () => {
  const email = {
    id: "id",
    to: "a@example.com",
    subject: "s",
    html: "<p>h</p>",
    text: "t",
    idempotencyKey: "key",
  };
  it("sends from EMAIL_FROM with HTML and text", async () => {
    env.EMAIL_REPLY_TO = "pengelola@example.com";
    mocks.sendMail.mockResolvedValue({});
    await smtpSender(email);
    expect(mocks.sendMail).toHaveBeenCalledWith({
      from: env.EMAIL_FROM,
      replyTo: "pengelola@example.com",
      to: "a@example.com",
      subject: "s",
      html: "<p>h</p>",
      text: "t",
      messageId: "<id@dana-keluarga.local>",
    });
  });
  it("treats rejected credentials and 5xx replies as permanent, connection errors as transient", async () => {
    mocks.sendMail.mockRejectedValue(
      Object.assign(new Error("535 auth"), {
        code: "EAUTH",
        responseCode: 535,
      }),
    );
    await expect(smtpSender(email)).rejects.toMatchObject({ permanent: true });
    mocks.sendMail.mockRejectedValue(
      Object.assign(new Error("550"), { code: "EENVELOPE", responseCode: 550 }),
    );
    await expect(smtpSender(email)).rejects.toMatchObject({ permanent: true });
    const offline = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    mocks.sendMail.mockRejectedValue(offline);
    await expect(smtpSender(email)).rejects.toBe(offline);
  });
});

describe("Resend adapter", () => {
  const email = {
    id: "id",
    to: "a@example.com",
    subject: "s",
    html: "<p>h</p>",
    text: "t",
    idempotencyKey: "key",
  };
  it("passes sender, reply-to and idempotency key", async () => {
    mocks.resendSend.mockResolvedValue({ data: { id: "re_1" }, error: null });
    await expect(resendSender(email)).resolves.toBeUndefined();
    expect(mocks.resendSend).toHaveBeenCalledWith(
      {
        from: env.EMAIL_FROM,
        replyTo: undefined,
        to: "a@example.com",
        subject: "s",
        html: "<p>h</p>",
        text: "t",
      },
      { idempotencyKey: "key" },
    );
  });
  it("classifies 4xx as permanent but rate limits and server errors as transient", async () => {
    for (const [statusCode, permanent] of [
      [422, true],
      [403, true],
      [429, false],
      [409, false],
      [500, false],
      [null, false],
    ] as const) {
      mocks.resendSend.mockResolvedValue({
        data: null,
        error: { name: "validation_error", message: "x", statusCode },
      });
      await expect(resendSender(email)).rejects.toMatchObject({ permanent });
    }
  });
});

describe("email template", () => {
  it("escapes content and turns the first link into a button", () => {
    const { html, text } = renderEmail(
      "Pinjaman <b>",
      "Halo <script>, disetujui. Lihat: http://localhost:5173/?view=loans&x=1",
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("Pinjaman &lt;b&gt;");
    expect(html).toContain('href="http://localhost:5173/?view=loans&amp;x=1"');
    expect(text).toContain("http://localhost:5173/?view=loans&x=1");
  });
});

it("replaces old queued localhost app links with the configured public email URL", async () => {
  env.PUBLIC_APP_URL = "https://dana.bulmar.tech";
  const send = vi.fn().mockResolvedValue(undefined);
  await processEmails(new Date(), send);
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      text: expect.stringContaining("https://dana.bulmar.tech/?view=approvals"),
      html: expect.not.stringContaining("localhost"),
    }),
  );
});

it("omits localhost links from real email until the public app URL is configured", async () => {
  env.EMAIL_MODE = "resend";
  const send = vi.fn().mockResolvedValue(undefined);
  await processEmails(new Date(), send);
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      text: expect.not.stringContaining("localhost"),
      html: expect.not.stringContaining('href="http://localhost'),
    }),
  );
  expect(lastUpdate()).toMatchObject({ status: "SENT" });
});
