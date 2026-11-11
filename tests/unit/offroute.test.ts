import { describe, expect, it } from "vitest";
import { OffRouteDetector, nearestOnLine, offsetPoint, progressAlong, circlePolygon } from "@/lib/map/offroute";
import { approximateRoute } from "@/lib/map/routes";
import { haversineM } from "@/lib/geo";

// straight east-west line along lat 48.85, ~1.1 km
const line: [number, number][] = [[2.3, 48.85], [2.305, 48.85], [2.31, 48.85]];

describe("off-route detector", () => {
  it("projects a point onto the line and measures distance in metres", () => {
    const p = offsetPoint({ lat: 48.85, lon: 2.305 }, 60, 0); // 60 m north of the line
    const n = nearestOnLine(p, line);
    expect(n.distM).toBeGreaterThan(55);
    expect(n.distM).toBeLessThan(65);
    expect(haversineM(n.point, { lat: 48.85, lon: 2.305 })).toBeLessThan(2);
  });

  it("is quiet on the line and within 40 m", () => {
    const d = new OffRouteDetector(line);
    expect(d.update({ lat: 48.85, lon: 2.302 }, 0).off).toBe(false);
    expect(d.update(offsetPoint({ lat: 48.85, lon: 2.302 }, 30, 0), 1000).off).toBe(false);
  });

  it("flags off-route only after 10 s beyond 40 m, and clears when back on the line", () => {
    const d = new OffRouteDetector(line);
    const away = offsetPoint({ lat: 48.85, lon: 2.304 }, 80, 0);
    expect(d.update(away, 0).off).toBe(false);
    expect(d.update(away, 5000).off).toBe(false);
    const s = d.update(away, 10_000);
    expect(s.off).toBe(true);
    expect(s.distM).toBeGreaterThan(75);
    expect(s.backTo).toBeTruthy();
    expect(d.update({ lat: 48.85, lon: 2.304 }, 11_000).off).toBe(false);
    expect(d.update(away, 12_000).off).toBe(false); // timer restarted
  });

  it("tracks progress along the route", () => {
    const start = progressAlong({ lat: 48.85, lon: 2.3 }, line).progressM;
    const mid = progressAlong({ lat: 48.85, lon: 2.305 }, line).progressM;
    expect(mid).toBeGreaterThan(start + 300);
  });

  it("draws an accuracy circle around the position", () => {
    const ring = circlePolygon({ lat: 48.85, lon: 2.3 }, 25);
    expect(ring.length).toBeGreaterThan(30);
    expect(haversineM({ lat: ring[0][1], lon: ring[0][0] }, { lat: 48.85, lon: 2.3 })).toBeGreaterThan(20);
  });

  it("sample routes are flagged approximate and never pose as turn-by-turn", () => {
    const r = approximateRoute({ lat: 48.85, lon: 2.3 }, { lat: 48.86, lon: 2.33 }, "walk", "Louvre");
    expect(r.approximate).toBe(true);
    expect(r.steps[0].instruction).toContain("sample straight-line route");
  });
});
