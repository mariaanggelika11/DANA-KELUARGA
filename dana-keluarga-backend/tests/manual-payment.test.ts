import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  familyMember: { findUnique: vi.fn(), findMany: vi.fn() },
  familyBankAccount: { findFirst: vi.fn(), create: vi.fn() },
  loanInstallment: { findFirst: vi.fn(), update: vi.fn(), aggregate: vi.fn() },
  payment: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  },
  loan: { update: vi.fn() },
  fundRequest: { updateMany: vi.fn(), aggregate: vi.fn() },
  ledgerEntry: { groupBy: vi.fn(), create: vi.fn() },
  auditLog: { create: vi.fn() },
  notification: { create: vi.fn() },
  emailMessage: { createMany: vi.fn(), updateMany: vi.fn() },
}));
vi.mock("../src/config/prisma", () => ({ prisma: db }));
import {
  reportTransfer,
  reviewTransfer,
  saveBankAccount,
} from "../src/modules/payments/payment.service";
import {
  bankAccountSchema,
  transferSchema,
  financialInstallmentStatus,
  installmentPaymentStatus,
} from "../src/modules/payments/payment.rules";
const uid = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const borrower = {
  sub: uid(1),
  familyId: uid(2),
  familyRole: "MEMBER",
  systemRole: "USER",
};
const manager = { ...borrower, sub: uid(3), familyRole: "TREASURER" };
const account = {
  id: uid(4),
  familyId: borrower.familyId,
  version: 1,
  bankName: "BCA",
  accountNumber: "0012345678",
  accountHolder: "Dana keluarga",
};
const installment = {
  id: uid(5),
  loanId: uid(6),
  status: "UNPAID",
  remainingAmount: new Prisma.Decimal(500000),
  paidAmount: new Prisma.Decimal(0),
  dueDate: new Date("2999-01-01"),
  installmentNumber: 1,
  loan: {
    id: uid(6),
    familyId: borrower.familyId,
    borrowerId: borrower.sub,
    disbursedAt: new Date("2026-01-01"),
    status: "ACTIVE",
    borrower: { name: "Reni" },
    family: { name: "Keluarga A" },
  },
};
const input = {
  idempotencyKey: uid(7),
  bankAccountId: account.id,
  amount: "500000",
  transferredAt: new Date("2026-02-01T03:00:00Z"),
  transferReference: "REF-123",
  transferNotes: "Dari rekening Reni",
};
const payment = {
  id: uid(8),
  ...input,
  amount: new Prisma.Decimal(input.amount),
  externalId: `manual-${input.idempotencyKey}`,
  familyId: borrower.familyId,
  loanId: installment.loanId,
  installmentId: installment.id,
  payerId: borrower.sub,
  provider: "MANUAL",
  status: "PENDING",
  installment,
  loan: installment.loan,
};
beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async (input) =>
    typeof input === "function" ? input(db) : Promise.all(input),
  );
  db.familyMember.findUnique.mockImplementation(async ({ where }) => ({
    status: "ACTIVE",
    role: where.familyId_userId.userId === manager.sub ? "TREASURER" : "MEMBER",
    user: { isActive: true, systemRole: "USER" },
  }));
  db.familyMember.findMany.mockResolvedValue([{ userId: manager.sub }]);
  db.familyBankAccount.findFirst.mockResolvedValue(account);
  db.familyBankAccount.create.mockResolvedValue({ ...account, version: 2 });
  db.loanInstallment.findFirst.mockResolvedValue(installment);
  db.payment.findUnique.mockResolvedValue(null);
  db.payment.findFirst.mockResolvedValue(null);
  db.payment.create.mockResolvedValue(payment);
  db.payment.findUniqueOrThrow.mockResolvedValue(payment);
  db.payment.update.mockResolvedValue({ ...payment, status: "SUCCESS" });
  db.loanInstallment.aggregate.mockResolvedValue({
    _sum: { remainingAmount: new Prisma.Decimal(0) },
  });
  db.ledgerEntry.groupBy.mockResolvedValue([]);
  db.ledgerEntry.create.mockResolvedValue({ id: uid(9) });
  db.emailMessage.createMany.mockResolvedValue({ count: 1 });
});
describe("family bank account configuration", () => {
  const bank = {
    expectedVersion: 1,
    bankName: "BCA",
    accountNumber: "0012345678",
    accountHolder: "Dana keluarga",
  };
  it("preserves leading zeroes and rejects malformed account numbers", () => {
    expect(bankAccountSchema.parse(bank).accountNumber).toBe("0012345678");
    expect(
      bankAccountSchema.safeParse({ ...bank, accountNumber: "123abc" }).success,
    ).toBe(false);
  });
  it("allows only the family's current fund manager, including after role revocation", async () => {
    await expect(saveBankAccount(borrower, bank)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    db.familyMember.findUnique.mockResolvedValue({
      status: "ACTIVE",
      role: "MEMBER",
      user: { isActive: true, systemRole: "USER" },
    });
    await expect(saveBankAccount(manager, bank)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(db.familyBankAccount.create).not.toHaveBeenCalled();
  });
  it("creates an audited new version instead of editing a previous destination", async () => {
    await saveBankAccount(manager, bank);
    expect(db.familyBankAccount.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          familyId: manager.familyId,
          version: 2,
          accountNumber: "0012345678",
        }),
      }),
    );
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "FAMILY_BANK_ACCOUNT_CHANGED",
        }),
      }),
    );
  });
  it("rejects a stale editor version", async () => {
    await expect(
      saveBankAccount(manager, { ...bank, expectedVersion: 0 }),
    ).rejects.toMatchObject({ code: "ACCOUNT_CHANGED" });
    expect(db.familyBankAccount.create).not.toHaveBeenCalled();
  });
});
describe("borrower transfer reporting", () => {
  const simple = {
    idempotencyKey: uid(7),
    bankAccountId: account.id,
    expectedRemainingAmount: "500000",
  };
  it("reports the remaining balance with one click, without inventing bank evidence", async () => {
    expect(transferSchema.parse(simple)).toEqual(simple);
    await reportTransfer(borrower, installment.loanId, installment.id, simple);
    expect(db.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: "500000",
        status: "PENDING",
        transferredAt: null,
        transferReference: null,
      }),
    });
    expect(db.loanInstallment.update).not.toHaveBeenCalled();
    expect(db.ledgerEntry.create).not.toHaveBeenCalled();
  });
  it("allows a simple retry after confirmation without generating another payment", async () => {
    db.payment.findUnique.mockResolvedValue({
      ...payment,
      status: "SUCCESS",
      transferredAt: null,
      transferReference: null,
      transferNotes: "",
    });
    db.loanInstallment.findFirst.mockResolvedValue({
      ...installment,
      remainingAmount: new Prisma.Decimal(0),
      loan: { ...installment.loan, status: "PAID_OFF" },
    });
    expect(
      (
        await reportTransfer(
          borrower,
          installment.loanId,
          installment.id,
          simple,
        )
      ).status,
    ).toBe("SUCCESS");
    expect(db.payment.create).not.toHaveBeenCalled();
  });
  it("blocks an outdated balance and duplicate pending simple reports", async () => {
    await expect(
      reportTransfer(borrower, installment.loanId, installment.id, {
        ...simple,
        expectedRemainingAmount: "499999",
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_CONFLICT" });
    db.payment.findFirst.mockResolvedValueOnce(payment);
    await expect(
      reportTransfer(borrower, installment.loanId, installment.id, simple),
    ).rejects.toMatchObject({ code: "PAYMENT_PENDING" });
    expect(db.payment.create).not.toHaveBeenCalled();
  });
  it("records a pending report and notifies managers without changing cash or debt", async () => {
    await reportTransfer(borrower, installment.loanId, installment.id, input);
    expect(db.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payerId: borrower.sub,
        familyId: borrower.familyId,
        provider: "MANUAL",
        bankAccountId: account.id,
      }),
    });
    expect(db.loanInstallment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: installment.id,
          loanId: installment.loanId,
          loan: { familyId: borrower.familyId, borrowerId: borrower.sub },
        },
      }),
    );
    expect(db.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: manager.sub,
          title: "Transfer cicilan menunggu pemeriksaan",
        }),
      }),
    );
    expect(db.emailMessage.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            userId: manager.sub,
            familyId: borrower.familyId,
            eventKey: `PAYMENT_REPORTED:${payment.id}:${manager.sub}`,
            subject: "Transfer cicilan menunggu pemeriksaan",
          }),
        ],
        skipDuplicates: true,
      }),
    );
    expect(db.ledgerEntry.create).not.toHaveBeenCalled();
    expect(db.loanInstallment.update).not.toHaveBeenCalled();
  });
  it("does not let even a fund manager report someone else's payment", async () => {
    db.loanInstallment.findFirst.mockResolvedValue(null);
    await expect(
      reportTransfer(manager, installment.loanId, installment.id, input),
    ).rejects.toMatchObject({ code: "OWN_PAYMENT_REQUIRED" });
    expect(db.payment.create).not.toHaveBeenCalled();
  });
  it("makes an identical report retry idempotent and rejects changed payloads", async () => {
    db.payment.findUnique.mockResolvedValue(payment);
    expect(
      await reportTransfer(borrower, installment.loanId, installment.id, input),
    ).toEqual(payment);
    await expect(
      reportTransfer(borrower, installment.loanId, installment.id, {
        ...input,
        amount: "499999",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(db.payment.create).not.toHaveBeenCalled();
  });
  it("rejects excessive amounts, an unrelated bank account, a pending report, and duplicate references", async () => {
    await expect(
      reportTransfer(borrower, installment.loanId, installment.id, {
        ...input,
        amount: "500001",
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_CONFLICT" });
    db.familyBankAccount.findFirst.mockResolvedValueOnce(null);
    await expect(
      reportTransfer(borrower, installment.loanId, installment.id, input),
    ).rejects.toMatchObject({ code: "BANK_ACCOUNT_REQUIRED" });
    db.payment.findFirst.mockResolvedValueOnce(payment);
    await expect(
      reportTransfer(borrower, installment.loanId, installment.id, input),
    ).rejects.toMatchObject({ code: "PAYMENT_PENDING" });
    db.payment.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(payment);
    await expect(
      reportTransfer(borrower, installment.loanId, installment.id, input),
    ).rejects.toMatchObject({ code: "DUPLICATE_TRANSFER" });
    expect(db.payment.create).not.toHaveBeenCalled();
  });
  it("rejects future transfer times and records references consistently", () => {
    const parsed = transferSchema.parse({
      ...input,
      transferReference: " ref-123 ",
    });
    expect("transferReference" in parsed && parsed.transferReference).toBe(
      "REF-123",
    );
    expect(
      transferSchema.safeParse({
        ...input,
        transferredAt: new Date(Date.now() + 3600000),
      }).success,
    ).toBe(false);
  });
});
describe("independent fund manager review", () => {
  beforeEach(() => {
    db.payment.findFirst.mockResolvedValue(payment);
  });
  it("accepts confirmation without notes and requires a reason for rejection", async () => {
    await expect(
      reviewTransfer(manager, payment.id, "reject", ""),
    ).rejects.toMatchObject({ code: "REJECTION_REASON_REQUIRED" });
    expect(db.payment.update).not.toHaveBeenCalled();
    await reviewTransfer(manager, payment.id, "confirm", "");
    expect(db.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SUCCESS",
          reviewNotes: "Dana masuk sudah diperiksa pada rekening keluarga.",
        }),
      }),
    );
  });
  it("keeps a partially repaid overdue installment overdue and the loan active", async () => {
    db.payment.findUniqueOrThrow.mockResolvedValue({
      ...payment,
      amount: new Prisma.Decimal(200000),
      installment: { ...installment, dueDate: new Date("2000-01-01") },
    });
    db.loanInstallment.aggregate.mockResolvedValue({
      _sum: { remainingAmount: new Prisma.Decimal(300000) },
    });
    await reviewTransfer(manager, payment.id, "confirm", "Sesuai mutasi");
    expect(db.loanInstallment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "OVERDUE" }),
      }),
    );
    expect(db.loan.update).not.toHaveBeenCalled();
    expect(db.fundRequest.updateMany).not.toHaveBeenCalled();
  });
  it("rejects a borrower, a manager of another family, and self confirmation", async () => {
    await expect(
      reviewTransfer(borrower, payment.id, "confirm", "Sesuai mutasi bank"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    db.payment.findFirst.mockResolvedValueOnce(null);
    await expect(
      reviewTransfer(
        { ...manager, familyId: uid(50) },
        payment.id,
        "confirm",
        "Sesuai mutasi bank",
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_NOT_FOUND" });
    db.payment.findUniqueOrThrow.mockResolvedValue({
      ...payment,
      payerId: manager.sub,
      loan: { ...payment.loan, borrowerId: manager.sub },
    });
    await expect(
      reviewTransfer(manager, payment.id, "confirm", "Sesuai mutasi bank"),
    ).rejects.toMatchObject({ code: "SELF_CONFIRMATION_NOT_ALLOWED" });
    expect(db.ledgerEntry.create).not.toHaveBeenCalled();
  });
  it("confirms atomically, closes Loan and FundRequest, and never posts a duplicate", async () => {
    await reviewTransfer(manager, payment.id, "confirm", "Sesuai mutasi bank");
    expect(db.payment.update).toHaveBeenCalledWith({
      where: { id: payment.id, status: "PENDING" },
      data: expect.objectContaining({
        status: "SUCCESS",
        reviewedById: manager.sub,
        reviewNotes: "Sesuai mutasi bank",
      }),
    });
    expect(db.loan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PAID_OFF" }),
      }),
    );
    expect(db.fundRequest.updateMany).toHaveBeenCalledWith({
      where: { loanId: payment.loanId },
      data: { status: "PAID_OFF" },
    });
    db.payment.findUniqueOrThrow.mockResolvedValue({
      ...payment,
      status: "SUCCESS",
    });
    await reviewTransfer(manager, payment.id, "confirm", "Sesuai mutasi bank");
    expect(db.ledgerEntry.create).toHaveBeenCalledOnce();
    expect(db.loanInstallment.update).toHaveBeenCalledOnce();
  });
  it("rejects with a reason without changing balances or installments", async () => {
    await reviewTransfer(
      manager,
      payment.id,
      "reject",
      "Dana belum terlihat di rekening",
    );
    expect(db.payment.update).toHaveBeenCalledWith({
      where: { id: payment.id, status: "PENDING" },
      data: expect.objectContaining({
        status: "FAILED",
        reviewNotes: "Dana belum terlihat di rekening",
      }),
    });
    expect(db.ledgerEntry.create).not.toHaveBeenCalled();
    expect(db.loanInstallment.update).not.toHaveBeenCalled();
    expect(db.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: borrower.sub }),
      }),
    );
    expect(db.emailMessage.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            userId: borrower.sub,
            subject: "Laporan transfer belum dapat diterima",
            eventKey: `PAYMENT_REJECTED:${payment.id}`,
          }),
        ],
        skipDuplicates: true,
      }),
    );
  });
  it("blocks opposite decisions after review and legacy provider rows", async () => {
    db.payment.findUniqueOrThrow.mockResolvedValueOnce({
      ...payment,
      status: "FAILED",
    });
    await expect(
      reviewTransfer(manager, payment.id, "confirm", "Sesuai mutasi bank"),
    ).rejects.toMatchObject({ code: "PAYMENT_ALREADY_REVIEWED" });
    db.payment.findUniqueOrThrow.mockResolvedValueOnce({
      ...payment,
      provider: "SANDBOX",
    });
    await expect(
      reviewTransfer(manager, payment.id, "confirm", "Sesuai mutasi bank"),
    ).rejects.toMatchObject({ code: "INVALID_MANUAL_PAYMENT" });
    for (const invalid of [
      { ...payment, loan: { ...payment.loan, familyId: uid(99) } },
      { ...payment, installment: { ...payment.installment, loanId: uid(99) } },
    ]) {
      db.payment.findUniqueOrThrow.mockResolvedValueOnce(invalid);
      await expect(
        reviewTransfer(manager, payment.id, "confirm", "Sesuai mutasi bank"),
      ).rejects.toMatchObject({ code: "INVALID_MANUAL_PAYMENT" });
    }
    expect(db.ledgerEntry.create).not.toHaveBeenCalled();
  });
});

