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
let r06FixtureEnvironment: Record<string, string> = {};

function seedR06NonliveScannerFixture(runRoot: string): Record<string, string> {
  const descriptor = path.join(repoRoot, 'tests', 'fixtures', 'scanner', 'r06_nonlive_us_data_ready_v1.json');
  const output = execFileSync(
    python,
    [
      path.join(repoRoot, 'scripts', 'seed_r06_nonlive_scanner_fixture.py'),
      '--run-root', runRoot,
      '--descriptor', descriptor,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        APP_ENV: 'test',
        WOLFYSTOCK_UAT_NO_LIVE_PROVIDERS: 'true',
        WOLFYSTOCK_UAT_LIVE_PROVIDER_ALLOWLIST: '',
        WOLFYSTOCK_HISTORICAL_OHLCV_RUNTIME_ENABLED: 'false',
        WOLFYSTOCK_YFINANCE_US_OHLCV_CACHE_ENABLED: 'false',
      },
    },
  );
  const payload = JSON.parse(output) as { environment?: Record<string, unknown> };
  const environment = payload.environment;
  if (!environment || typeof environment !== 'object') {
    throw new Error('R06 fixture seed emitted no environment contract');
  }
  const values = Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  if (!values.WOLFYSTOCK_R06_NONLIVE_SCANNER_FIXTURE_MANIFEST_SHA256) {
    throw new Error('R06 fixture seed emitted an incomplete environment contract');
  }
  return values;
}

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

