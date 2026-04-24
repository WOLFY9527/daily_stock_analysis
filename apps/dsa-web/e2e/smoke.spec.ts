import { expect, test, type Page } from '@playwright/test';

const backendBaseUrl = process.env.DSA_WEB_SMOKE_BACKEND_URL || 'http://127.0.0.1:8000';
const smokePassword = process.env.DSA_WEB_SMOKE_PASSWORD;
const routeApiRequests = process.env.DSA_WEB_SMOKE_ROUTE_API === '1';

type AuthStatusPayload = {
  authEnabled: boolean;
  loggedIn?: boolean;
};

async function getAuthStatus(page: Page): Promise<AuthStatusPayload> {
  const response = await page.request.get(`${backendBaseUrl}/api/v1/auth/status`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function waitForAppShell(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toContainText(/WolfyStock|股票研究工作区|Stock Research Workspace/, {
    timeout: 15_000,
  });
}

async function openHome(page: Page) {
  await page.goto('/');
  await waitForAppShell(page);
}

async function maybeLogin(page: Page): Promise<AuthStatusPayload> {
  const authStatus = await getAuthStatus(page);
  if (!authStatus.authEnabled) {
    await openHome(page);
    test.info().annotations.push({
      type: 'environment-limited',
      description: 'authEnabled=false; authenticated-only smoke checks are limited to reachable public/runtime state.',
    });
    return authStatus;
  }

  test.skip(!smokePassword, 'Set DSA_WEB_SMOKE_PASSWORD to run authenticated smoke tests.');

  await page.goto('/login');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#password')).toBeVisible({ timeout: 10_000 });
  await page.locator('#password').fill(smokePassword!);

  const submitButton = page.getByRole('button', { name: /授权进入工作台|完成设置并登录|登录继续|Sign in|Set password/i });
  await expect(submitButton).toBeVisible();

  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes('/api/v1/auth/login') && response.status() === 200,
      { timeout: 15_000 },
    ),
    submitButton.click(),
  ]);

  await page.waitForURL('/', { timeout: 15_000 });
  await waitForAppShell(page);
  return authStatus;
}

async function expectReachableRoute(page: Page, path: string, expectedText: RegExp) {
  await page.goto(path);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toContainText(expectedText, { timeout: 15_000 });
}

async function ensureGuestSession(page: Page): Promise<AuthStatusPayload> {
  const authStatus = await getAuthStatus(page);
  if (!authStatus.authEnabled) {
    test.info().annotations.push({
      type: 'environment-limited',
      description: 'authEnabled=false; guest redirect enforcement is inactive in auth-disabled local runtime.',
    });
    return authStatus;
  }

  await page.request.post(`${backendBaseUrl}/api/v1/auth/logout`).catch(() => undefined);
  return getAuthStatus(page);
}

async function expectBentoRoute(
  page: Page,
  path: string,
  pageTestId: string,
  heroTestId: string,
  bodyText: RegExp,
) {
  await page.goto(path);
  await waitForAppShell(page);
  await expect(page.locator(`[data-testid="${pageTestId}"]`)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(`[data-testid="${heroTestId}"]`)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('body')).toContainText(bodyText, { timeout: 15_000 });
}

async function expectGlowText(page: Page, valueTestId: string) {
  const target = page.locator(`[data-testid="${valueTestId}"]`);
  await expect(target).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (
    target.evaluate((element) => getComputedStyle(element).textShadow)
  )).not.toBe('none');
}

