import { defineConfig, devices } from '@playwright/test';

const PORT = 4317;
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: 'e2e',
  testIgnore: /screenshot\.spec\.ts/,
  // One worker on an empty server, so the results page counts exactly what the journey did.
  workers: 1,
  fullyParallel: false,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `npm run build && SEED_VISITORS=0 PORT=${String(PORT)} PAYMENT_LATENCY_MS=100 LOG_LEVEL=warn npm start`,
    url: `http://localhost:${String(PORT)}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
