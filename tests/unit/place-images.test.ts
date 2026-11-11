import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import images from "@/lib/seed/place-images.json";
import { DESTINATIONS } from "@/lib/seed/data";
import { generateSeed } from "@/lib/seed/generate";

const ALLOWED = /^(CC BY(-SA)?( \d(\.\d)?)?|CC BY(-SA)? \d\.\d( [A-Za-z]+)?|CC0.*|Public domain|PD.*|Attribution|No restrictions)$/i;
const entries = Object.entries(images as Record<string, { file: string; title: string; author: string; license: string; licenseUrl: string; sourceUrl: string }>);

describe("real place photos (Wikimedia Commons, openly licensed)", () => {
  it("has photos for most landmarks, and every entry is a real POI of a real destination", () => {
    const real = new Set(DESTINATIONS.flatMap((d) => d.pois.map((p) => `${d.slug}/${p.name}`)));
    expect(entries.length).toBeGreaterThan(60);
    for (const [k] of entries) expect(real.has(k), `${k} is not a POI in the itineraries`).toBe(true);
  });
  it("every photo file exists locally (no hotlinking) and has author, license and a Commons source", () => {
    for (const [k, v] of entries) {
      expect(fs.existsSync(path.join(process.cwd(), "public", v.file)), `${k}: ${v.file}`).toBe(true);
      expect(v.file.startsWith("/places/")).toBe(true);
      expect(v.author.length, k).toBeGreaterThan(1);
      expect(ALLOWED.test(v.license), `${k}: license "${v.license}"`).toBe(true);
      expect(v.sourceUrl, k).toMatch(/^https:\/\/commons\.wikimedia\.org\//);
    }
  });
  it("every destination has a hero photo of one of its own landmarks", () => {
    const seed = generateSeed({ baseDate: "2026-11-10", flightDays: 1 });
    const noHero = seed.destinations.filter((d) => !d.heroImage).map((d) => d.slug);
    expect(noHero, `destinations without a photo: ${noHero.join(", ")}`).toEqual([]);
  });
  it("landmarks carry their photo and credit; fictional hotels never get a photo", () => {
    const seed = generateSeed({ baseDate: "2026-11-10", flightDays: 1 });
    const withImg = seed.pois.filter((p) => p.imageFile);
    expect(withImg.length).toBe(entries.length);
    for (const p of withImg) expect(p.imageCredit?.license).toBeTruthy();
    expect(seed.pois.filter((p) => p.category === "hotel" && (p.imageFile || p.imageCredit))).toEqual([]);
    expect(seed.pois.filter((p) => p.category === "airport" && p.imageFile)).toEqual([]);
  });
});
