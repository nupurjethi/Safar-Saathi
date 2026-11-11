/* Safar Saathi service worker (hand-written, versioned caches).
 *
 * - App shell + static chunks: cache-first (immutable hashed files) so pages open with no network.
 * - Trip pages (/trips/*): network-first, fall back to the saved copy. They are client-rendered shells with no
 *   personal data in the HTML; the data lives in IndexedDB (the offline pack).
 * - Map tiles (PMTiles) and map assets: served from the "ss-pack-files" cache, with HTTP Range support.
 * - /api/*: NEVER cached here (authenticated). The pack itself is stored by the app in IndexedDB.
 */
const VERSION = "v1";
const SHELL = "ss-shell-v2"; // keep in sync with SHELL_CACHE in lib/offline/dexie.ts
const STATIC = `ss-static-${VERSION}`;
// Per-trip files live in "ss-trip-{ref}-v{n}" namespaces written by the app; they are never deleted here.
const KEEP = [SHELL, STATIC];
const PRECACHE = ["/offline", "/icons/icon-192.png", "/icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(PRECACHE).catch(() => {})).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("ss-") && !k.startsWith("ss-trip-") && !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") self.skipWaiting();
  if (data.type === "CACHE_ASSETS") {
    event.waitUntil(cacheAssets(data.urls || []).then((ok) => event.ports[0] && event.ports[0].postMessage({ ok })));
  }
  if (data.type === "CACHE_URLS") {
    event.waitUntil(
      cacheUrls(data.urls || []).then((ok) => event.ports[0] && event.ports[0].postMessage({ ok })),
    );
  }
});

const ASSET_REF = /(?:\/_next\/)?(static\/(?:chunks|css|media)\/[^"'\s\\)]+\.(?:js|mjs|css|woff2|wasm))/g;

/**
 * Store /_next/static files and, recursively, every chunk they reference. Dynamic imports (like the lazy map
 * chunk) are only named inside other chunks, so we scan chunk text for "static/chunks/..." references.
 */
async function cacheAssets(urls) {
  const stat = await caches.open(STATIC);
  const seen = new Set();
  const queue = urls.filter((u) => u.startsWith("/_next/static/"));
  let ok = true;
  while (queue.length) {
    const batch = queue.splice(0, 8);
    await Promise.all(batch.map(async (a) => {
      if (seen.has(a)) return;
      seen.add(a);
      try {
        let res = await stat.match(a);
        if (!res) {
          const r = await fetch(a);
          if (!r.ok) { ok = false; return; }
          await stat.put(a, r.clone());
          res = r;
        }
        if (/\.(js|mjs)$/.test(a)) {
          const text = await res.clone().text();
          for (const m of text.matchAll(ASSET_REF)) {
            const next = "/_next/" + m[1];
            if (!seen.has(next)) queue.push(next);
          }
        }
      } catch (e) { ok = false; }
    }));
  }
  return ok;
}

/** Fetch each page, store it, then discover and store the JS/CSS chunks it needs. */
async function cacheUrls(urls) {
  const shell = await caches.open(SHELL);
  const stat = await caches.open(STATIC);
  let ok = true;
  const assets = new Set();
  for (const u of urls) {
    try {
      const res = await fetch(u, { credentials: "same-origin" });
      if (!res.ok) { ok = false; continue; }
      const html = await res.clone().text();
      await shell.put(new URL(u, self.location.origin).pathname, res);
      // chunk URLs appear as "/_next/static/..." in tags and as "static/chunks/..." in the RSC payload
      for (const m of html.matchAll(/(?:\/_next\/)?(static\/(?:chunks|css|media)\/[^"'\s\\)]+\.(?:js|css|woff2))/g)) assets.add("/_next/" + m[1]);
    } catch (e) {
      ok = false;
    }
  }
  if (!(await cacheAssets([...assets]))) ok = false;
  return ok;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // PMTiles + map assets from the pack cache (cross-origin Blob URLs too)
  if (url.pathname.endsWith(".pmtiles") || url.pathname.startsWith("/map/") || url.pathname.startsWith("/places/")) {
    event.respondWith(fromPackFiles(req, url));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // never cache authenticated API responses
  if (req.headers.get("RSC") || url.searchParams.has("_rsc")) return; // let Next fall back to a hard navigation

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(req, STATIC));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(navigation(req, url));
  }
});

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

const CACHEABLE_PAGES = /^\/(trips(\/|$)|offline$|explore$|login$|$)/;

async function navigation(req, url) {
  const shell = await caches.open(SHELL);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 4000)),
    ]);
    if (res.ok && CACHEABLE_PAGES.test(url.pathname) && !res.redirected) shell.put(url.pathname, res.clone());
    return res;
  } catch (e) {
    const hit = (await shell.match(url.pathname)) || (await shell.match(url.pathname.replace(/\/$/, "")));
    if (hit) return hit;
    const fallback = await shell.match("/offline");
    return fallback || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
}

/** Serve from the trip / shell caches; answer Range requests by slicing the cached full file. */
async function fromPackFiles(req, url) {
  const key = new URL(url.href).href;
  // search every cache: tiles live in the trip's own namespace, map style/worker in the shared shell cache
  const hit = await caches.match(key, { ignoreSearch: true });
  if (!hit) {
    try { return await fetch(req); } catch (e) { return new Response("Not saved on this phone yet", { status: 504 }); }
  }
  const range = req.headers.get("range");
  if (!range) return hit;
  const m = /bytes=(\d+)-(\d*)/.exec(range);
  if (!m) return hit;
  const buf = await hit.arrayBuffer();
  const start = Number(m[1]);
  const end = m[2] ? Math.min(Number(m[2]), buf.byteLength - 1) : buf.byteLength - 1;
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": hit.headers.get("Content-Type") || "application/octet-stream",
      "Content-Range": `bytes ${start}-${end}/${buf.byteLength}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
    },
  });
}
