/**
 * Pure flight paths for the scroll story (no three.js import, so they can be unit-tested).
 * Coordinates are stage units: +x right, +y UP. The plane never travels downward: after take-off it
 * crosses the screen sideways, climbing gently, with the nose following the direction of travel.
 */
export type KF = readonly [number, number][];
export function kf(p: number, frames: KF): number {
  if (p <= frames[0][0]) return frames[0][1];
  for (let i = 0; i < frames.length - 1; i++) {
    const [a, va] = frames[i], [b, vb] = frames[i + 1];
    if (p <= b) { const t = (p - a) / (b - a); const e = t * t * (3 - 2 * t); return va + (vb - va) * e; }
  }
  return frames[frames.length - 1][1];
}
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export type Pose = { x: number; y: number; z: number; rx: number; ry: number; rz: number; scale: number };

/** Hero: pre-flight, take-off to the right (p<0.545), then a level cruise left to right behind the one-liners (0.615-0.92). */
export function heroPose(p: number, t = 0): Pose {
  const wobble = Math.sin(t * 0.9) * 0.05 * (1 - smooth(0.3, 0.5, p));
  return {
    x: kf(p, [[0, 0.1], [0.4, 0.45], [0.5, 3.2], [0.545, 6.4], [0.615, -7.2], [0.92, 7.4]]),
    y: kf(p, [[0, -0.5], [0.35, -0.15], [0.5, 1.3], [0.545, 3.3], [0.615, 1.2], [0.92, 1.8]]) + wobble,
    z: kf(p, [[0, 0], [0.5, 1.4], [0.62, 0.2]]),
    // nose is +x. ry = 0 is a pure side profile flying to the right; rz > 0 lifts the nose. (ry = -pi/2 would aim the nose at the camera.)
    rx: kf(p, [[0, 0], [0.4, -0.12], [0.52, -0.55], [0.615, -0.18], [0.92, -0.12]]),
    ry: kf(p, [[0, -0.52], [0.25, -0.98], [0.42, -1.2], [0.52, -1.5], [0.615, -0.32], [0.92, -0.32]]),
    rz: kf(p, [[0, 0.02], [0.2, 0.03], [0.36, 0.34], [0.52, 0.52], [0.615, 0.06], [0.92, 0.16]]),
    scale: kf(p, [[0, 1], [0.4, 1.12], [0.5, 1.6], [0.62, 1.25], [0.92, 1.3]]),
  };
}
