import { expect, openAdminRouteWithHarness, test } from './fixtures/adminAuth';

const desktopScenarios = [
  {
    name: 'English at 1440px',
    width: 1440,
    path: '/en/settings/system',
    labels: [
      'Ops Overview / System Settings',
      'Launch Cockpit',
      'System Logs',
      'Evidence Review',
      'Data Sources & Readiness',
      'Circuit Diagnostics',
      'Cost Observability',
      'User Governance',
      'Notification Channels',
    ],
  },
  {
    name: 'English at 1280px',
    width: 1280,
    path: '/en/settings/system',
    labels: [
      'Ops Overview / System Settings',
      'Launch Cockpit',
      'System Logs',
      'Evidence Review',
      'Data Sources & Readiness',
      'Circuit Diagnostics',
      'Cost Observability',
      'User Governance',
      'Notification Channels',
    ],
  },
  {
    name: 'English at 1024px',
    width: 1024,
    path: '/en/settings/system',
    labels: [
      'Ops Overview / System Settings',
      'Launch Cockpit',
      'System Logs',
      'Evidence Review',
      'Data Sources & Readiness',
      'Circuit Diagnostics',
      'Cost Observability',
      'User Governance',
      'Notification Channels',
    ],
  },
  {
    name: 'Chinese at 1280px',
    width: 1280,
    path: '/zh/settings/system',
    labels: [
      '运维总览/系统设置',
      'Launch Cockpit',
      '系统日志',
      '证据复核',
      '数据源与就绪度',
      '熔断诊断',
      '成本观测',
      '用户治理',
      '通知通道',
    ],
  },
] as const;

