import { config } from "dotenv";
config({ path: ".env.local" });
import { closeDb, dbKind, getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { publishPack } from "@/lib/packs/build";

/**
 * Rebuilds every booking's offline pack. Run after `tiles:build` (so packs list the tile files) or after adding a
 * ROUTING_API_KEY (so routes switch from straight-line samples to real road routes from OpenRouteService).
 * Routing calls happen here, at build time, never from the phone.
 */
async function main() {
  const db = await getDb();
  const rows = await db.select({ id: s.bookings.id, ref: s.bookings.ref }).from(s.bookings);
  console.log(`(${dbKind()}) rebuilding ${rows.length} pack(s). Routing: ${process.env.ROUTING_API_KEY ? "OpenRouteService" : "straight-line samples (no ROUTING_API_KEY)"}`);
  for (const r of rows) {
    const p = await publishPack(r.id, db);
    console.log(`  ${r.ref}: ${p.changed ? `v${p.version} built` : `v${p.version} unchanged`}`);
  }
  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
