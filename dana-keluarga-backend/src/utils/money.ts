export function splitAmount(total: bigint, parts: number): bigint[] {
  if (parts <= 0) throw new Error('Parts must be positive');
  const base = total / BigInt(parts);
  const remainder = total % BigInt(parts);
  return Array.from({ length: parts }, (_, index) => base + (BigInt(index) < remainder ? 1n : 0n));
}

export function formatIDR(amount: bigint | number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(amount));
}
