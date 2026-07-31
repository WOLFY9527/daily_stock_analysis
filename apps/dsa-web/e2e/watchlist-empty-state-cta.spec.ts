import { expect, test, type Page, type Route } from '@playwright/test';

const mockCurrentUser = {
  id: 7,
  username: 'watchlist-user',
  email: 'watchlist@example.com',
  isAdmin: false,
};

const filteredWatchlistItem = {
  id: 1,
  symbol: 'NVDA',
  market: 'us',
  name: 'NVIDIA',
  source: 'scanner',
  scannerRunId: 11,
  scannerRank: 1,
  scannerScore: 96,
  scoreStatus: 'fresh',
  lastScoredAt: '2026-05-02T09:00:00Z',
  intelligence: {
    scanner: {
      lastScore: 96,
      lastRank: 1,
      status: 'selected',
      themeLabel: 'AI Semiconductors',
      profile: 'us_preopen_v1',
      lastScannedAt: '2026-05-02T09:00:00Z',
    },
    strategySimulation: {
      status: 'ready',
      avgForwardReturnPct: 2.1,
      hitRate: 0.58,
    },
    backtest: {
      lastResultId: 34,
      totalReturnPct: 12.4,
      maxDrawdownPct: -4.2,
      sharpe: 1.2,
      tradeCount: 4,
      testedAt: '2026-05-02T09:10:00Z',
    },
  },
  themeId: 'ai_semis',
  universeType: 'theme',
  createdAt: '2026-05-02T08:50:00Z',
  updatedAt: '2026-05-02T09:10:00Z',
};

async function fulfillJson(route: Route, payload: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });
}

