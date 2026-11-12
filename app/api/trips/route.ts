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
    .select({ ref: s.bookings.ref, startDate: s.bookings.startDate, endDate: s.bookings.endDate, pax: s.bookings.pax, status: s.bookings.status, totalInr: s.bookings.totalInr, packVersion: s.bookings.packVersion, title: s.itineraries.title, slug: s.itineraries.slug, palette: s.itineraries.heroPalette, planTitle: s.travelPlans.title, planExtracted: s.travelPlans.extracted, source: s.bookings.source })
    .from(s.bookings)
    .leftJoin(s.itineraries, eq(s.itineraries.id, s.bookings.itineraryId))
    .leftJoin(s.travelPlans, eq(s.travelPlans.id, s.bookings.planId))
    .where(eq(s.bookings.userId, sess.uid))
    .orderBy(desc(s.bookings.startDate));
  const dests = await db.select({ slug: s.destinations.slug, hero: s.destinations.heroImage, credit: s.destinations.heroCredit }).from(s.destinations);
  const heroOf = new Map(dests.map((d) => [d.slug, d.hero && d.credit ? { src: d.hero, credit: d.credit } : null]));
  const its = await db.select({ slug: s.itineraries.slug, cities: s.itineraries.cities }).from(s.itineraries);
  const first = new Map(its.map((i) => [i.slug, i.cities[0]]));
  return json({ trips: rows.map(({ planTitle, planExtracted, ...r }) => ({ ...r, title: r.title ?? planTitle ?? "My travel plan", palette: r.palette ?? ["#d8fd34", "#1f2a05"], hero: r.slug ? heroOf.get(first.get(r.slug) ?? "") ?? null : ((h) => (h ? { src: h.src, credit: { title: h.title, author: h.author, license: h.license, licenseUrl: h.licenseUrl, sourceUrl: h.sourceUrl, pageUrl: h.sourceUrl } } : null))((planExtracted as { hero?: { src: string; title: string; author: string; license: string; licenseUrl: string; sourceUrl: string } } | null)?.hero) })) });
});
