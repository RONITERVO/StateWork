import { defineConfig, devices } from '@playwright/test';
const port = Number(process.env.STATEWORK_E2E_PORT ?? 4181);
export default defineConfig({
  testDir: 'tests/browser',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    timeout: 30000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
