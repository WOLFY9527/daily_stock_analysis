import { expect, test, type Page } from '@playwright/test';

const backendBaseUrl = process.env.DSA_WEB_SMOKE_BACKEND_URL || 'http://127.0.0.1:8000';
const smokePassword = process.env.DSA_WEB_SMOKE_PASSWORD;

type AuthStatusPayload = {
  authEnabled: boolean;
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

  const submitButton = page.getByRole('button', { name: /授权进入工作台|完成设置并登录|Sign in|Set password/i });
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

test.describe('web deployment smoke', () => {
  test('home app shell loads', async ({ page }) => {
    await openHome(page);
    await expect(page.locator('body')).toContainText(/输入股票代码或名称|历史分析|Start with a symbol|Analysis history/);
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
    await expect(page.getByRole('button', { name: /授权进入工作台|完成设置并登录|Sign in|Set password/i })).toBeVisible();
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

    await expect(page.locator('body')).toContainText(/重置访问口令|Reset access password|管理员|administrator/i, {
      timeout: 10_000,
    });
  });

  test('portfolio route loads or shows current auth-disabled/auth-required state', async ({ page }) => {
    const authStatus = await getAuthStatus(page);
    await expectReachableRoute(
      page,
      '/portfolio',
      authStatus.authEnabled
        ? /持仓管理|Portfolio|登录后查看你的持仓|Sign in to open your portfolio/
        : /持仓管理|登录后查看你的持仓|Sign in to open your portfolio|Portfolio/,
    );
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
    await expect(page.getByRole('button', { name: /打开管理工具|Open admin tools/i })).toBeVisible();
    await expect(page.locator('body')).toContainText(/当前视图：普通页面|Current view: User page/i);

    await page.getByRole('button', { name: /打开管理工具|Open admin tools/i }).click();
    await expect(page.getByRole('button', { name: /返回普通页面|Return to user page/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('body')).toContainText(/当前视图：管理工具|Current view: Admin tools/i);
    await expect(page.getByRole('main').getByRole('link', { name: /独立控制台|Independent console/i })).toBeVisible();

    await page.getByRole('main').getByRole('link', { name: /独立控制台|Independent console/i }).click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: /系统控制面|System control/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('body')).toContainText(/Admin Mode 已启用|Admin Mode enabled/i);
    await expect(page.getByRole('button', { name: /重置|Reset/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /保存配置|Save/i })).toBeVisible();
  });

  test('settings system direct route opens or reports admin gating', async ({ page }) => {
    await maybeLogin(page);
    await expectReachableRoute(
      page,
      '/settings/system',
      /系统控制面|System control|请先开启管理工具|Open personal settings first|Sign in/i,
    );
  });

  test('settings system route supports locale switching and provider editor entry when reachable', async ({ page }) => {
    await maybeLogin(page);
    await expectReachableRoute(
      page,
      '/settings/system',
      /系统控制面|System control|请先开启管理工具|Open personal settings first|Sign in/i,
    );

    const body = page.locator('body');
    const systemReady = await body.getByText(/系统控制面|System control/i).isVisible({ timeout: 2_000 }).catch(() => false);
    if (!systemReady) {
      test.info().annotations.push({
        type: 'environment-limited',
        description: '/settings/system is currently gated; provider editor and locale checks require admin/system access.',
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
});
