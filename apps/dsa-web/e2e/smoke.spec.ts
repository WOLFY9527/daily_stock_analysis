import { expect, test, type Page } from '@playwright/test';

const smokePassword = process.env.DSA_WEB_SMOKE_PASSWORD;
const backendBaseUrl = process.env.DSA_WEB_SMOKE_BACKEND_URL || 'http://127.0.0.1:8000';

type AuthStatusPayload = {
  authEnabled: boolean;
};

async function getAuthStatus(page: Page): Promise<AuthStatusPayload> {
  const response = await page.request.get(`${backendBaseUrl}/api/v1/auth/status`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function login(page: Page) {
  const authStatus = await getAuthStatus(page);
  if (!authStatus.authEnabled) {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await expect(
      page.getByRole('heading', { name: '股票研究工作区' }),
    ).toBeVisible({ timeout: 10_000 });
    return;
  }

  test.skip(!smokePassword, 'Set DSA_WEB_SMOKE_PASSWORD to run authenticated smoke tests.');

  await page.goto('/login');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#password')).toBeVisible({ timeout: 10_000 });

  await page.locator('#password').fill(smokePassword!);

  const submitButton = page.getByRole('button', { name: /授权进入工作台|完成设置并登录/ });
  await expect(submitButton).toBeVisible();

  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes('/api/v1/auth/login') && response.status() === 200,
      { timeout: 15_000 },
    ),
    submitButton.click(),
  ]);

  await page.waitForURL('/', { timeout: 15_000 });
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('link', { name: '首页' })).toBeVisible({ timeout: 10_000 });
}

test.describe('web smoke', () => {
  test('login page renders password form', async ({ page }) => {
    const authStatus = await getAuthStatus(page);
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');

    if (!authStatus.authEnabled) {
      await expect(
        page.getByRole('heading', { name: '股票研究工作区' }),
      ).toBeVisible({ timeout: 10_000 });
      return;
    }

    await expect(page.getByText(/WolfyStock 账户|WolfyStock account/).first()).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: /登录进入 WolfyStock|设置管理员访问口令|Sign in to WolfyStock|Set the admin access password/,
      }),
    ).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.getByRole('button', { name: /授权进入工作台|完成设置并登录/ })).toBeVisible();
  });

  test('home page shows analysis entry and history panel after login', async ({ page }) => {
    await login(page);

    const stockInput = page.getByPlaceholder('输入股票代码或名称，如 600519、贵州茅台、AAPL');
    await expect(stockInput).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('link', { name: '首页' })).toBeVisible();
    await expect(page.getByRole('link', { name: '问股' })).toBeVisible();
    await expect(page.getByText('历史分析')).toBeVisible();

    await stockInput.fill('600519');
    await expect(page.getByRole('button', { name: '分析', exact: true })).toBeVisible();
  });

  test('chat page allows entering a question and starts a request', async ({ page }) => {
    await login(page);

    await page.getByRole('link', { name: '问股' }).click();
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByRole('heading', { name: '问股' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('先提一个具体问题')).toBeVisible();

    const input = page.getByPlaceholder(/例如：分析 600519/);
    await expect(input).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('研究模式')).toBeVisible();

    const prompt = '请简要分析 600519';
    await input.fill(prompt);
    await page.getByRole('button', { name: '发送' }).click();

    await expect(page.locator('p').filter({ hasText: prompt }).last()).toBeVisible({ timeout: 5_000 });
  });

  test('mobile shell opens navigation drawer after login', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);

    const menuButton = page.getByRole('button', { name: /打开导航|菜单/i });
    if (await menuButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await menuButton.click();
    }

    await expect(page.getByRole('link', { name: '回测' })).toBeVisible({ timeout: 5_000 });
  });

  test('settings flow keeps personal settings separate from the admin control plane after login', async ({ page }) => {
    await login(page);

    await page.getByRole('link', { name: '设置' }).click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: '个人偏好' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: '打开管理工具' })).toBeVisible();
    await expect(page.getByText('当前视图：普通页面')).toBeVisible();

    await page.getByRole('button', { name: '打开管理工具' }).click();
    await expect(page.getByRole('button', { name: '返回普通页面' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('当前视图：管理工具')).toBeVisible();
    await expect(
      page.getByRole('main').getByRole('link', { name: '独立控制台' }),
    ).toBeVisible();

    await page.getByRole('main').getByRole('link', { name: '独立控制台' }).click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: '系统控制面' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Admin Mode 已启用')).toBeVisible();
    await expect(page.getByRole('button', { name: '重置' })).toBeVisible();
    await expect(page.getByRole('button', { name: /保存配置/ })).toBeVisible();
  });

  test('portfolio page renders account creation and sync entry points after login', async ({ page }) => {
    await login(page);

    await page.goto('/portfolio');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByRole('heading', { name: '持仓管理' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: '新建账户' })).toBeVisible();
    await expect(page.getByRole('button', { name: '新建账户' })).toBeVisible();
    await expect(page.getByText('数据同步')).toBeVisible();
  });

  test('settings system direct route is gated until admin mode is enabled, then opens the console', async ({ page }) => {
    await login(page);

    await page.goto('/settings/system');
    await page.waitForLoadState('domcontentloaded');

    const systemHeading = page.getByRole('heading', { name: '系统控制面' });
    if (await systemHeading.isVisible().catch(() => false)) {
      await expect(page.getByRole('button', { name: /保存配置/ })).toBeVisible();
      return;
    }

    await expect(
      page.getByRole('heading', { name: '请先开启管理工具再访问此页面' }),
    ).toBeVisible({ timeout: 10_000 });
    await page.getByRole('link', { name: '打开个人设置' }).click();
    await page.waitForURL(/\/settings$/, { timeout: 10_000 });
    await page.getByRole('button', { name: '打开管理工具' }).click();
    await expect(page.getByText('当前视图：管理工具')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('main').getByRole('link', { name: '独立控制台' }).click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: '系统控制面' })).toBeVisible({ timeout: 10_000 });
  });

  test('backtest page renders filter controls after login', async ({ page }) => {
    await login(page);

    await page.getByRole('link', { name: '回测' }).click();
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByRole('heading', { name: '回测', exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: '基础参数' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: '股票代码' })).toBeVisible();
    await expect(
      page.getByTestId('backtest-control-section-symbol').getByRole('button', { name: '继续' }),
    ).toBeVisible();
  });
});
