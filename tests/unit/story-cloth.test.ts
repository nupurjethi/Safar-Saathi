import { describe, expect, it } from "vitest";
import { type BannerOpts, UNROLL_END, HOLD_END, bannerWave, cardCurvature, cardLife, cardOpacity, cardPoint, cardScale, cubicBezier, unrollStrip, fillBannerGrid, fillCardGrid, rippleEnvelope, unroll, WRAP_SCALE, type CardClothOpts } from "@/lib/story/cloth";

const O: CardClothOpts = { width: 3, height: 1.875, radius: 0.35, seed: 0.37, flutter: 1 };
const grid = (n: number) => Array.from({ length: n + 1 }, (_, i) => i / n);
const TIMES = [0, 0.13, 0.5, 1.7, 3.3, 12.9, 100.25];

describe("trip card cloth: wrapped on the plane, unrolls, then flat and static", () => {
  it("is exactly flat and does not move at all once settled (any time, any u, v, any flutter)", () => {
    for (const q of [UNROLL_END, 0.55, HOLD_END, 0.9, 1]) {
      for (const t of TIMES) for (const flutter of [0, 1, 3]) for (const u of grid(12)) for (const v of grid(12)) {
        const p = cardPoint(u, v, q, t, { ...O, flutter });
        expect(p.z).toBe(0); // exactly flat: no residual wobble
        expect(Math.abs(p.x - (u - 0.5) * O.width)).toBeLessThan(1e-12);
        expect(Math.abs(p.y - (v - 0.5) * O.height)).toBeLessThan(1e-12);
      }
    }
    // and the same point at two different times is bit-for-bit identical
    expect(cardPoint(0.3, 0.8, 0.6, 1.1, O)).toEqual(cardPoint(0.3, 0.8, 0.6, 9.9, O));
  });

  it("lies on the fuselage cylinder while wrapped, and does not ripple", () => {
    for (const t of TIMES) for (const u of grid(10)) for (const v of grid(10)) {
      const p = cardPoint(u, v, 0, t, O);
      // cylinder axis is the x axis, one radius below the card centre
      expect(Math.abs(Math.hypot(p.y, p.z + O.radius) - O.radius)).toBeLessThan(1e-9);
      expect(Math.abs(p.x - (u - 0.5) * O.width * WRAP_SCALE)).toBeLessThan(1e-12);
    }
    expect(cardPoint(0.5, 0.5, 0, 0, O).z).toBeCloseTo(0, 12); // the centre touches the roof
    expect(cardPoint(0.5, 0.5, 0, 0, O).y).toBeCloseTo(0, 12);
    expect(rippleEnvelope(0)).toBe(0);
    expect(cardCurvature(0, O.radius)).toBeCloseTo(1 / O.radius, 12);
  });

  it("really is a strip that unrolls: arc length is preserved while the curvature falls to zero", () => {
    for (const q of [0.04, 0.15, 0.3, 0.45, 0.6]) {
      const k = cardCurvature(q, O.radius);
      // walk the strip in small steps: the length of the curve equals the card height whatever the curvature
      let len = 0, prev = unrollStrip(-O.height / 2, k);
      for (let i = 1; i <= 400; i++) { const p = unrollStrip(-O.height / 2 + (O.height * i) / 400, k); len += Math.hypot(p.y - prev.y, p.z - prev.z); prev = p; }
      expect(len).toBeCloseTo(O.height, 3);
    }
    expect(cardCurvature(UNROLL_END, O.radius)).toBe(0);
    expect(cardCurvature(0.9, O.radius)).toBe(0);
    for (let i = 0; i < 20; i++) expect(cardCurvature((i + 1) / 40, O.radius)).toBeLessThanOrEqual(cardCurvature(i / 40, O.radius) + 1e-12); // monotone
  });

  it("ripples peak mid-flight and never exceed a sensible bound", () => {
    let peakQ = 0, peak = 0;
    for (let i = 0; i <= 200; i++) { const q = i / 200; const e = rippleEnvelope(q); expect(e).toBeGreaterThanOrEqual(0); expect(e).toBeLessThanOrEqual(1); if (e > peak) { peak = e; peakQ = q; } }
    expect(peakQ).toBeGreaterThan(0.1); expect(peakQ).toBeLessThan(0.35);
    expect(peak).toBeGreaterThan(0.9);
    let maxDz = 0;
    for (const q of [0.05, 0.12, 0.2, 0.28, 0.4]) for (const t of TIMES) for (const u of grid(16)) for (const v of grid(16)) {
      const p = cardPoint(u, v, q, t, { ...O, flutter: 3 });
      const flat = (v - 0.5) * O.height * cardScale(q);
      // the card stays within a card-height of the roof and never turns inside out: |z| and |y - flat| are bounded
      maxDz = Math.max(maxDz, Math.abs(p.z));
      expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
      expect(Math.abs(p.y - flat)).toBeLessThan(O.height);
    }
    expect(maxDz).toBeLessThan(O.height * 0.9);
  });

  it("moves continuously with progress (no jumps, no pops), and replays the same going backwards", () => {
    const N = 4000;
    for (const t of [0, 1.3, 7.7]) {
      let prev = cardPoint(0.2, 0.9, 0, t, O), worst = 0;
      for (let i = 1; i <= N; i++) {
        const p = cardPoint(0.2, 0.9, i / N, t, O);
        worst = Math.max(worst, Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z));
        prev = p;
      }
      expect(worst).toBeLessThan(0.02); // per 1/4000 of the life
    }
    // pure function of (q, t): the same q gives the same shape whichever direction you scrolled from
    expect(cardPoint(0.7, 0.3, 0.27, 2.2, O)).toEqual(cardPoint(0.7, 0.3, 0.27, 2.2, O));
  });

  it("fills a PlaneGeometry grid (top row first) consistently with cardPoint", () => {
    const nu = 6, nv = 4, out = new Float32Array((nu + 1) * (nv + 1) * 3);
    fillCardGrid(out, nu, nv, 0.22, 1.4, O);
    const topLeft = cardPoint(0, 1, 0.22, 1.4, O), bottomRight = cardPoint(1, 0, 0.22, 1.4, O);
    expect(out[0]).toBeCloseTo(topLeft.x, 5); expect(out[1]).toBeCloseTo(topLeft.y, 5); expect(out[2]).toBeCloseTo(topLeft.z, 5);
    const last = out.length - 3;
    expect(out[last]).toBeCloseTo(bottomRight.x, 5); expect(out[last + 1]).toBeCloseTo(bottomRight.y, 5);
  });

  it("card life, opacity and the slide path behave", () => {
    expect(cardLife(0, 0, 1.9)).toBe(0); expect(cardLife(5, 0, 1.9)).toBe(1);
    expect(cardLife(1.9, 1, 1.9)).toBeCloseTo(0.4737, 3);
    expect(cardOpacity(0)).toBe(0); expect(cardOpacity(0.3)).toBe(1); expect(cardOpacity(HOLD_END)).toBe(1); expect(cardOpacity(1)).toBe(0);
    expect(unroll(0)).toBe(0); expect(unroll(UNROLL_END)).toBe(1);
    const a = { x: 0, y: 1, z: 0 }, d = { x: 3, y: 0, z: 4 };
    expect(cubicBezier(a, { x: 0, y: 2, z: 1 }, { x: 3, y: 1, z: 1 }, d, 0)).toEqual(a);
    expect(cubicBezier(a, { x: 0, y: 2, z: 1 }, { x: 3, y: 1, z: 1 }, d, 1)).toEqual(d);
  });
});