describe("consistent installment payment status", () => {
  const now = new Date("2026-10-09T17:00:00Z");
  const base = {
    remainingAmount: new Prisma.Decimal(100),
    paidAmount: new Prisma.Decimal(0),
    dueDate: new Date("2026-10-10T03:00:00Z"),
    payments: [],
  };
  it("shows waiting for review while keeping the financial balance unpaid", () => {
    expect(
      installmentPaymentStatus(
        {
          ...base,
          payments: [
            {
              provider: "MANUAL",
              status: "PENDING",
              bankAccountId: account.id,
            },
          ],
        },
        now,
      ),
    ).toBe("PENDING_REVIEW");
    expect(financialInstallmentStatus(base, now)).toBe("UNPAID");
  });
  it("treats rejected, cancelled, expired and legacy reports as no pending review", () => {
    for (const status of ["FAILED", "CANCELLED", "EXPIRED", "SUCCESS"])
      expect(
        installmentPaymentStatus(
          {
            ...base,
            payments: [
              { provider: "MANUAL", status, bankAccountId: account.id },
            ],
          },
          now,
        ),
      ).toBe("UNPAID");
    expect(
      installmentPaymentStatus(
        {
          ...base,
          payments: [
            { provider: "SANDBOX", status: "PENDING", bankAccountId: null },
          ],
        },
        now,
      ),
    ).toBe("UNPAID");
    expect(
      installmentPaymentStatus(
        {
          ...base,
          payments: [
            { provider: "MANUAL", status: "PENDING", bankAccountId: null },
          ],
        },
        now,
      ),
    ).toBe("UNPAID");
  });
  it("uses WIB calendar dates for overdue and prioritizes settled balances", () => {
    const due = {
      ...base,
      dueDate: new Date("2026-10-09T03:00:00Z"),
      paidAmount: new Prisma.Decimal(50),
    };
    expect(
      installmentPaymentStatus(due, new Date("2026-10-09T16:59:00Z")),
    ).toBe("PARTIAL");
    expect(installmentPaymentStatus(due, now)).toBe("OVERDUE");
    expect(
      installmentPaymentStatus(
        {
          ...due,
          remainingAmount: new Prisma.Decimal(0),
          payments: [
            {
              provider: "MANUAL",
              status: "PENDING",
              bankAccountId: account.id,
            },
          ],
        },
        now,
      ),
    ).toBe("PAID");
  });
});
