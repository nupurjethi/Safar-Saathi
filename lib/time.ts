/** Timezone helpers with no dependencies. Dates are "YYYY-MM-DD", times "HH:mm". */

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    dtfCache.set(tz, f);
  }
  return f;
}

/** Offset of `tz` from UTC in minutes at the given instant. */
export function tzOffsetMinutes(at: Date, tz: string): number {
  const parts = dtf(tz).formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return Math.round((asUtc - at.getTime()) / 60000);
}

const offsetCache = new Map<string, number>();
/** Fast offset for a calendar day (sampled at noon UTC). Good enough for seed data. */
export function tzOffsetForDay(dateStr: string, tz: string): number {
  const k = `${tz}|${dateStr}`;
  let v = offsetCache.get(k);
  if (v === undefined) {
    v = tzOffsetMinutes(new Date(`${dateStr}T12:00:00Z`), tz);
    offsetCache.set(k, v);
  }
  return v;
}

/** Wall-clock time in `tz` -> UTC Date. */
export function zonedToUtc(dateStr: string, timeStr: string, tz: string): Date {
  const guess = new Date(`${dateStr}T${timeStr}:00Z`);
  const off1 = tzOffsetMinutes(guess, tz);
  const first = new Date(guess.getTime() - off1 * 60000);
  const off2 = tzOffsetMinutes(first, tz);
  return off1 === off2 ? first : new Date(guess.getTime() - off2 * 60000);
}

export function localDate(at: Date, tz: string): string {
  const p = dtf(tz).formatToParts(at);
  const g = (t: string) => p.find((x) => x.type === t)?.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

export function localTime(at: Date, tz: string): string {
  const p = dtf(tz).formatToParts(at);
  const g = (t: string) => p.find((x) => x.type === t)?.value;
  return `${g("hour")}:${g("minute")}`;
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400000);
}

/** UTC [start, end) of a local calendar day in `tz`. */
export function localDayRangeUtc(dateStr: string, tz: string): [Date, Date] {
  return [zonedToUtc(dateStr, "00:00", tz), zonedToUtc(addDays(dateStr, 1), "00:00", tz)];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "12 Dec" (DD Mon). */
export function fmtDate(dateStr: string, withYear = false): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
}

/** Short zone label like "CET" / "GMT+1" for a tz at an instant. */
export function tzLabel(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? tz;
}

/** "09:30 CET" – 24-hour time with the zone named (UX rule). */
export function fmtTimeZ(at: Date | string, tz: string): string {
  const d = typeof at === "string" ? new Date(at) : at;
  return `${localTime(d, tz)} ${tzLabel(d, tz)}`;
}

/** Indian digit grouping: 125000 -> ₹1,25,000 */
export function inr(n: number): string {
  const neg = n < 0;
  const s = Math.abs(Math.round(n)).toString();
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  return `${neg ? "-" : ""}₹${grouped}`;
}
