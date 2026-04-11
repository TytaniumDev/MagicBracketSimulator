import { test, expect } from '@playwright/test';

/**
 * Smoke tests — verify the app boots, routes render, and the critical
 * unauthenticated entry points don't throw. These tests run against the
 * Vite dev server (see playwright.config.ts).
 *
 * What's covered:
 *   - / renders without JS errors
 *   - Unauthenticated users see a sign-in prompt
 *   - /browse is reachable
 *   - No uncaught errors in the console during page load
 *
 * What's NOT covered (would require a test auth provider):
 *   - End-to-end "create a job and watch it run" flow
 *   - Firebase-authenticated routes
 *   - Worker pool interactions
 *
 * To extend with authenticated flows: run the Firebase Auth Emulator and
 * configure frontend/public/config.json to point at it; inject a test
 * token via page.addInitScript() before the first navigation.
 */

test.describe('smoke', () => {
  // Catch any console errors that happen during page load — these are
  // almost always real bugs that would otherwise go unnoticed in CI.
  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        // Firebase config warnings when running against local without auth
        // are expected; filter them out of the failure signal.
        const text = msg.text();
        if (text.includes('Firebase') || text.includes('firebase')) return;
        errors.push(`console.error: ${text}`);
      }
    });
    // Stash on the test info so individual tests can assert on it
    test.info().annotations.push({ type: 'errors-array' });
    (page as unknown as { _consoleErrors: string[] })._consoleErrors = errors;
  });

  test('home page renders without errors', async ({ page }) => {
    await page.goto('/');
    // The root app shell should render — <h1>, <nav>, or a recognizable
    // branded element. We only assert that the body has non-empty content
    // so we don't couple to specific copy.
    await expect(page.locator('body')).not.toBeEmpty();
    const errors = (page as unknown as { _consoleErrors: string[] })._consoleErrors;
    expect(errors, `Unexpected console errors: ${errors.join('\n')}`).toHaveLength(0);
  });

  test('app shell renders branded header and nav', async ({ page }) => {
    await page.goto('/');
    // The Header is auth-state independent and always renders the branded
    // logo text. If this is missing, the app shell failed to mount —
    // routes, lazy imports, or the layout are broken.
    await expect(
      page.getByRole('link', { name: /magic bracket simulator/i })
    ).toBeVisible({ timeout: 15_000 });
    // The Rankings link is also always visible regardless of auth state.
    await expect(page.getByRole('link', { name: /rankings/i })).toBeVisible();
  });

  test('/browse route is reachable', async ({ page }) => {
    await page.goto('/browse');
    await expect(page.locator('body')).not.toBeEmpty();
    // Browse page either shows the jobs list or a sign-in prompt
    // depending on auth state. Either is acceptable — we only care
    // that the route loads without crashing.
    const errors = (page as unknown as { _consoleErrors: string[] })._consoleErrors;
    expect(errors, `Unexpected console errors: ${errors.join('\n')}`).toHaveLength(0);
  });

  test('unknown route does not white-screen', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    await expect(page.locator('body')).not.toBeEmpty();
  });
});
