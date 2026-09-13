const WIB_OFFSET = 7 * 60 * 60 * 1000;
export function wibDay(date: Date) {
  return new Date(date.getTime() + WIB_OFFSET).toISOString().slice(0, 10);
}
export function wibHour(date: Date) {
  return new Date(date.getTime() + WIB_OFFSET).getUTCHours();
}
export function daysUntil(due: Date, now: Date) {
  return Math.round((Date.parse(wibDay(due)) - Date.parse(wibDay(now))) / 86400000);
}
// Preserve the original day where possible; Jan 31 + 1 month becomes Feb 28/29.
export function addMonthsWib(date: Date, months: number) {
  const local = new Date(date.getTime() + WIB_OFFSET);
  const day = local.getUTCDate();
  local.setUTCDate(1);
  local.setUTCMonth(local.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
  local.setUTCDate(Math.min(day, lastDay));
  return new Date(local.getTime() - WIB_OFFSET);
}
