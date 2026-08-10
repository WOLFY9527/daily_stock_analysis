import { test as appTest, expect as appExpect } from './fixtures/appSmoke';
import type { Locator, Page, Request } from '@playwright/test';
import {
  expectForbiddenTradingWordingAbsent,
  expectNoHorizontalOverflow,
  installProductAuthHarness,
  test as productTest,
  expect as productExpect,
} from './fixtures/productAuth';

const viewports = [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
];

async function expectBefore(
  first: Locator,
  second: Locator,
) {
  const firstBox = await first.boundingBox();
  const secondBox = await second.boundingBox();
  productExpect(firstBox).not.toBeNull();
  productExpect(secondBox).not.toBeNull();
  productExpect(firstBox?.y ?? 0).toBeLessThan(secondBox?.y ?? Number.POSITIVE_INFINITY);
}

async function expectCompleteInFlowBoundary(
  boundary: Locator,
  target: Locator,
) {
  await boundary.evaluate((element) => element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' }));
  await productExpect(boundary).toBeInViewport();

  const [boundaryBox, targetBox, style] = await Promise.all([
    boundary.boundingBox(),
    target.boundingBox(),
    boundary.evaluate((element) => {
      const computed = window.getComputedStyle(element);
      return { position: computed.position, zIndex: computed.zIndex };
    }),
  ]);
  productExpect(boundaryBox).not.toBeNull();
  productExpect(targetBox).not.toBeNull();
  productExpect(style.position).toBe('static');
  productExpect(style.zIndex).toBe('auto');
  productExpect(targetBox?.y ?? 0).toBeGreaterThanOrEqual(
    (boundaryBox?.y ?? 0) + (boundaryBox?.height ?? 0),
  );
}

async function expectFocusedControlUnobstructed(page: Page, control: Locator) {
  await control.evaluate((element) => element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' }));
  await productExpect.poll(async () => {
    const [controlBox, mastheadBox, topSurface, viewportHeight] = await Promise.all([
      control.boundingBox(),
      page.locator('header').first().boundingBox(),
      control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const surface = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return surface === element || element.contains(surface);
      }),
      page.evaluate(() => window.innerHeight),
    ]);
    return Boolean(
      controlBox
      && mastheadBox
      && topSurface
      && controlBox.y >= mastheadBox.y + mastheadBox.height
      && controlBox.y + controlBox.height <= viewportHeight,
    );
  }).toBe(true);
  await page.keyboard.press('Tab');
  await control.focus();
  await productExpect(control).toBeFocused();
  await control.evaluate((element) => element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' }));

  await productExpect.poll(async () => control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const surface = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return surface === element || element.contains(surface);
  })).toBe(true);
  await productExpect.poll(async () => control.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
}

async function expectChainScroll(content: Locator, axis: 'horizontal' | 'vertical') {
  const before = await content.evaluate((element, scrollAxis) => {
    const scroller = element.parentElement as HTMLElement | null;
    if (!scroller) return null;
    return scrollAxis === 'horizontal'
      ? { offset: scroller.scrollLeft, maximum: scroller.scrollWidth - scroller.clientWidth }
      : { offset: scroller.scrollTop, maximum: scroller.scrollHeight - scroller.clientHeight };
  }, axis);
  productExpect(before).not.toBeNull();
  productExpect(before?.maximum ?? 0).toBeGreaterThan(0);

  await content.evaluate((element, scrollAxis) => {
    const scroller = element.parentElement as HTMLElement | null;
    if (!scroller) return;
    if (scrollAxis === 'horizontal') scroller.scrollLeft = Math.min(100, scroller.scrollWidth - scroller.clientWidth);
    else scroller.scrollTop = Math.min(100, scroller.scrollHeight - scroller.clientHeight);
  }, axis);

  const after = await content.evaluate((element, scrollAxis) => {
    const scroller = element.parentElement as HTMLElement | null;
    if (!scroller) return null;
    return scrollAxis === 'horizontal'
      ? { offset: scroller.scrollLeft, maximum: scroller.scrollWidth - scroller.clientWidth }
      : { offset: scroller.scrollTop, maximum: scroller.scrollHeight - scroller.clientHeight };
  }, axis);
  productExpect(after).not.toBeNull();
  productExpect(after?.offset ?? 0).toBeGreaterThan(before?.offset ?? 0);
  productExpect(after?.offset ?? 0).toBeLessThanOrEqual(after?.maximum ?? 0);
}

