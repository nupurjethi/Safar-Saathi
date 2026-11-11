"use client";
import { packContentHash, sha256Hex } from "@/lib/packs/hash";
import type { OfflinePack, PackManifest } from "@/lib/packs/types";
import { getStored, offlineDb, SHELL_CACHE, tripCacheName } from "./dexie";

export type SyncGroup = "details" | "maps" | "pages" | "done" | "manifest";
export type SyncProgress = { phase: SyncGroup; doneFiles: number; totalFiles: number; loadedBytes: number; totalBytes: number; groups: { details: boolean; maps: boolean } };
export type SyncResult = { updated: boolean; version: number; reason?: "up-to-date" | "unauthenticated" | "over-budget" | "offline" | "error"; message?: string };

export async function ensurePersistence() {
  try {
    const persisted = navigator.storage?.persist ? await navigator.storage.persist() : false;
    const est = await navigator.storage?.estimate?.();
    return { persisted, usage: est?.usage ?? 0, quota: est?.quota ?? 0 };
  } catch {
    return { persisted: false, usage: 0, quota: 0 };
  }
}

function swPost(msg: unknown, timeoutMs = 20000): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return resolve(false);
    // If the service worker never becomes ready (unsupported browser, dev mode), carry on without it.
    const ready = Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
    ready.then((reg) => {
      const sw = reg?.active;
      if (!sw) return resolve(false);
      const ch = new MessageChannel();
      const t = setTimeout(() => resolve(false), timeoutMs);
      ch.port1.onmessage = (e) => { clearTimeout(t); resolve(!!e.data?.ok); };
      sw.postMessage(msg, [ch.port2]);
    }, () => resolve(false));
  });
}

const abs = (url: string) => new URL(url, typeof location !== "undefined" ? location.origin : "http://localhost").href;

/** Download one file, verify its SHA-256, and only then write it to the cache. A bad hash throws and writes nothing. */
export async function downloadVerified(cache: Cache, url: string, expectedHash: string | undefined, onBytes: (n: number) => void) {
  // "?ss-refresh=1" tells the service worker to go to the network: otherwise it would hand back the copy we already saved
  // and an UPDATED file (new tiles, new photo) could never replace its old version.
  const res = await fetch(url + (url.includes("?") ? "&" : "?") + "ss-refresh=1", { credentials: "same-origin", cache: "no-store" });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); total += value.length; onBytes(value.length);
  }
  const blob = new Blob(chunks as BlobPart[], { type: res.headers.get("content-type") ?? "application/octet-stream" });
  if (expectedHash) {
    const got = await sha256Hex(await blob.arrayBuffer());
    if (got !== expectedHash) throw new Error(`Integrity check failed for ${url}`);
  }
  await cache.put(abs(url), new Response(blob, { headers: { "Content-Type": blob.type, "Content-Length": String(total), "Accept-Ranges": "bytes" } }));
  return total;
}

/**
 * Spec section 4: download (or update) a trip's offline bundle.
 *  order: trip data + rules -> map files -> app pages. The guide works before the maps finish.
 *  every file is hash-checked; unchanged files are reused from the previous version; interrupted runs resume.
 *  all new files go under version n+1; the version is switched ONLY after everything verified (atomic swap), then n is deleted.
 */
