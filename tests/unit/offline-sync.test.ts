import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupDb } from "./helpers";
import { getLatestPack } from "@/lib/packs/build";
import { packContentHash, sha256Hex } from "@/lib/packs/hash";
import type { OfflinePack, PackManifest } from "@/lib/packs/types";
import { deleteTrip, getStored, offlineDb, SHELL_CACHE, tripCacheName } from "@/lib/offline/dexie";
import { syncTrip } from "@/lib/offline/sync";

/* ---- a tiny in-memory Cache Storage ---- */
class MemCache {
  map = new Map<string, Response>();
  async put(k: string | Request, r: Response) { this.map.set(typeof k === "string" ? k : k.url, r); }
  async match(k: string | Request) { const r = this.map.get(typeof k === "string" ? k : k.url); return r ? r.clone() : undefined; }
  async keys() { return [...this.map.keys()].map((u) => new Request(u)); }
}
const store = new Map<string, MemCache>();
const memCaches = {
  async open(n: string) { if (!store.has(n)) store.set(n, new MemCache()); return store.get(n)!; },
  async keys() { return [...store.keys()]; },
  async delete(n: string) { return store.delete(n); },
  async match(k: string) { for (const c of store.values()) { const r = await c.match(k); if (r) return r; } return undefined; },
};

const enc = (s: string) => new TextEncoder().encode(s);
let base: OfflinePack;
const tileBytes = { paris: enc("PARIS-TILES-v1".repeat(50)), rome: enc("ROME-TILES-v1".repeat(50)) };
let tileHashes: Record<string, string> = {};
let fetchLog: string[] = [];
const served: Record<string, { body: Uint8Array | string; status?: number }> = {};

async function packFor(version: number, mutate: (p: OfflinePack) => void = () => {}) {
  const p = JSON.parse(JSON.stringify(base)) as OfflinePack;
  p.packVersion = version; mutate(p);
  p.contentHash = await packContentHash(p as unknown as Record<string, unknown>);
  return p;
}
function manifestFor(p: OfflinePack, tiles: { slug: string; hash: string }[]): PackManifest {
  const ref = p.booking.ref;
  const text = JSON.stringify(p);
  return {
    bookingRef: ref, packVersion: p.packVersion, contentHash: p.contentHash, builtAt: p.builtAt, totalBytes: text.length + 5000, budgetBytes: 80 * 1048576, overBudget: false,
    files: [
      { url: `/api/packs/${ref}/pack?v=${p.packVersion}`, kind: "pack", bytes: text.length, hash: p.contentHash },
      ...tiles.map((t) => ({ url: `/tiles/${t.slug}.pmtiles`, kind: "tiles" as const, bytes: 700, hash: t.hash })),
      { url: "/map/style.json", kind: "map-asset", bytes: 60, hash: tileHashes.style },
    ],
  };
}
function serve(p: OfflinePack, m: PackManifest) {
  const ref = p.booking.ref;
  served[`/api/packs/${ref}/manifest`] = { body: JSON.stringify(m) };
  served[`/api/packs/${ref}/pack?v=${p.packVersion}`] = { body: JSON.stringify(p) };
}

beforeAll(async () => {
  const { booking } = await setupDb();
  base = (await getLatestPack(booking.id))!.pack as OfflinePack;
  tileHashes = { paris: await sha256Hex(tileBytes.paris.buffer as ArrayBuffer), rome: await sha256Hex(tileBytes.rome.buffer as ArrayBuffer), style: await sha256Hex(enc('{"version":8}').buffer as ArrayBuffer) };
  served["/tiles/paris.pmtiles"] = { body: tileBytes.paris };
  served["/tiles/rome.pmtiles"] = { body: tileBytes.rome };
  served["/map/style.json"] = { body: '{"version":8}' };
});

beforeEach(async () => {
  store.clear(); fetchLog = [];
  const db = offlineDb();
  await Promise.all([db.trips.clear(), db.tripPacks.clear(), db.rulesets.clear(), db.fileRecs.clear()]);
  vi.stubGlobal("caches", memCaches);
  vi.stubGlobal("location", { origin: "http://localhost" });
  vi.stubGlobal("fetch", async (input: string | Request) => {
    const url = typeof input === "string" ? input : input.url;
    const path = url.replace("http://localhost", "");
    fetchLog.push(path);
    const hit = served[path];
    if (!hit) return new Response("nope", { status: 404 });
    return new Response(hit.body as BodyInit, { status: hit.status ?? 200 });
  });
});

