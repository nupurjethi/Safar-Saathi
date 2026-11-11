import { and, asc, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { handle, json } from "@/lib/server/http";
import { addDays } from "@/lib/time";

export const dynamic = "force-dynamic";
const Q = z.object({ hotelId: z.string().uuid(), checkin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), nights: z.coerce.number().int().min(1).max(14).default(1), rooms: z.coerce.number().int().min(1).max(5).default(1) });

export async function stayAvailability(input: z.infer<typeof Q>) {
  const db = await getDb();
  const end = addDays(input.checkin, input.nights);
  const [h] = await db.select().from(s.hotels).where(eq(s.hotels.id, input.hotelId)).limit(1);
  const rows = await db.select().from(s.roomInventory).where(and(eq(s.roomInventory.hotelId, input.hotelId), eq(s.roomInventory.roomType, "standard"), gte(s.roomInventory.date, input.checkin), lt(s.roomInventory.date, end))).orderBy(asc(s.roomInventory.date));
  const available = rows.length === input.nights && rows.every((r) => r.roomsLeft >= input.rooms);
  return { hotel: h && { id: h.id, name: h.name, stars: h.stars }, checkin: input.checkin, checkout: end, nights: input.nights, rooms: input.rooms, available, perNight: rows.map((r) => ({ date: r.date, priceInr: r.priceInr, roomsLeft: r.roomsLeft })), totalInr: available ? rows.reduce((a, r) => a + r.priceInr, 0) * input.rooms : null };
}

export const GET = handle(async (req: Request) => {
  const q = Q.parse(Object.fromEntries(new URL(req.url).searchParams));
  return json({ ...(await stayAvailability(q)), notice: "Sample data. Not live inventory." });
});
