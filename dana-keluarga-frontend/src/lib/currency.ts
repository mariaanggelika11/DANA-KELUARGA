export const MAX_CURRENCY = "9999999999999999";
const digits = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const currency = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});
export function parseCurrency(value: string | null | undefined): string {
  if (value == null || value.trim() === "") return "";
  const cleaned = value.trim().replace(/^Rp\s*/i, "");
  if (!/^(\d+|\d{1,3}(\.\d{3})+)$/.test(cleaned))
    throw new Error(
      "Masukkan nominal Rupiah bulat tanpa tanda minus atau pecahan.",
    );
  return BigInt(cleaned.replace(/\./g, "")).toString();
}
const integer = (value: string | number | bigint) => {
  if (typeof value === "number" && !Number.isSafeInteger(value))
    throw new Error("Nominal tidak aman. Gunakan string integer.");
  return BigInt(String(value).replace(/\.00?$/, ""));
};
export const formatCurrency = (value: string | number | bigint) =>
  currency.format(integer(value));
export const formatCurrencyInput = (value: string) =>
  value === "" ? "" : digits.format(integer(value));
export function currencyError(
  value: string,
  required = false,
  min = "1",
  max = MAX_CURRENCY,
) {
  if (!value) return required ? "Nominal wajib diisi." : "";
  if (!/^\d+$/.test(value)) return "Nominal harus berupa Rupiah bulat.";
  if (BigInt(value) < BigInt(min))
    return min === "1"
      ? "Nominal harus lebih dari Rp0."
      : `Nominal minimum adalah ${formatCurrency(min)}.`;
  if (BigInt(value) > BigInt(max))
    return `Nominal tidak boleh melebihi ${formatCurrency(max)}.`;
  return "";
}
