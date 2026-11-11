import { getDb } from "@/lib/db/client";
import { resetDemoData, todayUtc } from "@/lib/seed/demo";
import { clearCatalogueCache } from "@/lib/server/catalogue";
import { GateError } from "@/lib/gate/errors";
import { handle, json } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
/** Resets bookings, agent history, cases and packs; keeps the catalogue. Recreates Neha's Paris → Rome trip. */
export const POST = handle(async () => {
  await requireSession(["admin"]);
  if (process.env.DEMO_MODE === "false") throw new GateError("FORBIDDEN", 403, "Demo reset is turned off.");
  const db = await getDb();
  const r = await resetDemoData(db, todayUtc());
  clearCatalogueCache();
  return json({ ok: true, ref: r.booking.ref, packVersion: r.pack.version });
});