describe("per-trip cache, hash checks, atomic swap and resume (spec 4)", () => {
  it("syncs a trip into its own cache namespace and activates version 1", async () => {
    const p1 = await packFor(1); const ref = p1.booking.ref;
    serve(p1, manifestFor(p1, [{ slug: "paris", hash: tileHashes.paris }]));
    const r = await syncTrip(ref);
    expect(r).toMatchObject({ updated: true, version: 1 });
    expect((await getStored(ref))!.version).toBe(1);
    expect((await getStored(ref))!.pack.rules["hotel-not-found"]).toBeTruthy(); // rules come from the separate rulesets store
    expect([...store.keys()]).toContain(tripCacheName(ref, 1));
    expect(await (await memCaches.open(tripCacheName(ref, 1))).match("http://localhost/tiles/paris.pmtiles")).toBeTruthy();
    expect(await (await memCaches.open(SHELL_CACHE)).match("http://localhost/map/style.json")).toBeTruthy(); // shared map asset
  });

  it("if one file's hash fails, the old version stays active and nothing half-written becomes active", async () => {
    const p1 = await packFor(1); const ref = p1.booking.ref;
    serve(p1, manifestFor(p1, [{ slug: "paris", hash: tileHashes.paris }]));
    await syncTrip(ref);
    const p2 = await packFor(2, (p) => { p.booking.title = "Changed title"; });
    serve(p2, manifestFor(p2, [{ slug: "rome", hash: "sha256:" + "0".repeat(64) }])); // declared hash does not match the bytes served
    const r = await syncTrip(ref);
    expect(r.updated).toBe(false);
    expect(r.reason).toBe("error");
    expect(r.message).toMatch(/Integrity check failed/);
    expect((await getStored(ref))!.version).toBe(1);
    expect((await getStored(ref))!.pack.booking.title).toBe(base.booking.title);
    expect((await offlineDb().trips.get(ref))!.activeVersion).toBe(1);
    expect(await offlineDb().tripPacks.get([ref, 2])).toBeUndefined();
    expect(await (await memCaches.open(tripCacheName(ref, 1))).match("http://localhost/tiles/paris.pmtiles")).toBeTruthy(); // v1 files untouched
    expect(await (await memCaches.open(tripCacheName(ref, 2))).match("http://localhost/tiles/rome.pmtiles")).toBeUndefined(); // the bad file was never written
  });

  it("a good update swaps atomically, reuses unchanged files without downloading, and deletes the old version", async () => {
    const p1 = await packFor(1); const ref = p1.booking.ref;
    serve(p1, manifestFor(p1, [{ slug: "paris", hash: tileHashes.paris }]));
    await syncTrip(ref);
    const p2 = await packFor(2, (p) => { p.booking.title = "Updated trip"; });
    serve(p2, manifestFor(p2, [{ slug: "paris", hash: tileHashes.paris }]));
    fetchLog = [];
    const r = await syncTrip(ref);
    expect(r).toMatchObject({ updated: true, version: 2 });
    expect(fetchLog.filter((x) => x.includes(".pmtiles"))).toEqual([]); // unchanged tile copied from v1, not downloaded
    expect((await getStored(ref))!.pack.booking.title).toBe("Updated trip");
    expect([...store.keys()]).not.toContain(tripCacheName(ref, 1));
    expect(await offlineDb().tripPacks.where("ref").equals(ref).count()).toBe(1);
    expect(await offlineDb().rulesets.where("ref").equals(ref).count()).toBe(1);
  });

  it("an interrupted download resumes from the last verified file", async () => {
    const p1 = await packFor(1); const ref = p1.booking.ref;
    const tiles = [{ slug: "paris", hash: tileHashes.paris }, { slug: "rome", hash: tileHashes.rome }];
    serve(p1, manifestFor(p1, tiles));
    served["/tiles/rome.pmtiles"] = { body: "boom", status: 500 };
    const first = await syncTrip(ref);
    expect(first.updated).toBe(false);
    expect(await getStored(ref)).toBeNull(); // never active
    expect((await offlineDb().fileRecs.get([ref, "/tiles/paris.pmtiles"]))!.hash).toBe(tileHashes.paris); // paris was verified and recorded
    served["/tiles/rome.pmtiles"] = { body: tileBytes.rome };
    fetchLog = [];
    const second = await syncTrip(ref);
    expect(second).toMatchObject({ updated: true, version: 1 });
    expect(fetchLog.filter((x) => x.includes("paris.pmtiles"))).toEqual([]); // not downloaded again
    expect(fetchLog.filter((x) => x.includes("rome.pmtiles")).length).toBe(1);
  });

  it("two trips have separate cache namespaces; deleting one leaves the other intact", async () => {
    const a = await packFor(1);
    const b = await packFor(1, (p) => { p.booking.ref = "SS-99999"; });
    serve(a, manifestFor(a, [{ slug: "paris", hash: tileHashes.paris }]));
    serve(b, manifestFor(b, [{ slug: "paris", hash: tileHashes.paris }]));
    await syncTrip(a.booking.ref); await syncTrip(b.booking.ref);
    expect([...store.keys()].filter((k) => k.startsWith("ss-trip-")).sort()).toEqual([tripCacheName(a.booking.ref, 1), tripCacheName(b.booking.ref, 1)].sort());
    await deleteTrip(a.booking.ref);
    expect(await getStored(a.booking.ref)).toBeNull();
    expect([...store.keys()]).not.toContain(tripCacheName(a.booking.ref, 1));
    expect((await getStored(b.booking.ref))!.version).toBe(1);
    expect(await (await memCaches.open(tripCacheName(b.booking.ref, 1))).match("http://localhost/tiles/paris.pmtiles")).toBeTruthy();
  });

  it("a pack that fails its own integrity check is never stored", async () => {
    const p1 = await packFor(1); const ref = p1.booking.ref;
    const m = manifestFor(p1, []);
    const tampered = { ...p1, booking: { ...p1.booking, title: "tampered" } };
    served[`/api/packs/${ref}/manifest`] = { body: JSON.stringify(m) };
    served[`/api/packs/${ref}/pack?v=1`] = { body: JSON.stringify(tampered) };
    const r = await syncTrip(ref);
    expect(r.updated).toBe(false);
    expect(r.message).toMatch(/integrity/i);
    expect(await getStored(ref)).toBeNull();
  });
});
