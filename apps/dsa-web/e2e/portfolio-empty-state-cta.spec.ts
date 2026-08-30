import { expect, test, type Page, type Route } from '@playwright/test';
import { installPortfolioSmokeHarness } from './fixtures/portfolioSmoke';

async function fulfillJson(route: Route, payload: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });
}

type PortfolioTruthFixtureState = 'no_account' | 'account_no_holdings' | 'valuation_unavailable';

async function installPortfolioEmptyHarness(page: Page, truthState: PortfolioTruthFixtureState = 'account_no_holdings') {
  const noAccount = truthState === 'no_account';
  const valuationUnavailable = truthState === 'valuation_unavailable';
  const accountCount = noAccount ? 0 : 1;
  const totalCash = valuationUnavailable ? '0' : '5000';
  const portfolioTruth = noAccount
    ? {
      state: 'no_account',
      account_state: 'no_account',
      valuation_state: 'not_applicable',
      value_semantics: 'not_applicable',
      authoritative_total: null,
      covered_subtotal: null,
      account_count: 0,
      position_count: 0,
    }
    : valuationUnavailable
      ? {
        state: 'valuation_unavailable',
        account_state: 'no_holdings',
        valuation_state: 'unavailable',
        value_semantics: 'unavailable',
        authoritative_total: null,
        covered_subtotal: null,
        account_count: 1,
        position_count: 0,
      }
      : {
        state: 'account_no_holdings',
        account_state: 'no_holdings',
        valuation_state: 'fully_valued',
        value_semantics: 'authoritative_total',
        authoritative_total: '5000',
        covered_subtotal: null,
        account_count: 1,
        position_count: 0,
      };

  if (noAccount) {
    await page.route('**/api/v1/portfolio/accounts**', async (route) => {
      if (route.request().method() === 'GET') {
        await fulfillJson(route, { accounts: [] });
        return;
      }
      await route.fallback();
    });
  }
  await page.route('**/api/v1/portfolio/snapshot**', async (route) => {
    await fulfillJson(route, {
      as_of: '2026-04-15',
      cost_method: 'fifo',
      currency: 'USD',
      account_count: accountCount,
      realized_pnl: '0',
      unrealized_pnl: '0',
      fee_total: '0',
      tax_total: '0',
      fx_stale: false,
      portfolio_truth: portfolioTruth,
      total_cash: totalCash,
      total_market_value: '0',
      total_equity: totalCash,
      accounts: noAccount ? [] : [
        {
          account_id: 1,
          account_name: 'Launch Owner Main',
          owner_id: 'user-1',
          broker: 'IBKR',
          market: 'us',
          base_currency: 'USD',
          as_of: '2026-04-15',
          cost_method: 'fifo',
          total_cash: totalCash,
          total_market_value: '0',
          total_equity: totalCash,
          realized_pnl: '0',
          unrealized_pnl: '0',
          fee_total: '0',
          tax_total: '0',
          fx_stale: false,
          positions: [],
        },
      ],
    });
  });
  await page.route('**/api/v1/portfolio/risk**', async (route) => {
    await fulfillJson(route, {
      as_of: '2026-04-15',
      account_id: null,
      cost_method: 'fifo',
      currency: 'USD',
      thresholds: {},
      concentration: {
        total_market_value: '0',
        top_weight_pct: 0,
        alert: false,
        top_positions: [],
      },
      sector_concentration: {
        total_market_value: '0',
        top_weight_pct: 0,
        alert: false,
        top_sectors: [],
        coverage: {},
        errors: [],
      },
      drawdown: {
        series_points: 0,
        max_drawdown_pct: 0,
        current_drawdown_pct: 0,
        alert: false,
        fx_stale: false,
      },
      stop_loss: {
        near_alert: false,
        triggered_count: 0,
        near_count: 0,
        items: [],
      },
    });
  });
  await page.route('**/api/v1/portfolio/trades**', async (route) => {
    await fulfillJson(route, { items: [], total: 0, page: 1, page_size: 20 });
  });
  await page.route('**/api/v1/portfolio/cash-ledger**', async (route) => {
    await fulfillJson(route, { items: [], total: 0, page: 1, page_size: 20 });
  });
  await page.route('**/api/v1/portfolio/corporate-actions**', async (route) => {
    await fulfillJson(route, { items: [], total: 0, page: 1, page_size: 20 });
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    .toBe(true);
}

async function openPortfolioEmptyState(page: Page, truthState: PortfolioTruthFixtureState = 'account_no_holdings') {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('dsa-admin-surface-mode', 'admin');
  });
  await installPortfolioSmokeHarness(page, { operatorMode: true });
  await installPortfolioEmptyHarness(page, truthState);
  await page.goto('/zh/portfolio');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('portfolio-bento-page')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('portfolio-start-card')).toBeVisible();
}

