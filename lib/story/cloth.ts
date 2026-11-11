/**
 * Cloth for the scroll story. Pure maths (no three.js import) so it can be unit-tested.
 *
 *  1. The hero banner (the destinations flag trailing the plane): a pennant that is pinned at the tail and flaps freely.
 *  2. The trip cards: each card starts WRAPPED over the roof of the fuselage, slides off along a curve while it
 *     UNROLLS and ripples, and finishes completely flat and STATIC in front of the viewer.
 *
 * Conventions
 *  - Card frame: the card lies in the XY plane, +x right, +y up, +z out of the face. Centre at the origin. SETTLED = flat, z = 0.
 *  - Wrapped: the card hugs a cylinder of radius `radius` whose axis is the x axis, 'radius' below the card centre
 *    (so the centre touches the roof, the top and bottom edges drape down the sides of the fuselage).
 *  - q is the life of one card, 0..1. 0 = wrapped on the plane, UNROLL_END = settled in front, HOLD_END = leaves.
 *  - Banner frame: pinned edge at x = 0, the free end trails toward -x. y is up, z is out of the face.
 */
import { clamp01, smooth } from "./path";

export type V3 = { x: number; y: number; z: number };

/* ------------------------------------------------------------------ cards */

/** Slide + unroll is finished at this life; from here to HOLD_END the card is perfectly flat and static. */
export const UNROLL_END = 0.5;
export const HOLD_END = 0.72;
export const WRAP_SCALE = 0.5;

export type CardClothOpts = {
  /** Settled card size (world units). */
  width: number;
  height: number;
  /** Radius of the fuselage cylinder the card is wrapped around (world units). */
  radius: number;
  /** Per-card phase so the cards do not ripple in unison. */
  seed?: number;
  /** 1 = normal; scroll speed raises it (more flutter while you scroll fast). */
  flutter?: number;
};

/** Ripple amplitude envelope: exactly 0 while wrapped (q <= 0) and exactly 0 once settled (q >= UNROLL_END); peaks mid-flight. */
export function rippleEnvelope(q: number): number {
  return smooth(0.0, 0.14, q) * (1 - smooth(0.3, UNROLL_END, q));
}

/** Unroll progress 0 (wrapped) .. 1 (flat). Exactly 1 from UNROLL_END on. */
export const unroll = (q: number) => smooth(0.03, UNROLL_END, q);

/** Curvature of the card, 1/radius while wrapped, exactly 0 once unrolled. */
export const cardCurvature = (q: number, radius: number) => (1 / radius) * (1 - unroll(q));

/** Size factor: small while wrapped around the plane, full size once unrolled (exactly 1 from UNROLL_END on). */
export const cardScale = (q: number) => WRAP_SCALE + (1 - WRAP_SCALE) * unroll(q);

/** A strip of the card, arc length s from its centre, bent with constant curvature k: a circular arc (k = 1/radius) that straightens as k -> 0. */
export function unrollStrip(s: number, k: number): { y: number; z: number } {
  if (k < 1e-9) return { y: s, z: 0 }; // flat: exact
  return { y: Math.sin(k * s) / k, z: (Math.cos(k * s) - 1) / k };
}

/** Point (u, v in 0..1; v = 1 is the top edge) of a card at life q and time t (seconds), in the card frame. */
export function cardPoint(u: number, v: number, q: number, t: number, o: CardClothOpts): V3 {
  const sc = cardScale(q);
  const W = o.width * sc, H = o.height * sc;
  const x0 = (u - 0.5) * W;
  const s = (v - 0.5) * H; // arc length along the card height
  const k = cardCurvature(q, o.radius);
  const strip = unrollStrip(s, k); // a true unrolling strip
  const y = strip.y;
  let z = strip.z;
  let x = x0;

  const e = rippleEnvelope(q);
  if (e > 0) {
    const ph = (o.seed ?? 0) * 6.2831853;
    const f = o.flutter ?? 1;
    const lead = 1 - v; // the bottom edge leads the slide
    // waves travel from the leading edge back toward the plane, a slower cross swell, and a quick flutter
    const w1 = Math.sin(6.2831853 * (1.35 * lead + 0.35 * u) - 4.6 * t + ph);
    const w2 = Math.sin(6.2831853 * (2.2 * u - 0.8 * lead) + 3.1 * t + 2 * ph);
    const w3 = Math.sin(6.2831853 * (5.0 * u + 3.0 * lead) - 9.0 * t + 3 * ph);
    const amp = e * H;
    z += amp * (0.15 * (0.5 + 0.5 * lead) * w1 + 0.06 * w2 + 0.028 * f * w3 * lead);
    z += amp * 0.2 * lead * lead * lead; // leading edge curls toward the viewer
    x += amp * 0.045 * Math.sin(6.2831853 * (0.9 * lead + 0.6 * u) - 3.4 * t + ph) * lead; // slight sideways drift
  }
  return { x, y, z };
}

