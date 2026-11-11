import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { createBooking } from "@/lib/server/booking";
import { publishPack } from "@/lib/packs/build";
import { addDays } from "@/lib/time";
import { truncateUserData } from "./insert";

export const DEMO_EMAIL = "neha@demo.safarsaathi.test";
export const DEMO_REF = "SS-48213";
export const DEMO_SLUG = "paris-rome-classic-7n";
/** Second demo trip: Bangalore, starting today, so the presenter can stand in the city and show the offline map and GPS working. */
export const DEMO_BLR_REF = "SS-56001";
export const DEMO_BLR_SLUG = "bangalore-3n-standard-culture";

export async function createDemoUsers(db: Db) {
  const rows = await db
    .insert(s.users)
    .values([
      { email: DEMO_EMAIL, name: "Neha Kulkarni", phoneE164: "+919800000001", role: "traveller", isDemo: true },
      { email: "asha@demo.safarsaathi.test", name: "Asha (Support)", role: "agent", isDemo: true },
      { email: "admin@demo.safarsaathi.test", name: "Admin", role: "admin", isDemo: true },
    ])
    .returning();
  return { neha: rows[0], agent: rows[1], admin: rows[2] };
}

/** Neha's upcoming Paris → Rome trip for 4, starting `startInDays` after the seed base date. */
export async function createDemoBooking(db: Db, userId: string, baseDate: string, startInDays = 3) {
  const { booking } = await createBooking(
    {
      userId, slug: DEMO_SLUG, startDate: addDays(baseDate, startInDays), pax: 4, ref: DEMO_REF,
      travellers: [
        { name: "Neha Kulkarni", ageBand: "adult", passportLast4: "4821" },
        { name: "Sameer Kulkarni", ageBand: "adult", passportLast4: "4822" },
        { name: "Anaya Kulkarni", ageBand: "child", passportLast4: "9013" },
        { name: "Shalini Kulkarni", ageBand: "senior", passportLast4: "7305" },
      ],
    },
    db,
  );
  const pack = await publishPack(booking.id, db);
  return { booking, pack };
}

/** Neha's Bangalore trip for 2, starting `startInDays` (default 0 = today) after the seed base date. */
export async function createBangaloreDemoBooking(db: Db, userId: string, baseDate: string, startInDays = 0) {
  const { booking } = await createBooking(
    {
      userId, slug: DEMO_BLR_SLUG, startDate: addDays(baseDate, startInDays), pax: 2, ref: DEMO_BLR_REF,
      travellers: [
        { name: "Neha Kulkarni", ageBand: "adult", passportLast4: "4821" },
        { name: "Sameer Kulkarni", ageBand: "adult", passportLast4: "4822" },
      ],
    },
    db,
  );
  const pack = await publishPack(booking.id, db);
  return { booking, pack };
}

/** Admin "reset demo data": wipes bookings/agent/cases/packs, keeps the catalogue, recreates Neha's trip. */
export async function resetDemoData(db: Db, baseDate: string) {
  await truncateUserData(db);
  const { neha } = await createDemoUsers(db);
  const demo = await createDemoBooking(db, neha.id, baseDate);
  const blr = await createBangaloreDemoBooking(db, neha.id, baseDate);
  return { neha, ...demo, blr };
}

export async function findDemoUser(db: Db) {
  const [u] = await db.select().from(s.users).where(eq(s.users.email, DEMO_EMAIL)).limit(1);
  return u ?? null;
}

export const todayUtc = () => new Date().toISOString().slice(0, 10);
