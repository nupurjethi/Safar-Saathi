/**
 * Fetches REAL, openly licensed photos of the real landmarks in the itineraries, through the official
 * Wikipedia / Wikimedia Commons APIs (no scraping, no keys). Each photo is matched by coordinates AND title,
 * license-checked (CC BY, CC BY-SA, CC0, public domain only), downloaded to public/places/ (so the app never hotlinks
 * and the offline pack can carry it), and its author + license are stored in lib/seed/place-images.json for attribution.
 *
 * Usage: npm run images:fetch           (resumes; skips places already fetched)
 *        npm run images:fetch -- --force
 * Hotels in the itineraries are fictional sample data, so they get no photo.
 */
import fs from "node:fs";
import path from "node:path";
import { DESTINATIONS } from "@/lib/seed/data";
import { haversineM } from "@/lib/geo";

const UA = "SafarSaathiPrototype/0.1 (educational prototype; image attribution kept in place-images.json)";
const OUT_JSON = path.join(process.cwd(), "lib/seed/place-images.json");
const OUT_DIR = path.join(process.cwd(), "public/places");
const ALLOWED = /^(CC BY(-SA)?( \d(\.\d)?)?|CC BY(-SA)? \d\.\d( [A-Za-z]+)?|CC0.*|Public domain|PD.*|Attribution|No restrictions)$/i;
const force = process.argv.includes("--force");
/** Matches I reviewed by hand and rejected because the photo is not of the named place. Never refetched. */
const REJECT: Record<string, string> = {
  "bangkok/Wat Arun": "matched Wat Pho, a different temple",
  "bangkok/Siam Paragon": "matched Siam Square, a different place",
  "dubai/Atlantis, The Palm": "matched a fountain, not the resort",
  "zurich/Zurich Old Town": "matched one building (Cabaret Voltaire)",
  "london/Camden Market": "matched the wider Camden Town area",
  "dubai/Museum of the Future": "matched a conference photo",
  "abu-dhabi/Louvre Abu Dhabi": "matched a statue inside, not the building",
  "seoul/N Seoul Tower": "matched an interior snack bar",
  "istanbul/Topkapi Palace": "matched a kitchen chimney detail",
  "vienna/Wiener Riesenrad": "matched a view FROM the wheel",
  "sydney/The Rocks": "matched a gallery shop",
  "barcelona/Gothic Quarter": "matched a facade detail",
  "maldives/Malé Fish Market": "matched the waterfront, not the market",
  "istanbul/Galata Tower": "matched a view FROM the tower",
  "phuket/Karon Beach": "matched a statue near the beach",
  "ho-chi-minh-city/War Remnants Museum": "matched a single exhibit"
};


export type PlaceImage = { file: string; title: string; author: string; license: string; licenseUrl: string; sourceUrl: string; pageUrl: string; width: number; height: number };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set(["the", "of", "de", "la", "le", "and", "park", "river", "cruise", "market", "beach", "island", "museum", "square", "temple", "palace", "bridge", "tower", "old", "town", "street", "walking", "night"]);
const tokens = (s: string) => norm(s).split(" ").filter((t) => t.length > 2 && !STOP.has(t));
const strip = (h: string) => h.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/\s+/g, " ").trim();
const slug = (s: string) => norm(s).replace(/ /g, "-").slice(0, 48);

let last = 0;
/** Hand-picked Commons files (verified to show the named place) for places the automatic match could not find. */
const PICKS: Record<string, string> = {
  "rome/Vatican Museums": "Circular staircase of the Vatican Museums 02.jpg",
};

async function api(url: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let i = 0; i < 7; i++) {
    const wait = 650 - (Date.now() - last); // stay well under Wikimedia's polite request rate
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const r = await fetch(url, { headers: { "User-Agent": UA, "Api-User-Agent": UA }, signal: AbortSignal.timeout(25000) }).catch(() => null);
    if (r?.ok) return r.json();
    const ra = Number(r?.headers.get("retry-after")) || 0;
    await sleep(Math.max(ra * 1000, 4000 * (i + 1))); // 429 / 5xx: back off and retry
  }
  throw new Error(`API failed: ${url.slice(0, 120)}`);
}