describe("hero banner cloth: always moving, pinned at the tail", () => {
  const B: BannerOpts = { length: 34, height: 11, amp: 1, flutter: 1 };
  const NU = 40, NV = 14;
  const fill = (t: number, o = B) => { const pos = new Float32Array((NU + 1) * (NV + 1) * 3), shade = new Float32Array((NU + 1) * (NV + 1)); fillBannerGrid(pos, shade, NU, NV, t, o); return { pos, shade }; };

  it("is pinned: the edge at the tail never moves, the free end swings the most", () => {
    const a = fill(0.4), b = fill(1.9);
    for (let iy = 0; iy <= NV; iy++) {
      const k = (iy * (NU + 1) + NU) * 3; // pinned column
      expect(a.pos[k]).toBe(0); expect(Math.abs(a.pos[k + 2])).toBeLessThan(1e-9); expect(Math.abs(b.pos[k + 2])).toBeLessThan(1e-9);
    }
    let pinned = 0, free = 0;
    for (const t of [0.3, 0.9, 1.7, 2.6, 3.4]) for (let u = 0; u <= 1; u += 0.05) { const w = Math.abs(bannerWave(u, 0.5, t, B)); if (u < 0.1) pinned = Math.max(pinned, w); if (u > 0.9) free = Math.max(free, w); }
    expect(free).toBeGreaterThan(pinned * 6);
  });

  it("never goes rigid: it keeps moving even in the gentlest wind, and moves more in a stronger one", () => {
    const variance = (o: BannerOpts) => {
      let sum = 0;
      const base = fill(0, o).pos;
      for (let i = 1; i <= 30; i++) { const p = fill(i * 0.1, o).pos; let d = 0; for (let k = 2; k < p.length; k += 3) d += (p[k] - base[k]) ** 2; sum += d / (p.length / 3); }
      return sum / 30;
    };
    const calm = variance({ ...B, amp: 0.5 }), strong = variance({ ...B, amp: 1.3 });
    expect(calm).toBeGreaterThan(0.5); // plainly visible motion (plane-local units squared)
    expect(strong).toBeGreaterThan(calm * 2);
    expect(bannerWave(0.8, 0.4, 0.1, { ...B, amp: 0.5 })).not.toBe(bannerWave(0.8, 0.4, 0.6, { ...B, amp: 0.5 }));
  });

  it("flutters more while you scroll fast (the flutter factor adds motion at the free end)", () => {
    const tipMotion = (flutter: number) => { let s = 0; for (let i = 0; i < 400; i++) { const t = i * 0.05; s += Math.abs(bannerWave(0.97, 0.5, t + 0.05, { ...B, flutter }) - bannerWave(0.97, 0.5, t, { ...B, flutter })); } return s; };
    expect(tipMotion(3.2)).toBeGreaterThan(tipMotion(1) * 1.1);
  });

  it("does not stretch (rows keep their length), stays finite and keeps a sane brightness range", () => {
    const { pos, shade } = fill(1.23, { ...B, amp: 1.5, flutter: 3, lagY: 3, lagZ: -2, twist: 0.4 });
    for (let iy = 0; iy <= NV; iy++) {
      let len = 0;
      for (let i = NU; i > 0; i--) { const a = (iy * (NU + 1) + i) * 3, b = (iy * (NU + 1) + i - 1) * 3; len += Math.hypot(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]); }
      expect(len).toBeGreaterThan(B.length * 0.95); // twist and lag add a little; the cloth never shrinks to nothing or balloons
      expect(len).toBeLessThan(B.length * 1.35);
    }
    for (const v of pos) expect(Number.isFinite(v)).toBe(true);
    for (const s of shade) { expect(s).toBeGreaterThanOrEqual(0.5); expect(s).toBeLessThanOrEqual(1); }
    expect(Math.max(...shade) - Math.min(...shade)).toBeGreaterThan(0.1); // folds shade darker in the troughs
  });
});
