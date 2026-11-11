import { defineConfig, devices } from "@playwright/test";

const PORT = 3600;
const DB = ".data/pglite-e2e";

// E2E runs against a production build (service worker + offline need `next start`).
// The webServer command re-seeds an isolated local database first (40 days of sample inventory).
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", ...devices["Pixel 7"], serviceWorkers: "allow", permissions: ["geolocation"], geolocation: { latitude: 48.8606, longitude: 2.3376 } },
  webServer: {
    // DATABASE_URL= and LLM_API_KEY= (empty) win over .env.local, so the tests NEVER touch your Neon database or a live model; SMS_PROVIDER=sim so no real Twilio message is ever sent by a test.
    command: `rm -rf ${DB} && DATABASE_URL= LLM_API_KEY= SMS_PROVIDER=sim PGLITE_DIR=${DB} SEED_FLIGHT_DAYS=40 npx tsx scripts/reset.ts && DATABASE_URL= LLM_API_KEY= SMS_PROVIDER=sim PGLITE_DIR=${DB} DEMO_MODE=true NEXT_PUBLIC_DEMO_MODE=true npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
