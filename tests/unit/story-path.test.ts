import { describe, expect, it } from "vitest";
import { heroPose } from "@/lib/story/path";

describe("story plane path", () => {
  const sample = (a: number, b: number, n = 400) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n).map((p) => ({ p, pose: heroPose(p) }));

  it("never travels downward after take-off (cruise segment moves sideways and up)", () => {
    const cruise = sample(0.615, 0.92);
    for (let i = 1; i < cruise.length; i++) expect(cruise[i].pose.y).toBeGreaterThanOrEqual(cruise[i - 1].pose.y - 1e-9);
    expect(cruise[cruise.length - 1].pose.x).toBeGreaterThan(cruise[0].pose.x + 10);
  });
  it("keeps the nose level or up and never rolls to a vertical dive", () => {
    for (const { pose } of sample(0, 0.95)) {
      expect(pose.rz).toBeGreaterThanOrEqual(0); // rz < 0 would point the nose down
      expect(Math.abs(pose.rx)).toBeLessThan(0.7); // no near-vertical roll/pitch
    }
  });
  it("stays above the lower edge of the screen while visible", () => {
    for (const { pose } of sample(0, 0.92)) expect(pose.y).toBeGreaterThan(-1);
  });
});
