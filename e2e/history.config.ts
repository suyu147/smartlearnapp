import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
export default defineConfig({
  expect: { timeout: 30_000 },
  outputDir: path.resolve(__dirname, '../node_modules/.cache/history-playwright'),
  testDir: '.', testMatch: 'history.spec.ts', workers: 1, reporter: 'list', timeout: 90_000,
  use: { baseURL: 'http://localhost:3107', ...devices['Desktop Chrome'], screenshot: 'only-on-failure' },
  webServer: { cwd: path.resolve(__dirname, '..'), command: process.env.HISTORY_E2E_PRODUCTION === '1' ? 'node node_modules/next/dist/bin/next start --port 3107' : 'node node_modules/next/dist/bin/next dev --port 3107', url: 'http://localhost:3107', reuseExistingServer: true, timeout: 120_000 },
});
