import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../src',
  testMatch: '**/*.e2e.playwright.ts',
  timeout: 30_000,
  use: {
    trace: 'retain-on-failure',
  },
  workers: 1,
});
