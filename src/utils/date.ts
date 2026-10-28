/**
 * Date helpers. All dates inside the system are represented as ISO calendar
 * dates (`YYYY-MM-DD`, no time component) and "day boundaries" are resolved in
 * the configured timezone rather than the process timezone.
 */

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDateString(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  return isValidCalendarDate(value);
}

export function isValidCalendarDate(value: string): boolean {
  const [yearStr, monthStr, dayStr] = value.split('-');
  if (!yearStr || !monthStr || !dayStr) return false;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/** Formats a Date as an ISO calendar date in the given IANA timezone. */
export function formatIsoDateInTz(date: Date, timezone: string): string {
  // en-CA yields YYYY-MM-DD reliably.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Returns today's date (ISO calendar date) in the given timezone. */
export function todayInTz(timezone: string): string {
  assertValidTimezone(timezone);
  return formatIsoDateInTz(new Date(), timezone);
}

export function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
  } catch {
    throw new Error(`Unknown timezone: ${timezone}`);
  }
}

/** Compares two ISO calendar dates. Returns negative/0/positive like string compare. */
export function compareIsoDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Returns the ISO date of the Monday that starts the week containing `isoDate`. */
export function weekStartIso(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay(); // 0=Sunday..6=Saturday
  const diff = dow === 0 ? -6 : 1 - dow;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

/** Returns [monday, sunday] of the week containing `isoDate`. */
export function weekRangeIso(isoDate: string): { start: string; end: string } {
  const start = weekStartIso(isoDate);
  return { start, end: addDaysIso(start, 6) };
}

/** List of ISO dates from `from` to `to` inclusive (assumes from <= to). */
export function eachDayIso(from: string, to: string): string[] {
  const days: string[] = [];
  let cursor = from;
  while (compareIsoDates(cursor, to) <= 0) {
    days.push(cursor);
    cursor = addDaysIso(cursor, 1);
  }
  return days;
}