function runtimeLogTail(): string {
  if (!runtimeDir) return 'runtime log unavailable';
  try {
    let tail = readFileSync(path.join(runtimeDir, 'runtime.log'), 'utf8').slice(-12 * 1024);
    for (const secret of [adminPassword, memberPassword]) {
      if (secret) tail = tail.replaceAll(secret, '[REDACTED]');
    }
    return tail
      .replace(/(Authorization:\s*Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
      .replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
      || 'runtime log empty';
  } catch {
    return 'runtime log unavailable';
  }
}

async function waitForRuntime(): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (runtime?.exitCode !== null) {
      throw new Error(`Release runtime exited before readiness (code ${runtime?.exitCode})\nRuntime log tail:\n${runtimeLogTail()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health/live`);
      if (response.ok) return;
    } catch {
      // The task-owned local runtime is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Release runtime did not become live\nRuntime log tail:\n${runtimeLogTail()}`);
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
  const mobileStrip = page.getByTestId('shell-mobile-strip');
  if (await mobileStrip.isVisible().catch(() => false)) {
    await mobileStrip.getByRole('button', { name: '打开导航菜单' }).click();
    const drawer = page.getByRole('dialog', { name: '导航菜单' });
    await expect(drawer).toBeVisible();
    await drawer.getByTestId('shell-mobile-account-center').getByRole('button', { name: '退出登录' }).click();
  } else {
    const accountEntry = page.locator('[data-testid="shell-account-center-entry"]:visible');
    await expect(accountEntry).toHaveCount(1);
    await accountEntry.getByRole('button', { name: '账户中心' }).click();
    const menu = page.locator('[data-testid="shell-account-center-menu"]:visible');
    await menu.getByRole('menuitem', { name: '退出登录' }).click();
  }
  const dialog = page.getByRole('dialog', { name: '退出登录' });
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/auth/logout') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: '确认退出' }).click();
  return responsePromise;
}

async function selectProfessionalWorkflowStep(page: Page, testId: string): Promise<void> {
  const mobileStep = page.getByTestId(`${testId}-mobile`);
  if (await mobileStep.isVisible().catch(() => false)) {
    await mobileStep.click();
    return;
  }
  await page.getByTestId(testId).click();
}

function projectPublicParseIdentity(payload: Record<string, unknown>) {
  const parsedStrategy = payload.parsed_strategy;
  const parsed = parsedStrategy && typeof parsedStrategy === 'object' && !Array.isArray(parsedStrategy)
    ? parsedStrategy as Record<string, unknown>
    : {};
  const strategySpec = parsed.strategy_spec;
  const setup = parsed.setup;
  return {
    responseCode: payload.code,
    strategySpec,
    strategySpecSymbol: strategySpec && typeof strategySpec === 'object' && !Array.isArray(strategySpec)
      ? (strategySpec as Record<string, unknown>).symbol
      : undefined,
    setup,
    setupSymbol: setup && typeof setup === 'object' && !Array.isArray(setup)
      ? (setup as Record<string, unknown>).symbol
      : undefined,
  };
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
    r06FixtureEnvironment = seedR06NonliveScannerFixture(path.join(runtimeDir, 'r06-nonlive-scanner-fixture'));
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
      ...Object.entries(r06FixtureEnvironment).map(([key, value]) => `${key}=${value}`),
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
      ...r06FixtureEnvironment,
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
    await selectProfessionalWorkflowStep(page, 'pro-workflow-step-assets');
    const assetsStep = page.getByTestId('pro-step-assets');
    await expect(assetsStep).toBeVisible();
    const ticker = assetsStep.getByLabel('Ticker');
    await expect(ticker).toHaveValue('');
    await selectProfessionalWorkflowStep(page, 'pro-workflow-step-strategy');
    const strategyStep = page.getByTestId('pro-step-strategy');
    await expect(strategyStep).toBeVisible();

    const strategyText = page.getByLabel('Strategy text');
    const confirmation = strategyStep.getByLabel('Confirm parse result');
    const mobileExecutionSummary = page.getByTestId('pro-mobile-execution-summary');
    const execute = await mobileExecutionSummary.isVisible().catch(() => false)
      ? mobileExecutionSummary.getByRole('button', { name: 'Execute backtest task' })
      : page.getByTestId('pro-execution-rail').getByRole('button', { name: 'Execute backtest task' });
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
    const missingIdentity = projectPublicParseIdentity(missingPayload);
    const missingDetails = missingPayload.unsupported_details as Array<Record<string, unknown>>;

    expect(missingParse.status()).toBe(200);
    expect(missingRequest).toMatchObject({ strategy_text: indicatorStrategy });
    expect(missingRequest).not.toHaveProperty('code');
    expect(missingIdentity.responseCode).toBeNull();
    expect(missingPayload.executable).toBe(false);
    expect(missingPayload.normalization_state).toBe('unsupported');
    expect(missingIdentity.strategySpec).not.toBeNull();
    expect(typeof missingIdentity.strategySpec).toBe('object');
    expect(Array.isArray(missingIdentity.strategySpec)).toBe(false);
    expect(missingIdentity.setup).not.toBeNull();
    expect(typeof missingIdentity.setup).toBe('object');
    expect(Array.isArray(missingIdentity.setup)).toBe(false);
    expect([null, undefined]).toContain(missingIdentity.strategySpecSymbol);
    expect([null, undefined]).toContain(missingIdentity.setupSymbol);
    for (const fabricatedIdentity of ['BUY', 'SELL', 'RSI', 'NONE', 'MOMENTUM']) {
      expect(missingIdentity.responseCode).not.toBe(fabricatedIdentity);
      expect(missingIdentity.strategySpecSymbol).not.toBe(fabricatedIdentity);
      expect(missingIdentity.setupSymbol).not.toBe(fabricatedIdentity);
    }
    expect(missingDetails.map((item) => item.code)).toContain('unsupported_missing_symbol');
    expect(missingDetails.map((item) => item.code)).not.toContain('unsupported_multi_symbol');
    await expect(page.getByTestId('pro-unsupported-guidance')).toBeVisible();
    await expect(page.getByTestId('pro-execution-rail')).toContainText('--');
    await expect(confirmation).toBeDisabled();
    await expect(execute).toBeDisabled();
    expect(mainFrameNavigations).toBe(beforeMissingParseNavigations);

    await strategyStep.getByRole('button', { name: 'Reset' }).click();
    await selectProfessionalWorkflowStep(page, 'pro-workflow-step-assets');
    await expect(assetsStep).toBeVisible();
    await ticker.fill('AAPL');
    await selectProfessionalWorkflowStep(page, 'pro-workflow-step-strategy');
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
    const explicitIdentity = projectPublicParseIdentity(explicitPayload);
    const explicitDetails = explicitPayload.unsupported_details as Array<Record<string, unknown>>;

    expect(explicitParse.status()).toBe(200);
    expect(explicitRequest).toMatchObject({ code: 'AAPL', strategy_text: indicatorStrategy });
    expect(explicitIdentity.responseCode).toBe('AAPL');
    expect(explicitPayload.executable).toBe(true);
    expect(explicitIdentity.strategySpec).not.toBeNull();
    expect(typeof explicitIdentity.strategySpec).toBe('object');
    expect(Array.isArray(explicitIdentity.strategySpec)).toBe(false);
    expect(explicitIdentity.strategySpecSymbol).toBe('AAPL');
    expect([null, undefined, 'AAPL']).toContain(explicitIdentity.setupSymbol);
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

  test('member core research loop persists qualification-only truth across scanner research watchlist backtest portfolio and admin', async ({ browser }) => {
    test.setTimeout(60_000);
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const pageErrors: Error[] = [];
    const consoleErrors: string[] = [];
    const adminPageErrors: Error[] = [];
    const adminConsoleErrors: string[] = [];
    memberPage.on('pageerror', (error) => pageErrors.push(error));
    memberPage.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    adminPage.on('pageerror', (error) => adminPageErrors.push(error));
    adminPage.on('console', (message) => {
      if (message.type() === 'error') adminConsoleErrors.push(message.text());
    });
    try {
      await login(memberPage, memberUsername, memberPassword, '/zh/scanner');
      await memberPage.getByTestId('scanner-market-toggle').getByRole('button', { name: '美股', exact: true }).click();
      const scannerRunButton = memberPage.getByTestId('scanner-run-button');
      await expect(scannerRunButton).toBeVisible();
      const scannerRunResponsePromise = memberPage.waitForResponse(
        (response) => response.url().endsWith('/api/v1/scanner/run') && response.request().method() === 'POST',
      );
      await scannerRunButton.click();
      const scannerRunResponse = await scannerRunResponsePromise;
      const scannerRun = await scannerRunResponse.json() as Record<string, unknown>;
      expect(scannerRunResponse.status()).toBe(200);
      expect(scannerRun).toMatchObject({
        market: 'us',
        profile: 'us_preopen_v1',
        status: 'completed',
        diagnostics: {
          dataReadiness: {
            state: 'partial',
            candidateGenerationState: 'degraded',
            candidateGenerationLimitations: expect.arrayContaining(['fixture_evidence']),
          },
        },
      });
      expect(r06FixtureEnvironment.WOLFYSTOCK_R06_NONLIVE_SCANNER_FIXTURE_MANIFEST_SHA256).toMatch(/^[0-9a-f]{64}$/);
      const scannerRunId = Number(scannerRun.id);
      expect(scannerRunId).toBeGreaterThan(0);
      const scannerDetail = await memberPage.evaluate(async (runId) => {
        const response = await fetch(`/api/v1/scanner/runs/${runId}`);
        return { status: response.status, payload: await response.json() };
      }, scannerRunId);
      expect(scannerDetail.status).toBe(200);
      const candidates = (scannerDetail.payload as Record<string, unknown>).candidates;
      expect(candidates).toEqual(expect.arrayContaining([expect.objectContaining({ symbol: 'AAPL' })]));
      const aaplCandidate = (candidates as unknown[]).find(
        (candidate) => candidate !== null
          && typeof candidate === 'object'
          && (candidate as Record<string, unknown>).symbol === 'AAPL',
      ) as Record<string, unknown> | undefined;
      expect(aaplCandidate).toMatchObject({
        symbol: 'AAPL',
        rank: expect.any(Number),
        score: null,
      });
      const historicalReadiness = aaplCandidate?.historicalOhlcvReadiness as Record<string, unknown> | undefined;
      const backtestEndDate = typeof historicalReadiness?.asOf === 'string' ? historicalReadiness.asOf : '';
      expect(backtestEndDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const backtestStart = new Date(`${backtestEndDate}T00:00:00Z`);
      backtestStart.setUTCDate(backtestStart.getUTCDate() - 28);
      const backtestStartDate = backtestStart.toISOString().slice(0, 10);

      const scannerCandidate = memberPage.getByTestId('scanner-ranked-row-AAPL');
      await memberPage.getByTestId('scanner-candidate-filters').getByRole('button', { name: '候选池', exact: true }).click();
      await expect(scannerCandidate).toBeVisible();
      await scannerCandidate.click();
      const candidateDetail = memberPage.getByTestId('scanner-candidate-detail-AAPL');
      await expect(candidateDetail).toBeVisible();
      const saveWatchlistResponsePromise = memberPage.waitForResponse(
        (response) => response.url().endsWith('/api/v1/watchlist/items') && response.request().method() === 'POST',
      );
      await candidateDetail.getByRole('button', { name: '追踪', exact: true }).click();
      const savedWatchlistResponse = await saveWatchlistResponsePromise;
      const savedWatchlistRequest = savedWatchlistResponse.request().postDataJSON() as Record<string, unknown>;
      const savedWatchlistItem = await savedWatchlistResponse.json() as Record<string, unknown>;
      expect(savedWatchlistResponse.status()).toBe(200);
      expect(savedWatchlistRequest).toMatchObject({
        symbol: 'AAPL',
        market: 'us',
        source: 'scanner',
        scanner_run_id: scannerRunId,
      });
      expect(savedWatchlistRequest).not.toHaveProperty('scanner_score');
      expect(savedWatchlistRequest).not.toHaveProperty('scanner_rank');
      expect(savedWatchlistItem).toMatchObject({
        symbol: 'AAPL',
        source: 'scanner',
        scanner_run_id: scannerRunId,
        scanner_score: null,
      });
      await expect(candidateDetail.getByRole('button', { name: '已追踪', exact: true })).toBeDisabled();

      const researchPacketResponsePromise = memberPage.waitForResponse(
        (response) => response.url().endsWith('/api/v1/stocks/AAPL/research-packet')
          && response.request().method() === 'GET',
      );
      const researchNavigationPromise = memberPage.waitForURL(/\/zh\/stocks\/AAPL\/structure-decision/);
      await candidateDetail.getByRole('button', { name: '分析', exact: true }).click();
      await researchNavigationPromise;
      await expect(memberPage.getByTestId('stock-structure-decision-page')).toBeVisible();
      const researchPacketResponse = await researchPacketResponsePromise;
      const researchPacket = await researchPacketResponse.json() as Record<string, unknown>;
      expect(researchPacketResponse.status()).toBe(200);
      expect(researchPacket).toMatchObject({
        observationOnly: true,
        decisionGrade: false,
        productReadModel: expect.objectContaining({
          researchStatus: expect.any(String),
          freshness: expect.objectContaining({ state: expect.any(String) }),
          provenance: expect.objectContaining({
            historyEvidence: {
              sourceClass: 'qualification_fixture',
              freshness: 'synthetic',
              availability: 'missing',
              observationOnly: true,
            },
          }),
        }),
      });
      await expect(memberPage.getByTestId('stock-observation-boundary-strips')).toBeVisible();
      await memberPage.goto(`${baseUrl}/zh/watchlist`);
      await expect(memberPage.getByTestId('watchlist-page')).toBeVisible();
      await memberPage.reload();
      const reloadedWatchlist = await memberPage.evaluate(async () => {
        const response = await fetch('/api/v1/watchlist/items');
        return { status: response.status, payload: await response.json() };
      });
      expect(reloadedWatchlist.status).toBe(200);
      expect((reloadedWatchlist.payload as Record<string, unknown>).items).toEqual(expect.arrayContaining([
        expect.objectContaining({
          symbol: 'AAPL',
          source: 'scanner',
          scanner_run_id: scannerRunId,
          scanner_score: null,
        }),
      ]));

      const strategyText = 'RSI below 30 buy and RSI above 70 sell';
      const parsed = await memberPage.evaluate(async (request) => {
        const response = await fetch('/api/v1/backtest/rule/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        });
        return { status: response.status, payload: await response.json() };
      }, {
        code: 'AAPL',
        strategy_text: strategyText,
        start_date: backtestStartDate,
        end_date: backtestEndDate,
      });
      expect(parsed.status).toBe(200);
      const parsedPayload = parsed.payload as Record<string, unknown>;
      expect(parsedPayload).toMatchObject({ code: 'AAPL', executable: true });
      const backtestRun = await memberPage.evaluate(async (request) => {
        const response = await fetch('/api/v1/backtest/rule/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        });
        return { status: response.status, payload: await response.json() };
      }, {
        code: 'AAPL',
        strategy_text: strategyText,
        parsed_strategy: parsedPayload.parsed_strategy,
        start_date: backtestStartDate,
        end_date: backtestEndDate,
        lookback_bars: 60,
        benchmark_mode: 'none',
        confirmed: true,
        wait_for_completion: true,
      });
      expect(backtestRun.status).toBe(200);
      const backtestRunPayload = backtestRun.payload as Record<string, unknown>;
      const backtestRunId = Number(backtestRunPayload.id);
      expect(backtestRunId).toBeGreaterThan(0);
      expect(backtestRunPayload.status).toBe('completed');
      expect(backtestRunPayload.data_quality).toMatchObject({
        source: 'r06_nonlive_qualification_fixture',
        authority_status: 'degraded_fill_only',
        authority_source_type: 'synthetic_fixture',
        authority_reason_codes: ['qualification_fixture_not_authoritative'],
      });
      const reopenedBacktest = await memberPage.evaluate(async (runId) => {
        const [status, result] = await Promise.all([
          fetch(`/api/v1/backtest/rule/runs/${runId}/status`),
          fetch(`/api/v1/backtest/rule/runs/${runId}`),
        ]);
        return {
          statusCode: status.status,
          status: await status.json(),
          resultCode: result.status,
          result: await result.json(),
        };
      }, backtestRunId);
      expect(reopenedBacktest.statusCode).toBe(200);
      expect(reopenedBacktest.resultCode).toBe(200);
      expect(reopenedBacktest.status).toMatchObject({ id: backtestRunId, status: 'completed' });
      expect(reopenedBacktest.result).toMatchObject({ id: backtestRunId, status: 'completed' });
      await memberPage.goto(`${baseUrl}/en/backtest/results/${backtestRunId}`);
      await expect(memberPage.getByTestId('deterministic-backtest-result-page')).toBeVisible();
      await memberPage.reload();
      await expect(memberPage.getByTestId('deterministic-backtest-result-page')).toBeVisible();

      const account = await memberPage.evaluate(async () => {
        const response = await fetch('/api/v1/portfolio/accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'R06 mixed FX qualification account', market: 'us', base_currency: 'CNY' }),
        });
        return { status: response.status, payload: await response.json() };
      });
      expect(account.status).toBe(200);
      const accountId = Number((account.payload as Record<string, unknown>).id);
      expect(accountId).toBeGreaterThan(0);
      const portfolioEventDate = new Date().toISOString().slice(0, 10);
      const cashLedger = await memberPage.evaluate(async ({ id, eventDate }) => {
        const response = await fetch('/api/v1/portfolio/cash-ledger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account_id: id,
            event_date: eventDate,
            direction: 'in',
            amount: '100',
            currency: 'CNY',
            note: 'R06 qualification covered subtotal',
          }),
        });
        return { status: response.status, payload: await response.json() };
      }, { id: accountId, eventDate: portfolioEventDate });
      expect(cashLedger.status).toBe(200);
      expect(Number((cashLedger.payload as Record<string, unknown>).id)).toBeGreaterThan(0);
      const trade = await memberPage.evaluate(async ({ id, tradeDate }) => {
        const response = await fetch('/api/v1/portfolio/trades', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account_id: id,
            symbol: 'AAPL',
            trade_date: tradeDate,
            side: 'buy',
            quantity: '1',
            price: '100',
            fee: '0',
            tax: '0',
            market: 'us',
            currency: 'USD',
          }),
        });
        return { status: response.status, payload: await response.json() };
      }, { id: accountId, tradeDate: portfolioEventDate });
      expect(trade.status).toBe(200);
      const portfolio = await memberPage.evaluate(async () => {
        const response = await fetch('/api/v1/portfolio/snapshot');
        return { status: response.status, payload: await response.json() };
      });
      expect(portfolio.status).toBe(200);
      expect(portfolio.payload).toMatchObject({
        portfolio_truth: expect.objectContaining({
          state: 'valuation_partial',
          value_semantics: 'covered_subtotal',
          authoritative_total: null,
          covered_subtotal: expect.anything(),
        }),
        total_equity: null,
        availability: expect.objectContaining({
          valuation: expect.objectContaining({
            state: 'partial',
            value_semantics: 'covered_subtotal',
            missing_fx_pairs: expect.arrayContaining(['USD/CNY']),
          }),
        }),
      });
      await memberPage.goto(`${baseUrl}/zh/portfolio`);
      await expect(memberPage.getByTestId('portfolio-bento-page')).toBeVisible();
      await expect(memberPage.getByTestId('portfolio-total-assets-covered-subtotal')).toBeVisible();

      await login(adminPage, adminUsername, adminPassword, '/zh/admin/logs');
      const ops = await adminPage.evaluate(async () => {
        const response = await fetch('/api/v1/admin/ops/status');
        return { status: response.status, payload: await response.json() };
      });
      expect(ops.status).toBe(200);
      expect(ops.payload).toMatchObject({
        buildProvenance: { backendGitSha: expectedCandidateSha },
        taskQueueStatusSummary: { available: true, status: 'ok', configured: true },
      });
      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
      expect(adminPageErrors).toEqual([]);
      expect(adminConsoleErrors).toEqual([]);
    } finally {
      await Promise.all([
        memberPage.close({ runBeforeUnload: false }),
        adminPage.close({ runBeforeUnload: false }),
      ]);
      await Promise.all([
        memberContext.close(),
        adminContext.close(),
      ]);
    }
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
