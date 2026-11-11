import { defineConfig, devices } from '@playwright/test';

const PORT = 4318;

/** Refreshes docs/screenshot.png against a simulated database: `npm run screenshot`. */
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
    command: `npm run build && npm run simulate -- --db data/screenshot.db && DB_PATH=data/screenshot.db PORT=${String(PORT)} LOG_LEVEL=warn npm start`,
    url: `http://localhost:${String(PORT)}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
