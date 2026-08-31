import type { Page, Route } from '@playwright/test';
import { expect, test } from './fixtures/appSmoke';

type SearchNavigationWindow = Window & {
  __t665SearchMarker?: string;
  __t665RouteTransitions?: number;
};

async function stabilizeUnrelatedData(page: Page) {
  await page.route('**/api/v1/analysis/preview', async (route) => {
    const payload = route.request().postDataJSON() as { stock_code?: unknown } | null;
    const stockCode = typeof payload?.stock_code === 'string' ? payload.stock_code.trim() : '';
    if (!stockCode) {
      throw new Error('Preview fixture requires a request stock_code.');
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query_id: 't665-preview',
        stock_code: stockCode,
        stock_name: `${stockCode} preview`,
        preview_scope: 'guest',
        report: {
          meta: { query_id: 't665-preview', stock_code: stockCode, stock_name: `${stockCode} preview`, report_type: 'brief' },
          summary: { analysis_summary: 'Preview unavailable for route qualification.', sentiment_score: 50 },
        },
      }),
    });
  });
  await page.route('**/api/v1/stocks/AAPL/validate', async (route) => {
    if (route.request().method() !== 'GET') {
      throw new Error(`Stock validation fixture received unexpected ${route.request().method()} request.`);
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        stock_code: 'AAPL',
        normalized_symbol: 'AAPL',
        market: 'us',
        status: 'valid',
        valid: true,
        exists: true,
        stock_name: 'Apple Inc.',
      }),
    });
  });
  await page.route('**/api/v1/options/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

function stockSymbolFromDetailRead(route: Route): string {
  if (route.request().method() !== 'GET') {
    throw new Error(`Stock detail fixture received unexpected ${route.request().method()} request.`);
  }

  const [, encodedSymbol] = new URL(route.request().url()).pathname.match(/^\/api\/v1\/stocks\/([^/]+)\//) || [];
  const symbol = typeof encodedSymbol === 'string' ? decodeURIComponent(encodedSymbol).trim().toUpperCase() : '';
  if (!['AAPL', 'HK00700', 'ORCL'].includes(symbol)) {
    throw new Error(`Stock detail fixture received unexpected symbol ${symbol || '(empty)'}.`);
  }
  return symbol;
}

function stockFixtureMarket(symbol: string): 'us' | 'hk' {
  return symbol.startsWith('HK') ? 'hk' : 'us';
}

async function installStockDetailReadRoutes(page: Page) {
  const sourceConfidence = {
    source_label: 'Playwright fixture boundary',
    as_of: null,
    freshness: 'synthetic',
    is_stale: false,
    is_partial: true,
    is_synthetic: true,
    is_unavailable: true,
  };

  await page.route('**/api/v1/stocks/*/quote', async (route) => {
    const symbol = stockSymbolFromDetailRead(route);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        stock_code: symbol,
        stock_name: `${symbol} fixture identity`,
        current_price: null,
        change: null,
        change_percent: null,
        update_time: null,
        freshness: 'synthetic',
        is_stale: false,
        is_partial: true,
        is_synthetic: true,
        is_unavailable: true,
        source_confidence: sourceConfidence,
      }),
    });
  });

  await page.route('**/api/v1/stocks/*/research-packet', async (route) => {
    const symbol = stockSymbolFromDetailRead(route);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        symbol,
        market: stockFixtureMarket(symbol),
        identity: { name: `${symbol} fixture identity`, exchange: null, sector: null, industry: null },
        quote: { state: 'unknown', price: null, change_percent: null, as_of: null },
        history: { state: 'unknown', bars: null, period: 'daily', as_of: null },
        structure: { state: 'unknown', label: null, confidence: null, as_of: null },
        fundamentals: { state: 'not_integrated', fields_available: [] },
        events: { state: 'missing', latest: [] },
        peer: { state: 'insufficient', benchmark: null },
        missing_data: ['fundamentals', 'events', 'peer'],
        research_status: 'partial',
        next_data_action: 'Observed evidence is required before research is complete.',
        observation_only: true,
        decision_grade: false,
        no_advice_disclosure: 'Research observation only.',
      }),
    });
  });

  await page.route('**/api/v1/stocks/*/structure-decision', async (route) => {
    const symbol = stockSymbolFromDetailRead(route);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 't739_stock_detail_fixture_v1',
        ticker: symbol,
        structure_state: 'unknown',
        confidence: null,
        confidence_state: { status: 'partial', label: 'Fixture evidence limited', reasons: ['Fixture data is not live evidence.'] },
        explanation: {
          why_this_structure: null,
          what_confirms_it: [],
          what_invalidates_it: [],
          key_levels: [],
        },
        research_notes: { watch_next: [], needs_more_evidence: ['Observed evidence'], risk_flags: ['Fixture data is not decision-grade.'] },
        data_quality: { status: 'partial', period: 'daily', requested_days: 180, observed_bars: null, usable_bars: null, reason: 'Fixture supplies no observed history.' },
        missing_evidence: [{ kind: 'quote', message: 'Observed quote evidence is unavailable in this fixture.' }],
        observation_only: true,
        decision_grade: false,
        no_advice_disclosure: 'Research observation only.',
      }),
    });
  });

  await page.route(/\/api\/v1\/stocks\/[^/?]+\/history(?:\?.*)?$/, async (route) => {
    const symbol = stockSymbolFromDetailRead(route);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        stock_code: symbol,
        stock_name: `${symbol} fixture identity`,
        period: 'daily',
        source: 'playwright_fixture',
        source_confidence: sourceConfidence,
        data: [],
      }),
    });
  });

  await page.route('**/api/v1/stocks/*/technical-indicators', async (route) => {
    const symbol = stockSymbolFromDetailRead(route);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        contract_version: 'stock_technical_indicators_v1',
        symbol,
        status: 'insufficient_history',
        timeframe: 'daily',
        as_of: null,
        freshness: 'synthetic',
        source_label: 'Playwright fixture boundary',
        data_quality: { status: 'insufficient_history', required_bars: 200, observed_bars: null, usable_bars: null, missing_bars: null, freshness: 'synthetic' },
        indicators: {},
        no_advice_disclosure: 'Research observation only.',
      }),
    });
  });

  await page.route(/\/api\/v1\/stocks\/[^/?]+\/evidence(?:\?.*)?$/, async (route) => {
    const symbol = stockSymbolFromDetailRead(route);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        symbols: [symbol],
        items: [{
          symbol,
          market: stockFixtureMarket(symbol).toUpperCase(),
          quote: { state: 'unknown' },
          technical: { state: 'insufficient' },
          fundamental: null,
          news: null,
          symbol_evidence_readiness: {
            symbol_evidence_readiness: true,
            symbol,
            readiness_tier: 'insufficient',
            evidence_used: [],
            evidence_missing: ['quote', 'history', 'fundamentals', 'events', 'peer'],
            stale_inputs: [],
            data_quality_notes: ['Playwright fixture data is partial.'],
            observation_only: true,
            no_advice_disclosure: 'Research observation only.',
          },
        }],
        meta: { generated_at: null, source: 'playwright_fixture' },
      }),
    });
  });
}