/** Fill a Float32Array (x,y,z per vertex) for a PlaneGeometry grid of nu x nv segments (vertex order: top row first, left to right). */
export function fillCardGrid(out: Float32Array, nu: number, nv: number, q: number, t: number, o: CardClothOpts): void {
  let i = 0;
  for (let iy = 0; iy <= nv; iy++) {
    const v = 1 - iy / nv;
    for (let ix = 0; ix <= nu; ix++) {
      const p = cardPoint(ix / nu, v, q, t, o);
      out[i++] = p.x; out[i++] = p.y; out[i++] = p.z;
    }
  }
}

/** Where one card is in its life when the scroll offset is `x` (cards are one unit apart; each lives `life` units). */
export function cardLife(x: number, index: number, life: number): number {
  return clamp01((x - index) / life);
}

/** Opacity of a card at life q: fades in as it appears on the roof, solid while it slides and holds, fades out as it leaves. */
export const cardOpacity = (q: number) => smooth(0, 0.05, q) * (1 - smooth(HOLD_END, 1, q));

export function cubicBezier(p0: V3, p1: V3, p2: V3, p3: V3, t: number): V3 {
  const a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, c = 3 * (1 - t) * t * t, d = t ** 3;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y, z: a * p0.z + b * p1.z + c * p2.z + d * p3.z };
}

/* ----------------------------------------------------------------- banner */

export type BannerOpts = {
  length: number; // pinned edge to free end
  height: number;
  /** Wind strength: 0.5 gentle .. 1.5 gusting. Never 0: the banner always moves. */
  amp: number;
  /** 1 = normal; scroll speed raises it (more flutter while you scroll fast). */
  flutter?: number;
  /** Bend of the free end in y / z (plane-local units at the free end), from the plane's own motion. */
  lagY?: number;
  lagZ?: number;
  /** Twist of the free end (radians). */
  twist?: number;
  /** How much of the wave also lifts the cloth up and down (so the flapping shows in the silhouette from the side). Default 0.55. */
  flap?: number;
};

/** Out-of-plane wave height at (u, v) (u = 0 pinned, 1 free end) and time t. Zero at the pinned edge, biggest at the free end. */
export function bannerWave(u: number, v: number, t: number, o: BannerOpts): number {
  const f = o.flutter ?? 1;
  const A = o.amp * o.length * 0.075;
  const env = Math.pow(u, 1.15) * (0.25 + 0.75 * u);
  const main = Math.sin(6.2831853 * (u * 2.4 + 0.18 * v) - 4.2 * t);
  const swell = 0.45 * Math.sin(6.2831853 * (u * 1.1 - 0.35 * v) - 1.7 * t + 1.3);
  const cross = 0.3 * Math.sin(6.2831853 * (v * 1.6 - u * 0.5) + 2.2 * t);
  const flutter = 0.24 * f * u * Math.sin(6.2831853 * (u * 6.0 + 0.5 * v) - 9.5 * t + 0.7);
  return A * env * (main + swell + cross + flutter);
}

/**
 * Fills positions (x,y,z per vertex) and a per-vertex brightness (0.5..1, darker in the troughs of the folds) for a grid of
 * nu x nv segments. Vertex order is a PlaneGeometry's: top row (v = 1) first; within a row ix = 0 is the FREE end.
 * Each row keeps its length (the cloth does not stretch): where it rises and falls, it draws in toward the pin.
 */
export function fillBannerGrid(pos: Float32Array, shade: Float32Array, nu: number, nv: number, t: number, o: BannerOpts): void {
  const du = o.length / nu;
  const zs = new Float64Array(nu + 1);
  const A = o.amp * o.length * 0.075;
  for (let iy = 0; iy <= nv; iy++) {
    const v = 1 - iy / nv;
    for (let i = 0; i <= nu; i++) zs[i] = bannerWave(1 - i / nu, v, t, o); // i = 0 is the free end (u = 1)
    // walk from the pinned end (i = nu) to the free end (i = 0)
    let x = 0;
    for (let i = nu; i >= 0; i--) {
      const u = 1 - i / nu;
      if (i < nu) {
        const dz = zs[i] - zs[i + 1];
        x -= Math.sqrt(Math.max(du * du - dz * dz, (0.35 * du) ** 2));
      }
      let y = (v - 0.5) * o.height;
      let z = zs[i];
      const lagY = (o.lagY ?? 0) * u * u, lagZ = (o.lagZ ?? 0) * u * u;
      y += lagY + zs[i] * (o.flap ?? 0.55); z += lagZ; // the wave moves the cloth out of its plane AND up/down: it flaps in the silhouette too
      const tw = (o.twist ?? 0) * Math.pow(u, 1.6);
      if (tw !== 0) { const c = Math.cos(tw), s = Math.sin(tw); const yy = y * c - z * s; z = y * s + z * c; y = yy; }
      const k = (iy * (nu + 1) + i) * 3;
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      const zn = A > 1e-6 ? Math.max(-1, Math.min(1, zs[i] / (A * (0.2 + 0.8 * u)))) : 0;
      shade[iy * (nu + 1) + i] = 0.74 + 0.26 * (0.5 + 0.5 * zn);
    }
  }
}
