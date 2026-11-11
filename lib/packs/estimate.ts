import fs from "node:fs";
import path from "node:path";

/** "Offline guide: about 38 MB, takes about 30 seconds on 4G": from built tile files when present, else a per-city estimate. */
export function estimateOffline(citySlugs: string[]) {
  let tiles: Record<string, { bytes: number }> = {};
  try { tiles = JSON.parse(fs.readFileSync(path.join(process.cwd(), "public", "tiles", "manifest.json"), "utf8")); } catch { /* no tiles built yet */ }
  const mapBytes = citySlugs.reduce((a, c) => a + (tiles[c]?.bytes ?? 3 * 1048576) + (tiles[`${c}-core`]?.bytes ?? 10 * 1048576), 0);
  const bytes = mapBytes + 4 * 1048576; // trip data, rules, routes, place photos, label fonts and map icons
  const mb = Math.max(1, Math.round(bytes / 1048576));
  const seconds = Math.max(10, Math.round((bytes * 8) / (20 * 1e6) / 5) * 5); // ~20 Mbit/s on 4G
  return { mb, seconds, fromBuiltTiles: citySlugs.every((c) => !!tiles[c] && !!tiles[`${c}-core`]) };
}
