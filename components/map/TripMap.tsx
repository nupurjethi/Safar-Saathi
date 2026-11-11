"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MLMap, Marker } from "maplibre-gl";
import { Crosshair, Footprints, Navigation, TriangleAlert } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { buildStyle, hasRealTiles } from "@/lib/map/style";
import { pinElement } from "@/lib/map/pins";
import { OffRouteDetector, circlePolygon, offsetPoint, progressAlong, nearestOnLine, type OffRouteState } from "@/lib/map/offroute";
import type { OfflinePack } from "@/lib/packs/types";
import type { SavedRoute } from "@/lib/map/routes";

type Pos = { lat: number; lon: number; accuracy?: number; heading?: number | null; ts: number };
const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const cardinal = (b: number) => ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(b / 45) % 8];

let protocolReady = false;

export function TripMap({ pack, routeId, pin, onRoute, focusCity }: { pack: OfflinePack; routeId: string | null; pin: string | null; onRoute: (id: string | null) => void; focusCity?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const mlRef = useRef<typeof import("maplibre-gl") | null>(null);
  const markers = useRef<Marker[]>([]);
  const gpsMarker = useRef<Marker | null>(null);
  const watch = useRef<number | null>(null);
  const wake = useRef<{ release: () => Promise<void> } | null>(null);
  const detector = useRef<OffRouteDetector | null>(null);
  const simTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [ready, setReady] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const [gpsErr, setGpsErr] = useState<string | null>(null);
  const [navigating, setNavigating] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [off, setOff] = useState<OffRouteState | null>(null);
  const follow = useRef(false); // centre the camera on the next GPS fix (and keep centred while navigating)
  const navigatingRef = useRef(false);
  const route: SavedRoute | undefined = useMemo(() => pack.routes.find((r) => r.id === routeId), [pack.routes, routeId]);
  const hasTiles = hasRealTiles(pack.map.cities);

  // create the map once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ml = await import("maplibre-gl");
      const { Protocol } = await import("pmtiles");
      if (cancelled || !el.current) return;
      mlRef.current = ml;
      if (!protocolReady) {
        const protocol = new Protocol();
        ml.addProtocol("pmtiles", protocol.tile);
        ml.setWorkerUrl("/map/maplibre-gl-worker.mjs"); // served from our origin and cached for offline (see scripts/copy-map-assets.mjs)
        protocolReady = true;
      }
      const dark = document.documentElement.getAttribute("data-theme") !== "light" && !(document.documentElement.getAttribute("data-theme") === null && window.matchMedia("(prefers-color-scheme: light)").matches);
      const first = pack.map.cities.find((c) => c.id === focusCity) ?? pack.map.cities[0];
      const map = new ml.Map({
        container: el.current, style: buildStyle(pack.map.cities, dark), center: [first.center[1], first.center[0]], zoom: 13.2, attributionControl: false, minZoom: 8, maxZoom: 19, dragRotate: true, cooperativeGestures: false,
      });
      map.addControl(new ml.AttributionControl({ compact: false, customAttribution: "© OpenStreetMap contributors" }), "bottom-right");
      map.addControl(new ml.NavigationControl({ showCompass: true }), "top-right");
      map.addControl(new ml.ScaleControl({ unit: "metric" }), "bottom-left");
      map.on("load", () => {
        map.addSource("routes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addSource("active", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addSource("accuracy", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "routes-faint", type: "line", source: "routes", paint: { "line-color": "#6f7b8b", "line-width": 3, "line-opacity": 0.55, "line-dasharray": [1.5, 1.5] }, layout: { "line-cap": "round", "line-join": "round" } });
        map.addLayer({ id: "active-casing", type: "line", source: "active", paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 7, 17, 13] }, layout: { "line-cap": "round", "line-join": "round" } });
        map.addLayer({ id: "active-line", type: "line", source: "active", paint: { "line-color": "#1a73e8", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 4, 17, 8] }, layout: { "line-cap": "round", "line-join": "round" } });
        map.addLayer({ id: "accuracy-fill", type: "fill", source: "accuracy", paint: { "fill-color": "#d8fd34", "fill-opacity": 0.28 } });
        map.addLayer({ id: "accuracy-line", type: "line", source: "accuracy", paint: { "line-color": "#050505", "line-width": 2, "line-opacity": 0.75 } });
        setReady(true);
      });
      mapRef.current = map;
      (window as unknown as { __ssMap?: unknown }).__ssMap = map; // read-only handle for the e2e tests
    })();
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; setReady(false); };
  }, [pack.map.cities]); // eslint-disable-line react-hooks/exhaustive-deps -- focusCity only sets the first camera position

  // place markers
  useEffect(() => {
    const map = mapRef.current, ml = mlRef.current;
    if (!ready || !map || !ml) return;
    markers.current.forEach((m) => m.remove());
    markers.current = Object.values(pack.places).map((p) => {
      const d = pinElement(p.kind === "hotel" || p.kind === "airport" ? p.kind : "sight", p.name);
      d.setAttribute("data-place", p.id);
      return new ml.Marker({ element: d, anchor: "bottom", offset: [0, 18] }).setLngLat([p.lon, p.lat]).addTo(map);
    });
  }, [ready, pack.places]);

  // routes + fit
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("routes") as import("maplibre-gl").GeoJSONSource).setData({ type: "FeatureCollection", features: pack.routes.filter((r) => r.id !== routeId).map((r) => r.geojson) as never });
    (map.getSource("active") as import("maplibre-gl").GeoJSONSource).setData({ type: "FeatureCollection", features: route ? [route.geojson as never] : [] });
    detector.current = route ? new OffRouteDetector(route.geojson.geometry.coordinates) : null;
    setOff(null);
    const pts = route ? route.geojson.geometry.coordinates : pin && pack.places[pin] ? [[pack.places[pin].lon, pack.places[pin].lat]] : [];
    try {
      if (pts.length > 1) {
        const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
        map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: { top: 60, bottom: 50, left: 40, right: 40 }, duration: 600, maxZoom: 18 });
      } else if (pts.length === 1) map.easeTo({ center: pts[0] as [number, number], zoom: 16 });
    } catch { /* a camera error must never take the page down */ }
  }, [ready, route, routeId, pin, pack.routes, pack.places]);

  const applyPos = (p: Pos) => {
    setPos(p);
    const map = mapRef.current, ml = mlRef.current;
    if (!map || !ml) return;
    if (!gpsMarker.current) {
      const d = document.createElement("div");
      d.setAttribute("data-testid", "gps-dot");
      d.innerHTML = `<div class="gps-dot"></div><div data-arrow style="position:absolute;left:50%;top:-17px;width:0;height:0;margin-left:-7px;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:14px solid #d8fd34;filter:drop-shadow(0 0 0 #050505) drop-shadow(1px 0 0 #050505) drop-shadow(-1px 0 0 #050505) drop-shadow(0 -1px 0 #050505);transform-origin:7px 30px;display:none"></div>`;
      gpsMarker.current = new ml.Marker({ element: d }).setLngLat([p.lon, p.lat]).addTo(map);
    }
    gpsMarker.current.setLngLat([p.lon, p.lat]);
    if (follow.current) { map.easeTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 16), duration: 700 }); if (!navigatingRef.current) follow.current = false; }
    const arrow = gpsMarker.current.getElement().querySelector("[data-arrow]") as HTMLElement | null;
    if (arrow) { arrow.style.display = p.heading != null && !Number.isNaN(p.heading) ? "block" : "none"; arrow.style.transform = `rotate(${p.heading ?? 0}deg)`; }
    (map.getSource("accuracy") as import("maplibre-gl").GeoJSONSource | undefined)?.setData({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [circlePolygon(p, Math.max(p.accuracy ?? 10, 5))] } });
    if (detector.current) setOff(detector.current.update(p, p.ts));
  };

  const startGps = () => {
    if (!("geolocation" in navigator)) return setGpsErr("This phone does not share location with the browser.");
    setGpsErr(null);
    setTracking(true);
    follow.current = true;
    watch.current = navigator.geolocation.watchPosition(
      (g) => applyPos({ lat: g.coords.latitude, lon: g.coords.longitude, accuracy: g.coords.accuracy, heading: g.coords.heading, ts: Date.now() }),
      (e) => setGpsErr(e.code === 1 ? "Location is blocked. Allow location for this app in your phone settings. GPS works with no mobile data." : "Waiting for a GPS fix. The first fix can take a minute outdoors."),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 },
    );
  };
  const stopGps = () => {
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
    setTracking(false);
  };
  const startNav = async () => {
    setNavigating(true);
    navigatingRef.current = true; follow.current = true;
    if (watch.current === null) startGps();
    try { wake.current = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null; } catch {}
  };
  const stopNav = () => {
    setNavigating(false);
    navigatingRef.current = false;
    void wake.current?.release().catch(() => {});
    wake.current = null;
  };
  useEffect(() => () => { stopGps(); void wake.current?.release().catch(() => {}); if (simTimer.current) clearInterval(simTimer.current); }, []);

  // Demo: simulate GPS along the route (no real GPS needed), optionally drifting off the line.
  const simulate = (offRoute: boolean) => {
    if (!route) return;
    if (simTimer.current) clearInterval(simTimer.current);
    const line = route.geojson.geometry.coordinates;
    let i = 0;
    detector.current?.reset();
    simTimer.current = setInterval(() => {
      const k = Math.min(line.length - 1, Math.floor(i / 4));
      const base = { lat: line[k][1], lon: line[k][0] };
      const p = offRoute && i > 3 ? offsetPoint(base, 90, 90) : base;
      applyPos({ ...p, accuracy: 8, heading: null, ts: Date.now() + (offRoute ? i * 4000 : 0) });
      i++;
      if (k >= line.length - 1 && !offRoute) clearInterval(simTimer.current!);
      if (offRoute && i > 8) clearInterval(simTimer.current!);
    }, 800);
  };

  const outside = useMemo(() => {
    if (!pos || !hasTiles) return false;
    const inBox = (b: [number, number, number, number]) => pos.lon >= b[0] && pos.lon <= b[2] && pos.lat >= b[1] && pos.lat <= b[3];
    return !pack.map.cities.some((c) => (c.pmtiles && inBox(c.bbox)) || (c.core && inBox(c.core.bbox)));
  }, [pos, hasTiles, pack.map.cities]);

  // next step + distance
  const nav = useMemo(() => {
    if (!route || !pos) return null;
    const line = route.geojson.geometry.coordinates;
    const here = progressAlong(pos, line);
    const steps = route.steps.map((s, i) => ({ s, i, p: progressAlong({ lat: s.lat, lon: s.lon }, line).progressM }));
    const next = steps.find((x) => x.p > here.progressM + 5 && x.i > 0) ?? steps[steps.length - 1];
    const remaining = Math.max(0, Math.min(route.distance_m, route.distance_m - here.progressM));
    return { step: next.s, distToNext: Math.max(0, next.p - here.progressM), remaining, onLineM: nearestOnLine(pos, line).distM };
  }, [route, pos]);

  // the map sits above the control panel in a column, so the panel never covers it; resize the canvas when the panel grows or shrinks
  useEffect(() => {
    if (!el.current || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(el.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="flex h-[calc(100dvh-16rem)] min-h-[440px] flex-col overflow-hidden rounded-2xl border-[1.5px] border-line sm:h-[calc(100dvh-12rem)]">
      <div className="relative min-h-[220px] flex-1">
        {/* inline position: maplibre-gl.css sets .maplibregl-map { position: relative }, which would otherwise win and collapse this to 0 height */}
        <div ref={el} className="absolute inset-0" style={{ position: "absolute", inset: 0 }} data-testid="map-canvas" aria-label="Offline map" role="application" />
        {!hasTiles && <p className="absolute left-3 top-3 z-10 max-w-[70%] rounded-xl bg-surface/90 px-3 py-2 text-[13px] text-muted">Street map files are not built yet (run npm run tiles:build). Places and routes still draw offline.</p>}
        {outside && <p role="status" data-testid="outside-map" className="absolute inset-x-3 top-3 z-10 rounded-xl border border-line bg-surface/95 px-3 py-2 text-[13px] text-muted">You are outside the area saved for this trip. Your GPS dot still works, but there is no street map here.</p>}

        {off?.off && (
          <div role="alert" data-testid="off-route" className="absolute inset-x-3 top-3 z-20 flex items-center gap-3 rounded-2xl border-[1.5px] border-warn bg-surface p-3">
            <TriangleAlert className="shrink-0 text-warn" />
            <div className="min-w-0"><p className="font-semibold">You are off the saved route</p><p className="text-[15px] text-muted">Head {cardinal(off.bearingDeg ?? 0)} for {fmtDist(off.distM)} to get back on it.</p></div>
            <span aria-hidden style={{ transform: `rotate(${off.bearingDeg ?? 0}deg)` }} className="ml-auto text-3xl text-warn">↑</span>
          </div>
        )}
      </div>

      <div className="max-h-[48%] shrink-0 space-y-2 overflow-y-auto border-t border-line bg-bg p-3">
        {route ? (
          <>
            <div className="flex items-center justify-between gap-2"><p className="min-w-0 flex-1 truncate font-semibold">{route.fromName} to {route.toName}</p><Badge className="shrink-0 whitespace-nowrap">{fmtDist(route.distance_m)} · {Math.round(route.duration_s / 60)} min</Badge></div>
            {route.approximate && <p className="text-[13px] text-muted">Sample straight-line route (no routing key at build time). Not turn-by-turn.</p>}
            {nav ? (
              <p data-testid="next-step" className="rounded-xl border-[1.5px] border-line bg-surface p-2 text-[15px]"><span className="font-semibold">In {fmtDist(nav.distToNext)}:</span> {nav.step.instruction}</p>
            ) : <p className="line-clamp-2 text-[15px] text-muted">{route.steps[0]?.instruction}</p>}
          </>
        ) : <p className="text-[15px] text-muted">Pick a saved route above, or tap Show my location to see where you are.</p>}
        {gpsErr && <p className="text-[14px] text-warn">{gpsErr}</p>}
        {pos && <p className="text-[13px] text-muted" data-testid="gps-status">GPS fix: accuracy about {Math.round(pos.accuracy ?? 0)} m</p>}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Button size="md" variant={tracking ? "secondary" : "primary"} onClick={() => (!tracking ? startGps() : stopGps())} data-testid="locate-btn" className={route ? "px-2" : "col-span-2"}><Crosshair size={18} className="shrink-0" /> {!tracking ? <><span className="sm:hidden">My location</span><span className="hidden sm:inline">Show my location</span></> : "Stop location"}</Button>
          {route && <Button size="md" variant={navigating ? "danger" : "secondary"} onClick={() => (navigating ? stopNav() : void startNav())} className="px-2"><Navigation size={18} className="shrink-0" /> {navigating ? "Stop" : "Navigate"}</Button>}
        </div>
        {route && (
          <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
            {process.env.NEXT_PUBLIC_DEMO_MODE !== "false" && (<>
              <Button size="md" variant="ghost" className="whitespace-nowrap border border-line px-1" onClick={() => simulate(false)}><Footprints size={16} className="hidden shrink-0 sm:block" /> <span className="sm:hidden">Walk demo</span><span className="hidden sm:inline">Demo: walk route</span></Button>
              <Button size="md" variant="ghost" className="whitespace-nowrap border border-line px-1" onClick={() => simulate(true)}><span className="sm:hidden">Off-route</span><span className="hidden sm:inline">Demo: go off-route</span></Button>
            </>)}
            <Button size="md" variant="ghost" className="px-1" onClick={() => onRoute(null)}>Clear</Button>
          </div>
        )}
      </div>
    </div>
  );
}