export async function syncTrip(ref: string, onProgress?: (p: SyncProgress) => void, opts: { force?: boolean; allowOverBudget?: boolean } = {}): Promise<SyncResult> {
  const db = offlineDb();
  const prog: SyncProgress = { phase: "manifest", doneFiles: 0, totalFiles: 0, loadedBytes: 0, totalBytes: 0, groups: { details: false, maps: false } };
  const emit = (p: Partial<SyncProgress>) => onProgress?.(Object.assign(prog, p));
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  let oldActive = 0;
  try {
    emit({ phase: "manifest" });
    const mres = await fetch(`/api/packs/${encodeURIComponent(ref)}/manifest`, { cache: "no-store" });
    if (mres.status === 401) return { updated: false, version: 0, reason: "unauthenticated" };
    if (!mres.ok) throw new Error(`Manifest ${mres.status}`);
    const manifest = (await mres.json()) as PackManifest;
    const local = await getStored(ref);
    oldActive = local?.version ?? 0;
    if (!opts.force && local && local.contentHash === manifest.contentHash) { emit({ phase: "done" }); return { updated: false, version: local.version, reason: "up-to-date" }; }
    if (manifest.overBudget && !opts.allowOverBudget) return { updated: false, version: oldActive, reason: "over-budget", message: `This trip needs ${(manifest.totalBytes / 1048576).toFixed(0)} MB, over the ${(manifest.budgetBytes / 1048576).toFixed(0)} MB budget. Download maps over Wi-Fi.` };

    const newV = manifest.packVersion;
    const heavy = manifest.files.filter((f) => f.kind === "tiles" || f.kind === "map-asset" || f.kind === "image");
    emit({ totalFiles: heavy.length + 2, totalBytes: manifest.files.reduce((a, f) => a + (f.kind === "page" ? 0 : f.bytes), 0), loadedBytes: 0, doneFiles: 0 });

    // 1) trip data + rules, verified against the pack's contentHash
    emit({ phase: "details" });
    const pf = manifest.files.find((f) => f.kind === "pack")!;
    const pres = await fetch(pf.url, { cache: "no-store" });
    if (!pres.ok) throw new Error(`Pack ${pres.status}`);
    const text = await pres.text();
    emit({ loadedBytes: prog.loadedBytes + text.length, doneFiles: prog.doneFiles + 1 });
    const pack = JSON.parse(text) as OfflinePack;
    if ((await packContentHash(pack as unknown as Record<string, unknown>)) !== manifest.contentHash) throw new Error("Pack failed its integrity check");
    emit({ groups: { ...prog.groups, details: true } });

    // 2) map files. Tiles go in this trip's versioned namespace; style/worker/sprites are shared app-shell files.
    emit({ phase: "maps" });
    const tripCache = await caches.open(tripCacheName(ref, newV));
    const shell = await caches.open(SHELL_CACHE);
    const prevCache = oldActive ? await caches.open(tripCacheName(ref, oldActive)) : null;
    const known = new Map((await db.fileRecs.where("ref").equals(ref).toArray()).map((r) => [`${r.url}@${r.version}`, r]));
    const writes: { url: string; hash?: string; bytes: number; version: number }[] = [];
    for (const f of heavy) {
      const isTile = f.kind === "tiles" || f.kind === "image"; // per-trip namespace (shared map assets go to the shell cache)
      const target = isTile ? tripCache : shell;
      const ver = isTile ? newV : 0;
      const key = abs(f.url);
      const already = known.get(`${f.url}@${ver}`);
      if (already && already.hash === f.hash && (await target.match(key))) { emit({ loadedBytes: prog.loadedBytes + f.bytes, doneFiles: prog.doneFiles + 1 }); continue; } // resume / unchanged shared file
      const prev = isTile && prevCache && oldActive ? known.get(`${f.url}@${oldActive}`) : null;
      const prevHit = prev && prev.hash === f.hash ? await prevCache!.match(key) : null;
      if (prevHit) { await tripCache.put(key, prevHit.clone()); emit({ loadedBytes: prog.loadedBytes + f.bytes }); } // unchanged since the last version: copy, no download
      else await downloadVerified(target, f.url, f.hash, (b) => emit({ loadedBytes: prog.loadedBytes + b }));
      writes.push({ url: f.url, hash: f.hash, bytes: f.bytes, version: ver });
      // record each verified file right away so an interrupted download resumes from here
      await db.fileRecs.put({ ref, url: f.url, hash: f.hash, bytes: f.bytes, version: ver, cachedAt: Date.now() });
      emit({ doneFiles: prog.doneFiles + 1 });
    }
    emit({ groups: { ...prog.groups, maps: true } });

    // 3) app pages and lazy chunks via the service worker, so the guide, map and SOS open with no network
    emit({ phase: "pages" });
    await swPost({ type: "CACHE_URLS", urls: manifest.files.filter((f) => f.kind === "page").map((f) => f.url) });
    if (typeof document !== "undefined") {
      await Promise.allSettled([import("@/components/map/TripMap"), import("maplibre-gl"), import("pmtiles")]);
      const fromTiming = performance.getEntriesByType("resource").map((e) => e.name);
      const fromDom = [...document.querySelectorAll<HTMLElement>("script[src], link[href]")].map((n) => (n as HTMLScriptElement).src || (n as HTMLLinkElement).href);
      const loaded = [...fromTiming, ...fromDom].map((u) => { try { return new URL(u).pathname; } catch { return ""; } }).filter((p) => p.startsWith("/_next/static/"));
      await swPost({ type: "CACHE_ASSETS", urls: [...new Set(loaded)] });
    }
    emit({ doneFiles: prog.doneFiles + 1 });

    // 4) ATOMIC SWAP: write version n+1, then flip activeVersion in one transaction. Old version n stays active until here.
    const { rules, rulesMeta, ruleSet, ...rest } = pack;
    await db.transaction("rw", [db.trips, db.tripPacks, db.rulesets], async () => {
      await db.tripPacks.put({ ref, version: newV, contentHash: manifest.contentHash, pack: rest, manifest, savedAt: Date.now() });
      await db.rulesets.put({ ref, version: newV, rules, rulesMeta, ruleSet });
      await db.trips.put({ ref, activeVersion: newV, status: pack.booking.status, title: pack.booking.title, syncedAt: Date.now(), totalBytes: manifest.totalBytes });
    });
    // 5) only now delete the old version (data, file records and its cache namespace)
    await db.tripPacks.where("ref").equals(ref).and((r) => r.version !== newV).delete();
    await db.rulesets.where("ref").equals(ref).and((r) => r.version !== newV).delete();
    await db.fileRecs.where("ref").equals(ref).and((r) => r.version !== newV && r.version !== 0).delete();
    for (const k of await caches.keys()) if (k.startsWith(`ss-trip-${ref}-v`) && k !== tripCacheName(ref, newV)) await caches.delete(k);
    void writes;
    emit({ phase: "done" });
    const ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);
    void fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "pack_ready", props: { ms, bytes: manifest.totalBytes } }) }).catch(() => {});
    return { updated: true, version: newV };
  } catch (e) {
    // Any failure leaves the previous version active. Partial new files stay for resume.
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    return { updated: false, version: oldActive || (await getStored(ref))?.version || 0, reason: offline ? "offline" : "error", message: e instanceof Error ? e.message : String(e) };
  }
}
