import { defineConfig, devices } from '@playwright/test';

// e2e drives the real stack (MySQL + Redis in Docker, API :4000, web :5173). `npm run demo` is started if nothing is listening.
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173/DataSim/',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: 'npm run demo',
    url: 'http://127.0.0.1:5173/DataSim/',
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
