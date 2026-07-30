import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/appSmoke';

type SearchNavigationWindow = Window & {
  __t665SearchMarker?: string;
  __t665RouteTransitions?: number;
};

test.use({ allowKnownGuestPreviewRejectionConsole: true });

async function stabilizeUnrelatedData(page: Page) {
  await page.route('**/api/v1/analysis/preview', async (route) => {
    const payload = route.request().postDataJSON() as { stock_code?: unknown } | null;
    const stockCode = typeof payload?.stock_code === 'string' ? payload.stock_code.trim() : '';
    if (!stockCode) {
      throw new Error('Preview fixture requires a request stock_code.');
    }

    if (stockCode === 'not-a-symbol!') {
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Guest preview rejected the submitted stock code.' }),
      });
      return;
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

test('home stock search reaches the canonical route through keyboard, button, and suggestions', async ({ page }) => {
  const failedRequests: string[] = [];
  const errorResponses: string[] = [];
  const expectedPreviewRejections: Array<{ status: number; stockCode: string; url: string }> = [];
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}`));
  page.on('response', (response) => {
    if (response.status() < 400) {
      return;
    }

    if (response.status() === 422 && response.url().includes('/api/v1/analysis/preview')) {
      const payload = response.request().postDataJSON() as { stock_code?: unknown } | null;
      const stockCode = typeof payload?.stock_code === 'string' ? payload.stock_code.trim() : '';
      if (stockCode === 'not-a-symbol!') {
        expectedPreviewRejections.push({ status: response.status(), stockCode, url: response.url() });
        return;
      }
    }

    errorResponses.push(`${response.status()} ${response.url()}`);
  });

  await stabilizeUnrelatedData(page);
  await page.goto('/');
  await expect(page.getByTestId('home-bento-omnibar-input')).toBeVisible();
  await expect(page.getByTestId('guest-home-research-access-disclosure')).toHaveText(
    '搜索会先验证标的；打开完整个股研究需要登录。',
  );
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
  await homeInput.fill('600519');
  await page.getByTestId('home-bento-analyze-button').click();
  await expect(page).toHaveURL(/\/stocks\/600519\/structure-decision\?symbol=600519&source=manual$/);
  await expect(page.getByTestId('auth-guard-overlay')).toBeVisible();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('consumer-protected-frame')).toHaveAttribute('data-boundary-family', 'consumer-protected');
  await expect(page.getByTestId('stock-structure-decision-page')).toHaveCount(0);
  await expectSpaMarker(page);
  await expect.poll(() => page.evaluate(() => (window as SearchNavigationWindow).__t665RouteTransitions)).toBe(3);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('home-bento-omnibar-input')).toBeVisible();
  await homeInput.fill('0700.HK');
  await homeInput.press('Enter');
  await expect(page).toHaveURL(/\/stocks\/0700\.HK\/structure-decision\?symbol=0700\.HK&source=manual$/);
  await expectSpaMarker(page);
  await expect.poll(() => page.evaluate(() => (window as SearchNavigationWindow).__t665RouteTransitions)).toBe(4);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('home-bento-omnibar-input')).toBeVisible();
  await homeInput.fill('not-a-symbol!');
  await page.getByTestId('home-bento-analyze-button').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('guest-preview-unavailable-state')).toBeVisible();
  await homeInput.fill('');
  await page.getByTestId('home-bento-analyze-button').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('请输入股票代码后再开始分析')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as SearchNavigationWindow).__t665RouteTransitions)).toBe(4);

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
  await expect.poll(() => page.evaluate(() => (window as SearchNavigationWindow).__t665RouteTransitions)).toBe(5);

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
  await expect.poll(() => page.evaluate(() => (window as SearchNavigationWindow).__t665RouteTransitions)).toBe(6);

  await expect(page.getByRole('dialog')).toBeVisible();
  expect(failedRequests).toEqual([]);
  expect(expectedPreviewRejections).toHaveLength(1);
  expect(expectedPreviewRejections[0]).toMatchObject({ status: 422, stockCode: 'not-a-symbol!' });
  expect(expectedPreviewRejections[0]?.url).toContain('/api/v1/analysis/preview');
  expect(errorResponses).toEqual([]);
});
