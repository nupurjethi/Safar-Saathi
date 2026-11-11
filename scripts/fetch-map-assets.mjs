// Downloads the static map assets the offline basemap needs (open source, Protomaps "basemaps-assets", OFL/CC0):
//   fonts   Noto Sans glyph PBFs for the ranges we draw (Latin, Greek, Cyrillic, Arabic, Thai, punctuation)
//   sprites POI/shield icons for the light and dark map styles
// They are saved under public/map/ and listed in every offline pack, so the map never calls the network on the phone.
// Usage: npm run map:assets   (resumable: skips files that already exist)
import fs from "node:fs";
import path from "node:path";

const BASE = "https://protomaps.github.io/basemaps-assets";
const OUT = path.join(process.cwd(), "public", "map");
const FONTS = ["Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"];
const RANGES = ["0-255", "256-511", "512-767", "768-1023", "1024-1279", "1536-1791", "1792-2047", "3584-3839", "7680-7935", "8192-8447", "8448-8703", "11264-11519", "42752-43007", "43008-43263"];
const SPRITES = ["light", "dark", "light@2x", "dark@2x"];

async function get(url, dest) {
  if (fs.existsSync(dest)) return "skip";
  const r = await fetch(url);
  if (!r.ok) return `miss ${r.status}`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  return "ok";
}

let ok = 0, miss = 0;
for (const f of FONTS) for (const r of RANGES) {
  const res = await get(`${BASE}/fonts/${encodeURIComponent(f)}/${r}.pbf`, path.join(OUT, "fonts", f, `${r}.pbf`));
  if (res.startsWith("miss")) miss++; else ok++;
}
for (const s of SPRITES) for (const ext of ["json", "png"]) {
  const res = await get(`${BASE}/sprites/v4/${s}.${ext}`, path.join(OUT, "sprites", `${s}.${ext}`));
  if (res.startsWith("miss")) miss++; else ok++;
}
console.log(`map assets: ${ok} present, ${miss} not available upstream (fine: unused ranges)`);
