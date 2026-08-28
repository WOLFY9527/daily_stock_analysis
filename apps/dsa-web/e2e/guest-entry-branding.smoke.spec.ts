import { expect as baseExpect, type Page } from '@playwright/test';
import { expect as appExpect, test as appTest } from './fixtures/appSmoke';
import { expectNoConsumerRawLeakage } from './fixtures/consumerRawLeakageGuard';
import { captureShellVisualEvidence } from './fixtures/shellVisualEvidence';

const guestJourneyViewports = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'tablet', width: 1024, height: 768 },
  { label: 'mobile', width: 390, height: 844 },
] as const;

async function expectNoHorizontalOverflow(page: Page) {
  await baseExpect
    .poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    .toBe(true);
}

appTest('guest entry routes use research branding instead of AI persona copy', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('/');
  await appExpect(page).not.toHaveURL(/\/login(?:\?|$)/);
  await appExpect(page.getByTestId('guest-home-clean-search')).toBeVisible({ timeout: 15_000 });
  await appExpect(page.getByTestId('home-bento-dashboard')).toHaveAttribute('data-route-identity', 'guest-home');
  await appExpect(page).toHaveTitle(/WolfyStock (游客研究控制台|Guest Research Console)/);
  await appExpect(page.getByRole('heading', { name: /WolfyStock 研究控制台|WolfyStock Research Console/ })).toBeVisible();
  await appExpect(page.getByTestId('guest-home-market-preview-strip')).toContainText(/当前市场观察|Current market observation/);
  await appExpect(page.getByTestId('guest-home-market-preview-strip')).toHaveAttribute('role', 'status');
  await appExpect(page.locator('body')).not.toContainText(/WOLFY AI|wake the AI|INITIALIZING WOLFY AI CORE|terminal boot/i);
  await appExpect(page.getByTestId('guest-home-clean-search')).not.toContainText(/\bNVDA\b|NVIDIA|TSLA|Tesla/i);
  await expectNoHorizontalOverflow(page);

  await page.goto('/guest');
  await appExpect(page).not.toHaveURL(/\/login(?:\?|$)/);
  await appExpect(page.getByTestId('guest-home-clean-search')).toBeVisible({ timeout: 15_000 });
  await appExpect(page.getByRole('heading', { name: /WolfyStock 研究控制台|WolfyStock Research Console/ })).toBeVisible();
  await captureShellVisualEvidence(page, 'guest', { width: 1440, height: 900 });
  await expectNoConsumerRawLeakage(page.locator('body'), { label: '/guest' });

  for (const viewport of guestJourneyViewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/zh/guest');
    await appExpect(page.getByTestId('guest-home-clean-search')).toBeVisible({ timeout: 15_000 });
    await appExpect(page.getByTestId('home-bento-dashboard')).toHaveAttribute('data-route-identity', 'guest-home');
    await appExpect(page.getByTestId('guest-home-market-preview-strip')).toContainText('当前市场观察');
    await appExpect(page.getByTestId('home-bento-omnibar-input')).toHaveAttribute('placeholder', '输入代码或名称开始研究...');
    await appExpect(page.locator('body')).not.toContainText(/WOLFY AI|唤醒 AI|INITIALIZING|terminal boot/i);
    await appExpect(page.getByTestId('guest-home-clean-search')).not.toContainText(/\bNVDA\b|NVIDIA|TSLA|Tesla/i);
    await expectNoHorizontalOverflow(page);
    if (viewport.width === 390) {
      await captureShellVisualEvidence(page, 'guest', { width: viewport.width, height: viewport.height });
    }
    await expectNoConsumerRawLeakage(page.locator('body'), { label: `/zh/guest ${viewport.label}` });
  }

  await page.goto('/zh/login');
  await appExpect(page).toHaveTitle('登录 - WolfyStock');
  await appExpect(page.getByRole('heading', { name: 'WolfyStock 账户登录' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '返回游客模式' }).click();
  await appExpect(page).toHaveURL(/\/zh\/guest$/);
  await appExpect(page.getByTestId('guest-home-clean-search')).toBeVisible({ timeout: 15_000 });
  await appExpect(page.locator('body')).not.toContainText(/WOLFY AI|INITIALIZING|terminal boot/i);
  await expectNoHorizontalOverflow(page);

  await page.goto('/zh/login');
  await appExpect(page).toHaveTitle('登录 - WolfyStock');
  await page.goto('/zh/register?redirect=%2Fzh%2Fmarket-overview');
  await appExpect(page).toHaveTitle('创建账户 - WolfyStock');
  await appExpect(page).not.toHaveURL(/\/login(?:\?|$)/);
  await appExpect(page.getByRole('heading', { name: '创建账户' })).toBeVisible({ timeout: 15_000 });
  await appExpect(page.getByRole('button', { name: '返回游客模式' })).toBeVisible();
  await page.goBack();
  await appExpect(page).toHaveTitle('登录 - WolfyStock');
  await page.goForward();
  await appExpect(page).toHaveTitle('创建账户 - WolfyStock');

  await page.goto('/en/login');
  await appExpect(page).toHaveTitle('Login - WolfyStock');
  await page.goto('/en/register');
  await appExpect(page).toHaveTitle('Create Account - WolfyStock');
  await page.goBack();
  await appExpect(page).toHaveTitle('Login - WolfyStock');
  await page.goForward();
  await appExpect(page).toHaveTitle('Create Account - WolfyStock');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/market-overview');
  await appExpect(page).not.toHaveURL(/\/login(?:\?|$)/);
  await appExpect(page.getByTestId('market-overview-shell')).toBeVisible({ timeout: 15_000 });
  await appExpect(page.getByTestId('auth-guard-overlay')).toHaveCount(0);
});

