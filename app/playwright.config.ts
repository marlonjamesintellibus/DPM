// The use case 1 story in a real browser (build plan phase 6): `pnpm e2e` builds the app, starts it
// on its own fresh database (DPM_DATA_DIR) with Atlas on the recorded fixture, and plays steps 1 to 8.
// It uses the installed Google Chrome; set E2E_BROWSER=chromium after `npx playwright install chromium`
// on a machine without it.
import { defineConfig } from "@playwright/test";

const PORT = 3100;
// While writing tests, E2E_BASE_URL points them at a server you started yourself (on a fresh `pnpm db:reset`)
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  // The story is one world played in order, so its steps run one after another
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: external ?? `http://localhost:${PORT}`,
    channel: process.env.E2E_BROWSER === "chromium" ? undefined : "chrome",
    viewport: { width: 1440, height: 900 },
    timezoneId: "America/Jamaica",
    trace: "retain-on-failure",
  },
  webServer: external
    ? undefined
    : {
        command: `pnpm db:reset && pnpm build && pnpm start --port ${PORT}`,
        url: `http://localhost:${PORT}/api/health`,
        timeout: 240_000,
        reuseExistingServer: false,
        stdout: "pipe",
        env: { DPM_DATA_DIR: ".data/e2e", DPM_ATLAS: "fixture", DPM_CLOCK: "" },
      },
});
