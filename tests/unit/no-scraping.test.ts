import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["app", "lib", "components", "scripts", "public/sw.js", "next.config.ts", "package.json"];
const SKIP = new Set(["node_modules", ".next", ".data", "test-results"]);
const BANNED = /(skyscanner|makemytrip|goibibo|cleartrip|kayak|expedia)\.(com|co|in|net)/i;

function files(p: string): string[] {
  if (!fs.existsSync(p)) return [];
  const st = fs.statSync(p);
  if (st.isFile()) return /\.(ts|tsx|js|mjs|json|sh)$/.test(p) ? [p] : [];
  return fs.readdirSync(p).flatMap((n) => (SKIP.has(n) ? [] : files(path.join(p, n))));
}

describe("no scraping of travel sites (spec 2, 10.11)", () => {
  it("no source file mentions or fetches the hostname of a travel-site that forbids scraping", () => {
    // the ONE allowed mention: lib/providers/platforms.ts builds link-out URLs (the traveller opens the site themselves)
    const hits = ROOTS.flatMap(files).filter((f) => !f.endsWith("lib/providers/platforms.ts") && !f.endsWith("components/chat/PlatformCard.tsx") && BANNED.test(fs.readFileSync(f, "utf8")));
    expect(hits, `Remove scraping code. Real travel data only comes through official APIs or the user's own keys. Found in: ${hits.join(", ")}`).toEqual([]);
  });
  it("the platform link-out file only builds links: it never fetches, scrapes or handles credentials", () => {
    const code = fs.readFileSync("lib/providers/platforms.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|password|cookie|credential/i);
  });
  it("no headless-browser or crawler dependency is installed", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const deps = Object.keys({ ...pkg.dependencies });
    expect(deps.filter((d) => /puppeteer|cheerio|jsdom|crawlee|scrapy|playwright-core/.test(d))).toEqual([]);
  });
  it("only the single LLM module imports an AI provider SDK", () => {
    const offenders = ROOTS.flatMap(files).filter((f) => !f.endsWith("lib/llm/index.ts") && /from "@ai-sdk\//.test(fs.readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