appTest('guest first fold stays honest when the public market snapshot is unavailable', async ({ page }) => {
  await page.route('**/api/v1/market/market-briefing', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        source: 'fallback',
        sourceLabel: 'Latest available data',
        updatedAt: '2026-06-08T00:00:00Z',
        asOf: '2026-06-08T00:00:00Z',
        freshness: 'fallback',
        isFallback: true,
        isReliable: false,
        warning: 'Sign in to open Market Overview, Scanner, and saved research history once the public snapshot comes back.',
        items: [],
      }),
    });
  });

  await page.goto('/en/guest');
  await appExpect(page.getByTestId('guest-home-clean-search')).toBeVisible({ timeout: 15_000 });
  await appExpect(page.getByTestId('guest-home-market-preview-strip')).toContainText('Public market observation unavailable right now');
  await appExpect(page.getByTestId('guest-home-market-preview-strip')).toContainText('Sign in to open Market Overview, Scanner, and saved research history once the public snapshot comes back.');
  await appExpect(page.getByTestId('guest-home-clean-search')).not.toContainText(/\bNVDA\b|NVIDIA|TSLA|Tesla/i);
  await baseExpect
    .poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    .toBe(true);
  await expectNoConsumerRawLeakage(page.locator('body'), { label: '/en/guest unavailable snapshot' });
});

appTest('guest search keeps the preview host while rendering a valid public preview', async ({ page }) => {
  await page.route('**/api/v1/analysis/preview', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query_id: 'preview-tsla',
        stock_code: 'TSLA',
        stock_name: 'Tesla',
        preview_scope: 'guest',
        report: {
          meta: {
            query_id: 'preview-tsla',
            stock_code: 'TSLA',
            stock_name: 'Tesla',
            report_type: 'brief',
            created_at: '2026-06-08T00:00:00Z',
          },
          summary: {
            analysis_summary: 'Public preview retains observation-only information; full research requires sign-in.',
            trend_prediction: 'Observation only',
            sentiment_score: 51,
            sentiment_label: 'Observation only',
            observation_scope: 'Observation only',
            key_price_reference: 'Price references require the complete research packet after sign-in.',
            evidence_boundary: 'Public preview does not include internal reasoning or execution guidance.',
          },
        },
      }),
    });
  });

  await page.goto('/zh/guest');
  await appExpect(page.getByTestId('guest-home-clean-search')).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('home-bento-omnibar-input').fill('TSLA');
  await page.getByRole('button', { name: '分析' }).click();

  await appExpect(page).toHaveURL(/\/zh\/guest$/);
  await appExpect(page.getByTestId('auth-guard-overlay')).toHaveCount(0);
  await appExpect(page.getByTestId('guest-preview-unavailable-state')).toHaveCount(0);
  await appExpect(page.getByTestId('home-research-console')).toBeVisible();
  await appExpect(page.getByTestId('guest-home-frosted-lock')).toHaveCount(2);
  await appExpect(page.getByTestId('home-bento-decision-signal-hero')).toContainText(/仅观察|Observation only/);
  await appExpect(page.getByTestId('home-research-readiness-strip')).toContainText(/仅观察|Observation only/);
  await appExpect(page.getByText(/解锁完整研究框架、价格观察与技术形态解读|Unlock the full research framework, price observations, and technical context/).first()).toBeVisible();
  await appExpect(page.locator('body')).not.toContainText(/实时诱饵|WOLFY AI|唤醒 AI|本地研究快照|本地快照|目标价|止损|买入|卖出|持有|仓位建议/i);
  await baseExpect
    .poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    .toBe(true);
  await expectNoConsumerRawLeakage(page.locator('body'), { label: '/zh/guest preview unavailable' });

  await page.getByRole('link', { name: /打开结构面板|Open stock structure/ }).click();
  await appExpect(page).toHaveURL(/\/zh\/stocks\/TSLA\/structure-decision$/);
  await appExpect(page.getByTestId('auth-guard-overlay')).toBeVisible();
  await appExpect(page.getByRole('link', { name: /前往登录|Sign in/ })).toHaveAttribute(
    'href',
    '/zh/login?redirect=%2Fzh%2Fstocks%2FTSLA%2Fstructure-decision',
  );

  await page.goBack();
  await appExpect(page).toHaveURL(/\/zh\/guest$/);
  await appExpect(page.getByTestId('guest-home-clean-search')).toBeVisible({ timeout: 15_000 });
  await appExpect(page.getByTestId('auth-guard-overlay')).toHaveCount(0);

  await page.reload();
  await appExpect(page).toHaveURL(/\/zh\/guest$/);
  await appExpect(page.getByTestId('guest-home-clean-search')).toBeVisible({ timeout: 15_000 });
  await appExpect(page.getByTestId('home-research-console')).toHaveCount(0);
  await appExpect(page.getByTestId('auth-guard-overlay')).toHaveCount(0);
});
