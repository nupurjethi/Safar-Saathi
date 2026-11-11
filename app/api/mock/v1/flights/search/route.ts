import { and, asc, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { handle, json } from "@/lib/server/http";
import { ORIGINS } from "@/lib/seed/data";
import { localDate, localDayRangeUtc } from "@/lib/time";
import { inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";
const Q = z.object({ from: z.string().length(3), to: z.string().length(3), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), pax: z.coerce.number().int().min(1).max(9).default(1), anchor: z.enum(["depart", "arrive"]).default("depart") });

export async function searchFlights(input: z.infer<typeof Q>) {
  const db = await getDb();
  const from = input.from.toUpperCase(), to = input.to.toUpperCase();
  const dests = await db.select().from(s.destinations).where(inArray(s.destinations.airportIata, [from, to]));
  const tz = (iata: string) => ORIGINS[iata]?.tz ?? dests.find((d) => d.airportIata === iata)?.timezone ?? "UTC";
  const anchorTz = tz(input.anchor === "depart" ? from : to);
  const [lo, hi] = localDayRangeUtc(input.date, anchorTz);
  const col = input.anchor === "depart" ? s.flights.departAt : s.flights.arriveAt;
  const rows = await db.select().from(s.flights).where(and(eq(s.flights.fromIata, from), eq(s.flights.toIata, to), gte(col, lo), lt(col, hi))).orderBy(asc(s.flights.departAt));
  return rows.map((f) => ({
    id: f.id, flightNo: f.flightNo, carrierName: f.carrierName, from: f.fromIata, to: f.toIata, departAt: f.departAt.toISOString(), arriveAt: f.arriveAt.toISOString(),
    departLocalDate: localDate(f.departAt, tz(from)), farePerPaxInr: f.fareInr, seatsLeft: f.seatsLeft, available: f.seatsLeft >= input.pax, changeFeeInr: f.changeFeeInr, fareRules: f.fareRules,
  }));
}

export const GET = handle(async (req: Request) => {
  const q = Q.parse(Object.fromEntries(new URL(req.url).searchParams));
  return json({ flights: await searchFlights(q), notice: "Sample data. Not live inventory." });
});
