import { z } from "zod";

export const MAX_MONEY = 9999999999999999n;
export const amountSchema = z
  .union([z.string(), z.number().int().safe()])
  .transform(String)
  .refine(
    (value) =>
      /^\d{1,16}$/.test(value) &&
      BigInt(value) > 0n &&
      BigInt(value) <= MAX_MONEY,
    "Nominal harus berupa Rupiah bulat, lebih dari Rp0, dan tidak melebihi Rp9.999.999.999.999.999.",
  )
  .transform((value) => BigInt(value).toString());
const formatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});
export const formatMoney = (
  value: { toString(): string } | string | number | bigint,
) =>
  formatter
    .format(BigInt(value.toString().replace(/\.00?$/, "")))
    .replace(/\s/g, "");
export function splitAmount(total: bigint, parts: number): bigint[] {
  if (!Number.isInteger(parts) || parts <= 0)
    throw new Error("Parts must be positive");
  const base = total / BigInt(parts);
  const remainder = total % BigInt(parts);
  return Array.from(
    { length: parts },
    (_, index) => base + (BigInt(index) < remainder ? 1n : 0n),
  );
}
