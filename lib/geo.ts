export type LatLon = { lat: number; lon: number };

export function haversineKm(a: LatLon, b: LatLon): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function haversineM(a: LatLon, b: LatLon) {
  return haversineKm(a, b) * 1000;
}

export type BBox = [number, number, number, number]; // minLon minLat maxLon maxLat

export function bboxOf(points: LatLon[], padDeg = 0.03): BBox {
  const lons = points.map((p) => p.lon);
  const lats = points.map((p) => p.lat);
  return [Math.min(...lons) - padDeg, Math.min(...lats) - padDeg, Math.max(...lons) + padDeg, Math.max(...lats) + padDeg];
}
