import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseCurrency,
  formatCurrency,
  formatCurrencyInput,
  currencyError,
} from "../src/lib/currency.ts";
describe("shared currency parsing and formatting", () => {
  for (const [raw, display] of [
    ["0", "0"],
    ["1", "1"],
    ["1000", "1.000"],
    ["10000", "10.000"],
    ["1000000", "1.000.000"],
    ["45000000", "45.000.000"],
    ["9999999999999999", "9.999.999.999.999.999"],
  ]) {
    it(`round trips ${raw} without precision loss`, () => {
      assert.equal(formatCurrencyInput(raw), display);
      assert.equal(parseCurrency(display), raw);
      assert.match(formatCurrency(raw), /^Rp/);
    });
  }
  for (const input of ["", null, undefined])
    it(`handles empty ${input}`, () => assert.equal(parseCurrency(input), ""));
  for (const input of [
    "1000000",
    "1.000.000",
    "Rp1.000.000",
    "Rp 1.000.000",
    "0001000000",
  ])
    it(`pastes ${input}`, () => assert.equal(parseCurrency(input), "1000000"));
  for (const input of ["-100", "abc", "$100", "1,5", "1.5", "1e3", "+100"])
    it(`rejects ${input}`, () => assert.throws(() => parseCurrency(input)));
  it("keeps clearing distinct from zero", () => {
    assert.equal(formatCurrencyInput(""), "");
    assert.equal(currencyError("", false), "");
    assert.notEqual(currencyError("", true), "");
    assert.notEqual(currencyError("0", true), "");
  });
  it("enforces configurable minimum and maximum", () => {
    assert.notEqual(currencyError("9999", true, "10000"), "");
    assert.equal(currencyError("10000", true, "10000", "50000000"), "");
    assert.notEqual(currencyError("50000001", true, "10000", "50000000"), "");
    assert.notEqual(currencyError("10000000000000000", true), "");
  });
  it("rejects unsafe numeric display values", () =>
    assert.throws(() => formatCurrency(Number.MAX_SAFE_INTEGER + 1)));
});
