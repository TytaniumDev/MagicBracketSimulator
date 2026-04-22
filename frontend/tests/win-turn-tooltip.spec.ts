import { test, expect, type Page } from '@playwright/test';

/**
 * Regression guard for the Power Rankings "Avg Win Turn" tooltip.
 *
 * Covers the three bugs that were visible at PR #175:
 *   1. Tooltip rendered too narrow (16 bars in w-64).
 *   2. Tooltip was clipped by the table's overflow-x-auto container.
 *   3. Histogram bars had 0 computed height (percentage heights didn't
 *      resolve against the flex ancestor), so no data was visible.
 */

const HISTOGRAM = [0, 0, 0, 0, 2, 5, 10, 15, 8, 4, 3, 2, 1, 0, 0, 0];
const MAX_BIN_INDEX = 7;

const mockLeaderboard = {
  decks: [
    {
      deckId: 'test-deck',
      name: 'Test Deck',
      setName: 'Test Set',
      isPrecon: true,
      primaryCommander: null,
      rating: 50.0,
      gamesPlayed: 100,
      wins: 50,
      winRate: 0.5,
      avgWinTurn: 7.8,
      winTurnHistogram: HISTOGRAM,
    },
  ],
};

async function stubLeaderboardApis(page: Page) {
  await page.route('**/api/leaderboard*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockLeaderboard),
    }),
  );
  await page.route('**/api/coverage/config', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ enabled: false, targetGamesPerPair: 100 }),
    }),
  );
  await page.route('**/api/coverage/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ coveredPairs: 0, totalPairs: 0, percentComplete: 0 }),
    }),
  );
  // Any other API calls from the page shell — keep them from 404-ing into
  // visible error states that could block the leaderboard from rendering.
  await page.route('**/api/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ isAdmin: false }),
    }),
  );
}

test.describe('WinTurnTooltip', () => {
  test.beforeEach(async ({ page }) => {
    await stubLeaderboardApis(page);
  });

  test('renders with visible bars, readable width, inside the viewport', async ({ page }) => {
    await page.goto('/leaderboard');

    const icon = page.getByRole('button', { name: /show win turn distribution/i }).first();
    await expect(icon).toBeVisible();
    await icon.hover();

    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toBeVisible();

    // --- Size (regression guard for "too small") ---
    const box = await tooltip.boundingBox();
    expect(box, 'tooltip should have a measurable bounding box').not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(300);
    expect(box!.height).toBeGreaterThanOrEqual(80);

    // --- Viewport containment (regression guard for "cut off by outer container") ---
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);

    // --- Bar data (regression guard for "no actual data") ---
    const bars = tooltip.locator('[data-testid="win-turn-bar"]');
    await expect(bars).toHaveCount(16);

    const heights = await bars.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().height),
    );
    // Bins with zero count should measure ~0; non-zero bins should render
    // a visible bar. The max-count bin must be the tallest.
    for (let i = 0; i < HISTOGRAM.length; i++) {
      if (HISTOGRAM[i] === 0) {
        expect(heights[i], `bin ${i} should be empty`).toBeLessThanOrEqual(1);
      } else {
        expect(heights[i], `bin ${i} (count ${HISTOGRAM[i]}) should be visible`)
          .toBeGreaterThan(1);
      }
    }
    const tallestIndex = heights.indexOf(Math.max(...heights));
    expect(tallestIndex).toBe(MAX_BIN_INDEX);
  });

  test('tooltip is not clipped at a narrow viewport', async ({ page }) => {
    // Narrow viewport forces the table's overflow-x-auto to engage — if the
    // tooltip were still a child of the table, it would be clipped here.
    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto('/leaderboard');

    const icon = page.getByRole('button', { name: /show win turn distribution/i }).first();
    await icon.scrollIntoViewIfNeeded();
    await icon.hover();

    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toBeVisible();

    const box = await tooltip.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(300);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(600);
  });

  test('tooltip portals to document.body, outside the table', async ({ page }) => {
    await page.goto('/leaderboard');
    const icon = page.getByRole('button', { name: /show win turn distribution/i }).first();
    await icon.hover();

    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toBeVisible();

    // If the tooltip is rendered via createPortal to document.body, it will
    // not be a descendant of the <table>. This is the structural guarantee
    // that keeps the overflow-x-auto container from clipping it.
    const isInsideTable = await tooltip.evaluate(
      (el) => el.closest('table') !== null,
    );
    expect(isInsideTable).toBe(false);
  });
});