async function expectDrawerToggle(page: Page, triggerTestId: string, drawerTestId: string) {
  await page.locator(`[data-testid="${triggerTestId}"]`).click();
  await expect(page.locator(`[data-testid="${drawerTestId}"]`)).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test.describe('web deployment smoke', () => {
  test.beforeEach(async ({ page }) => {
    if (!routeApiRequests) {
      return;
    }
    await page.route('**/api/**', async (route) => {
      const requestUrl = new URL(route.request().url());
      const response = await route.fetch({
        url: `${backendBaseUrl}${requestUrl.pathname}${requestUrl.search}`,
      });
      await route.fulfill({ response });
    });
  });

  test.afterEach(async ({ page }) => {
    if (!routeApiRequests) {
      return;
    }
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('home app shell loads', async ({ page }) => {
    await openHome(page);
    await expect(page.locator('body')).toContainText(/WolfyStock 决策面板|WolfyStock Command Center|游客预览模式|Guest Preview Mode/, {
      timeout: 15_000,
    });
  });

  test('signed-in home bento dashboard renders drawer interactions and mobile stack when reachable', async ({ page }) => {
    await maybeLogin(page);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const body = page.locator('body');
    const grid = page.locator('[data-testid="home-bento-grid"]');
    const decisionCard = page.locator('[data-testid="home-bento-card-decision"]');

    await expect(body).toContainText(/WolfyStock 决策面板|WolfyStock Command Center/, { timeout: 15_000 });
    await expect(grid).toBeVisible();
    await expect(decisionCard).toBeVisible();

    await decisionCard.hover();
    await expect.poll(async () => (
      decisionCard.evaluate((element) => getComputedStyle(element).translate)
    )).not.toBe('none');

    const glowLabel = decisionCard.getByText(/看多|Bullish/).first();
    await expect.poll(async () => (
      glowLabel.evaluate((element) => getComputedStyle(element).textShadow)
    )).not.toBe('none');

    await page.getByRole('button', { name: /查看策略细节|Open Strategy Brief/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15_000 });
    await expect(body).toContainText(/执行策略细节|Execution strategy brief/i, { timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('[data-testid="home-bento-grid"]')).toBeVisible();
    await expect(page.locator('[data-testid="home-bento-card-strategy"]')).toBeVisible();
  });

  test('signed-in home bento dashboard localizes core copy when reachable', async ({ page }) => {
    await maybeLogin(page);

    await page.goto('/en');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('[data-testid="home-bento-grid"]')).toBeVisible();
    await expect(page.locator('body')).toContainText(/WolfyStock Command Center|Execution Strategy|Technical Structure/, {
      timeout: 15_000,
    });

    await page.goto('/zh');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('[data-testid="home-bento-grid"]')).toBeVisible();
    await expect(page.locator('body')).toContainText(/WolfyStock 决策面板|执行策略|技术形态/, {
      timeout: 15_000,
    });
  });

  test('login route is reachable or redirects cleanly when auth is disabled', async ({ page }) => {
    const authStatus = await getAuthStatus(page);
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');

    if (!authStatus.authEnabled) {
      await expect(page.locator('body')).toContainText(/WolfyStock|股票研究工作区|Stock Research Workspace/, {
        timeout: 10_000,
      });
      return;
    }

    await expect(page.locator('body')).toContainText(/WolfyStock 账户|WolfyStock account/, { timeout: 10_000 });
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.getByRole('button', { name: /授权进入工作台|完成设置并登录|登录继续|Sign in|Set password/i })).toBeVisible();
  });

  test('guest route loads the dedicated guest surface', async ({ page }) => {
    await page.goto('/guest');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('[data-testid="guest-home-bento-page"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="guest-home-bento-hero"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('body')).toContainText(/游客预览模式|Guest Preview Mode|输入标的|Enter a symbol|即时分析预览|Instant Analysis Snapshot/, {
      timeout: 15_000,
    });
  });

  test('guest preview keeps hover lift and locale switching on the bento shell', async ({ page }) => {
    await page.goto('/en/guest');
    await waitForAppShell(page);
    await expect(page.locator('[data-testid="guest-home-bento-page"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('body')).toContainText(/Guest Preview Mode|Instant Analysis Snapshot|Guest limits/, {
      timeout: 15_000,
    });

    const previewCard = page.locator('[data-testid="guest-home-preview-card"]');
    await previewCard.hover();
    await expect.poll(async () => (
      previewCard.evaluate((element) => getComputedStyle(element).translate)
    )).not.toBe('none');
    await expectGlowText(page, 'guest-home-bento-hero-unlock-value');
    await expectDrawerToggle(page, 'guest-home-bento-drawer-trigger', 'guest-home-bento-drawer');

    await page.goto('/zh/guest');
    await waitForAppShell(page);
    await expect(page.locator('[data-testid="guest-home-bento-hero"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('body')).toContainText(/游客预览模式|即时分析预览|游客限制/, {
      timeout: 15_000,
    });
  });

  test('reset-password route is reachable when runtime allows it', async ({ page }) => {
    const authStatus = await getAuthStatus(page);
    await page.goto('/reset-password');
    await page.waitForLoadState('domcontentloaded');

    if (!authStatus.authEnabled) {
      await expect(page.locator('body')).toContainText(/WolfyStock|股票研究工作区|Stock Research Workspace/, {
        timeout: 10_000,
      });
      return;
    }

    await expect(page.locator('body')).toContainText(/请求重置密码|账户恢复|Reset access password|Request password reset|Account recovery/i, {
      timeout: 10_000,
    });
  });

  test('portfolio route loads or shows current auth-disabled/auth-required state', async ({ page }) => {
    const authStatus = await getAuthStatus(page);
    await expectReachableRoute(
      page,
      '/portfolio',
      authStatus.authEnabled
        ? /游客预览模式|Guest Preview Mode|输入标的|Enter a symbol|即时分析预览|Instant Analysis Snapshot/
        : /持仓管理|登录后查看你的持仓|Sign in to open your portfolio|Portfolio/,
    );
  });

  test('guest-only session cannot open restricted product routes', async ({ page }) => {
    const authStatus = await ensureGuestSession(page);
    test.skip(!authStatus.authEnabled, 'Auth-disabled runtime treats the app as an unrestricted local workspace.');

    for (const path of ['/portfolio', '/backtest', '/scanner', '/settings', '/settings/system']) {
      await page.goto(path);
      await page.waitForLoadState('domcontentloaded');
      await expect(page).toHaveURL(/\/guest$/);
      await expect(page.locator('body')).toContainText(/游客预览模式|Guest Preview Mode|输入标的|Enter a symbol|即时分析预览|Instant Analysis Snapshot/, {
        timeout: 15_000,
      });
      await expect(page.locator('body')).not.toContainText(/持仓管理|Portfolio Management|市场扫描|Market Scanner|系统控制面|System control/);
    }
  });

  test('settings flow keeps personal settings separate from the admin control plane when reachable', async ({ page }) => {
    const authStatus = await maybeLogin(page);

    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');

    if (!authStatus.authEnabled) {
      await expect(page.locator('body')).toContainText(/个人偏好|Personal preferences|Sign in|登录后/i, { timeout: 15_000 });
      return;
    }

    await expect(page.getByRole('heading', { name: /个人偏好|Personal preferences/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('main').getByRole('link', { name: /控制台|Console/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('main').getByRole('link', { name: /日志|Logs/i })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('main').getByRole('link', { name: /控制台|Console/i }).click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: /系统控制面|System control/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('body')).toContainText(/管理员控制台|Admin Console|全局系统控制面|global system control plane/i);
    await expect(page.getByRole('button', { name: /重置|Reset/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /保存配置|Save/i })).toBeVisible();
  });

  test('settings system direct route opens or reports admin gating', async ({ page }) => {
    await maybeLogin(page);
    await expectReachableRoute(
      page,
      '/settings/system',
      /系统控制面|System control|Sign in|登录/i,
    );
  });

  test('settings system route supports locale switching and provider editor entry when reachable', async ({ page }) => {
    await maybeLogin(page);
    await expectReachableRoute(
      page,
      '/settings/system',
      /系统控制面|System control|Sign in|登录/i,
    );

    const body = page.locator('body');
    const systemReady = await body.getByText(/系统控制面|System control/i).isVisible({ timeout: 2_000 }).catch(() => false);
    if (!systemReady) {
      test.info().annotations.push({
        type: 'environment-limited',
        description: '/settings/system is currently unavailable for this session; provider editor and locale checks require admin console access.',
      });
      return;
    }

    await expect(body).toContainText(/AI|Provider|渠道|模型/);
    await expect(body).toContainText(/保存配置|Save/);

    await page.goto('/en/settings/system');
    await page.waitForLoadState('domcontentloaded');
    await expect(body).toContainText(/System control|AI|Provider|Save/i, { timeout: 15_000 });

    await page.goto('/settings/system');
    await page.waitForLoadState('domcontentloaded');
    await expect(body).toContainText(/系统控制面|AI|Provider|渠道|模型/, { timeout: 15_000 });
  });

  test('backtest page renders filter controls when reachable', async ({ page }) => {
    await maybeLogin(page);
    await page.goto('/backtest');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toContainText(/回测|Backtest|基础参数|Basic parameters|股票代码|Stock symbol/, {
      timeout: 15_000,
    });
  });

  test('major product routes expose Gemini Bento shells across desktop and mobile viewports', async ({ page }) => {
    await maybeLogin(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await expectBentoRoute(page, '/scanner', 'user-scanner-bento-page', 'user-scanner-bento-hero', /市场扫描|Market Scanner|我的手动扫描|My scanner run/);
    await expectBentoRoute(page, '/portfolio', 'portfolio-bento-page', 'portfolio-bento-hero', /持仓管理|Portfolio management|总权益|Total equity/);
    await expectBentoRoute(page, '/backtest', 'backtest-bento-page', 'backtest-bento-hero', /回测|Backtest|普通版配置|Configuration page/);
    await expectBentoRoute(page, '/chat', 'chat-bento-page', 'chat-bento-hero', /问股|Stock Chat|量化研究|Quant Research/);
    await expectGlowText(page, 'chat-bento-hero-skill-value');

    await page.goto('/settings/system');
    await waitForAppShell(page);
    const settingsReady = await page.locator('[data-testid="settings-bento-page"]').isVisible({ timeout: 2_000 }).catch(() => false);
    if (settingsReady) {
      await expect(page.locator('[data-testid="settings-bento-hero"]')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('body')).toContainText(/系统控制面|System control|管理员控制台|Admin Console/, { timeout: 15_000 });
    } else {
      test.info().annotations.push({
        type: 'environment-limited',
        description: '/settings/system did not expose the admin Bento surface in this runtime.',
      });
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await expectBentoRoute(page, '/scanner', 'user-scanner-bento-page', 'user-scanner-bento-hero', /市场扫描|Market Scanner/);
    await expectBentoRoute(page, '/portfolio', 'portfolio-bento-page', 'portfolio-bento-hero', /持仓管理|Portfolio management/);
    await expectBentoRoute(page, '/backtest', 'backtest-bento-page', 'backtest-bento-hero', /回测|Backtest/);
    await expectBentoRoute(page, '/chat', 'chat-bento-page', 'chat-bento-hero', /问股|Stock Chat|量化研究|Quant Research/);
  });

  test('segment pages keep drawer toggles, glow text, and locale-ready Bento shells', async ({ page }) => {
    await maybeLogin(page);

    await page.goto('/scanner');
    await waitForAppShell(page);
    await expect(page.locator('[data-testid="user-scanner-bento-page"]')).toBeVisible({ timeout: 15_000 });
    await expectGlowText(page, 'user-scanner-bento-hero-shortlist-value');
    await expectDrawerToggle(page, 'user-scanner-bento-drawer-trigger', 'user-scanner-bento-drawer');

    await page.goto('/portfolio');
    await waitForAppShell(page);
    await expect(page.locator('[data-testid="portfolio-bento-page"]')).toBeVisible({ timeout: 15_000 });
    await expectGlowText(page, 'portfolio-bento-hero-equity-value');
    await expectDrawerToggle(page, 'portfolio-bento-drawer-trigger', 'portfolio-bento-drawer');

    await page.goto('/backtest');
    await waitForAppShell(page);
    await expect(page.locator('[data-testid="backtest-bento-page"]')).toBeVisible({ timeout: 15_000 });
    await expectGlowText(page, 'backtest-bento-hero-module-value');
    await expectDrawerToggle(page, 'backtest-bento-drawer-trigger', 'backtest-bento-drawer');

    await page.goto('/chat');
    await waitForAppShell(page);
    await expect(page.locator('[data-testid="chat-bento-page"]')).toBeVisible({ timeout: 15_000 });
    await expectGlowText(page, 'chat-bento-hero-skill-value');
    await expectDrawerToggle(page, 'chat-bento-drawer-trigger', 'chat-bento-drawer');

    await page.goto('/settings/system');
    await waitForAppShell(page);
    const settingsPage = page.locator('[data-testid="settings-bento-page"]');
    const settingsAvailable = await settingsPage.isVisible({ timeout: 2_000 }).catch(() => false);
    if (!settingsAvailable) {
      test.info().annotations.push({
        type: 'environment-limited',
        description: '/settings/system disclosure checks require admin Bento access in this runtime.',
      });
      return;
    }

    await expectGlowText(page, 'settings-bento-hero-dirty-value');
    await expectDrawerToggle(page, 'settings-bento-drawer-trigger', 'settings-bento-drawer');

    await page.goto('/en/scanner');
    await waitForAppShell(page);
    await expect(page.locator('[data-testid="user-scanner-bento-page"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('body')).toContainText(/Market Scanner|My scanner run|Open rationale/i, { timeout: 15_000 });

    await page.goto('/en/guest');
    await waitForAppShell(page);
    await expect(page.locator('[data-testid="guest-home-bento-page"]')).toBeVisible({ timeout: 15_000 });
    await expectGlowText(page, 'guest-home-bento-hero-unlock-value');

    await page.goto('/scanner');
    await waitForAppShell(page);
    await expect(page.locator('body')).toContainText(/市场扫描|我的扫描运行|查看解释/, { timeout: 15_000 });
  });

  test('guest scanner teaser keeps drawer toggle and locale copy', async ({ page }) => {
    await ensureGuestSession(page);
    await page.goto('/scanner');
    await waitForAppShell(page);
    const guestSurface = await page.locator('[data-testid="guest-scanner-bento-page"]').isVisible({ timeout: 2_000 }).catch(() => false);
    if (!guestSurface) {
      test.info().annotations.push({
        type: 'environment-limited',
        description: 'Current runtime routed /scanner to the signed-in scanner surface; guest teaser validation requires a guest session.',
      });
      return;
    }

    await expectGlowText(page, 'guest-scanner-bento-hero-history-value');
    await expectDrawerToggle(page, 'guest-scanner-bento-drawer-trigger', 'guest-scanner-bento-drawer');

    await page.goto('/en/scanner');
    await waitForAppShell(page);
    await expect(page.locator('[data-testid="guest-scanner-bento-page"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('body')).toContainText(/Market Scanner Preview|Access guide|Saved history/, { timeout: 15_000 });
  });
});
