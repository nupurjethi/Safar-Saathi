"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { Map as MLMap, Marker } from "maplibre-gl";
import { buildStyle, hasRealTiles } from "@/lib/map/style";
import { pinElement } from "@/lib/map/pins";
import type { PackMapCity } from "@/lib/packs/types";

export type PreviewPoint = { name: string; lat: number; lon: number; kind: "hotel" | "sight"; city: string };
let protocolReady = false;

/** Real street map of the trip's cities with the hotel and landmark pins, shown on the itinerary page before booking. Same tiles/style as the offline map. */
export function PreviewMap({ cities, points, label }: { cities: PackMapCity[]; points: PreviewPoint[]; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [city, setCity] = useState(cities[0]?.id ?? "");
  const mapRef = useRef<MLMap | null>(null);
  const mlRef = useRef<typeof import("maplibre-gl") | null>(null);
  const markers = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const real = hasRealTiles(cities);

  useEffect(() => {
    if (!box.current || !real) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(box.current);
    return () => io.disconnect();
  }, [real]);

  useEffect(() => {
    if (!visible || !box.current) return;
    let map: MLMap | null = null, dead = false;
    (async () => {
      const ml = await import("maplibre-gl");
      const { Protocol } = await import("pmtiles");
      if (dead || !box.current) return;
      if (!protocolReady) { ml.addProtocol("pmtiles", new Protocol().tile); ml.setWorkerUrl("/map/maplibre-gl-worker.mjs"); protocolReady = true; }
      const root = document.documentElement.getAttribute("data-theme");
      const dark = root ? root !== "light" : !window.matchMedia("(prefers-color-scheme: light)").matches;
      const first = cities[0];
      map = new ml.Map({ container: box.current, style: buildStyle(cities, dark), center: [first.center[1], first.center[0]], zoom: 12, attributionControl: false, minZoom: 8, maxZoom: 18, cooperativeGestures: true });
      map.addControl(new ml.AttributionControl({ compact: true, customAttribution: "© OpenStreetMap contributors" }), "bottom-right");
      map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
      mapRef.current = map; mlRef.current = ml;
      setReady(true);
      (window as unknown as { __ssPreviewMap?: unknown }).__ssPreviewMap = map;
    })();
    return () => { dead = true; map?.remove(); mapRef.current = null; setReady(false); };
  }, [visible, cities]);

  // pins + camera for the selected city (a trip can span cities hundreds of km apart)
  useEffect(() => {
    const map = mapRef.current, ml = mlRef.current;
    if (!ready || !map || !ml) return;
    markers.current.forEach((m) => m.remove());
    const mine = points.filter((p) => p.city === city);
    let n = 0;
    markers.current = mine.map((p) => { n += p.kind === "sight" ? 1 : 0; return new ml.Marker({ element: pinElement(p.kind, p.name, p.kind === "sight" ? n : "H"), anchor: "bottom", offset: [0, 18] }).setLngLat([p.lon, p.lat]).addTo(map); });
    const c = cities.find((x) => x.id === city);
    if (mine.length > 1) map.fitBounds([[Math.min(...mine.map((p) => p.lon)), Math.min(...mine.map((p) => p.lat))], [Math.max(...mine.map((p) => p.lon)), Math.max(...mine.map((p) => p.lat))]], { padding: 56, maxZoom: 15, duration: 0 });
    else if (c) map.jumpTo({ center: [c.center[1], c.center[0]], zoom: 13 });
  }, [ready, city, points, cities]);

  if (!real) return null;
  return (
    <figure className="card overflow-hidden" data-testid="preview-map">
      {cities.length > 1 && (
        <div className="flex gap-2 border-b border-line p-2" role="tablist" aria-label="City">
          {cities.map((c) => <button key={c.id} role="tab" aria-selected={city === c.id} onClick={() => setCity(c.id)} data-testid="preview-city" className={`min-h-11 rounded-full border-[1.5px] px-4 text-[15px] font-medium ${city === c.id ? "border-lime bg-lime text-lime-ink" : "border-line bg-surface"}`}>{c.name}</button>)}
        </div>
      )}
      <div ref={box} className="h-[340px] w-full bg-surface-2" role="application" aria-label={`Street map of ${label}`} style={{ position: "relative" }} />
      <figcaption className="px-4 py-2 text-[13px] text-muted">Real OpenStreetMap streets and places in {label}. Pins: hotel (H) and the landmarks on your plan, in order. After you select the trip, this map is saved on your phone and works offline with GPS. © OpenStreetMap contributors</figcaption>
    </figure>
  );
}