async function assertDesktopHeader(page: Parameters<typeof openAdminRouteWithHarness>[0], labels: readonly string[]) {
  const nav = page.getByTestId('shell-admin-primary-nav');
  const utility = page.getByTestId('shell-header-utility-island');
  const search = page.locator('#shell-stock-search-header');

  await expect(nav).toBeVisible();
  await expect(search).toBeVisible();
  await expect(utility).toBeVisible();
  await expect(page.getByTestId('system-settings-page')).toBeVisible();

  const geometry = await page.evaluate(() => {
    const navElement = document.querySelector<HTMLElement>('[data-testid="shell-admin-primary-nav"]');
    const utilityElement = document.querySelector<HTMLElement>('[data-testid="shell-header-utility-island"]');
    const searchElement = document.querySelector<HTMLElement>('#shell-stock-search-header');
    if (!navElement || !utilityElement || !searchElement) return null;
    const navRect = navElement.getBoundingClientRect();
    const utilityRect = utilityElement.getBoundingClientRect();
    const searchRect = searchElement.getBoundingClientRect();
    return {
      navRight: navRect.right,
      utilityLeft: utilityRect.left,
      searchLeft: searchRect.left,
      searchRight: searchRect.right,
      utilityRight: utilityRect.right,
      documentOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    };
  });

  expect(geometry).not.toBeNull();
  expect(geometry?.navRight).toBeLessThanOrEqual((geometry?.utilityLeft ?? 0) + 1);
  expect(geometry?.searchLeft).toBeGreaterThanOrEqual((geometry?.utilityLeft ?? 0) - 1);
  expect(geometry?.searchRight).toBeLessThanOrEqual((geometry?.utilityRight ?? 0) + 1);
  expect(geometry?.documentOverflow).toBe(0);

  const links = nav.getByRole('link');
  await expect(links).toHaveCount(labels.length);
  expect(await links.evaluateAll((nodes) => nodes.every((node) => (node as HTMLAnchorElement).tabIndex >= 0))).toBe(true);

  for (const label of labels) {
    const link = nav.getByRole('link', { name: label, exact: true });
    await expect(link).toBeVisible();
    await link.focus();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

    const focusMetrics = await link.evaluate((element) => {
      const navElement = element.closest<HTMLElement>('[data-testid="shell-admin-primary-nav"]');
      const utilityElement = document.querySelector<HTMLElement>('[data-testid="shell-header-utility-island"]');
      if (!navElement || !utilityElement) return null;
      const linkRect = element.getBoundingClientRect();
      const navRect = navElement.getBoundingClientRect();
      const utilityRect = utilityElement.getBoundingClientRect();
      const hit = document.elementFromPoint(linkRect.left + linkRect.width / 2, linkRect.top + linkRect.height / 2);
      return {
        focused: document.activeElement === element,
        withinNav: linkRect.left >= navRect.left - 1
          && linkRect.right <= navRect.right + 1
          && linkRect.top >= navRect.top - 1
          && linkRect.bottom <= navRect.bottom + 1,
        clearOfUtility: linkRect.right <= utilityRect.left + 1 || linkRect.left >= utilityRect.right - 1,
        unobstructed: hit === element || Boolean(hit?.closest('a') === element),
      };
    });

    expect(focusMetrics).toEqual({
      focused: true,
      withinNav: true,
      clearOfUtility: true,
      unobstructed: true,
    });
  }

  const accountTrigger = page.getByTestId('shell-account-center-entry').getByRole('button');
  await expect(accountTrigger).toBeVisible();
  await expect(accountTrigger).toBeEnabled();
  await accountTrigger.click();
  await expect(page.getByTestId('shell-account-center-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('shell-account-center-menu')).toBeHidden();

  await page.keyboard.press('Control+K');
  await expect(search).toBeFocused();
  await search.fill('AAPL');
  await expect(search).toHaveValue('AAPL');
}

for (const scenario of desktopScenarios) {
  test(`admin header navigation and search remain reachable: ${scenario.name}`, async ({ page }) => {
    test.skip(test.info().project.name.includes('mobile'), 'desktop geometry runs in the desktop browser project');
    await page.setViewportSize({ width: scenario.width, height: 900 });
    await openAdminRouteWithHarness(page, scenario.path);
    await assertDesktopHeader(page, scenario.labels);
  });
}

test('admin shell transitions continuously at the 1024px desktop breakpoint', async ({ page }) => {
  test.skip(test.info().project.name.includes('mobile'), 'breakpoint transition runs in the desktop browser project');
  await page.setViewportSize({ width: 1023, height: 900 });
  await openAdminRouteWithHarness(page, '/zh/settings/system');
  await expect(page.getByTestId('shell-mobile-strip')).toBeVisible();
  await expect(page.getByTestId('shell-admin-primary-nav')).toHaveCount(0);

  await page.getByRole('button', { name: '打开导航菜单' }).click();
  await expect(page.getByTestId('shell-mobile-navigation-menu')).toBeVisible();

  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(page.getByTestId('shell-mobile-strip')).toHaveCount(0);
  await expect(page.getByTestId('shell-admin-primary-nav')).toBeVisible();
  await expect(page.getByTestId('shell-mobile-navigation-menu')).toHaveCount(0);
});

test('Chinese mobile drawer keeps admin navigation, identity, and search usable', async ({ page }) => {
  test.skip(!test.info().project.name.includes('mobile'), 'mobile drawer runs in the mobile browser project');
  await page.setViewportSize({ width: 390, height: 844 });
  await openAdminRouteWithHarness(page, '/zh/settings/system');

  await expect(page.getByTestId('shell-mobile-strip')).toBeVisible();
  await page.getByRole('button', { name: '打开导航菜单' }).click();
  const drawer = page.getByTestId('shell-mobile-navigation-menu');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId('shell-mobile-account-center')).toContainText('Playwright Admin');

  const nav = drawer.getByTestId('shell-admin-primary-nav');
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link', { name: '运维总览/系统设置', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: '通知通道', exact: true })).toBeVisible();

  const search = drawer.locator('#shell-stock-search-drawer');
  await expect(search).toBeVisible();
  await search.fill('AAPL');
  await expect(search).toHaveValue('AAPL');
  await expect.poll(async () => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth))).toBe(0);
});
