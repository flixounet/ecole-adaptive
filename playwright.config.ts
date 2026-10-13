import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4180/';
const localPython = fileURLToPath(
  new URL(
    process.platform === 'win32' ? './.venv/Scripts/python.exe' : './.venv/bin/python',
    import.meta.url,
  ),
);
const python = existsSync(localPython) ? localPython : 'python';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: process.env.CI ? 2 : 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'allow',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit-ipad', use: { ...devices['iPad (gen 7)'], browserName: 'webkit' } },
  ],
  webServer: [
    {
      command: `"${process.execPath}" e2e/server.mjs --port 4180`,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `"${python}" tests/teacher_e2e_server.py --port 8137`,
      url: 'http://127.0.0.1:8137/api/config',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
