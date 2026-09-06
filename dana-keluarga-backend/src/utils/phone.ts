export function normalizeIndonesianPhone(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.startsWith('08')) return `62${digits.slice(1)}`;
  if (digits.startsWith('8')) return `62${digits}`;
  if (digits.startsWith('620')) return `62${digits.slice(3)}`;
  return digits;
}
