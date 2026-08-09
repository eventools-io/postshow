import { defineConfig, devices } from '@playwright/test';

const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  // Vitest owns *.test.ts(x); the browser suite keeps its own suffix so the two
  // runners never pick up each other's files.
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 1 : undefined,
  reporter: CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5176',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://127.0.0.1:5176',
    reuseExistingServer: !CI,
    timeout: 120_000,
    // The Supabase client throws at import time without these, so the browser
    // suite used to depend on a committed .env file being present. Pinning the
    // local values here matches vitest.config.ts and keeps the run independent
    // of a developer's environment. Nothing here contacts a real project: the
    // journey stubs its network calls.
    env: {
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
    },
  },
});