async function markClientSession(page: Page) {
  await page.evaluate(() => {
    const trackedWindow = window as SearchNavigationWindow;
    trackedWindow.__t665SearchMarker = 'spa-search-session';
    trackedWindow.__t665RouteTransitions = 0;
    const originalPushState = window.history.pushState.bind(window.history);
    window.history.pushState = function pushState(...args) {
      trackedWindow.__t665RouteTransitions = (trackedWindow.__t665RouteTransitions || 0) + 1;
      return originalPushState(...args);
    };
  });
}

async function expectSpaMarker(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as SearchNavigationWindow).__t665SearchMarker)).toBe('spa-search-session');
}

async function installAuthenticatedHomeSession(page: Page) {
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
          id: 't739-member',
          username: 't739-member',
          displayName: 'T739 Member',
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

test('authenticated Home stock search reaches the canonical route through keyboard, button, and suggestions', async ({ page }) => {
  const failedRequests: string[] = [];
  const errorResponses: string[] = [];
  const previewStockCodes: string[] = [];
  const validatedSymbols: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    const validationMatch = /^\/api\/v1\/stocks\/([^/]+)\/validate$/.exec(url.pathname);
    if (request.method() === 'GET' && validationMatch) {
      validatedSymbols.push(decodeURIComponent(validationMatch[1]));
    }
    if (request.method() === 'POST' && url.pathname === '/api/v1/analysis/preview') {
      const payload = request.postDataJSON() as { stock_code?: unknown } | null;
      if (typeof payload?.stock_code === 'string') {
        previewStockCodes.push(payload.stock_code.trim());
      }
    }
  });
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}`));
  page.on('response', (response) => {
    if (response.status() < 400) {
      return;
    }
    errorResponses.push(`${response.status()} ${response.url()}`);
  });

  await stabilizeUnrelatedData(page);
  await installStockDetailReadRoutes(page);
  await installAuthenticatedHomeSession(page);
  await page.goto('/');
  await expect(page.getByTestId('home-bento-omnibar-input')).toBeVisible();
  await expect(page.getByTestId('guest-home-research-access-disclosure')).toHaveCount(0);
  await markClientSession(page);

  const homeInput = page.getByTestId('home-bento-omnibar-input');
  await homeInput.fill('AAPL');
  await homeInput.press('Enter');
  await expect(page).toHaveURL(/\/stocks\/AAPL\/structure-decision\?symbol=AAPL&source=manual$/);
  await expectSpaMarker(page);
  await expect.poll(() => page.evaluate(() => (window as SearchNavigationWindow).__t665RouteTransitions)).toBe(1);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('home-bento-omnibar-input')).toBeVisible();
  await homeInput.fill('AAPL');
  await page.getByTestId('home-bento-analyze-button').click();
  await expect(page).toHaveURL(/\/stocks\/AAPL\/structure-decision\?symbol=AAPL&source=manual$/);
  await expectSpaMarker(page);
  await expect.poll(() => page.evaluate(() => (window as SearchNavigationWindow).__t665RouteTransitions)).toBe(2);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('home-bento-omnibar-input')).toBeVisible();
  await homeInput.fill('0700.HK');
  await homeInput.press('Enter');
  await expect(page).toHaveURL(/\/stocks\/HK00700\/structure-decision\?symbol=HK00700&source=manual$/);
  await expectSpaMarker(page);
  await expect.poll(() => page.evaluate(() => (window as SearchNavigationWindow).__t665RouteTransitions)).toBe(3);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('home-bento-omnibar-input')).toBeVisible();
  const previewRequestCountBeforeInvalid = previewStockCodes.length;
  await homeInput.fill('not-a-symbol!');
  await page.getByTestId('home-bento-analyze-button').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('请输入格式正确的股票代码')).toBeVisible();
  await expect(homeInput).toBeFocused();
  await expect(homeInput).toHaveAttribute('aria-invalid', 'true');
  await expect(homeInput).toHaveAttribute('aria-describedby', 'home-bento-omnibar-error');
  await expect(page.getByTestId('home-bento-omnibar-error')).toHaveAttribute('role', 'alert');
  await expect(page.getByTestId('home-bento-fallback-toast')).toHaveCount(0);
  expect(validatedSymbols).toContain('not-a-symbol!');
  expect(previewStockCodes).toHaveLength(previewRequestCountBeforeInvalid);
  await homeInput.fill('');
  await page.getByTestId('home-bento-analyze-button').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('请输入股票代码后再开始分析')).toBeVisible();
  await expect(homeInput).toBeFocused();
  await expect(homeInput).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('home-bento-fallback-toast')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as SearchNavigationWindow).__t665RouteTransitions)).toBe(3);

  const isMobile = page.viewportSize()?.width !== undefined && (page.viewportSize()?.width || 0) < 700;
  if (isMobile) {
    const menuTrigger = page.getByRole('button', { name: '打开导航菜单' });
    await menuTrigger.click();
  }
  const shellSearch = page.getByRole('search', { name: '按股票代码打开个股研究' });
  await expect(shellSearch).toBeVisible();
  const shellInput = shellSearch.getByRole('textbox', { name: '个股' });
  await shellInput.fill('AAPL');
  await shellInput.press('Enter');
  await expect(page).toHaveURL(/\/stocks\/AAPL\/structure-decision$/);
  await expectSpaMarker(page);
  await expect.poll(() => page.evaluate(() => (window as SearchNavigationWindow).__t665RouteTransitions)).toBe(4);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('home-bento-omnibar-input')).toBeVisible();
  if (isMobile) {
    const menuTrigger = page.getByRole('button', { name: '打开导航菜单' });
    await menuTrigger.click();
  }
  const shellSearchAfterBack = page.getByRole('search', { name: '按股票代码打开个股研究' });
  const shellInputAfterBack = shellSearchAfterBack.getByRole('textbox', { name: '个股' });
  await shellInputAfterBack.fill('AAPL');
  await shellInputAfterBack.press('Escape');
  await expect(shellSearchAfterBack.getByTestId('shell-stock-search-popover')).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  if (isMobile) {
    const menuTrigger = page.getByRole('button', { name: '打开导航菜单' });
    await expect(page.getByTestId('shell-mobile-navigation-menu')).toHaveCount(0);
    await expect(menuTrigger).toBeFocused();
    await menuTrigger.click();
  } else {
    await expect(shellInputAfterBack).not.toBeFocused();
  }
  await shellInputAfterBack.fill('AAPL');
  await shellSearchAfterBack
    .getByTestId('shell-stock-search-popover')
    .getByRole('button', { name: '验证后打开个股研究 使用已验证的标的身份。', exact: true })
    .click();
  await expect(page).toHaveURL(/\/stocks\/AAPL\/structure-decision$/);
  await expectSpaMarker(page);
  await expect.poll(() => page.evaluate(() => (window as SearchNavigationWindow).__t665RouteTransitions)).toBe(5);

  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(failedRequests).toEqual([]);
  expect(validatedSymbols).toEqual(expect.arrayContaining(['AAPL', '0700.HK', 'not-a-symbol!']));
  expect(previewStockCodes).not.toContain('not-a-symbol!');
  expect(errorResponses).toEqual([]);
});

test('guest canonical stock destination remains owned by AuthGuard', async ({ page }) => {
  await page.goto('/stocks/600519/structure-decision?symbol=600519&source=manual');

  await expect(page).toHaveURL(/\/stocks\/600519\/structure-decision\?symbol=600519&source=manual$/);
  await expect(page.getByTestId('auth-guard-overlay')).toBeVisible();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('consumer-protected-frame')).toHaveAttribute('data-boundary-family', 'consumer-protected');
  await expect(page.getByTestId('stock-structure-decision-page')).toHaveCount(0);
});