async function expectDemoBoundaryCopy(boundary: Locator) {
  await productExpect(boundary).toContainText('演示 / 合成数据');
  await productExpect(boundary).toContainText('来源：synthetic_options_lab_fixture');
  await productExpect(boundary).toContainText('样本版本：options_lab_synthetic_v1');
  await productExpect(boundary).toContainText('快照时间：2026-05-06T13:45:00Z');
  await productExpect(boundary).toContainText('非实时 · 仅观察');
  await productExpect(boundary).toContainText('不作为官方实时权威或可执行判断依据，也不作为交易信号或执行依据');
}

async function installAuthenticatedAppSmokeSession(page: Page) {
  await page.route('**/api/v1/auth/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        authEnabled: true,
        loggedIn: true,
        passwordSet: true,
        passwordChangeable: true,
        setupState: 'enabled',
        currentUser: {
          id: 'user-1',
          username: 'wolfy-user',
          displayName: 'Wolfy User',
          role: 'user',
          isAdmin: false,
          isAuthenticated: true,
          transitional: false,
          authEnabled: true,
        },
      }),
    });
  });
}

productTest.describe('Options Lab launch research surface', () => {
  productTest('keeps conclusion and assumptions ahead of option-chain detail', async ({ page }) => {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      const requestCalls: string[] = [];
      const recordRequest = (request: Request) => {
        const url = new URL(request.url());
        requestCalls.push(`${request.method()} ${url.pathname}`);
      };
      page.on('request', recordRequest);
      await installProductAuthHarness(page);
      await installAuthenticatedAppSmokeSession(page);
      await page.goto('/options-lab');
      await page.waitForLoadState('domcontentloaded');

      const decision = page.getByTestId('options-lab-decision-engine');
      const assumptions = page.getByTestId('options-lab-assumptions-panel');
      const chainPanel = page.getByTestId('options-lab-chain-panel').first();
      const strategyDetails = page.getByTestId('options-lab-analysis-details');
      const inputBoundary = page.getByTestId('options-lab-input-demo-boundary');
      const strategyBoundary = page.getByTestId('options-lab-strategy-demo-boundary');
      const decisionBoundary = page.getByTestId('options-lab-decision-demo-boundary');
      const analyzerBoundary = page.getByTestId('options-lab-analysis-demo-boundary');
      const chainBoundary = page.getByTestId('options-lab-chain-demo-boundary');
      const compare = page.getByRole('button', { name: '运行结构比较' });
      const evaluate = page.getByRole('button', { name: '评估情景准备度' });
      const analyze = page.getByRole('button', { name: '运行策略分析' });
      const refreshScenario = assumptions.getByRole('button', { name: '刷新情景' });
      const callsTable = page.getByTestId('options-lab-calls-table');

      await productExpect(page.getByRole('heading', { name: '期权实验室' })).toBeVisible();
      await productExpect(page).toHaveURL(/\/options-lab$/);
      await productExpect(
        viewport.width >= 768
          ? page.getByTestId('options-lab-calls-table-desktop-table')
          : page.getByTestId('options-lab-calls-table-mobile-list'),
      ).toContainText('TEM260619C00055000');
      await productExpect(decision).toBeVisible();
      await productExpect(decision).toContainText('情景判断');
      await productExpect(decision).toContainText('判断内容');
      await productExpect(page.getByTestId('options-lab-risk-boundary-panel')).toContainText('风险边界');
      await productExpect(assumptions).toBeVisible();
      await productExpect(chainPanel).toBeVisible();
      await productExpect(strategyDetails.getByRole('button', { name: /展开/ })).toHaveAttribute('aria-expanded', 'false');
      await expectBefore(assumptions, decision);
      await expectBefore(decision, chainPanel);

      const heroBox = await page.getByTestId('options-lab-product-hero').boundingBox();
      productExpect(heroBox?.y ?? viewport.height).toBeLessThan(viewport.height);
      for (const boundary of [inputBoundary, strategyBoundary, decisionBoundary, analyzerBoundary, chainBoundary]) {
        await expectDemoBoundaryCopy(boundary);
      }
      const passiveOptionsCalls = requestCalls.filter((call) => call.includes('/api/v1/options/'));
      productExpect(passiveOptionsCalls.length).toBeGreaterThanOrEqual(3);
      productExpect(passiveOptionsCalls.every((call) => call.startsWith('GET '))).toBe(true);
      productExpect(passiveOptionsCalls).toContain('GET /api/v1/options/underlyings/TEM/summary');
      productExpect(passiveOptionsCalls).toContain('GET /api/v1/options/underlyings/TEM/expirations');
      productExpect(passiveOptionsCalls).toContain('GET /api/v1/options/underlyings/TEM/chain');
      await expectNoHorizontalOverflow(page);

      for (const [boundary, target] of [
        [inputBoundary, assumptions],
        [strategyBoundary, compare],
        [decisionBoundary, evaluate],
        [analyzerBoundary, analyze],
        [chainBoundary, chainPanel],
      ] as const) {
        await expectCompleteInFlowBoundary(boundary, target);
      }
      for (const action of [refreshScenario, compare, evaluate, analyze]) {
        await expectFocusedControlUnobstructed(page, action);
      }
      await expectChainScroll(
        viewport.width >= 768
          ? callsTable.getByTestId('options-lab-calls-table-desktop-table')
          : callsTable.getByTestId('options-lab-calls-table-mobile-list'),
        viewport.width >= 768 ? 'horizontal' : 'vertical',
      );
      await expectNoHorizontalOverflow(page);

      await compare.click();
      await productExpect.poll(() => requestCalls.filter((call) => call === 'POST /api/v1/options/strategies/compare').length).toBe(1);
      await evaluate.click();
      await productExpect.poll(() => requestCalls.filter((call) => call === 'POST /api/v1/options/decision/evaluate').length).toBe(1);
      await analyze.click();
      await productExpect.poll(() => requestCalls.filter((call) => call === 'POST /api/v1/options/strategies/analyze').length).toBe(1);
      await productExpect(page.getByTestId('options-lab-strategy-analyzer')).toContainText('分析 #1');
      productExpect(requestCalls.some((call) => /\/(orders|broker|portfolio)(?:\/|$)/.test(call))).toBe(false);

      const collapsedDisclosure = strategyDetails.getByRole('button', { name: /展开/ });
      await expectFocusedControlUnobstructed(page, collapsedDisclosure);
      await collapsedDisclosure.click();
      await productExpect(strategyDetails.getByRole('button', { name: /收起/ })).toHaveAttribute('aria-expanded', 'true');
      await strategyDetails.getByRole('button', { name: /收起/ }).click();
      await productExpect(strategyDetails.getByRole('button', { name: /展开/ })).toHaveAttribute('aria-expanded', 'false');
      await productExpect(strategyDetails.getByRole('button', { name: /展开/ })).toBeFocused();
      await expectForbiddenTradingWordingAbsent(page);
      await expectNoHorizontalOverflow(page);
      page.off('request', recordRequest);
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });
});

