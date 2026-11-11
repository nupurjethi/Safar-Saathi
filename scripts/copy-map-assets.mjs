// MapLibre's worker must be a real file served from our own origin: bundlers can't resolve it reliably, and the
// service worker caches /map/* so the map renders with no network. Run on install and before dev/build.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";

const src = "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs";
if (existsSync(src)) {
  mkdirSync("public/map", { recursive: true });
  copyFileSync(src, "public/map/maplibre-gl-worker.mjs");
  console.log("copied maplibre worker to public/map/");
}
