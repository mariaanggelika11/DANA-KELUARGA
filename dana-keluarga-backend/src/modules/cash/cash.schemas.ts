import { z } from "zod";
import { amountSchema } from "../../utils/money";

const cashTransactionSchema = z.object({
  amount: amountSchema,
  purpose: z.string().trim().min(3).max(240),
  idempotencyKey: z.string().uuid(),
});

export const contributionSchema = cashTransactionSchema.extend({
  bankAccountId: z.string().uuid().optional(),
});

export const fundRequestSchema = cashTransactionSchema.extend({
  tenorMonths: z.coerce.number().int().min(1).max(60).default(6),
});

export const withdrawalSchema = fundRequestSchema.extend({
  expectedWithdrawal: z.string().regex(/^(0|[1-9][0-9]{0,15})$/),
});
