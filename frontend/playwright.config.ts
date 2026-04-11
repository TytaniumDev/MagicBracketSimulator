import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Magic Bracket Simulator smoke tests.
 *
 * Runs against the Vite dev server. Auth-backed flows require a test user
 * via Firebase Emulator or a stubbed auth provider (not yet configured) —
 * see tests/smoke.spec.ts for what's currently covered.
 *
 * Run locally:
 *   npm run test:e2e         # headless
 *   npm run test:e2e:ui      # with Playwright UI
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  // Start the Vite dev server automatically unless PLAYWRIGHT_BASE_URL is set
  // (in which case we assume the user is running against a deployed instance).
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        // Vite's first-run is slow (esbuild prebundle on cold cache can take
        // 90+ seconds on a fresh clone). Give it plenty of headroom; on
        // subsequent runs this is essentially instant.
        timeout: 180_000,
      },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
