import type { OfflinePack, PackFlight, PackPlace } from "@/lib/packs/types";
import { currentStay } from "@/lib/rules/context";
import { addDays, localDate } from "@/lib/time";
import { normalize, tokMatch, tokens } from "./text";

export type Entities = {
  /** A destination the question names ("hotel in Rome"). */
  city?: string;
  /** A real place from the trip the question names ("Colosseum"). */
  place?: PackPlace;
  flight?: PackFlight;
  /** ISO date the question points at ("today", "kal", "day 3", "17 Nov"). */
  date?: string;
  dayNo?: number;
  relative?: "today" | "tomorrow" | "day-after";
};

const STOP = new Set(["the", "and", "of", "de", "la", "le", "di", "del", "du", "da", "el", "al", "hotel", "airport", "international", "old", "town", "city", "new", "great", "grand", "royal", "national", "museum", "tower", "palace", "church", "temple", "market", "park", "square", "street", "beach", "bridge", "gardens", "garden", "station", "centre", "center", "street"]);

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function extract(pack: OfflinePack, question: string, now: Date): Entities {
  const q = normalize(question);
  const qt = tokens(question);
  const out: Entities = {};

  // city
  for (const s of pack.stays) {
    const ct = tokens(s.cityName);
    if (ct.length && ct.every((c) => qt.some((t) => t === c || (c.length >= 5 && tokMatch(t, c))))) out.city = s.city;
  }

  // flight number such as AJ724 or "aj 724"
  const fm = question.toUpperCase().match(/\b([A-Z]{2})\s?(\d{2,4})\b/);
  if (fm) out.flight = pack.flights.find((f) => f.flight_no.toUpperCase() === `${fm[1]}${fm[2]}`);

  // place from the trip: need most of its distinctive words
  let best = 0;
  for (const p of Object.values(pack.places)) {
    const words = tokens(p.name.replace(/\(.*?\)/g, " ")).filter((w) => w.length >= 3 && !STOP.has(w));
    if (!words.length) continue;
    const hit = words.filter((w) => qt.some((t) => t === w || (w.length >= 5 && tokMatch(t, w)))).length;
    const ratio = hit / words.length;
    const score = ratio >= 0.6 ? hit + ratio : 0;
    if (score > best) { best = score; out.place = p; }
  }
  if (out.place && pack.stays.some((s) => tokens(s.cityName).join(" ") === normalize(out.place!.name))) out.place = undefined;

  // date words
  const stay = currentStay(pack, now, out.city);
  const today = localDate(now, stay.tz);
  if (/\b(tomorrow|kal|tmrw|tomorow)\b/.test(q)) { out.relative = "tomorrow"; out.date = addDays(today, 1); }
  else if (/\b(day after tomorrow|parso)\b/.test(q)) { out.relative = "day-after"; out.date = addDays(today, 2); }
  else if (/\b(today|aaj|tonight|now)\b/.test(q)) { out.relative = "today"; out.date = today; }
  const dn = q.match(/\bday (\d{1,2})\b/);
  if (dn) { out.dayNo = Number(dn[1]); out.date = pack.days.find((d) => d.dayNo === out.dayNo)?.date ?? out.date; }
  const iso = question.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) out.date = iso[1];
  const dm = q.match(/\b(\d{1,2}) (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/) ?? q.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (\d{1,2})\b/);
  if (dm) {
    const [day, mon] = /^\d/.test(dm[1]) ? [Number(dm[1]), dm[2]] : [Number(dm[2]), dm[1]];
    const m = MONTHS.indexOf(mon) + 1;
    const yr = Number((pack.booking.dates[0] ?? today).slice(0, 4));
    let cand = `${yr}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (pack.booking.dates[0] && cand < addDays(pack.booking.dates[0], -200)) cand = `${yr + 1}-${cand.slice(5)}`;
    out.date = cand;
  }
  return out;
}
