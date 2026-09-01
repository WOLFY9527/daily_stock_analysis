import { expect, request as apiRequest, test, type Page, type Response } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const python = process.env.PYTHON || path.join(
  repoRoot,
  '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
);

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for release qualification`);
  return value;
}

let expectedCandidateSha = '';
let environmentFingerprint = '';
let runtimeCwd = '';
let assetFingerprint = '';

let runtime: ChildProcess | undefined;
let runtimeDir = '';
let runtimeLogFd: number | undefined;
let baseUrl = '';
let adminUsername = '';
let adminPassword = '';
let memberUsername = '';
let memberPassword = '';

async function reservePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Unable to reserve a release-browser port');
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForRuntime(): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (runtime?.exitCode !== null) {
      throw new Error(`Release runtime exited before readiness (code ${runtime?.exitCode})`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health/live`);
      if (response.ok) return;
    } catch {
      // The task-owned local runtime is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Release runtime did not become live');
}

async function login(page: Page, username: string, password: string, redirect: string): Promise<void> {
  await page.goto(`${baseUrl}/zh/login?redirect=${encodeURIComponent(redirect)}`);
  await expect(page.locator('#username')).toBeVisible({ timeout: 30_000 });
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(new RegExp(`${redirect.replaceAll('/', '\\/')}$`), { timeout: 30_000 });
}

async function logoutFromShell(page: Page): Promise<Response> {
  const accountEntry = page.locator('[data-testid="shell-account-center-entry"]:visible');
  await expect(accountEntry).toHaveCount(1);
  await accountEntry.getByRole('button', { name: '账户中心' }).click();
  const menu = page.locator('[data-testid="shell-account-center-menu"]:visible');
  await menu.getByRole('menuitem', { name: '退出登录' }).click();
  const dialog = page.getByRole('dialog', { name: '退出登录' });
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/auth/logout') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: '确认退出' }).click();
  return responsePromise;
}

