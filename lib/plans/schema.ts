import { z } from "zod";

const D = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const DT = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
const HM = z.string().regex(/^\d{2}:\d{2}$/);
const IATA = z.string().regex(/^[A-Z]{3}$/);
const opt = <T extends z.ZodTypeAny>(s: T) => s.optional().nullable().transform((v) => v ?? undefined);
const str = (max: number) => z.string().trim().min(1).max(max);

/** What the model must return from the uploaded documents. Anything not in the documents is left out (never guessed). */
export const PlanSchema = z.object({
  title: str(120),
  travellers: z.array(z.object({ name: str(80) })).max(12).default([]),
  pax: z.number().int().min(1).max(12),
  startDate: D,
  endDate: D,
  homeCity: opt(str(60)),
  cities: z.array(z.object({ name: str(60), country: str(60), timezone: str(60), from: D, to: D })).min(1).max(8),
  flights: z.array(z.object({
    airline: str(60), flightNo: str(10), from: IATA, to: IATA, fromCity: opt(str(60)), toCity: opt(str(60)),
    departLocal: DT, arriveLocal: DT, fromTimezone: opt(str(60)), toTimezone: opt(str(60)), pnr: opt(str(12)), terminal: opt(str(20)),
  })).max(12).default([]),
  hotels: z.array(z.object({ name: str(100), address: str(200), city: str(60), checkin: D, checkout: D, phone: opt(str(30)), confirmation: opt(str(30)), rooms: opt(z.number().int().min(1).max(9)) })).max(10).default([]),
  activities: z.array(z.object({ date: D, time: opt(HM), title: str(140), place: opt(str(120)), city: str(60), notes: opt(str(240)) })).max(80).default([]),
  transfers: z.array(z.object({ date: D, time: opt(HM), from: str(120), to: str(120), city: opt(str(60)), provider: opt(str(80)), driver: opt(str(60)), phone: opt(str(30)), code: opt(str(20)) })).max(20).default([]),
  contacts: z.array(z.object({ label: str(60), phone: str(30) })).max(20).default([]),
  notes: z.array(z.string().max(300)).max(20).default([]),
});
export type Plan = z.infer<typeof PlanSchema>;

export const validTz = (tz: string | undefined) => { if (!tz) return false; try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } };

/** Checks that need more than the shape: dates in order, time zones real. Returns plain-English warnings (the plan is still used). */
export function planWarnings(p: Plan): string[] {
  const w: string[] = [];
  if (p.endDate < p.startDate) w.push("The trip end date is before the start date in your documents.");
  for (const c of p.cities) if (!validTz(c.timezone)) w.push(`Unknown time zone for ${c.name}; times there are shown as written.`);
  for (const h of p.hotels) if (h.checkout <= h.checkin) w.push(`${h.name}: check-out is not after check-in.`);
  if (!p.hotels.length) w.push("No hotel found in your documents. The guide uses the city centre as your base.");
  if (!p.flights.length) w.push("No flights found in your documents.");
  for (const h of p.hotels) if (!h.phone) w.push(`${h.name}: no phone number in your documents.`);
  return w;
}