type Cand = { title: string; pageimage?: string; lat?: number; lon?: number };

async function geoCands(lat: number, lon: number): Promise<Cand[]> {
  const geo = await api(`https://en.wikipedia.org/w/api.php?action=query&format=json&generator=geosearch&ggscoord=${lat}|${lon}&ggsradius=700&ggslimit=20&prop=pageimages|coordinates&piprop=name&colimit=1`);
  return Object.values<any>(geo.query?.pages ?? {}).map((p) => ({ title: p.title, pageimage: p.pageimage, lat: p.coordinates?.[0]?.lat, lon: p.coordinates?.[0]?.lon })); // eslint-disable-line @typescript-eslint/no-explicit-any
}
async function searchCands(name: string): Promise<Cand[]> {
  const out: Cand[] = [];
  const q = encodeURIComponent(name.replace(/\(.*?\)/g, ""));
  const s = await api(`https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${q}&gsrlimit=4&prop=pageimages|coordinates&piprop=name&colimit=1`);
  for (const p of Object.values<any>(s.query?.pages ?? {})) out.push({ title: p.title, pageimage: p.pageimage, lat: p.coordinates?.[0]?.lat, lon: p.coordinates?.[0]?.lon }); // eslint-disable-line @typescript-eslint/no-explicit-any
  return out;
}

/** Pick the page that is the SAME place: title overlaps the name and the coordinates are close. */
function pick(name: string, lat: number, lon: number, cands: Cand[]): Cand | null {
  const want = tokens(name);
  let best: { c: Cand; score: number } | null = null;
  for (const c of cands) {
    if (!c.pageimage || c.lat == null || c.lon == null) continue;
    const d = haversineM({ lat, lon }, { lat: c.lat, lon: c.lon });
    if (d > 1500) continue;
    const have = new Set(tokens(c.title));
    const overlap = want.filter((t) => have.has(t)).length;
    const score = (want.length ? overlap / want.length : 0) - d / 20000;
    const nameMatch = want.length > 0 && overlap >= Math.max(1, Math.ceil(want.length * 0.5));
    if (!nameMatch) continue;
    if (!best || score > best.score) best = { c, score };
  }
  return best?.c ?? null;
}

/** Fallback: geotagged photos on Commons itself near the landmark, accepted only when the file name names the place. */
async function commonsGeoFile(name: string, lat: number, lon: number): Promise<string | null> {
  const j = await api(`https://commons.wikimedia.org/w/api.php?action=query&format=json&list=geosearch&gscoord=${lat}|${lon}&gsradius=400&gslimit=40&gsnamespace=6`);
  const want = tokens(name);
  let best: { title: string; score: number } | null = null;
  for (const r of (j.query?.geosearch ?? []) as { title: string; dist: number }[]) {
    if (!/\.(jpe?g|png)$/i.test(r.title)) continue;
    const have = new Set(tokens(r.title.replace(/^File:/, "")));
    const overlap = want.filter((w) => have.has(w)).length;
    if (!want.length || overlap < Math.max(1, Math.ceil(want.length * 0.5))) continue;
    const score = overlap / want.length - r.dist / 4000;
    if (!best || score > best.score) best = { title: r.title.replace(/^File:/, ""), score };
  }
  return best?.title ?? null;
}