test.describe.serial('qualified release real runtime', () => {
  test.beforeAll(async () => {
    expectedCandidateSha = requiredEnv('WOLFYSTOCK_RELEASE_CANDIDATE_SHA');
    environmentFingerprint = requiredEnv('WOLFYSTOCK_ENV_FINGERPRINT');
    runtimeCwd = realpathSync(repoRoot);
    const webArtifact = JSON.parse(
      readFileSync(path.join(repoRoot, 'static/.wolfystock-web-build-artifact.json'), 'utf8'),
    ) as { fingerprint?: string };
    assetFingerprint = webArtifact.fingerprint ?? '';
    const observedSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    expect(observedSha).toBe(expectedCandidateSha);
    expect(runtimeCwd).toBe(repoRoot);
    expect(environmentFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(assetFingerprint).toMatch(/^[0-9a-f]{64}$/);
    runtimeDir = mkdtempSync(path.join(os.tmpdir(), 'wolfystock-release-browser-'));
    const port = await reservePort();
    baseUrl = `http://127.0.0.1:${port}`;
    const suffix = randomBytes(6).toString('hex');
    adminUsername = 'admin';
    memberUsername = `release_member_${suffix}`;
    adminPassword = randomBytes(24).toString('base64url');
    memberPassword = randomBytes(24).toString('base64url');
    const envPath = path.join(runtimeDir, '.env');
    writeFileSync(envPath, [
      'ADMIN_AUTH_ENABLED=true',
      'APP_ENV=test',
      'CRYPTO_REALTIME_ENABLED=false',
      'WOLFYSTOCK_UAT_NO_LIVE_PROVIDERS=true',
      'WOLFYSTOCK_HISTORICAL_OHLCV_RUNTIME_ENABLED=false',
      'WOLFYSTOCK_YFINANCE_US_OHLCV_CACHE_ENABLED=false',
      'STOCK_LIST=AAPL',
    ].join('\n'), 'utf8');
    const runtimeEnv = {
      ...process.env,
      ADMIN_AUTH_ENABLED: 'true',
      APP_ENV: 'test',
      CRYPTO_REALTIME_ENABLED: 'false',
      DATABASE_PATH: path.join(runtimeDir, 'release-browser.sqlite'),
      ENV_FILE: envPath,
      LOG_DIR: path.join(runtimeDir, 'logs'),
      POSTGRES_PHASE_A_URL: '',
      WOLFYSTOCK_RELEASE_ADMIN_USERNAME: adminUsername,
      WOLFYSTOCK_RELEASE_ADMIN_PASSWORD: adminPassword,
      WOLFYSTOCK_RELEASE_MEMBER_USERNAME: memberUsername,
      WOLFYSTOCK_RELEASE_MEMBER_PASSWORD: memberPassword,
      WOLFYSTOCK_UAT_NO_LIVE_PROVIDERS: 'true',
      WOLFYSTOCK_HISTORICAL_OHLCV_RUNTIME_ENABLED: 'false',
      WOLFYSTOCK_YFINANCE_US_OHLCV_CACHE_ENABLED: 'false',
    };
    execFileSync(python, [path.join(repoRoot, 'scripts/release_runtime_fixture.py')], {
      cwd: repoRoot,
      env: runtimeEnv,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    runtimeLogFd = openSync(path.join(runtimeDir, 'runtime.log'), 'a');
    runtime = spawn(
      python,
      [path.join(repoRoot, 'main.py'), '--serve-only', '--host', '127.0.0.1', '--port', String(port)],
      {
        cwd: repoRoot,
        env: runtimeEnv,
        stdio: ['ignore', runtimeLogFd, runtimeLogFd],
        windowsHide: true,
      },
    );
    await waitForRuntime();
  });

  test.afterAll(async () => {
    if (runtime && runtime.exitCode === null) {
      runtime.kill();
      await new Promise<void>((resolve) => {
        runtime?.once('exit', () => resolve());
        setTimeout(resolve, 5_000);
      });
    }
    if (runtimeLogFd !== undefined) closeSync(runtimeLogFd);
    if (runtimeDir) rmSync(runtimeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  });

  test('production startup readiness and static assets', async ({ page }) => {
    const live = await page.request.get(`${baseUrl}/api/health/live`);
    const readiness = await page.request.get(`${baseUrl}/api/health/ready`);
    const root = await page.request.get(`${baseUrl}/`);
    expect(live.status()).toBe(200);
    expect(readiness.status()).toBe(200);
    expect(root.status()).toBe(200);
    expect(runtime?.spawnargs).toContain(path.join(repoRoot, 'main.py'));
    expect(runtime?.spawnargs).toContain('--serve-only');
    const html = await root.text();
    const assetPath = html.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1];
    expect(assetPath).toBeTruthy();
    const asset = await page.request.get(`${baseUrl}${assetPath}`);
    expect(asset.status()).toBe(200);
    expect((await asset.body()).byteLength).toBeGreaterThan(0);
  });

  test('login logout and revoked session', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await login(page, adminUsername, adminPassword, '/zh/admin/logs');
      const session = (await context.cookies(baseUrl)).find((cookie) => cookie.name === 'dsa_session');
      expect(session).toBeTruthy();
      const logout = await logoutFromShell(page);
      expect(logout.status()).toBe(204);
      await expect(page).toHaveURL(/\/zh\/guest$/, { timeout: 30_000 });
      const replay = await apiRequest.newContext({
        baseURL: baseUrl,
        extraHTTPHeaders: { Cookie: `dsa_session=${session!.value}` },
      });
      try {
        expect((await replay.get('/api/v1/admin/users')).status()).toBe(401);
      } finally {
        await replay.dispose();
      }
    } finally {
      await context.close();
    }
  });

  test('member admin boundary and portfolio read', async ({ browser }) => {
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    try {
      await login(memberPage, memberUsername, memberPassword, '/zh/portfolio');
      expect((await memberPage.request.get(`${baseUrl}/api/v1/admin/users`)).status()).toBe(403);
      const portfolio = await memberPage.request.get(`${baseUrl}/api/v1/portfolio/accounts`);
      expect(portfolio.status()).toBe(200);
      expect((await portfolio.json()).accounts).toEqual([]);
      await expect(memberPage.getByTestId('portfolio-permission-limited-state')).toHaveCount(0);
      await expect(memberPage.getByTestId('portfolio-empty-onboarding-row')).toBeVisible();
      const onboarding = memberPage.getByTestId('portfolio-empty-actions');
      const createAccountAction = onboarding.getByRole('button', { name: /创建账户|新建账户/ });
      await expect(createAccountAction).toBeEnabled();
      await createAccountAction.click();
      const accountForm = memberPage.locator('form').filter({ has: memberPage.getByLabel('账户名称') });
      await expect(accountForm).toBeVisible();
      const memberAccountName = `Release member account ${memberUsername}`;
      await memberPage.getByLabel('账户名称').fill(memberAccountName);
      const createResponsePromise = memberPage.waitForResponse(
        (response) => response.url().endsWith('/api/v1/portfolio/accounts') && response.request().method() === 'POST',
      );
      await accountForm.getByRole('button', { name: /创建账户|新建账户/ }).click();
      const createResponse = await createResponsePromise;
      expect(createResponse.status()).toBe(200);
      const renderedAccountNames = memberPage.getByTestId('portfolio-total-assets-card').getByText(memberAccountName, { exact: true });
      await expect(renderedAccountNames).not.toHaveCount(0);
      await expect(renderedAccountNames.first()).toBeVisible();
      const createdAccounts = await memberPage.request.get(`${baseUrl}/api/v1/portfolio/accounts`);
      expect(createdAccounts.status()).toBe(200);
      expect((await createdAccounts.json()).accounts).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: memberAccountName })]),
      );

      await login(adminPage, adminUsername, adminPassword, '/zh/admin/logs');
      expect((await adminPage.request.get(`${baseUrl}/api/v1/admin/users`)).status()).toBe(200);
      const ops = await adminPage.request.get(`${baseUrl}/api/v1/admin/ops/status`);
      expect(ops.status()).toBe(200);
      expect((await ops.json()).buildProvenance.backendGitSha).toBe(expectedCandidateSha);
    } finally {
      await memberContext.close();
      await adminContext.close();
    }
  });

  test('professional backtest parsing preserves explicit identity and rejects unqualified indicator prose', async ({ page }) => {
    const pageErrors: Error[] = [];
    const consoleErrors: string[] = [];
    let parseRequestCount = 0;
    let parse5xx = 0;
    let ruleRunRequests = 0;
    let mainFrameNavigations = 0;
    page.on('pageerror', (error) => pageErrors.push(error));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('request', (request) => {
      if (request.url().endsWith('/api/v1/backtest/rule/parse') && request.method() === 'POST') {
        parseRequestCount += 1;
      }
      if (request.url().endsWith('/api/v1/backtest/rule/run') && request.method() === 'POST') {
        ruleRunRequests += 1;
      }
    });
    page.on('response', (response) => {
      if (response.url().endsWith('/api/v1/backtest/rule/parse') && response.request().method() === 'POST' && response.status() >= 500) {
        parse5xx += 1;
      }
    });
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) mainFrameNavigations += 1;
    });

    await login(page, memberUsername, memberPassword, '/en/backtest');
    await page.getByRole('tab', { name: 'Research diagnostics' }).click();
    await expect(page.getByTestId('pro-backtest-workspace')).toBeVisible();
    await page.getByTestId('pro-workflow-step-assets').click();
    const assetsStep = page.getByTestId('pro-step-assets');
    await expect(assetsStep).toBeVisible();
    const ticker = assetsStep.getByLabel('Ticker');
    await expect(ticker).toHaveValue('');
    await page.getByTestId('pro-workflow-step-strategy').click();
    const strategyStep = page.getByTestId('pro-step-strategy');
    await expect(strategyStep).toBeVisible();

    const strategyText = page.getByLabel('Strategy text');
    const confirmation = strategyStep.getByLabel('Confirm parse result');
    const execute = page.getByRole('button', { name: 'Execute backtest task' });
    const indicatorStrategy = 'RSI below 30 buy and RSI above 70 sell';
    await strategyText.fill(indicatorStrategy);

    const beforeMissingParseNavigations = mainFrameNavigations;
    const missingParsePromise = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/backtest/rule/parse') && response.request().method() === 'POST',
    );
    await strategyStep.getByRole('button', { name: 'Parse strategy' }).click();
    const missingParse = await missingParsePromise;
    const missingRequest = missingParse.request().postDataJSON() as Record<string, unknown>;
    const missingPayload = await missingParse.json() as Record<string, unknown>;
    const missingParsed = missingPayload.parsed_strategy as Record<string, unknown>;
    const missingSpec = missingParsed.strategy_spec as Record<string, unknown>;
    const missingDetails = missingPayload.unsupported_details as Array<Record<string, unknown>>;

    expect(missingParse.status()).toBe(200);
    expect(missingRequest).toMatchObject({ strategy_text: indicatorStrategy });
    expect(missingRequest).not.toHaveProperty('code');
    expect(missingPayload.code).toBeNull();
    expect(missingPayload.executable).toBe(false);
    expect(missingPayload.normalization_state).toBe('unsupported');
    expect(missingSpec).not.toHaveProperty('symbol');
    expect(missingDetails.map((item) => item.code)).toContain('unsupported_missing_symbol');
    expect(missingDetails.map((item) => item.code)).not.toContain('unsupported_multi_symbol');
    await expect(page.getByTestId('pro-unsupported-guidance')).toBeVisible();
    await expect(page.getByTestId('pro-execution-rail')).toContainText('--');
    await expect(confirmation).toBeDisabled();
    await expect(execute).toBeDisabled();
    expect(mainFrameNavigations).toBe(beforeMissingParseNavigations);

    await strategyStep.getByRole('button', { name: 'Reset' }).click();
    await page.getByTestId('pro-workflow-step-assets').click();
    await expect(assetsStep).toBeVisible();
    await ticker.fill('AAPL');
    await page.getByTestId('pro-workflow-step-strategy').click();
    await expect(strategyStep).toBeVisible();
    await strategyText.fill(indicatorStrategy);

    const beforeExplicitParseNavigations = mainFrameNavigations;
    const explicitParsePromise = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/backtest/rule/parse') && response.request().method() === 'POST',
    );
    await strategyStep.getByRole('button', { name: 'Parse strategy' }).click();
    const explicitParse = await explicitParsePromise;
    const explicitRequest = explicitParse.request().postDataJSON() as Record<string, unknown>;
    const explicitPayload = await explicitParse.json() as Record<string, unknown>;
    const explicitParsed = explicitPayload.parsed_strategy as Record<string, unknown>;
    const explicitSpec = explicitParsed.strategy_spec as Record<string, unknown>;
    const explicitDetails = explicitPayload.unsupported_details as Array<Record<string, unknown>>;

    expect(explicitParse.status()).toBe(200);
    expect(explicitRequest).toMatchObject({ code: 'AAPL', strategy_text: indicatorStrategy });
    expect(explicitPayload.code).toBe('AAPL');
    expect(explicitPayload.executable).toBe(true);
    expect(explicitSpec.symbol).toBe('AAPL');
    expect(explicitDetails.map((item) => item.code)).not.toContain('unsupported_multi_symbol');
    await expect(page.getByTestId('pro-unsupported-guidance')).toHaveCount(0);
    await expect(page.getByTestId('pro-execution-rail')).toContainText('AAPL');
    await expect(confirmation).toBeEnabled();
    await confirmation.check();
    await expect(execute).toBeEnabled();
    expect(mainFrameNavigations).toBe(beforeExplicitParseNavigations);
    expect(parseRequestCount).toBeGreaterThanOrEqual(2);
    expect(parse5xx).toBe(0);
    expect(ruleRunRequests).toBe(0);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    await expect(page).toHaveURL(/\/en\/backtest$/);
    expect((await page.context().cookies(baseUrl)).some((cookie) => cookie.name === 'dsa_session')).toBe(true);
  });

  test('rollback error preserves portfolio state and exposes unavailable data', async ({ page }) => {
    await login(page, memberUsername, memberPassword, '/zh/portfolio');
    const before = await page.evaluate(async () => (await fetch('/api/v1/portfolio/accounts')).json());
    const rejected = await page.evaluate(async () => {
      const response = await fetch('/api/v1/portfolio/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Rejected release account',
          market: 'us',
          base_currency: 'USD',
          owner_id: 'different-owner',
        }),
      });
      return { status: response.status, body: await response.json() };
    });
    const after = await page.evaluate(async () => (await fetch('/api/v1/portfolio/accounts')).json());
    expect(rejected.status).toBe(400);
    expect(JSON.stringify(rejected.body)).not.toMatch(/traceback|token|password|private key/i);
    expect(after).toEqual(before);

    const capabilityResponse = await page.request.get(`${baseUrl}/api/v1/market/professional-data-capabilities`);
    expect(capabilityResponse.status()).toBe(200);
    expect(JSON.stringify(await capabilityResponse.json())).toMatch(/unavailable|stale/i);
  });
});
