import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });
import { closeDb, dbKind, getDb } from "@/lib/db/client";
import { createBangaloreDemoBooking, createDemoBooking, createDemoUsers, todayUtc } from "@/lib/seed/demo";
import { seedCatalogue, truncateAll } from "@/lib/seed/insert";

async function main() {
  const t0 = Date.now();
  const baseDate = process.env.SEED_BASE_DATE ?? todayUtc();
  const flightDays = Number(process.env.SEED_FLIGHT_DAYS ?? 120);
  console.log(`Seeding (${dbKind()}) base ${baseDate}, ${flightDays} days of inventory`);
  const db = await getDb();
  await truncateAll(db);
  await seedCatalogue(db, { baseDate, flightDays }, (m) => console.log("  " + m));
  const { neha } = await createDemoUsers(db);
  const { booking, pack } = await createDemoBooking(db, neha.id, baseDate);
  const blr = await createBangaloreDemoBooking(db, neha.id, baseDate);
  console.log(`Bangalore demo booking ${blr.booking.ref} ready (starts today, pack v${blr.pack.version})`);
  console.log(`Demo booking ${booking.ref} ready, pack v${pack.version}. Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
