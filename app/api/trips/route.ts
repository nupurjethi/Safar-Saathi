import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { handle, json } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const GET = handle(async () => {
  const sess = await requireSession();
  const db = await getDb();
  const rows = await db
    .select({ ref: s.bookings.ref, startDate: s.bookings.startDate, endDate: s.bookings.endDate, pax: s.bookings.pax, status: s.bookings.status, totalInr: s.bookings.totalInr, packVersion: s.bookings.packVersion, title: s.itineraries.title, slug: s.itineraries.slug, palette: s.itineraries.heroPalette })
    .from(s.bookings)
    .innerJoin(s.itineraries, eq(s.itineraries.id, s.bookings.itineraryId))
    .where(eq(s.bookings.userId, sess.uid))
    .orderBy(desc(s.bookings.startDate));
  const dests = await db.select({ slug: s.destinations.slug, hero: s.destinations.heroImage, credit: s.destinations.heroCredit }).from(s.destinations);
  const heroOf = new Map(dests.map((d) => [d.slug, d.hero && d.credit ? { src: d.hero, credit: d.credit } : null]));
  const its = await db.select({ slug: s.itineraries.slug, cities: s.itineraries.cities }).from(s.itineraries);
  const first = new Map(its.map((i) => [i.slug, i.cities[0]]));
  return json({ trips: rows.map((r) => ({ ...r, hero: heroOf.get(first.get(r.slug) ?? "") ?? null })) });
});
