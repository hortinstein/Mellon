import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 3999;
const dataFile = join(mkdtempSync(join(tmpdir(), 'mellon-e2e-')), 'locks.json');

export default defineConfig({
  testDir: 'e2e',
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
    env: { PORT: String(PORT), MELLON_DATA: dataFile, TYPESAFE_API_KEY: '', MELLON_SECRET_KEY: 'e2e-key' },
  },
});