async function installWatchlistEmptyHarness(page: Page) {
  await page.route('**/api/v1/auth/status**', async (route) => {
    await fulfillJson(route, {
      authEnabled: true,
      loggedIn: true,
      passwordSet: true,
      passwordChangeable: true,
      setupState: 'enabled',
      currentUser: mockCurrentUser,
    });
  });
  await page.route('**/api/v1/auth/me**', async (route) => {
    await fulfillJson(route, mockCurrentUser);
  });
  await page.route('**/api/v1/watchlist/items', async (route) => {
    await fulfillJson(route, { items: [] });
  });
  await page.route('**/api/v1/watchlist/refresh-status', async (route) => {
    await fulfillJson(route, {
      enabled: true,
      usTime: '08:45',
      cnTime: '09:00',
      hkTime: '09:00',
      status: 'idle',
      lastRunAt: null,
      nextRunAt: null,
    });
  });
  await page.route('**/api/v1/watchlist/research-overlay', async (route) => {
    await fulfillJson(route, {
      schema_version: 'watchlist_research_overlay_v1',
      overlay_state: 'empty',
      research_summary: 'No saved watchlist rows yet.',
      research_priority_queue: [],
      observation_only: true,
      decision_grade: false,
    });
  });
  await page.route('**/api/v1/user-alerts/rules', async (route) => {
    await fulfillJson(route, {
      contract_version: 'user_alert_contract_v1',
      delivery_mode: 'in_app',
      in_app_only: true,
      owner_scoped: true,
      items: [],
    });
  });
  await page.route('**/api/v1/user-alerts/events**', async (route) => {
    await fulfillJson(route, {
      contract_version: 'user_alert_contract_v1',
      delivery_mode: 'in_app',
      in_app_only: true,
      owner_scoped: true,
      total: 0,
      limit: 20,
      offset: 0,
      items: [],
    });
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

async function openWatchlistEmptyState(page: Page) {
  await installWatchlistEmptyHarness(page);
  await page.goto('/zh/watchlist');
  await page.waitForLoadState('domcontentloaded');
  await expect(page).not.toHaveURL(/\/guest(?:$|[/?#])/);
  await expect(page.getByTestId('watchlist-page')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('watchlist-compact-empty-state')).toBeVisible();
}

test('keeps a single primary scanner CTA in the empty state on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openWatchlistEmptyState(page);

  const headerStrip = page.getByTestId('watchlist-header-strip');
  const emptyState = page.getByTestId('watchlist-compact-empty-state');
  const boardShell = page.getByTestId('watchlist-board-shell');
  const scannerButton = page.getByRole('button', { name: '打开扫描器' });

  await expect(scannerButton).toHaveCount(1);
  await expect(headerStrip.getByRole('button', { name: '打开扫描器' })).toHaveCount(0);
  await expect(emptyState).toContainText('从一个明确的研究动作开始');
  await expect(emptyState).toContainText('它不会自动保存任何标的。');
  await expect(emptyState).toContainText('添加后可在这里查看已保存的候选证据与状态。');
  const alternatives = page.getByTestId('watchlist-empty-alternatives');
  const manualResearch = page.getByTestId('watchlist-empty-manual-research');
  const alternativesToggle = alternatives.getByRole('button', { name: '其他研究路径' });
  const manualResearchToggle = manualResearch.getByRole('button', { name: '改为研究单个代码' });
  await expect(alternativesToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(manualResearchToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: '市场概览' })).toHaveCount(0);
  await expect(page.getByLabel('手动研究代码')).toHaveCount(0);
  await alternativesToggle.focus();
  await expect(alternativesToggle).toBeFocused();
  await alternativesToggle.click();
  await expect(alternativesToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: '市场概览' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '选择观察标的' })).toHaveCount(0);
  await manualResearchToggle.click();
  await expect(manualResearchToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('手动研究代码')).toBeVisible();
  await expect(page.getByTestId('watchlist-compact-filter-bar')).toHaveCount(0);
  await expect(page.getByTestId('watchlist-advanced-filters')).toHaveCount(0);
  await expect(page.getByTestId('watchlist-list-header')).toHaveCount(0);
  await expect(page.getByTestId('watchlist-command-bar')).toHaveCount(0);
  await expect(boardShell).not.toHaveClass(/lg:grid-cols-\[minmax\(0,1fr\)_340px\]/);
  await expectNoHorizontalOverflow(page);
});

test('stacks the empty-state CTA cleanly at 390px without overlap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWatchlistEmptyState(page);

  const headerStrip = page.getByTestId('watchlist-header-strip');
  const emptyState = page.getByTestId('watchlist-compact-empty-state');
  const scannerButton = page.getByRole('button', { name: '打开扫描器' });

  await expect(scannerButton).toHaveCount(1);
  await expect(headerStrip.getByRole('button', { name: '打开扫描器' })).toHaveCount(0);
  await expect(emptyState).toContainText('从一个明确的研究动作开始');
  await expect(page.getByTestId('watchlist-compact-filter-bar')).toHaveCount(0);
  await expect(page.getByTestId('watchlist-command-bar')).toHaveCount(0);
  const alternatives = page.getByTestId('watchlist-empty-alternatives');
  const manualResearch = page.getByTestId('watchlist-empty-manual-research');
  await alternatives.getByRole('button', { name: '其他研究路径' }).click();
  await manualResearch.getByRole('button', { name: '改为研究单个代码' }).click();
  await expect(page.getByLabel('手动研究代码')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const layout = await emptyState.evaluate((node) => {
    const element = node as HTMLElement;
    const [content, onboarding, manual] = Array.from(element.children) as HTMLElement[];
    const contentRect = content.getBoundingClientRect();
    const onboardingRect = onboarding.getBoundingClientRect();
    const manualRect = manual.getBoundingClientRect();
    return {
      onboardingTop: onboardingRect.top,
      manualTop: manualRect.top,
      contentBottom: contentRect.bottom,
      onboardingLeft: onboardingRect.left,
      contentLeft: contentRect.left,
    };
  });

  expect(layout.onboardingTop).toBeGreaterThanOrEqual(layout.contentBottom - 1);
  expect(layout.manualTop).toBeGreaterThanOrEqual(layout.onboardingTop - 1);
  expect(layout.onboardingLeft).toBeGreaterThanOrEqual(layout.contentLeft - 1);
});

test('keeps a list failure unavailable until the user explicitly retries on desktop', async ({ page }) => {
  let listRequests = 0;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await installWatchlistEmptyHarness(page);
  await page.route('**/api/v1/watchlist/items', async (route) => {
    listRequests += 1;
    if (listRequests === 1) {
      await fulfillJson(route, { detail: 'Watchlist temporarily unavailable.' }, 503);
      return;
    }
    await fulfillJson(route, { items: [] });
  });

  await page.goto('/zh/watchlist');
  await page.waitForLoadState('domcontentloaded');

  const retry = page.getByTestId('watchlist-unavailable-retry');
  await expect(retry).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('watchlist-compact-empty-state')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await retry.focus();
  await expect(retry).toBeFocused();
  await retry.click();
  await expect(page.getByTestId('watchlist-compact-empty-state')).toBeVisible();
  expect(listRequests).toBe(2);
  await expectNoHorizontalOverflow(page);
});

test('keeps filtered-empty distinct from first use and clears filters on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installWatchlistEmptyHarness(page);
  await page.route('**/api/v1/watchlist/items', async (route) => {
    await fulfillJson(route, { items: [filteredWatchlistItem] });
  });

  await page.goto('/zh/watchlist');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('watchlist-row-NVDA')).toBeVisible({ timeout: 15_000 });

  await page.getByLabel('搜索').fill('no-match');
  const filteredEmpty = page.getByTestId('watchlist-compact-empty-state');
  const resetFilters = page.getByTestId('watchlist-reset-filters');
  await expect(filteredEmpty).toContainText('没有已保存标的符合当前筛选');
  await expect(page.getByTestId('watchlist-empty-onboarding-cta')).toHaveCount(0);
  await expect(resetFilters).toBeVisible();
  await resetFilters.focus();
  await expect(resetFilters).toBeFocused();
  await resetFilters.click();
  await expect(page.getByTestId('watchlist-row-NVDA')).toBeVisible();
  await expect(resetFilters).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
