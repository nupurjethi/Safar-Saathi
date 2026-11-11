#!/usr/bin/env bash
# Extract offline vector-tile files (PMTiles, OpenStreetMap data via Protomaps) for each destination.
#
# Two files per city, so the phone stores street-level detail only where travellers actually walk:
#   <slug>.pmtiles       overview: whole city + airport, zoom 0-12 (roads, areas, water, place names), ~3-8 MB
#   <slug>-core.pmtiles  core:     hotels + landmarks + 1.5 km, zoom 0-15 (every street, building, POI, label), ~4-13 MB
# Why PMTiles: one static file per area, read with HTTP range requests, cached whole on the phone. No per-tile API,
# and no bulk download from tile.openstreetmap.org (which the OSM tile usage policy forbids).
#
# Needs the `pmtiles` CLI:  brew install pmtiles   (or https://github.com/protomaps/go-pmtiles/releases)
# Usage:   npm run tiles:build -- paris rome        (slugs; default: every destination in the seed data)
# Env:     PROTOMAPS_BUILD  a daily build URL (default: the newest one from build-metadata.protomaps.dev)
#          OVERVIEW_ZOOM (12)  CORE_ZOOM (15)
#
# Output:  public/tiles/<slug>.pmtiles, <slug>-core.pmtiles + public/tiles/manifest.json (sha256 + bytes, read by the pack builder)
# Then:    upload public/tiles/* to Vercel Blob and set TILES_BASE_URL to the public Blob URL, or serve from /tiles.
set -euo pipefail

command -v pmtiles >/dev/null || { echo "pmtiles CLI not found. brew install pmtiles"; exit 1; }
if [ -z "${PROTOMAPS_BUILD:-}" ]; then
  KEY="$(curl -fsS https://build-metadata.protomaps.dev/builds.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);console.log(a[a.length-1].key)})')"
  PROTOMAPS_BUILD="https://build.protomaps.com/$KEY"
fi
OVERVIEW_ZOOM="${OVERVIEW_ZOOM:-12}"
CORE_ZOOM="${CORE_ZOOM:-15}"
OUT="public/tiles"
mkdir -p "$OUT"
echo "Using $PROTOMAPS_BUILD"

extract() { # name bbox maxzoom
  [ -s "$OUT/$1.pmtiles" ] && [ -z "${FORCE:-}" ] && { echo "  $1 exists, skipping (FORCE=1 to redo)"; return; }
  pmtiles extract "$PROTOMAPS_BUILD" "$OUT/$1.pmtiles.part" --bbox="$2" --maxzoom="$3" >/dev/null 2>&1 && mv "$OUT/$1.pmtiles.part" "$OUT/$1.pmtiles"
  echo "  $1  $(du -h "$OUT/$1.pmtiles" | cut -f1)"
}

# slug<TAB>overview bbox<TAB>core bbox from the seed source of truth
LIST="$(npx --yes tsx scripts/list-bboxes.ts "$@")"
echo "$LIST" | while IFS=$'\t' read -r slug obbox cbbox ovz; do
  [ -z "$slug" ] && continue
  echo "→ $slug"
  extract "$slug" "$obbox" "${ovz:-$OVERVIEW_ZOOM}"
  extract "$slug-core" "$cbbox" "$CORE_ZOOM"
done

node -e '
const fs=require("fs"),crypto=require("crypto");
const dir="public/tiles",m={};
for (const f of fs.readdirSync(dir).filter(f=>f.endsWith(".pmtiles"))) {
  const buf=fs.readFileSync(`${dir}/${f}`);
  // bounds from the PMTiles v3 header (int32 x 1e-7 at byte 102): stored here so the server never has to open the big files
  m[f.replace(".pmtiles","")]={bytes:buf.length,hash:"sha256:"+crypto.createHash("sha256").update(buf).digest("hex"),bbox:[buf.readInt32LE(102)/1e7,buf.readInt32LE(106)/1e7,buf.readInt32LE(110)/1e7,buf.readInt32LE(114)/1e7]};
}
fs.writeFileSync(`${dir}/manifest.json`,JSON.stringify(m,null,2));
console.log("wrote",dir+"/manifest.json",Object.keys(m).length,"files");'
echo "Done. Rebuild packs so they list the tiles:  npm run routes:build"