async function commonsInfo(file: string) {
  const j = await api(`https://commons.wikimedia.org/w/api.php?action=query&format=json&titles=${encodeURIComponent("File:" + file)}&prop=imageinfo&iiprop=extmetadata|url|size|mime&iiurlwidth=900&iiextmetadatafilter=Artist|LicenseShortName|LicenseUrl|ImageDescription`);
  const page = Object.values<any>(j.query?.pages ?? {})[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
  const ii = page?.imageinfo?.[0];
  if (!ii) return null;
  const m = ii.extmetadata ?? {};
  return { thumb: ii.thumburl as string, mime: ii.mime as string, w: ii.thumbwidth as number, h: ii.thumbheight as number, page: ii.descriptionurl as string, license: strip(m.LicenseShortName?.value ?? ""), licenseUrl: strip(m.LicenseUrl?.value ?? ""), author: strip(m.Artist?.value ?? "Unknown").slice(0, 90) };
}

async function main() {
  const db: Record<string, PlaceImage> = !force && fs.existsSync(OUT_JSON) ? JSON.parse(fs.readFileSync(OUT_JSON, "utf8")) : {};
  const miss: string[] = [];
  const skip = (m: string) => { miss.push(m); console.log("·", m); };
  let n = 0;
  for (const d of DESTINATIONS) {
    fs.mkdirSync(path.join(OUT_DIR, d.slug), { recursive: true });
    for (const poi of d.pois) {
      const key = `${d.slug}/${poi.name}`;
      if (REJECT[key]) continue;
      if (db[key] && fs.existsSync(path.join(process.cwd(), "public", db[key].file))) continue;
      try {
        let cand = pick(poi.name, poi.lat, poi.lon, await geoCands(poi.lat, poi.lon));
        if (!cand) cand = pick(poi.name, poi.lat, poi.lon, await searchCands(poi.name)); // only when the coordinate search found no same-named article
        let fileName = PICKS[key] ?? cand?.pageimage ?? null;
        let info = fileName ? await commonsInfo(fileName) : null;
        let titleFor = PICKS[key] ? PICKS[key].replace(/\.[a-z]+$/i, "") : cand?.title ?? "";
        if (!info?.thumb || !ALLOWED.test(info.license)) {
          // the article's lead image is missing from Commons or not openly licensed: look for a geotagged Commons photo that names the place
          const alt = await commonsGeoFile(poi.name, poi.lat, poi.lon);
          if (alt) { fileName = alt; info = await commonsInfo(alt); titleFor = alt.replace(/\.[a-z]+$/i, "").replace(/_/g, " "); }
        }
        if (!fileName || !info?.thumb) { skip(`${key}: no openly licensed photo found`); continue; }
        const cand2 = { title: titleFor };
        if (!ALLOWED.test(info.license)) { skip(`${key}: license not allowed (${info.license || "unknown"})`); continue; }
        if (!/^image\/(jpeg|png)$/.test(info.mime)) { skip(`${key}: unsupported type ${info.mime}`); continue; }
        const res = await fetch(info.thumb, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
        if (!res.ok) { skip(`${key}: download ${res.status}`); continue; }
        const buf = Buffer.from(await res.arrayBuffer());
        const ext = info.mime === "image/png" ? "png" : "jpg";
        const rel = `/places/${d.slug}/${slug(poi.name)}.${ext}`;
        fs.writeFileSync(path.join(process.cwd(), "public", rel), buf);
        db[key] = { file: rel, title: cand2.title, author: info.author, license: info.license, licenseUrl: info.licenseUrl, sourceUrl: info.page, pageUrl: info.page, width: info.w, height: info.h };
        fs.writeFileSync(OUT_JSON, JSON.stringify(db, null, 1));
        n++;
        console.log(`✓ ${key} ← ${cand2.title} (${info.license}, ${Math.round(buf.length / 1024)} KB)`);
      } catch (e) {
        miss.push(`${key}: ${e instanceof Error ? e.message : e}`); console.log("✗", miss[miss.length - 1]);
      }
    }
  }
  fs.writeFileSync(OUT_JSON, JSON.stringify(db, null, 1));
  console.log(`\nFetched ${n} new, ${Object.keys(db).length} total.`);
  if (miss.length) console.log(`Skipped ${miss.length} (no honest match; the app shows gradient art for these):\n  ` + miss.join("\n  "));
}
main().catch((e) => { console.error(e); process.exit(1); });
