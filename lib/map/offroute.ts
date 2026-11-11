import { haversineM, type LatLon } from "@/lib/geo";

export type Nearest = { distM: number; point: LatLon; segIndex: number; bearingDeg: number };

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Equirectangular projection around `origin` -> metres. Accurate to well under 1% at city scale. */
function toXY(p: LatLon, origin: LatLon) {
  return { x: rad(p.lon - origin.lon) * Math.cos(rad(origin.lat)) * R, y: rad(p.lat - origin.lat) * R };
}

export function bearing(from: LatLon, to: LatLon): number {
  const y = Math.sin(rad(to.lon - from.lon)) * Math.cos(rad(to.lat));
  const x = Math.cos(rad(from.lat)) * Math.sin(rad(to.lat)) - Math.sin(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.cos(rad(to.lon - from.lon));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Nearest point on a polyline ([lon,lat] pairs, GeoJSON order) and the distance to it in metres. */
export function nearestOnLine(pos: LatLon, line: [number, number][]): Nearest {
  let best: Nearest = { distM: Infinity, point: { lat: line[0][1], lon: line[0][0] }, segIndex: 0, bearingDeg: 0 };
  for (let i = 0; i < line.length - 1; i++) {
    const a = { lat: line[i][1], lon: line[i][0] };
    const b = { lat: line[i + 1][1], lon: line[i + 1][0] };
    const A = toXY(a, pos), B = toXY(b, pos); // pos is the origin => P = (0,0)
    const dx = B.x - A.x, dy = B.y - A.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(A.x * dx + A.y * dy) / len2));
    const cx = A.x + t * dx, cy = A.y + t * dy;
    const d = Math.hypot(cx, cy);
    if (d < best.distM) {
      const point = { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
      best = { distM: d, point, segIndex: i, bearingDeg: bearing(pos, point) };
    }
  }
  return best;
}

export const OFF_ROUTE_METRES = 40;
export const OFF_ROUTE_SECONDS = 10;

export type OffRouteState = { off: boolean; distM: number; backTo?: LatLon; bearingDeg?: number; sinceMs?: number };

/** Off-route = more than 40 m from the line for 10 s in a row (spec 6.4). */
export class OffRouteDetector {
  private since: number | null = null;
  constructor(private line: [number, number][], private metres = OFF_ROUTE_METRES, private seconds = OFF_ROUTE_SECONDS) {}

  update(pos: LatLon, tsMs: number): OffRouteState {
    const n = nearestOnLine(pos, this.line);
    if (n.distM <= this.metres) {
      this.since = null;
      return { off: false, distM: n.distM };
    }
    if (this.since === null) this.since = tsMs;
    const off = tsMs - this.since >= this.seconds * 1000;
    return { off, distM: n.distM, backTo: n.point, bearingDeg: n.bearingDeg, sinceMs: tsMs - this.since };
  }

  reset() {
    this.since = null;
  }
}

/** Metres along the line from the point nearest `pos` to the end, used for "distance remaining". */
export function remainingM(pos: LatLon, line: [number, number][]): number {
  const n = nearestOnLine(pos, line);
  let total = haversineM(n.point, { lat: line[n.segIndex + 1][1], lon: line[n.segIndex + 1][0] });
  for (let i = n.segIndex + 1; i < line.length - 1; i++) total += haversineM({ lat: line[i][1], lon: line[i][0] }, { lat: line[i + 1][1], lon: line[i + 1][0] });
  return total;
}

/** Distance (m) from the start of the line to the point nearest `pos`. */
export function progressAlong(pos: LatLon, line: [number, number][]) {
  const n = nearestOnLine(pos, line);
  let acc = 0;
  for (let i = 0; i < n.segIndex; i++) acc += haversineM({ lat: line[i][1], lon: line[i][0] }, { lat: line[i + 1][1], lon: line[i + 1][0] });
  acc += haversineM({ lat: line[n.segIndex][1], lon: line[n.segIndex][0] }, n.point);
  return { progressM: acc, ...n };
}

/** A circle polygon (GeoJSON) around a point, for the GPS accuracy ring. */
export function circlePolygon(center: LatLon, radiusM: number, steps = 48): [number, number][] {
  const out: [number, number][] = [];
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.cos((center.lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    out.push([center.lon + dLon * Math.cos(a), center.lat + dLat * Math.sin(a)]);
  }
  return out;
}

/** A point `metres` to the side of the line start, for the "simulate off-route" demo button. */
export function offsetPoint(p: LatLon, metres: number, bearingDeg: number): LatLon {
  const b = (bearingDeg * Math.PI) / 180;
  return { lat: p.lat + (metres * Math.cos(b)) / 111320, lon: p.lon + (metres * Math.sin(b)) / (111320 * Math.cos((p.lat * Math.PI) / 180)) };
}
