import { describe, it, expect } from 'vitest';
import { booleanEnv } from '../src/config/env';
import { generateInstallments } from '../src/utils/installments';
import { daysUntil, wibDay } from '../src/utils/calendar';

describe('configuration and installment calendar', () => {
  it('parses false as false and rejects ambiguous configuration', () => {
    expect(booleanEnv.parse('false')).toBe(false);
    expect(booleanEnv.parse('true')).toBe(true);
    expect(booleanEnv.safeParse('yes').success).toBe(false);
  });
  it('preserves the disbursement day after short months and conserves rupiah', () => {
    const installments = generateInstallments(1000000n, 3, new Date('2027-01-31T09:00:00+07:00'), 1);
    expect(installments.map((row) => wibDay(row.dueDate))).toEqual(['2027-02-28', '2027-03-31', '2027-04-30']);
    expect(installments.reduce((sum, row) => sum + row.principalAmount, 0n)).toBe(1000000n);
  });
  it('handles leap years', () => {
    expect(wibDay(generateInstallments(100n, 1, new Date('2028-01-31T09:00:00+07:00'), 1)[0].dueDate)).toBe('2028-02-29');
  });
  it('uses WIB even when the UTC date is still yesterday', () => {
    const now = new Date('2026-09-11T18:00:00Z');
    expect(wibDay(now)).toBe('2026-09-12');
    expect(daysUntil(new Date('2026-09-15T01:00:00+07:00'), now)).toBe(3);
  });
});
