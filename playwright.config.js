import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 3999;
// A fixed path so tests can run scripts/admin.js against the server's data;
// e2e/global-setup.js clears it before each run.
export const E2E_DATA = process.env.MELLON_E2E_DATA || join(tmpdir(), 'mellon-e2e', 'data.json');

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.js',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    // Allows using a preinstalled Chromium (e.g. PW_CHROMIUM=/opt/pw-browsers/chromium).
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node server.js',
    url: `http://127.0.0.1:${PORT}/api/status`,
    reuseExistingServer: false,
    env: { PORT: String(PORT), MELLON_DATA: E2E_DATA, TYPESAFE_API_KEY: '', MELLON_SECRET_KEY: 'e2e-key' },
  },
});
