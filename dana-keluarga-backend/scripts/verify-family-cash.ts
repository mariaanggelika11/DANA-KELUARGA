import { wibDay } from "../src/utils/calendar";
import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import {
  contribute,
  requestFunds,
  cashSummary,
} from "../src/modules/cash/cash.service";
import {
  actOnRequest,
  reassignRequest,
} from "../src/modules/approvals/approval.service";
import {
  reportTransfer,
  reviewTransfer,
  saveBankAccount,
  reversePayment,
} from "../src/modules/payments/payment.service";
import {
  reviewContribution,
  listContributions,
} from "../src/modules/cash/contribution.service";
import { updateMemberRole } from "../src/modules/management/member-role.service";
import { processEmails } from "../src/modules/email/email.service";
import { scheduleReminders } from "../src/modules/notifications/notification.worker";

const schema = new URL(process.env.DATABASE_URL!).searchParams.get("schema");
if (!schema || !/^cash_test_[a-f0-9]+$/.test(schema))
  throw new Error("Disposable cash_test schema required");
if (process.env.EMAIL_MODE !== "simulation")
  throw new Error("Email simulation required");
const key = () => crypto.randomUUID();
async function main() {
  const people = await Promise.all(
    ["maker", "approver", "releaser", "outsider", "replacement"].map(
      (name, index) =>
        prisma.user.create({
          data: {
            name,
            email: `${name}@example.invalid`,
            phone: `62899000000${index}`,
            passwordHash: "test-only",
          },
        }),
    ),
  );
  const [maker, approver, releaser, outsider, replacement] = people;
  const family = await prisma.family.create({
    data: { name: "Cash test", code: key(), createdById: maker.id },
  });
  const other = await prisma.family.create({
    data: { name: "Other", code: key(), createdById: outsider.id },
  });
  await prisma.familyMember.createMany({
    data: people.map((person) => ({
      familyId: person.id === outsider.id ? other.id : family.id,
      userId: person.id,
      role:
        person.id === releaser.id
          ? "TREASURER"
          : person.id === replacement.id
            ? "ADMIN"
            : "MEMBER",
    })),
  });
  const actor = (id = maker.id, familyId = family.id) => ({
    sub: id,
    familyId,
    familyRole: "MEMBER",
    systemRole: "USER",
  });
  await prisma.approvalPolicy.create({
    data: {
      familyId: family.id,
      version: 1,
      reason: "Test policy",
      createdById: maker.id,
      assignments: {
        create: [
          { userId: maker.id, permission: "MAKER", sequence: 1 },
          { userId: approver.id, permission: "APPROVER", sequence: 1 },
          { userId: releaser.id, permission: "RELEASER", sequence: 2 },
        ],
      },
    },
  });
  const manager = { ...actor(releaser.id), familyRole: "TREASURER" };
  const administrator = {
    ...actor(replacement.id),
    familyRole: "ADMIN",
    systemRole: "USER" as const,
  };
  const bank = await saveBankAccount(manager, {
    expectedVersion: 0,
    bankName: "BCA",
    accountNumber: "0012345678",
    accountHolder: "Cash test",
  });
  const contributeConfirmed = async (
    who: ReturnType<typeof actor>,
    input: { amount: string; purpose: string; idempotencyKey: string },
  ) => {
    const report = await contribute(who, input);
    return reviewContribution(
      manager,
      report.id,
      "confirm",
      "Uang sudah masuk sesuai mutasi",
    );
  };
  const deposit = {
    amount: "4000000",
    purpose: "Setoran awal",
    idempotencyKey: key(),
  };
  const copies = await Promise.all([
    contribute(actor(), deposit),
    contribute(actor(), deposit),
  ]);
  assert.equal(copies[0].id, copies[1].id);
  assert.equal(copies[0].status, "PENDING");
  assert.equal((await cashSummary(actor())).balance.toString(), "0");
  assert.equal(
    (await cashSummary(actor())).contribution.available.toString(),
    "0",
  );
  await assert.rejects(
    reviewContribution(actor(), copies[0].id, "confirm", ""),
    { code: "FORBIDDEN" },
  );
  await Promise.all([
    reviewContribution(manager, copies[0].id, "confirm", ""),
    reviewContribution(manager, copies[0].id, "confirm", ""),
  ]);
  assert.equal(
    await prisma.ledgerEntry.count({
      where: {
        referenceId: copies[0].id,
        referenceType: "CONTRIBUTION_REPORT",
      },
    }),
    1,
  );
  const deniedDeposit = await contribute(actor(), {
    ...deposit,
    amount: "100",
    idempotencyKey: key(),
  });
  await reviewContribution(
    manager,
    deniedDeposit.id,
    "reject",
    "Belum ada uang masuk",
  );
  assert.equal((await cashSummary(actor())).balance.toString(), "4000000");
  await assert.rejects(
    reviewContribution(manager, deniedDeposit.id, "confirm", ""),
    { code: "CONTRIBUTION_ALREADY_REVIEWED" },
  );
  await assert.rejects(
    contribute(manager, { ...deposit, idempotencyKey: key() }),
    { code: "REVIEWER_UNAVAILABLE" },
  );
  const treasuryMember = await prisma.familyMember.findUniqueOrThrow({
    where: { familyId_userId: { familyId: family.id, userId: releaser.id } },
  });
  await assert.rejects(
    updateMemberRole(administrator, treasuryMember.id, "MEMBER"),
    { code: "LAST_TREASURER" },
  );
  assert.equal(
    (await listContributions(actor())).items.every(
      (row) => row.userId === maker.id,
    ),
    true,
  );
  await prisma.familyMember.update({
    where: { familyId_userId: { familyId: family.id, userId: approver.id } },
    data: { role: "TREASURER" },
  });
  const treasuryDeposit = await contribute(manager, {
    ...deposit,
    amount: "100",
    idempotencyKey: key(),
  });
  await assert.rejects(
    reviewContribution(manager, treasuryDeposit.id, "confirm", ""),
    { code: "SELF_CONFIRMATION_NOT_ALLOWED" },
  );
  const secondTreasuryMember = await prisma.familyMember.findUniqueOrThrow({
    where: { familyId_userId: { familyId: family.id, userId: approver.id } },
  });
  await assert.rejects(
    updateMemberRole(administrator, secondTreasuryMember.id, "MEMBER"),
    { code: "PENDING_REVIEWER_REQUIRED" },
  );
  assert.equal(
    (
      await prisma.familyMember.findUniqueOrThrow({
        where: { id: secondTreasuryMember.id },
      })
    ).role,
    "TREASURER",
  );
  await reviewContribution(
    { ...actor(approver.id), familyRole: "TREASURER" },
    treasuryDeposit.id,
    "reject",
    "Fixture setoran dibatalkan",
  );
  await prisma.familyMember.update({
    where: { familyId_userId: { familyId: family.id, userId: approver.id } },
    data: { role: "MEMBER" },
  });

  await assert.rejects(contribute(actor(), { ...deposit, amount: "5000000" }), {
    code: "IDEMPOTENCY_CONFLICT",
  });
  await assert.rejects(contribute(actor(outsider.id), deposit), {
    code: "FORBIDDEN",
  });
  await contributeConfirmed(actor(approver.id), {
    ...deposit,
    amount: "10000000",
    idempotencyKey: key(),
  });
  const take = (amount: string) =>
    requestFunds(actor(), {
      amount,
      purpose: "Kebutuhan keluarga",
      tenorMonths: 2,
      idempotencyKey: key(),
    });
  const small = await take("3000000");
  assert.equal(small.loanAmount.toString(), "0");
  const exact = await take("1000000");
  assert.equal(exact.loanAmount.toString(), "0");
  assert.equal(
    (await cashSummary(actor())).contribution.available.toString(),
    "0",
  );
  await contributeConfirmed(actor(), { ...deposit, idempotencyKey: key() });
  const mixed = await take("6000000");
  assert.equal(mixed.withdrawalAmount.toString(), "4000000");
  assert.equal(mixed.loanAmount.toString(), "2000000");
  assert.equal((await cashSummary(actor())).reserved.toString(), "6000000");
  assert.equal(
    (await cashSummary(actor())).contribution.available.toString(),
    "0",
  );
  const loan = await prisma.loan.findUniqueOrThrow({
    where: { id: mixed.loanId! },
  });
  await assert.rejects(
    actOnRequest(actor(), loan.approvalRequestId!, "APPROVE"),
  );
  await assert.rejects(
    actOnRequest(
      actor(outsider.id, other.id),
      loan.approvalRequestId!,
      "APPROVE",
    ),
    { code: "REQUEST_NOT_FOUND" },
  );
  await actOnRequest(
    actor(approver.id),
    loan.approvalRequestId!,
    "REJECT",
    "Tidak disetujui",
  );
  assert.equal(
    (await cashSummary(actor())).contribution.available.toString(),
    "4000000",
  );
  const retry = await take("6000000");
  const approved = await prisma.loan.findUniqueOrThrow({
    where: { id: retry.loanId! },
  });
  await prisma.user.update({
    where: { id: approver.id },
    data: { isActive: false },
  });
  await reassignRequest(
    { ...actor(replacement.id), familyRole: "ADMIN" },
    approved.approvalRequestId!,
    {
      userId: replacement.id,
      expectedAssignedUserId: approver.id,
      reason: "Petugas lama tidak aktif",
    },
  );
  await assert.rejects(
    actOnRequest(actor(approver.id), approved.approvalRequestId!, "APPROVE"),
    { code: "NOT_ASSIGNED_AS_APPROVER" },
  );
  assert.equal(
    await prisma.auditLog.count({
      where: {
        action: "APPROVAL_STEP_REASSIGNED",
        entityId: approved.approvalRequestId!,
      },
    }),
    1,
  );
  await Promise.all([
    actOnRequest(actor(replacement.id), approved.approvalRequestId!, "APPROVE"),
    actOnRequest(actor(replacement.id), approved.approvalRequestId!, "APPROVE"),
  ]);
  await prisma.user.update({
    where: { id: approver.id },
    data: { isActive: true },
  });
  await Promise.all([
    actOnRequest(actor(releaser.id), approved.approvalRequestId!, "RELEASE"),
    actOnRequest(actor(releaser.id), approved.approvalRequestId!, "RELEASE"),
  ]);
  assert.equal(
    await prisma.ledgerEntry.count({ where: { type: "LOAN_DISBURSEMENT" } }),
    1,
  );
  let summary = await cashSummary(actor());
  assert.equal(summary.balance.toString(), "8000000");
  assert.equal(summary.outstanding.toString(), "2000000");
  assert.equal(summary.familyLoanTotals.outstanding.toString(), "2000000");
  const approverCash = summary.contributions.find(
    (member) => member.userId === approver.id,
  );
  // MEMBER sees only their own details, even though family cash totals are public.
  assert.equal(approverCash, undefined);
  const managerCash = await cashSummary({
    ...actor(releaser.id),
    familyRole: "TREASURER",
  });
  const depositorCash = managerCash.contributions.find(
    (member) => member.userId === approver.id,
  )!;
  assert.equal(depositorCash.available.toString(), "10000000");
  assert.equal(depositorCash.withdrawable.toString(), "8000000");
  assert.equal(managerCash.repaid.toString(), "0");
  assert.equal(managerCash.familyLoanTotals.loanTotal.toString(), "2000000");
  assert.equal(
    managerCash.requests
      .find((item) => item.id === retry.id)!
      .disbursedAt!.getTime(),
    (
      await prisma.loan.findUniqueOrThrow({ where: { id: approved.id } })
    ).disbursedAt!.getTime(),
  );
  assert.equal(summary.contribution.available.toString(), "0");
  const installments = await prisma.loanInstallment.findMany({
    where: { loanId: approved.id },
    orderBy: { installmentNumber: "asc" },
  });
  await scheduleReminders(
    new Date(`${wibDay(installments[0].dueDate)}T10:00:00+07:00`),
  );
  await processEmails();
  const replacementBank = await saveBankAccount(manager, {
    expectedVersion: bank.version,
    bankName: "BNI",
    accountNumber: "0098765432",
    accountHolder: "Cash test",
  });
  assert.notEqual(bank.id, replacementBank.id);
  await assert.rejects(
    prisma.familyBankAccount.update({
      where: { id: bank.id },
      data: { accountNumber: "9999999999" },
    }),
  );
  // Legacy previews must not occupy the pending slot for a real bank transfer.
  // These rows reproduce the production failure hidden by mocked Prisma tests.
  const legacyPayments = await Promise.all(
    installments.map((item, index) =>
      prisma.payment.create({
        data: {
          familyId: family.id,
          loanId: approved.id,
          installmentId: item.id,
          payerId: maker.id,
          amount: item.remainingAmount,
          provider: index === 0 ? "MANUAL" : "SANDBOX",
          externalId: `legacy-${key()}`,
          status: "PENDING",
        },
      }),
    ),
  );
  let rejectionChecked = false;
  const pay = async (installmentId: string, amount: string, simple = false) => {
    const input = simple
      ? {
          idempotencyKey: key(),
          bankAccountId: bank.id,
          expectedRemainingAmount: amount,
        }
      : {
          idempotencyKey: key(),
          bankAccountId: bank.id,
          amount,
          transferredAt: new Date(),
          transferReference: key().toUpperCase(),
          transferNotes: "Transfer fixture dari peminjam",
        };
    await assert.rejects(
      reportTransfer(manager, approved.id, installmentId, input),
      { code: "OWN_PAYMENT_REQUIRED" },
    );
    const before = await cashSummary(actor());
    let reports = await Promise.all([
      reportTransfer(actor(), approved.id, installmentId, input),
      reportTransfer(actor(), approved.id, installmentId, input),
    ]);
    assert.equal(reports[0].id, reports[1].id);
    assert.equal(reports[0].status, "PENDING");
    // The DB must still enforce one pending *real* transfer, even outside the service.
    await assert.rejects(
      prisma.payment.create({
        data: {
          familyId: family.id,
          loanId: approved.id,
          installmentId,
          payerId: maker.id,
          amount,
          provider: "MANUAL",
          externalId: `duplicate-${key()}`,
          bankAccountId: bank.id,
          status: "PENDING",
        },
      }),
      { code: "P2002" },
    );
    if (simple) {
      assert.equal(reports[0].transferredAt, null);
      assert.equal(reports[0].transferReference, null);
      assert.equal(reports[0].amount.toString(), amount);
      const duplicates = await Promise.allSettled([
        reportTransfer(actor(), approved.id, installmentId, {
          ...input,
          idempotencyKey: key(),
        }),
        reportTransfer(actor(), approved.id, installmentId, {
          ...input,
          idempotencyKey: key(),
        }),
      ]);
      assert.ok(
        duplicates.every(
          (result) =>
            result.status === "rejected" &&
            result.reason.code === "PAYMENT_PENDING",
        ),
      );
    }
    const after = await cashSummary(actor());
    assert.equal(after.balance.toString(), before.balance.toString());
    assert.equal(after.outstanding.toString(), before.outstanding.toString());
    await assert.rejects(
      reviewTransfer(actor(), reports[0].id, "confirm", "Sesuai mutasi bank"),
      { code: "FORBIDDEN" },
    );
    if (!rejectionChecked) {
      await reviewTransfer(
        manager,
        reports[0].id,
        "reject",
        "Referensi belum cocok dengan mutasi rekening",
      );
      await assert.rejects(
        reviewTransfer(manager, reports[0].id, "confirm", "Sesuai mutasi bank"),
        { code: "PAYMENT_ALREADY_REVIEWED" },
      );
      assert.equal(
        (await cashSummary(actor())).balance.toString(),
        before.balance.toString(),
      );
      const corrected = { ...input, idempotencyKey: key() };
      reports = await Promise.all([
        reportTransfer(actor(), approved.id, installmentId, corrected),
        reportTransfer(actor(), approved.id, installmentId, corrected),
      ]);
      assert.equal(reports[0].id, reports[1].id);
      rejectionChecked = true;
    }
    await Promise.all([
      reviewTransfer(manager, reports[0].id, "confirm", "Sesuai mutasi bank"),
      reviewTransfer(manager, reports[0].id, "confirm", "Sesuai mutasi bank"),
    ]);
    const recorded = await prisma.payment.findUniqueOrThrow({
      where: { id: reports[0].id },
      include: { bankAccount: true },
    });
    assert.equal(recorded.bankAccount!.accountNumber, bank.accountNumber);
    assert.equal(recorded.reviewedById, manager.sub);
    assert.equal(
      await prisma.ledgerEntry.count({
        where: { referenceType: "PAYMENT", referenceId: reports[0].id },
      }),
      1,
    );
  };
  await pay(installments[0].id, "500000");
  assert.equal(
    (
      await prisma.loanInstallment.findUniqueOrThrow({
        where: { id: installments[0].id },
      })
    ).status,
    "PARTIAL",
  );
  assert.equal((await cashSummary(actor())).outstanding.toString(), "1500000");
  const partialCash = await cashSummary(manager);
  assert.equal(partialCash.familyLoanTotals.repaid.toString(), "500000");
  assert.equal(partialCash.familyLoanTotals.outstanding.toString(), "1500000");
  const borrowerCash = partialCash.contributions.find(
    (member) => member.userId === maker.id,
  )!;
  assert.equal(borrowerCash.deposited.toString(), "8000000");
  assert.equal(borrowerCash.repaid.toString(), "500000");
  assert.equal(borrowerCash.outstanding.toString(), "1500000");
  const partialRequest = partialCash.requests.find(
    (item) => item.id === retry.id,
  )!;
  assert.equal(partialRequest.loanProgress!.repaid.toString(), "500000");
  assert.equal(partialRequest.loanProgress!.outstanding.toString(), "1500000");
  assert.equal(partialRequest.loanProgress!.paidInstallments, 0);
  assert.equal(partialRequest.loanProgress!.totalInstallments, 2);
  await pay(installments[0].id, "500000");
  await pay(installments[1].id, "1000000", true);
  for (const legacy of legacyPayments) {
    const preserved = await prisma.payment.findUniqueOrThrow({
      where: { id: legacy.id },
    });
    assert.equal(preserved.status, "PENDING");
    assert.equal(preserved.bankAccountId, null);
    assert.equal(preserved.amount.toString(), legacy.amount.toString());
  }
  assert.equal(
    (await prisma.fundRequest.findUniqueOrThrow({ where: { id: retry.id } }))
      .status,
    "PAID_OFF",
  );
  summary = await cashSummary(actor());
  assert.equal(summary.balance.toString(), "10000000");
  assert.equal(summary.outstanding.toString(), "0");
  assert.equal(summary.familyLoanTotals.repaid.toString(), "2000000");
  const paidRequest = summary.requests.find((item) => item.id === retry.id)!;
  assert.equal(paidRequest.loanProgress!.paidInstallments, 2);
  assert.equal(paidRequest.loanProgress!.outstanding.toString(), "0");
  assert(paidRequest.paidOffAt);
  assert.equal(summary.contribution.available.toString(), "0");
  assert.equal(
    (await prisma.loan.findUniqueOrThrow({ where: { id: approved.id } }))
      .status,
    "PAID_OFF",
  );
  const paidTransfer = await prisma.payment.findFirstOrThrow({
    where: {
      installmentId: installments[1].id,
      provider: "MANUAL",
      status: "SUCCESS",
      bankAccountId: { not: null },
    },
  });
  await assert.rejects(
    reversePayment(actor(), paidTransfer.id, "Salah konfirmasi"),
    { code: "FORBIDDEN" },
  );
  const reservationForCorrection = await requestFunds(actor(), {
    amount: "10000000",
    purpose: "Cadangan untuk menguji koreksi atomik",
    tenorMonths: 1,
    idempotencyKey: key(),
  });
  await assert.rejects(
    reversePayment(manager, paidTransfer.id, "Nominal tidak masuk di bank"),
    { code: "INSUFFICIENT_FAMILY_CASH" },
  );
  assert.equal(
    (await prisma.payment.findUniqueOrThrow({ where: { id: paidTransfer.id } }))
      .status,
    "SUCCESS",
  );
  assert.equal(
    (await prisma.loan.findUniqueOrThrow({ where: { id: approved.id } }))
      .status,
    "PAID_OFF",
  );
  assert.equal(
    await prisma.ledgerEntry.count({
      where: {
        referenceType: "PAYMENT_REVERSAL",
        referenceId: paidTransfer.id,
      },
    }),
    0,
  );
  const reservedLoan = await prisma.loan.findUniqueOrThrow({
    where: { id: reservationForCorrection.loanId! },
  });
  await actOnRequest(
    actor(approver.id),
    reservedLoan.approvalRequestId!,
    "REJECT",
    "Fixture cadangan selesai diperiksa",
  );
  await prisma.familyMember.update({
    where: { familyId_userId: { familyId: family.id, userId: maker.id } },
    data: { role: "TREASURER" },
  });
  await assert.rejects(
    reversePayment(
      { ...actor(), familyRole: "TREASURER" },
      paidTransfer.id,
      "Koreksi pembayaran sendiri",
    ),
    { code: "SELF_CONFIRMATION_NOT_ALLOWED" },
  );
  await prisma.familyMember.update({
    where: { familyId_userId: { familyId: family.id, userId: maker.id } },
    data: { role: "MEMBER" },
  });
  await Promise.all([
    reversePayment(manager, paidTransfer.id, "Nominal tidak masuk di bank"),
    reversePayment(manager, paidTransfer.id, "Nominal tidak masuk di bank"),
  ]);
  assert.equal(
    await prisma.ledgerEntry.count({
      where: {
        referenceType: "PAYMENT_REVERSAL",
        referenceId: paidTransfer.id,
      },
    }),
    1,
  );
  assert.equal(
    await prisma.ledgerEntry.count({
      where: { referenceType: "PAYMENT", referenceId: paidTransfer.id },
    }),
    1,
  );
  assert.equal(
    (await prisma.loan.findUniqueOrThrow({ where: { id: approved.id } }))
      .status,
    "ACTIVE",
  );
  assert.equal(
    (await prisma.loan.findUniqueOrThrow({ where: { id: approved.id } }))
      .paidOffAt,
    null,
  );
  assert.equal(
    (await prisma.fundRequest.findUniqueOrThrow({ where: { id: retry.id } }))
      .status,
    "ACTIVE",
  );
  const correctedCash = await cashSummary(actor());
  assert.equal(correctedCash.balance.toString(), "9000000");
  assert.equal(correctedCash.outstanding.toString(), "1000000");
  assert.equal(
    correctedCash.requests.find((row) => row.id === retry.id)!.loanProgress!
      .paidInstallments,
    1,
  );
  assert(
    (await prisma.payment.findUniqueOrThrow({ where: { id: paidTransfer.id } }))
      .reversedAt,
  );
  await assert.rejects(
    reversePayment(manager, paidTransfer.id, "Alasan lain"),
    { code: "PAYMENT_ALREADY_REVERSED" },
  );
  await pay(installments[1].id, "1000000", true);
  assert.equal((await cashSummary(actor())).balance.toString(), "10000000");
  assert.equal((await cashSummary(actor())).outstanding.toString(), "0");
  const concurrent = await Promise.allSettled([
    requestFunds(actor(approver.id), {
      amount: "7000000",
      purpose: "Tarikan serentak",
      tenorMonths: 1,
      idempotencyKey: key(),
    }),
    requestFunds(actor(approver.id), {
      amount: "7000000",
      purpose: "Tarikan serentak",
      tenorMonths: 1,
      idempotencyKey: key(),
    }),
  ]);
  assert.equal(
    concurrent.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal((await cashSummary(actor())).balance.toString(), "3000000");
  const entries = await prisma.ledgerEntry.findMany({
    orderBy: { createdAt: "asc" },
  });
  let balance = new Prisma.Decimal(0);
  for (const entry of entries) {
    assert.equal(entry.balanceBefore!.toString(), balance.toString());
    balance =
      entry.direction === "IN"
        ? balance.add(entry.amount)
        : balance.sub(entry.amount);
    assert.equal(entry.balanceAfter!.toString(), balance.toString());
  }
  await assert.rejects(
    prisma.ledgerEntry.delete({ where: { id: entries[0].id } }),
  );
  for (let index = 0; index < 3; index++) await processEmails();
  const emails = await prisma.emailMessage.findMany();
  assert(emails.some((item) => item.subject === "Tugas persetujuan baru"));
  assert(emails.some((item) => item.subject === "Pinjaman disetujui"));
  assert(emails.some((item) => item.subject === "Pengajuan ditolak"));
  assert(emails.some((item) => item.subject === "Pengingat cicilan"));
  assert(
    emails.every(
      (item) =>
        item.status === "SIMULATED" ||
        (item.status === "CANCELLED" &&
          [
            "Jenis pemberitahuan ini tidak dikirim lewat email",
            "Pembayaran dikoreksi pengelola dana.",
          ].includes(item.lastError ?? "")),
    ),
  );
  assert.equal(
    (await cashSummary(actor(outsider.id, other.id))).balance.toString(),
    "0",
  );
  await prisma.fundRequest.createMany({
    data: Array.from({ length: 105 }, () => ({
      familyId: family.id,
      userId: maker.id,
      idempotencyKey: key(),
      amount: "1",
      withdrawalAmount: "1",
      loanAmount: "0",
      tenorMonths: 1,
      purpose: "Pagination fixture",
      status: "CANCELLED" as const,
    })),
  });
  const pageSix = await cashSummary(actor(), 6);
  assert(pageSix.requestsTotal > 100);
  assert(pageSix.requests.length > 0 && pageSix.requests.length <= 20);
  console.log(
    "PASS: deposits stay pending without changing cash; independent confirmation once, rejection, reviewer coverage, last treasurer, audited payment reversal restores paid-off loan and ledger without deletion.",
  );
  console.log(
    "PASS: legacy sandbox and account-less pending payments do not block real transfers; database still blocks duplicate pending bank transfers; audited reassignment, paginated history beyond 100, borrower-only manual reports, independent bank confirmation, rejection and corrected resubmission, preserved account versions and idempotent confirmation, Loan/FundRequest PAID_OFF, deposits, idempotency, < / = / > contribution, reservation/rejection, sequential approval, self/tenant rejection, concurrent release/withdrawal, partial/full repayment, ledger snapshots/immutability, email simulation.",
  );
}
main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : "Test failed",
    );
    process.exitCode = 1;
  });
