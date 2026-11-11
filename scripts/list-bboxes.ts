import { generateSeed } from "@/lib/seed/generate";

// Prints "slug<TAB>overviewBbox<TAB>coreBbox" (minLon,minLat,maxLon,maxLat) for the requested destination slugs (or all).
//  overview = airport + every landmark (+4 km margin): roads and areas, so airport transfers still draw
//  core     = hotels + landmarks + 1.5 km margin, capped to ~14 km: the walkable tourist area, extracted at street-level zoom
const want = new Set(process.argv.slice(2));
const { destinations, pois, hotels } = generateSeed({ baseDate: "2026-01-01", flightDays: 1 });
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
for (const d of destinations) {
  if (want.size && !want.has(d.slug)) continue;
  const pts = [
    ...pois.filter((p) => p.destinationId === d.id && p.category !== "airport").map((p) => ({ lat: p.lat, lon: p.lon })),
    ...hotels.filter((h) => h.destinationId === d.id).map((h) => ({ lat: h.lat, lon: h.lon })),
  ];
  const lons = pts.map((p) => p.lon), lats = pts.map((p) => p.lat);
  const pad = 0.015, cap = 0.07; // cap: half-size in degrees around the centre of the points
  const cx = (Math.min(...lons) + Math.max(...lons)) / 2, cy = (Math.min(...lats) + Math.max(...lats)) / 2;
  const hx = Math.min((Math.max(...lons) - Math.min(...lons)) / 2 + pad, cap), hy = Math.min((Math.max(...lats) - Math.min(...lats)) / 2 + pad, cap);
  let core = [cx - hx, cy - hy, cx + hx, cy + hy].map(r4);
  let overview: number[] = d.bbox;
  let ovZoom = "";
  // The Bangalore demo covers the whole city (Bannerghatta in the south to the airport in the north): wider boxes, overview to zoom 14
  if (d.slug === "bangalore") { core = [77.47, 12.78, 77.72, 13.06]; overview = [77.4, 12.74, 77.82, 13.23]; ovZoom = "14"; }
  console.log(`${d.slug}\t${overview.join(",")}\t${core.join(",")}\t${ovZoom}`);
}
