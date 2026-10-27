import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'e2e-results',
  use: {
    baseURL: 'http://localhost:5174',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: false,
    timeout: 90_000,
    env: { FWALLSIM_E2E: '1' },
  },
});
