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
import { actOnRequest } from "../src/modules/approvals/approval.service";
import { settleSandboxPayment } from "../src/modules/payments/payment.service";
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
    ["maker", "approver", "releaser", "outsider"].map((name, index) =>
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
  const [maker, approver, releaser, outsider] = people;
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
      role: "MEMBER",
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
  await assert.rejects(contribute(actor(), { ...deposit, amount: "5000000" }), {
    code: "IDEMPOTENCY_CONFLICT",
  });
  await assert.rejects(contribute(actor(outsider.id), deposit), {
    code: "FORBIDDEN",
  });
  await contribute(actor(approver.id), {
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
  await contribute(actor(), { ...deposit, idempotencyKey: key() });
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
  await Promise.all([
    actOnRequest(actor(approver.id), approved.approvalRequestId!, "APPROVE"),
    actOnRequest(actor(approver.id), approved.approvalRequestId!, "APPROVE"),
  ]);
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
  assert.equal(summary.contribution.available.toString(), "0");
  const installments = await prisma.loanInstallment.findMany({
    where: { loanId: approved.id },
    orderBy: { installmentNumber: "asc" },
  });
  await scheduleReminders(
    new Date(`${wibDay(installments[0].dueDate)}T10:00:00+07:00`),
  );
  await processEmails();
  const pay = async (installmentId: string, amount: string) => {
    const payment = await prisma.payment.create({
      data: {
        familyId: family.id,
        loanId: approved.id,
        installmentId,
        payerId: maker.id,
        amount,
        provider: "SANDBOX",
        externalId: key(),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    await Promise.all([
      settleSandboxPayment(payment.id, releaser.id),
      settleSandboxPayment(payment.id, releaser.id),
    ]);
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
  await pay(installments[0].id, "500000");
  await pay(installments[1].id, "1000000");
  summary = await cashSummary(actor());
  assert.equal(summary.balance.toString(), "10000000");
  assert.equal(summary.outstanding.toString(), "0");
  assert.equal(summary.contribution.available.toString(), "0");
  assert.equal(
    (await prisma.loan.findUniqueOrThrow({ where: { id: approved.id } }))
      .status,
    "PAID_OFF",
  );
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
  assert(emails.every((item) => item.status === "SIMULATED"));
  assert.equal(
    (await cashSummary(actor(outsider.id, other.id))).balance.toString(),
    "0",
  );
  console.log(
    "PASS: deposits, idempotency, < / = / > contribution, reservation/rejection, sequential approval, self/tenant rejection, concurrent release/withdrawal, partial/full repayment, ledger snapshots/immutability, email simulation.",
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