async function openPortfolioUnavailableState(page: Page) {
  await installPortfolioSmokeHarness(page);
  await installPortfolioEmptyHarness(page);
  await page.route('**/api/v1/portfolio/snapshot**', async (route) => {
    await fulfillJson(route, { detail: 'Portfolio snapshot is temporarily unavailable.' }, 503);
  });
  await page.goto('/zh/portfolio');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('portfolio-unavailable-state')).toBeVisible({ timeout: 15_000 });
}

test.describe('portfolio empty-state CTA', () => {
  test('uses one executable first-use action on desktop and keeps later steps in a native disclosure', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.setViewportSize({ width: 1440, height: 1000 });
    await openPortfolioEmptyState(page, 'no_account');

    const commandStrip = page.getByTestId('portfolio-command-strip');
    const emptyWorkflowColumn = page.getByTestId('portfolio-empty-workflow-column');
    const primaryActions = page.getByTestId('portfolio-empty-actions');
    const disclosure = page.getByTestId('portfolio-empty-supporting-disclosure');

    await expect(commandStrip.getByRole('button', { name: '添加持仓' })).toHaveCount(0);
    await expect(commandStrip.getByRole('button', { name: '导入记录' })).toHaveCount(0);
    await expect(commandStrip.getByRole('button', { name: '同步数据' })).toHaveCount(0);
    await expect(emptyWorkflowColumn.getByRole('button', { name: '添加持仓' })).toHaveCount(0);
    await expect(emptyWorkflowColumn.getByRole('button', { name: '导入记录' })).toHaveCount(0);
    await expect(emptyWorkflowColumn.getByRole('button', { name: '同步数据' })).toHaveCount(0);
    await expect(primaryActions.getByRole('button')).toHaveCount(1);
    await expect(primaryActions.getByRole('button', { name: '新建账户' })).toBeEnabled();
    await expect(emptyWorkflowColumn.getByRole('link')).toHaveCount(0);
    await expect(emptyWorkflowColumn).toContainText('首次配置路径');
    await expect(emptyWorkflowColumn).toContainText('保存后会在下方自动展开真实持仓、风险摘要与近期活动。');
    await expect(page.getByTestId('portfolio-start-card')).toContainText('创建或导入首个组合');
    await expect(page.getByTestId('portfolio-total-assets-value')).toHaveText('尚未创建组合');
    await expect(page.getByTestId('portfolio-total-assets-value')).not.toContainText('USD 0.00');
    await expect(disclosure).not.toHaveAttribute('open');
    await disclosure.locator('summary').focus();
    await expect(disclosure.locator('summary')).toBeFocused();
    await disclosure.locator('summary').click();
    await expect(disclosure).toHaveAttribute('open', '');
    await expect(disclosure.getByRole('button', { name: '导入记录' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(consoleErrors.filter((entry) => !entry.includes('ERR_NETWORK_CHANGED'))).toEqual([]);
    expect(pageErrors).toEqual([]);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('keeps unavailable truth distinct from first use at 390px without horizontal overflow', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.setViewportSize({ width: 390, height: 844 });
    await installPortfolioSmokeHarness(page);
    await installPortfolioEmptyHarness(page, 'valuation_unavailable');
    await page.goto('/zh/portfolio');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('portfolio-truth-unavailable-state')).toBeVisible({ timeout: 15_000 });

    const commandStrip = page.getByTestId('portfolio-command-strip');
    const truthUnavailable = page.getByTestId('portfolio-truth-unavailable-state');

    await expect(commandStrip.getByRole('button', { name: '添加持仓' })).toHaveCount(0);
    await expect(commandStrip.getByRole('button', { name: '导入记录' })).toHaveCount(0);
    await expect(commandStrip.getByRole('button', { name: '同步数据' })).toHaveCount(0);
    await expect(truthUnavailable).toContainText('估值暂不可用');
    await expect(truthUnavailable.getByRole('button')).toHaveCount(1);
    await expect(truthUnavailable.getByRole('button', { name: '刷新组合快照' })).toBeEnabled();
    await expect(page.getByTestId('portfolio-empty-onboarding-row')).toHaveCount(0);
    await expect(page.getByTestId('portfolio-total-assets-value')).toHaveText('估值暂不可用');
    await expect(page.getByTestId('portfolio-total-assets-value')).not.toContainText('USD 0.00');
    await expectNoHorizontalOverflow(page);

    const layout = await truthUnavailable.evaluate((node) => {
      const element = node as HTMLElement;
      const action = element.querySelector('button') as HTMLElement | null;
      if (!action) return null;

      const stateRect = element.getBoundingClientRect();
      const actionRect = action.getBoundingClientRect();

      return {
        stateLeft: stateRect.left,
        stateRight: stateRect.right,
        actionLeft: actionRect.left,
        actionRight: actionRect.right,
      };
    });

    expect(layout).not.toBeNull();
    expect(layout?.actionLeft ?? 0).toBeGreaterThanOrEqual(layout?.stateLeft ?? 0);
    expect(layout?.actionRight ?? 0).toBeLessThanOrEqual((layout?.stateRight ?? 0) + 1);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('shows a 503 as unavailable with only the retry action', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openPortfolioUnavailableState(page);

    const unavailableState = page.getByTestId('portfolio-unavailable-state');
    await expect(unavailableState).toContainText('组合快照暂时不可用');
    await expect(unavailableState.getByRole('button')).toHaveCount(1);
    await expect(unavailableState.getByRole('button', { name: '重试加载组合' })).toBeEnabled();
    await expect(page.getByTestId('portfolio-empty-onboarding-row')).toHaveCount(0);
    await expect(page.getByTestId('portfolio-row-alerts')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('keeps confirmed no-account first-use guidance truthful on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installPortfolioSmokeHarness(page);
    await installPortfolioEmptyHarness(page, 'no_account');
    await page.goto('/zh/portfolio');
    await page.waitForLoadState('domcontentloaded');

    const onboarding = page.getByTestId('portfolio-empty-onboarding-row');
    await expect(onboarding).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('portfolio-start-card')).toContainText('创建或导入首个组合');
    await expect(page.getByTestId('portfolio-total-assets-value')).toHaveText('尚未创建组合');
    await expect(page.getByTestId('portfolio-total-assets-value')).not.toContainText('USD 0.00');
    await expect(page.getByTestId('portfolio-permission-limited-state')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('keeps confirmed first use visible when a later history read fails on desktop', async ({ page }) => {
    let releaseTrades: (() => void) | undefined;
    const tradesReleased = new Promise<void>((resolve) => {
      releaseTrades = resolve;
    });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addInitScript(() => {
      window.sessionStorage.setItem('dsa-admin-surface-mode', 'admin');
    });
    await installPortfolioSmokeHarness(page, { operatorMode: true });
    await installPortfolioEmptyHarness(page, 'account_no_holdings');
    await page.route('**/api/v1/portfolio/trades**', async (route) => {
      await tradesReleased;
      await fulfillJson(route, { detail: 'Portfolio history is temporarily unavailable.' }, 503);
    });
    await page.goto('/zh/portfolio');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('portfolio-empty-onboarding-row')).toBeVisible({ timeout: 15_000 });
    releaseTrades?.();
    await expect(page.getByTestId('portfolio-row-alerts')).toBeVisible();
    await expect(page.getByTestId('portfolio-empty-onboarding-row')).toBeVisible();
    await expect(page.getByTestId('portfolio-unavailable-state')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
