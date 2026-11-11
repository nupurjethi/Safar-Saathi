import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { selectTrip, payTrip } from "@/lib/server/trips";
import { getLatestPack } from "@/lib/packs/build";
import type { OfflinePack } from "@/lib/packs/types";
import { setupDb, BASE_DATE } from "./helpers";
import { addDays } from "@/lib/time";

/** "All the trips work": every one of the catalogue's itineraries can be selected, paid, and opened offline with a real map, real routes and photos. */
describe("every catalogue trip works end to end", () => {
  it("selects, pays and builds a complete offline bundle for all itineraries", async () => {
    const { neha } = await setupDb();
    const db = await getDb();
    const its = await db.select().from(s.itineraries);
    expect(its.length).toBeGreaterThanOrEqual(100);
    const problems: string[] = [];
    for (const it of its) {
      try {
        const r = await selectTrip({ userId: neha.id, slug: it.slug, startDate: addDays(BASE_DATE, 4), pax: 2 }, db);
        await payTrip({ userId: neha.id, ref: r.ref, travellers: [{ name: "A One", ageBand: "adult" }, { name: "B Two", ageBand: "adult" }] }, db);
        const [b] = await db.select().from(s.bookings).where(eq(s.bookings.ref, r.ref));
        const pack = (await getLatestPack(b.id, db))!.pack as OfflinePack;
        const bad: string[] = [];
        if (pack.booking.status !== "confirmed") bad.push("not confirmed");
        if (!pack.days.length || !pack.stays.length || !pack.flights.length) bad.push("missing days/stays/flights");
        for (const c of pack.map.cities) if (!c.pmtiles || !c.core) bad.push(`no street tiles for ${c.id}`);
        if (!pack.routes.length) bad.push("no routes");
        const straight = pack.routes.filter((x) => x.approximate).length;
        if (straight) bad.push(`${straight} straight-line routes`);
        if (!Object.values(pack.places).some((p) => p.image)) bad.push("no landmark photo");
        if (Object.keys(pack.rules).length < 6) bad.push("fewer than 6 guide scenarios");
        if (bad.length) problems.push(`${it.slug}: ${bad.join("; ")}`);
      } catch (e) { problems.push(`${it.slug}: ${e instanceof Error ? e.message : e}`); }
    }
    expect(problems, problems.slice(0, 8).join("\n")).toEqual([]);
  }, 600_000);
});
