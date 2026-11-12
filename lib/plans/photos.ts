import { createHash } from "node:crypto";
import { haversineM } from "@/lib/geo";
import type { PlaceImageRef } from "@/lib/packs/types";
import imageDb from "@/lib/seed/place-images.json";
import { matchDestination, matchLandmark, type LatLon } from "./geo";

/**
 * Real, openly licensed photos for the places in an uploaded plan, so its trip cards and pages are not blank.
 * Order: our own downloaded landmark/city photos, then Wikipedia/Wikimedia Commons through their official APIs
 * (license-checked: CC BY, CC BY-SA, CC0, public domain only; author and licence kept for the credit line). No scraping.
 */
const UA = "SafarSaathiPrototype/0.1 (educational prototype; photo credits kept with each photo)";
const ALLOWED = /^(CC BY(-SA)?( \d(\.\d)?)?|CC BY(-SA)? \d\.\d( [A-Za-z]+)?|CC0.*|Public domain|PD.*|Attribution|No restrictions)$/i;
const strip = (s: string) => s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const tokens = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["the", "and", "park", "temple"].includes(w));

type Db = Record<string, { file: string; title: string; author: string; license: string; licenseUrl: string; sourceUrl: string }>;
const seeded = imageDb as unknown as Db;
export const fromSeed = (key: string): PlaceImageRef | null => { const e = seeded[key]; return e ? { src: e.file, title: e.title, author: e.author, license: e.license, licenseUrl: e.licenseUrl, sourceUrl: e.sourceUrl } : null; };

/** Photo we already have for a place in one of our cities (its landmark photo, or the city's hero). */
export function seededPhoto(city: string, place?: string): PlaceImageRef | null {
  const d = matchDestination(city);
  if (!d) return null;
  if (place) { const lm = matchLandmark(city, place); return lm ? fromSeed(`${d.slug}/${lm.name}`) : null; }
  for (const poi of d.pois) { const e = fromSeed(`${d.slug}/${poi.name}`); if (e) return e; }
  return null;
}

async function api(url: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(url, { headers: { "User-Agent": UA, "Api-User-Agent": UA }, signal: AbortSignal.timeout(9000) }).catch(() => null);
  return r?.ok ? r.json() : null;
}

export type FoundPhoto = { data: Buffer; mime: string; sha256: string; credit: Omit<PlaceImageRef, "src"> };

/** One Wikipedia article's lead image (by title, or by a name search near a point), license-checked and downloaded. */
export async function findPhoto(name: string, near?: LatLon | null, opts: { exactTitle?: boolean } = {}): Promise<FoundPhoto | null> {
  if (process.env.PLAN_PHOTOS === "off") return null;
  let file: string | null = null;
  if (opts.exactTitle) {
    const j = await api(`https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&titles=${encodeURIComponent(name)}&prop=pageimages&piprop=name`);
    file = (Object.values<any>(j?.query?.pages ?? {})[0] as any)?.pageimage ?? null; // eslint-disable-line @typescript-eslint/no-explicit-any
  } else {
    const q = encodeURIComponent(name.replace(/\(.*?\)/g, ""));
    const j = await api(`https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${q}&gsrlimit=4&prop=pageimages|coordinates&piprop=name&colimit=1`);
    const want = tokens(name);
    let best: { f: string; score: number } | null = null;
    for (const p of Object.values<any>(j?.query?.pages ?? {})) { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!p.pageimage) continue;
      const overlap = want.filter((t) => tokens(p.title).includes(t)).length;
      if (!want.length || overlap < Math.max(1, Math.ceil(want.length * 0.5))) continue;
      const c = p.coordinates?.[0];
      const d = near && c ? haversineM(near, { lat: c.lat, lon: c.lon }) : 0;
      if (near && c && d > 25000) continue; // a different place with the same name
      const score = overlap / want.length - d / 100000;
      if (!best || score > best.score) best = { f: p.pageimage, score };
    }
    file = best?.f ?? null;
  }
  if (!file) return null;
  const info = await api(`https://commons.wikimedia.org/w/api.php?action=query&format=json&titles=${encodeURIComponent("File:" + file)}&prop=imageinfo&iiprop=extmetadata|url|mime&iiurlwidth=900&iiextmetadatafilter=Artist|LicenseShortName|LicenseUrl`);
  const ii = (Object.values<any>(info?.query?.pages ?? {})[0] as any)?.imageinfo?.[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!ii?.thumburl || !/^image\/(jpeg|png)$/.test(ii.mime)) return null;
  const m = ii.extmetadata ?? {};
  const license = strip(m.LicenseShortName?.value ?? "");
  if (!ALLOWED.test(license)) return null;
  const res = await fetch(ii.thumburl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!res?.ok) return null;
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length < 5000 || data.length > 1_500_000) return null;
  return { data, mime: ii.mime, sha256: `sha256:${createHash("sha256").update(data).digest("hex")}`, credit: { title: file.replace(/\.[a-z]+$/i, "").replace(/_/g, " "), author: strip(m.Artist?.value ?? "Unknown").slice(0, 90), license, licenseUrl: strip(m.LicenseUrl?.value ?? ""), sourceUrl: ii.descriptionurl } };
}
