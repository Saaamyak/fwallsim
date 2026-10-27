import { defineConfig } from '@playwright/test';

// Builds the "FWallSim Class" PDF course: captures screenshots from the live app, then renders PDFs.
export default defineConfig({
  testDir: 'course',
  testMatch: /.*\.course\.ts/,
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
  outputDir: 'e2e-results/course',
  use: { baseURL: 'http://localhost:5174', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  webServer: { command: 'npx vite --port 5174 --strictPort', url: 'http://localhost:5174', reuseExistingServer: false, timeout: 90_000, env: { FWALLSIM_E2E: '1' } },
});