appTest.describe('Backtest result launch research surface', () => {
  appTest('keeps KPI conclusion ahead of evidence, exports, trace, and ledger detail', async ({ page }) => {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await installAuthenticatedAppSmokeSession(page);
      await page.goto('/zh/backtest/results/34');
      await page.waitForLoadState('domcontentloaded');

      const hero = page.getByTestId('deterministic-result-page-hero');
      const kpis = page.getByTestId('deterministic-result-kpi-strip');
      const summary = page.getByTestId('backtest-report-summary');
      const resultSummary = page.getByTestId('backtest-report-result-summary');
      const chart = page.getByTestId('backtest-report-chart');
      const tradeTable = page.getByTestId('backtest-report-trade-table');
      const evidence = page.getByTestId('backtest-report-evidence-details');
      const dataQuality = page.getByTestId('backtest-report-data-quality');
      const advancedDetails = page.getByTestId('backtest-report-advanced-details');
      const secondaryActions = page.getByTestId('deterministic-result-secondary-actions');

      await appExpect(hero).toBeVisible({ timeout: 15_000 });
      await appExpect(kpis).toBeVisible();
      await appExpect(summary).toBeVisible();
      await appExpect(resultSummary).toContainText('研究结论');
      await appExpect(resultSummary).toContainText('总收益');
      await appExpect(resultSummary).toContainText('最大回撤');
      await appExpect(resultSummary).toContainText('交易次数');
      await appExpect(resultSummary).toContainText('诊断材料');
      await appExpect(secondaryActions).toBeVisible();
      await appExpect(evidence).not.toHaveJSProperty('open', true);
      await expectNoHorizontalOverflow(page);

      const kpiBox = await kpis.boundingBox();
      appExpect(kpiBox?.y ?? viewport.height).toBeLessThan(viewport.height);
      await expectBefore(summary, chart);
      await expectBefore(chart, tradeTable);
      await expectBefore(tradeTable, evidence);
      await appExpect(page.getByTestId('backtest-report-ledger-table')).toHaveCount(0);

      await evidence.locator('summary').click();
      await appExpect(evidence).toHaveJSProperty('open', true);
      await appExpect(dataQuality).toBeVisible();
      await appExpect(advancedDetails).toBeVisible();
      await advancedDetails.getByRole('button').first().click();
      await appExpect(page.getByText(/执行明细仅提供导出/)).toBeVisible();
      await advancedDetails.getByRole('button', { name: /展开每日账本/ }).click();
      await appExpect(page.getByTestId('backtest-report-ledger-table')).toBeVisible();
    }
  });
});
