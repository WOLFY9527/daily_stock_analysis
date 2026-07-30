import { expect, test, type BrowserContextOptions, type ConsoleMessage, type Page, type TestInfo } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const webRoot = path.join(repoRoot, 'apps', 'dsa-web');
const python = process.env.PYTHON || path.join(
  repoRoot,
  '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

type JourneyDiagnostics = {
  authHttpErrors: string[];
  consoleErrors: string[];
  dataConsoleErrors: string[];
  dataHttpErrors: string[];
  failedRequests: string[];
  pageErrors: string[];
  unexpectedHttpErrors: string[];
};

const stockDataNotFoundConsole = 'Failed to load resource: the server responded with a status of 404 (Not Found)';

let backend: ChildProcess | undefined;
let frontend: ChildProcess | undefined;
let runtimeDir = '';
let appUrl = '';

async function reservePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Unable to reserve a local browser-test port');
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForHttp(url: string, processes: ChildProcess[]): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const exited = processes.find((process) => process.exitCode !== null);
    if (exited) {
      throw new Error(`Local browser runtime exited before readiness (code ${exited.exitCode})`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The isolated local runtime is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Local browser runtime did not become ready: ${url}`);
}

async function stopProcess(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return;

  try {
    if (process.platform !== 'win32' && child.pid) {
      process.kill(-child.pid, 'SIGTERM');
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    child.kill('SIGTERM');
  }

  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

function projectContextOptions(testInfo: TestInfo): BrowserContextOptions {
  const { colorScheme, deviceScaleFactor, hasTouch, isMobile, locale, reducedMotion, screen, timezoneId, userAgent, viewport } = testInfo.project.use;
  const options: BrowserContextOptions = {};

  if (colorScheme) options.colorScheme = colorScheme;
  if (deviceScaleFactor) options.deviceScaleFactor = deviceScaleFactor;
  if (hasTouch) options.hasTouch = hasTouch;
  if (isMobile) options.isMobile = isMobile;
  if (locale) options.locale = locale;
  if (reducedMotion) options.reducedMotion = reducedMotion;
  if (screen) options.screen = screen;
  if (timezoneId) options.timezoneId = timezoneId;
  if (userAgent) options.userAgent = userAgent;
  if (viewport) options.viewport = viewport;

  return options;
}

function isExpectedNavigationAbort(method: string, errorText: string): boolean {
  return method === 'GET' && errorText === 'net::ERR_ABORTED';
}

function isStockDataPath(pathname: string): boolean {
  return pathname.startsWith('/api/v1/analysis/')
    || pathname.startsWith('/api/v1/market/')
    || pathname.startsWith('/api/v1/stocks/');
}

function stockDataNotFoundLocation(message: ConsoleMessage): string | null {
  if (message.type() !== 'error' || message.text() !== stockDataNotFoundConsole) return null;

  const location = message.location().url;
  if (!location) return null;

  const url = new URL(location);
  return isStockDataPath(url.pathname) ? `${url.pathname}${url.search}` : null;
}

function observeJourney(page: Page): JourneyDiagnostics {
  const diagnostics: JourneyDiagnostics = {
    authHttpErrors: [],
    consoleErrors: [],
    dataConsoleErrors: [],
    dataHttpErrors: [],
    failedRequests: [],
    pageErrors: [],
    unexpectedHttpErrors: [],
  };

  page.on('console', (message) => {
    const stockDataLocation = stockDataNotFoundLocation(message);
    if (stockDataLocation) {
      diagnostics.dataConsoleErrors.push(stockDataLocation);
    } else if (message.type() === 'error' && !message.text().includes('favicon.ico')) {
      diagnostics.consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText || 'unknown failure';
    if (!isExpectedNavigationAbort(request.method(), errorText)) {
      diagnostics.failedRequests.push(`${request.method()} ${request.url()} ${errorText}`);
    }
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;

    const url = new URL(response.url());
    const outcome = `${response.request().method()} ${response.status()} ${url.pathname}${url.search}`;
    if (url.pathname.startsWith('/api/v1/auth/')) {
      diagnostics.authHttpErrors.push(outcome);
    } else if (isStockDataPath(url.pathname)) {
      diagnostics.dataHttpErrors.push(outcome);
    } else if (!url.pathname.endsWith('/favicon.ico')) {
      diagnostics.unexpectedHttpErrors.push(outcome);
    }
  });

  return diagnostics;
}

function expectHealthyAuthJourney(diagnostics: JourneyDiagnostics): void {
  expect(diagnostics.authHttpErrors).toEqual([]);
  expect(diagnostics.consoleErrors).toEqual([]);
  expect(diagnostics.dataConsoleErrors).toEqual(
    diagnostics.dataHttpErrors
      .filter((outcome) => outcome.startsWith('GET 404 '))
      .map((outcome) => outcome.slice('GET 404 '.length)),
  );
  expect(diagnostics.failedRequests).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.unexpectedHttpErrors).toEqual([]);
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'wolfystock-t694-r12-browser-'));
  const envPath = path.join(runtimeDir, '.env');
  await writeFile(envPath, [
    'ADMIN_AUTH_ENABLED=false',
    'APP_ENV=test',
    'CRYPTO_REALTIME_ENABLED=false',
    'WOLFYSTOCK_UAT_NO_LIVE_PROVIDERS=true',
    'WOLFYSTOCK_HISTORICAL_OHLCV_RUNTIME_ENABLED=false',
    'WOLFYSTOCK_YFINANCE_US_OHLCV_CACHE_ENABLED=false',
    'STOCK_LIST=600519',
  ].join('\n'), 'utf8');

  const backendPort = await reservePort();
  let frontendPort = await reservePort();
  while (frontendPort === backendPort) frontendPort = await reservePort();
  const backendUrl = `http://127.0.0.1:${backendPort}`;
  appUrl = `http://127.0.0.1:${frontendPort}`;

  const viteConfigPath = path.join(runtimeDir, 'vite.t694-r12.config.ts');
  await writeFile(viteConfigPath, [
    `import base from ${JSON.stringify(path.join(webRoot, 'vite.config.ts'))}`,
    'export default {',
    '  ...base,',
    `  cacheDir: ${JSON.stringify(path.join(runtimeDir, 'vite-cache'))},`,
    '  server: {',
    '    ...(base.server || {}),',
    "    host: '127.0.0.1',",
    `    port: ${frontendPort},`,
    '    strictPort: true,',
    `    proxy: { '/api': { target: ${JSON.stringify(backendUrl)}, changeOrigin: true } },`,
    '  },',
    '}',
  ].join('\n'), 'utf8');

  backend = spawn(python, [
    '-m',
    'uvicorn',
    'api.app:app',
    '--host',
    '127.0.0.1',
    '--port',
    String(backendPort),
    '--log-level',
    'warning',
  ], {
    cwd: repoRoot,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      ADMIN_AUTH_ENABLED: 'false',
      APP_ENV: 'test',
      CRYPTO_REALTIME_ENABLED: 'false',
      DATABASE_PATH: path.join(runtimeDir, 't694-r12-auth-browser.sqlite'),
      ENV_FILE: envPath,
      LOG_DIR: path.join(runtimeDir, 'logs'),
      POSTGRES_PHASE_A_URL: '',
      WOLFYSTOCK_UAT_NO_LIVE_PROVIDERS: 'true',
      WOLFYSTOCK_HISTORICAL_OHLCV_RUNTIME_ENABLED: 'false',
      WOLFYSTOCK_YFINANCE_US_OHLCV_CACHE_ENABLED: 'false',
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  await waitForHttp(`${backendUrl}/api/health/live`, [backend]);

  frontend = spawn(npm, [
    '--prefix',
    webRoot,
    'run',
    'dev',
    '--',
    '--config',
    viteConfigPath,
  ], {
    cwd: repoRoot,
    detached: process.platform !== 'win32',
    env: process.env,
    stdio: 'ignore',
    windowsHide: true,
  });
  await waitForHttp(appUrl, [backend, frontend]);
});

test.afterAll(async () => {
  await stopProcess(frontend);
  await stopProcess(backend);
  if (runtimeDir) {
    await rm(runtimeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
});

test('qualifies stock search navigation against the managed runtime', async ({ browser, page }, testInfo) => {
  test.setTimeout(120_000);
  const canonicalPath = '/zh/stocks/600519/structure-decision?symbol=600519&source=manual#evidence';
  const legacyPath = '/zh/stock/600519?symbol=600519&source=manual#evidence';
  const adminPassword = randomBytes(24).toString('base64url');

  const setupContext = await browser.newContext(projectContextOptions(testInfo));
  const setupPage = await setupContext.newPage();
  const setupDiagnostics = observeJourney(setupPage);
  try {
    await setupPage.goto(`${appUrl}/zh/login?redirect=%2Fzh`, { waitUntil: 'domcontentloaded' });
    await expect(setupPage.locator('#passwordConfirm')).toBeVisible({ timeout: 30_000 });
    await expect(setupPage.locator('#username')).toHaveCount(0);
    await setupPage.locator('#password').fill(adminPassword);
    await setupPage.locator('#passwordConfirm').fill(adminPassword);
    const initializeResponsePromise = setupPage.waitForResponse(
      (response) => response.url().endsWith('/api/v1/auth/settings') && response.request().method() === 'POST',
    );
    await setupPage.locator('button[type="submit"]').click();
    expect((await initializeResponsePromise).status()).toBe(200);
    await expect(setupPage).toHaveURL(`${appUrl}/zh`, { timeout: 30_000 });
  } finally {
    await setupContext.close();
  }
  expectHealthyAuthJourney(setupDiagnostics);

  const canonicalDiagnostics = observeJourney(page);
  await page.goto(`${appUrl}${canonicalPath}`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(`${appUrl}${canonicalPath}`);
  await expect(page.getByTestId('auth-guard-overlay')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('consumer-protected-frame')).toHaveAttribute('data-boundary-family', 'consumer-protected');
  await expect(page.getByTestId('stock-structure-decision-page')).toHaveCount(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(`${appUrl}${canonicalPath}`);
  await expect(page.getByTestId('auth-guard-overlay')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('stock-structure-decision-page')).toHaveCount(0);

  await page.goto(`${appUrl}/zh`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(`${appUrl}/zh`);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(`${appUrl}${canonicalPath}`);
  await expect(page.getByTestId('auth-guard-overlay')).toBeVisible({ timeout: 30_000 });

  const legacyContext = await browser.newContext(projectContextOptions(testInfo));
  const legacyPage = await legacyContext.newPage();
  const legacyDiagnostics = observeJourney(legacyPage);
  try {
    await legacyPage.goto(`${appUrl}${legacyPath}`, { waitUntil: 'domcontentloaded' });
    await expect(legacyPage).toHaveURL(`${appUrl}${canonicalPath}`);
    await expect(legacyPage.getByTestId('auth-guard-overlay')).toBeVisible({ timeout: 30_000 });
    await expect(legacyPage.getByTestId('consumer-protected-frame')).toHaveAttribute('data-boundary-family', 'consumer-protected');
    await expect(legacyPage.getByTestId('stock-structure-decision-page')).toHaveCount(0);
  } finally {
    await legacyContext.close();
  }
  expectHealthyAuthJourney(legacyDiagnostics);

  const primaryAction = page.getByTestId('auth-guard-primary-action');
  await expect(primaryAction).toBeVisible();
  const href = await primaryAction.getAttribute('href');
  expect(href).not.toBeNull();
  const loginUrl = new URL(href as string, appUrl);
  expect(loginUrl.origin).toBe(new URL(appUrl).origin);
  expect(loginUrl.pathname).toBe('/zh/login');
  expect(loginUrl.searchParams.get('redirect')).toBe(canonicalPath);

  await primaryAction.click();
  await expect(page.locator('#username')).toBeVisible({ timeout: 30_000 });
  const returnedLoginUrl = new URL(page.url());
  expect(returnedLoginUrl.origin).toBe(new URL(appUrl).origin);
  expect(returnedLoginUrl.pathname).toBe('/zh/login');
  expect(returnedLoginUrl.searchParams.get('redirect')).toBe(canonicalPath);

  await page.locator('#username').fill('admin');
  await page.locator('#password').fill(adminPassword);
  const loginResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST',
  );
  await page.locator('button[type="submit"]').click();
  expect((await loginResponsePromise).status()).toBe(200);
  await expect(page).toHaveURL(`${appUrl}${canonicalPath}`, { timeout: 30_000 });
  await expect(page.getByTestId('auth-guard-overlay')).toHaveCount(0);
  await expect(page.locator([
    '[data-testid="stock-structure-decision-loading"]',
    '[data-testid="stock-structure-decision-page"]',
    '[data-testid="stock-structure-unavailable-state"]',
    '[data-testid="stock-structure-symbol-not-found-state"]',
  ].join(', ')).first()).toBeVisible({ timeout: 30_000 });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(`${appUrl}${canonicalPath}`);
  await expect(page.getByTestId('auth-guard-overlay')).toHaveCount(0);
  await expect(page.locator([
    '[data-testid="stock-structure-decision-loading"]',
    '[data-testid="stock-structure-decision-page"]',
    '[data-testid="stock-structure-unavailable-state"]',
    '[data-testid="stock-structure-symbol-not-found-state"]',
  ].join(', ')).first()).toBeVisible({ timeout: 30_000 });

  const authStatus = await page.evaluate(async () => {
    const response = await fetch('/api/v1/auth/status');
    if (!response.ok) throw new Error(`auth status failed with ${response.status}`);
    return response.json();
  });
  expect(authStatus).toMatchObject({
    authEnabled: true,
    loggedIn: true,
    currentUser: { username: 'admin', isAuthenticated: true },
  });
  expectHealthyAuthJourney(canonicalDiagnostics);
  console.log(JSON.stringify({
    canonicalPath,
    canonicalDiagnostics,
    legacyPath,
    legacyDiagnostics,
  }));
});
