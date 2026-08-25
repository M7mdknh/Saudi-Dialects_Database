import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run build && npm run start -- -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      // The mobile and desktop projects share this one server process, so
      // every submitting spec across both collapses onto the same
      // rate-limit bucket (no forwarded-for header locally) — the full e2e
      // suite alone exceeds the real per-IP budget. See rate-limit.ts.
      E2E_RATE_LIMIT_BYPASS: "1",
    },
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
});
