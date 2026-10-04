import { describe, expect, it } from "vitest";
import { calculateFundRequest, validateRequestIntent } from "../src/modules/cash/cash.rules";
import { amountSchema, formatMoney, splitAmount } from "../src/utils/money";
describe("authoritative cash splitting", () => {
  it.each([
    [3000000n, 4000000n, 3000000n, 0n],
    [4000000n, 4000000n, 4000000n, 0n],
    [6000000n, 4000000n, 4000000n, 2000000n],
    [5000000n, 0n, 0n, 5000000n],
  ])("splits %s against %s", (amount, own, withdrawalAmount, loanAmount) => {
    expect(calculateFundRequest(amount, own)).toEqual({
      withdrawalAmount,
      loanAmount,
      requiresApproval: loanAmount > 0n,
    });
  });
  it.each([0n, -1n, 10000000000000000n])(
    "rejects invalid amount %s",
    (amount) => expect(() => calculateFundRequest(amount, 0n)).toThrow(),
  );
  it("preserves large integer precision and installment totals", () => {
    const value = "9999999999999999";
    expect(amountSchema.parse(value)).toBe(value);
    expect(formatMoney(value)).toContain("9.999.999.999.999.999");
    expect(splitAmount(BigInt(value), 60).reduce((a, b) => a + b, 0n)).toBe(
      BigInt(value),
    );
  });
  it.each([
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    "Rp1.000",
    "1.000",
    "1e3",
    "",
    null,
    "10000000000000000",
  ])("rejects unsafe API amount %s", (amount) =>
    expect(amountSchema.safeParse(amount).success).toBe(false),
  );
});

describe("explicit transaction intent", () => {
  it("never turns a contribution withdrawal into a loan", () => {
    expect(() => validateRequestIntent("WITHDRAWAL", calculateFundRequest(5000000n, 4000000n).loanAmount)).toThrow("Kontribusi tersedia tidak mencukupi");
    expect(() => validateRequestIntent("WITHDRAWAL", calculateFundRequest(1n, 0n).loanAmount)).toThrow();
    expect(() => validateRequestIntent("WITHDRAWAL", 0n)).not.toThrow();
  });
  it("does not create zero-value loans when contributions cover the request", () => {
    expect(() => validateRequestIntent("LOAN", 0n)).toThrow("Kontribusi Anda mencukupi");
    expect(() => validateRequestIntent("LOAN", 1000000n)).not.toThrow();
  });
});
