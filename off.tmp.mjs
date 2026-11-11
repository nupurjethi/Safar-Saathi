import { chromium, devices } from "@playwright/test";
const U = "https://safar-saathi-five.vercel.app", ref = "SS-56001";
const b = await chromium.launch(); const ctx = await b.newContext({ ...devices["Pixel 7"], serviceWorkers: "allow", baseURL: U });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("console.error:", m.text().slice(0, 140)); });
await page.goto(`/api/auth/demo?role=traveller&next=/trips/${ref}?setup=1`);
await page.waitForSelector('[data-testid="offline-ready"]', { timeout: 180000 }).catch(() => console.log("never reached 'Offline guide ready'"));
console.log("status:", (await page.locator('[data-testid="offline-status"]').innerText().catch(() => "?")).slice(0, 120).replace(/\n/g, " "));
const info = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { sw: !!r?.active, controlled: !!navigator.serviceWorker.controller, caches: await Promise.all((await caches.keys()).map(async (k) => k + ":" + (await (await caches.open(k)).keys()).length)) }; });
console.log("sw:", JSON.stringify(info));
await page.reload(); await page.evaluate(() => navigator.serviceWorker.ready);
console.log("controlled after reload:", await page.evaluate(() => !!navigator.serviceWorker.controller));
await ctx.setOffline(true);
for (const p of ["", "/chat", "/guide", "/map", "/sos", "/offline"]) {
  const failed = []; const h = (r) => { if (!/ABORTED/.test(r.failure()?.errorText ?? "") && !/_rsc|\/api\//.test(r.url())) failed.push(r.url().replace(U, "")); }; page.on("requestfailed", h);
  let ok = true; try { await page.goto(`/trips/${ref}${p}`, { timeout: 15000 }); await page.waitForTimeout(3000); } catch { ok = false; }
  console.log(`/trips/${ref}${p}`.padEnd(24), ok ? "loaded" : "NAV FAIL", "| failed:", [...new Set(failed)].slice(0, 3).join(", ") || "none", "|", (await page.locator("main").innerText().catch(() => "")).slice(0, 60).replace(/\n/g, " "));
  page.off("requestfailed", h);
}
await b.close();
