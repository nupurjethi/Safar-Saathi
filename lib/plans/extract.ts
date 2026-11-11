import { llmAvailable, llmJson } from "@/lib/llm";
import { PlanSchema, planWarnings, type Plan } from "./schema";

export const PLAN_PROMPT_VERSION = "plan-extract-v1";

const SYSTEM = `You read a traveller's own travel documents (tickets, hotel vouchers, itineraries, spreadsheets, screenshots) and return ONE JSON object describing the trip.
Rules:
- Use ONLY facts written in the documents. If something is not there, leave the field out. Never guess phone numbers, booking codes, flight numbers, addresses or times.
- Dates as YYYY-MM-DD. Local date-times as YYYY-MM-DDTHH:mm in the local time of that airport or city (exactly as printed). Times of day as HH:mm (24 h).
- Airports as 3-letter IATA codes (e.g. BOM, DXB). Add each city's IANA time zone (e.g. Asia/Dubai) and each flight's fromTimezone/toTimezone.
- cities: every city the traveller stays in, in order, with the dates they are there. homeCity: where the trip starts and ends, if shown.
- activities: sightseeing, tours, restaurants or events with a date, the place name if given, and the city.
- transfers: airport pickups, drops and other booked rides, with provider, driver, phone and pickup code if given.
- contacts: phone numbers printed in the documents with what they are for (airline, hotel, tour operator, insurance, emergency).
- pax: number of travellers. travellers: their names if printed. title: a short trip name like "Dubai family trip, 5 nights".
Return JSON only, no markdown, with these keys: title, travellers[{name}], pax, startDate, endDate, homeCity, cities[{name,country,timezone,from,to}], flights[{airline,flightNo,from,to,fromCity,toCity,departLocal,arriveLocal,fromTimezone,toTimezone,pnr,terminal}], hotels[{name,address,city,checkin,checkout,phone,confirmation,rooms}], activities[{date,time,title,place,city,notes}], transfers[{date,time,from,to,city,provider,driver,phone,code}], contacts[{label,phone}], notes[string].`;

export type ExtractInput = { files: { name: string; text?: string; imageDataUrl?: string }[] };
export type ExtractResult = { ok: true; plan: Plan; warnings: string[] } | { ok: false; error: string };

/** One model call over all documents (text + images), validated against PlanSchema; one retry with the validation errors. */
export async function extractPlan(input: ExtractInput): Promise<ExtractResult> {
  if (!llmAvailable()) return { ok: false, error: "No AI model is configured (set LLM_API_KEY), so uploaded documents cannot be read yet." };
  const texts = input.files.filter((f) => f.text).map((f) => `=== FILE: ${f.name} ===\n${f.text}`);
  const images = input.files.filter((f) => f.imageDataUrl).map((f) => f.imageDataUrl!).slice(0, 8);
  if (!texts.length && !images.length) return { ok: false, error: "None of the files had readable content." };
  const base = `Documents (${texts.length} text file${texts.length === 1 ? "" : "s"}${images.length ? `, ${images.length} image${images.length === 1 ? "" : "s"} attached` : ""}):\n\n${texts.join("\n\n").slice(0, 180_000)}`;
  let errors = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await llmJson({ purpose: "plan", promptVersion: PLAN_PROMPT_VERSION, system: SYSTEM, prompt: errors ? `${base}\n\nYour previous JSON was invalid: ${errors}\nReturn corrected JSON only.` : base, images, maxOutputTokens: 12000 });
    if (!r.ok) { errors = r.error; continue; }
    const parsed = PlanSchema.safeParse(normalise(r.data));
    if (parsed.success) return { ok: true, plan: parsed.data, warnings: planWarnings(parsed.data) };
    errors = parsed.error.issues.slice(0, 12).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  }
  return { ok: false, error: `The documents could not be turned into a travel plan (${errors.slice(0, 300)}).` };
}

/** Small, safe clean-ups before validation (upper-case codes, drop empty strings, trim seconds). Never adds facts. */
export function normalise(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const clean = (v: unknown): unknown => {
    if (typeof v === "string") { const s = v.trim(); return s === "" ? undefined : s; }
    if (Array.isArray(v)) return v.map(clean).filter((x) => x !== undefined);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)]).filter(([, x]) => x !== undefined));
    return v;
  };
  const p = clean(raw) as Record<string, unknown>;
  const fl = (p.flights as Record<string, unknown>[] | undefined) ?? [];
  for (const f of fl) {
    for (const k of ["from", "to"]) if (typeof f[k] === "string") f[k] = (f[k] as string).toUpperCase();
    if (typeof f.flightNo === "string") f.flightNo = (f.flightNo as string).toUpperCase().replace(/\s+/g, "");
    for (const k of ["departLocal", "arriveLocal"]) if (typeof f[k] === "string") f[k] = (f[k] as string).replace(" ", "T").slice(0, 16);
  }
  if (typeof p.pax !== "number") p.pax = Array.isArray(p.travellers) && p.travellers.length ? p.travellers.length : 1;
  return p;
}
