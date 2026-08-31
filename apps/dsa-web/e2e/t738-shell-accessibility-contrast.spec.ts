import { expect, openAdminRouteWithHarness, test } from './fixtures/adminAuth';

type Rgba = { r: number; g: number; b: number; a: number };

async function inspectShell(page: Parameters<typeof openAdminRouteWithHarness>[0], selector: string) {
  return page.locator(selector).evaluate((input) => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Unable to create color parser');

    const parse = (value: string): Rgba => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    };
    const composite = (foreground: Rgba, background: Rgba): Rgba => {
      const alpha = foreground.a + background.a * (1 - foreground.a);
      if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
        g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
        b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
        a: alpha,
      };
    };
    const effectiveBackground = (element: HTMLElement): Rgba => {
      const ancestors: HTMLElement[] = [];
      for (let current: HTMLElement | null = element; current; current = current.parentElement) ancestors.push(current);
      let result = parse('rgb(0 0 0)');
      for (const current of ancestors.reverse()) {
        const background = parse(getComputedStyle(current).backgroundColor);
        if (background.a > 0) result = composite(background, result);
      }
      return result;
    };

    const inputElement = input as HTMLInputElement;
    const field = inputElement.closest<HTMLElement>('.shell-stock-search__field');
    if (!field) throw new Error('Search input is missing its canonical field owner');
    const inputStyle = getComputedStyle(inputElement);
    const placeholderStyle = getComputedStyle(inputElement, '::placeholder');
    const fieldStyle = getComputedStyle(field);
    const fieldBackground = effectiveBackground(field);
    const fieldOutside = effectiveBackground(field.parentElement ?? field);
    const utility = document.querySelector<HTMLElement>('[data-testid="shell-header-utility-island"]');
    const luminance = (color: Rgba) => {
      const channel = (value: number) => {
        const normalized = value / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    };
    const ratio = (first: Rgba, second: Rgba) => {
      const lighter = Math.max(luminance(first), luminance(second));
      const darker = Math.min(luminance(first), luminance(second));
      return (lighter + 0.05) / (darker + 0.05);
    };
    const utilityActions = [...document.querySelectorAll<HTMLElement>('.shell-header-action, .shell-account-center-trigger')].map((action) => {
      const style = getComputedStyle(action);
      return {
        text: action.textContent?.trim() ?? '',
        fontSize: style.fontSize,
        ratio: ratio(parse(style.color), effectiveBackground(action)),
      };
    });
    return {
      inputRatio: ratio(parse(inputStyle.color), fieldBackground),
      placeholderRatio: ratio(parse(placeholderStyle.color), fieldBackground),
      fieldBorderRatio: ratio(parse(fieldStyle.borderTopColor), fieldOutside),
      fieldBoxShadow: fieldStyle.boxShadow,
      inputFontSize: inputStyle.fontSize,
      utilityBackground: utility ? effectiveBackground(utility) : null,
      utilityActions,
      theme: document.documentElement.dataset.theme,
    };
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`T738 shell search and utility readability: ${theme} desktop`, async ({ page }) => {
    test.skip(test.info().project.name.includes('mobile'), 'desktop case runs in the desktop browser project');
    await page.addInitScript((selectedTheme) => {
      window.localStorage.setItem('dsa-theme-style', 'paper');
      window.localStorage.setItem('dsa-theme-mode', selectedTheme);
    }, theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAdminRouteWithHarness(page, '/en/settings/system');
    await expect(page.getByTestId('system-settings-page')).toBeVisible({ timeout: 30_000 });
    const search = page.locator('#shell-stock-search-header');
    await expect(search).toBeVisible({ timeout: 30_000 });
    const empty = await inspectShell(page, '#shell-stock-search-header');
    expect(empty.theme).toBe(theme);
    expect(empty.inputRatio).toBeGreaterThanOrEqual(4.5);
    expect(empty.placeholderRatio).toBeGreaterThanOrEqual(4.5);
    expect(Number.parseFloat(empty.inputFontSize)).toBeGreaterThanOrEqual(12);
    for (const action of empty.utilityActions) {
      expect(Number.parseFloat(action.fontSize), `${action.text} utility size`).toBeGreaterThanOrEqual(12);
      expect(action.ratio, `${action.text} utility contrast`).toBeGreaterThanOrEqual(4.5);
    }
    await search.fill('AAPL');
    const typed = await inspectShell(page, '#shell-stock-search-header');
    expect(typed.inputRatio).toBeGreaterThanOrEqual(4.5);
    await search.focus();
    const focused = await inspectShell(page, '#shell-stock-search-header');
    expect(focused.fieldBoxShadow).not.toBe('none');
    expect(focused.fieldBorderRatio).toBeGreaterThanOrEqual(3);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`T738 mobile drawer preserves readable search and identity: ${theme}`, async ({ page }) => {
    test.skip(!test.info().project.name.includes('mobile'), 'mobile case runs in the mobile browser project');
    await page.addInitScript((selectedTheme) => {
      window.localStorage.setItem('dsa-theme-style', 'paper');
      window.localStorage.setItem('dsa-theme-mode', selectedTheme);
    }, theme);
    await page.setViewportSize({ width: 390, height: 844 });
    await openAdminRouteWithHarness(page, '/zh/settings/system');
    await expect(page.getByTestId('system-settings-page')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: '打开导航菜单' }).click();
    const drawer = page.getByTestId('shell-mobile-navigation-menu');
    await expect(drawer).toBeVisible();
    const input = drawer.locator('#shell-stock-search-drawer');
    await expect(input).toBeVisible({ timeout: 30_000 });
    const evidence = await inspectShell(page, '#shell-stock-search-drawer');
    expect(evidence.theme).toBe(theme);
    expect(evidence.inputRatio).toBeGreaterThanOrEqual(4.5);
    expect(evidence.placeholderRatio).toBeGreaterThanOrEqual(4.5);
    expect(Number.parseFloat(evidence.inputFontSize)).toBeGreaterThanOrEqual(12);
    await expect(drawer.getByTestId('shell-mobile-account-center')).toContainText('Playwright Admin');
  });
}
