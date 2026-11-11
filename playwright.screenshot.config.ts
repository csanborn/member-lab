import { defineConfig, devices } from '@playwright/test';

const PORT = 4318;

/** Refreshes docs/screenshot.png against the seeded demo data: `npm run screenshot`. */
export default defineConfig({
  testDir: 'e2e',
  testMatch: /screenshot\.spec\.ts/,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  },
  webServer: {
    command: `npm run build && PORT=${String(PORT)} LOG_LEVEL=warn npm start`,
    url: `http://localhost:${String(PORT)}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
