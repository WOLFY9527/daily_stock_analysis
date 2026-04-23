import type React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiError, createParsedApiError } from '../../api/error';
import { UiLanguageProvider } from '../../contexts/UiLanguageContext';
import { translate } from '../../i18n/core';
import PortfolioPage from '../PortfolioPage';

const {
  getAccounts,
  getSnapshot,
  getRisk,
  refreshFx,
  listBrokerConnections,
  listImportBrokers,
  syncIbkrReadOnly,
  listTrades,
  listCashLedger,
  listCorporateActions,
  createTrade,
  deleteTrade,
  createCashLedger,
  deleteCashLedger,
  createCorporateAction,
  deleteCorporateAction,
  parseCsvImport,
  commitCsvImport,
  createAccount,
} = vi.hoisted(() => ({
  getAccounts: vi.fn(),
  getSnapshot: vi.fn(),
  getRisk: vi.fn(),
  refreshFx: vi.fn(),
  listBrokerConnections: vi.fn(),
  listImportBrokers: vi.fn(),
  syncIbkrReadOnly: vi.fn(),
  listTrades: vi.fn(),
  listCashLedger: vi.fn(),
  listCorporateActions: vi.fn(),
  createTrade: vi.fn(),
  deleteTrade: vi.fn(),
  createCashLedger: vi.fn(),
  deleteCashLedger: vi.fn(),
  createCorporateAction: vi.fn(),
  deleteCorporateAction: vi.fn(),
  parseCsvImport: vi.fn(),
  commitCsvImport: vi.fn(),
  createAccount: vi.fn(),
}));

vi.mock('../../api/portfolio', () => ({
  portfolioApi: {
    getAccounts,
    getSnapshot,
    getRisk,
    refreshFx,
    listBrokerConnections,
    listImportBrokers,
    syncIbkrReadOnly,
    listTrades,
    listCashLedger,
    listCorporateActions,
    createTrade,
    deleteTrade,
    createCashLedger,
    deleteCashLedger,
    createCorporateAction,
    deleteCorporateAction,
    parseCsvImport,
    commitCsvImport,
    createAccount,
  },
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  Legend: () => null,
  Cell: () => null,
}));

type AccountItem = {
  id: number;
  name: string;
  market?: 'cn' | 'hk' | 'us' | 'global';
  baseCurrency?: string;
};

function makeAccounts(items: AccountItem[] = [{ id: 1, name: 'Main' }]) {
  return {
    accounts: items.map((item) => ({
      id: item.id,
      name: item.name,
      broker: 'Demo',
      market: item.market ?? 'us',
      baseCurrency: item.baseCurrency ?? 'CNY',
      isActive: true,
      ownerId: null,
      createdAt: '2026-03-19T00:00:00Z',
      updatedAt: '2026-03-19T00:00:00Z',
    })),
  };
}

function makeSnapshot(options: { accountId?: number; fxStale?: boolean; accountCount?: number } = {}) {
  const accountId = options.accountId ?? 1;
  return {
    asOf: '2026-03-19',
    costMethod: 'fifo' as const,
    currency: 'CNY',
    accountCount: options.accountCount ?? 1,
    totalCash: 1000,
    totalMarketValue: 2000,
    totalEquity: 3000,
    realizedPnl: 0,
    unrealizedPnl: 0,
    feeTotal: 0,
    taxTotal: 0,
    fxStale: options.fxStale ?? true,
    portfolioAttribution: {
      accountAttribution: {
        topAccounts: [
          {
            accountId,
            accountName: `Account ${accountId}`,
            equityWeightPct: 100,
          },
        ],
      },
      industryAttribution: {
        topIndustries: [
          {
            industry: '半导体',
            weightPct: 61.2,
            symbolCount: 2,
          },
        ],
      },
    },
    accounts: [
      {
        accountId,
        accountName: `Account ${accountId}`,
        ownerId: null,
        broker: 'Demo',
        market: 'us',
        baseCurrency: 'CNY',
        asOf: '2026-03-19',
        costMethod: 'fifo' as const,
        totalCash: 1000,
        totalMarketValue: 2000,
        totalEquity: 3000,
        realizedPnl: 0,
        unrealizedPnl: 0,
        feeTotal: 0,
        taxTotal: 0,
        fxStale: options.fxStale ?? true,
        positions: [],
      },
    ],
  };
}

function makeRisk() {
  return {
    asOf: '2026-03-19',
    accountId: null,
    costMethod: 'fifo' as const,
    currency: 'CNY',
    thresholds: {},
    concentration: {
      totalMarketValue: 0,
      topWeightPct: 0,
      alert: false,
      topPositions: [],
    },
    sectorConcentration: {
      totalMarketValue: 0,
      topWeightPct: 0,
      alert: false,
      topSectors: [],
      coverage: {},
      errors: [],
    },
    industryAttribution: {
      topIndustries: [
        {
          industry: '半导体',
          weightPct: 61.2,
          symbolCount: 2,
        },
      ],
    },
    accountAttribution: {
      topAccounts: [
        {
          accountId: 1,
          accountName: 'Main',
          equityWeightPct: 100,
        },
      ],
    },
    drawdown: {
      seriesPoints: 0,
      maxDrawdownPct: 0,
      currentDrawdownPct: 0,
      alert: false,
      fxStale: false,
    },
    stopLoss: {
      nearAlert: false,
      triggeredCount: 0,
      nearCount: 0,
      items: [],
    },
  };
}

function deferredPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitForInitialLoad() {
  await waitFor(() => expect(getAccounts).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(getRisk).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(listTrades).toHaveBeenCalledTimes(1));
}

describe('PortfolioPage FX refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getAccounts.mockResolvedValue(makeAccounts());
    getSnapshot.mockImplementation(async ({ accountId }: { accountId?: number } = {}) => makeSnapshot({ accountId, fxStale: true }));
    getRisk.mockResolvedValue(makeRisk());
    refreshFx.mockResolvedValue({
      asOf: '2026-03-19',
      accountCount: 1,
      refreshEnabled: true,
      disabledReason: null,
      pairCount: 1,
      updatedCount: 1,
      staleCount: 0,
      errorCount: 0,
    });
    listBrokerConnections.mockResolvedValue({ connections: [] });
    listImportBrokers.mockResolvedValue({
      brokers: [{ broker: 'huatai', aliases: [], displayName: '华泰', fileExtensions: ['csv'] }],
    });
    syncIbkrReadOnly.mockResolvedValue({
      accountId: 1,
      brokerConnectionId: 9,
      brokerAccountRef: 'U1234567',
      connectionName: 'Primary IBKR',
      snapshotDate: '2026-03-19',
      syncedAt: '2026-03-19T10:00:00',
      baseCurrency: 'USD',
      totalCash: 5000,
      totalMarketValue: 1600,
      totalEquity: 6600,
      realizedPnl: 0,
      unrealizedPnl: 100,
      positionCount: 1,
      cashBalanceCount: 1,
      fxStale: false,
      snapshotOverlayActive: true,
      usedExistingConnection: true,
      apiBaseUrl: 'https://localhost:5000/v1/api',
      verifySsl: false,
      warnings: [],
    });
    listTrades.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    listCashLedger.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    listCorporateActions.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    createTrade.mockResolvedValue({ id: 1 });
    deleteTrade.mockResolvedValue({ deleted: 1 });
    createCashLedger.mockResolvedValue({ id: 1 });
    deleteCashLedger.mockResolvedValue({ deleted: 1 });
    createCorporateAction.mockResolvedValue({ id: 1 });
    deleteCorporateAction.mockResolvedValue({ deleted: 1 });
    parseCsvImport.mockResolvedValue({
      broker: 'huatai',
      recordCount: 0,
      skippedCount: 0,
      errorCount: 0,
      records: [],
      cashRecordCount: 0,
      cashEntries: [],
      corporateActionCount: 0,
      corporateActions: [],
      warnings: [],
      metadata: {},
      errors: [],
    });
    commitCsvImport.mockResolvedValue({
      accountId: 1,
      recordCount: 0,
      insertedCount: 0,
      duplicateCount: 0,
      failedCount: 0,
      cashRecordCount: 0,
      cashInsertedCount: 0,
      cashFailedCount: 0,
      corporateActionCount: 0,
      corporateActionInsertedCount: 0,
      corporateActionFailedCount: 0,
      dryRun: true,
      duplicateImport: false,
      warnings: [],
      metadata: {},
      errors: [],
    });
    createAccount.mockResolvedValue({ id: 1 });
  });

  it('renders stale FX status with a manual refresh button', async () => {
    render(<PortfolioPage />);

    await waitForInitialLoad();

    expect(await screen.findByText(translate('zh', 'portfolio.fxStale'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: translate('zh', 'portfolio.refreshFx') })).toBeInTheDocument();
  });

  it('keeps manual entry tools collapsed by default once accounts are available', async () => {
    render(<PortfolioPage />);

    await waitForInitialLoad();

    const summary = screen.getByText(translate('zh', 'portfolio.manualAdjustments'));
    const disclosure = summary.closest('details');

    expect(disclosure).not.toBeNull();
    expect(disclosure).not.toHaveAttribute('open');

    fireEvent.click(summary.closest('summary') ?? summary);

    expect(disclosure).toHaveAttribute('open');
    expect(screen.getByText(translate('zh', 'portfolio.manualTrade'))).toBeInTheDocument();
    expect(screen.getByText(translate('zh', 'portfolio.dataSyncTitle'))).toBeInTheDocument();
  });

  it('shows IBKR as a broker import option and surfaces account-linked connection context', async () => {
    listImportBrokers.mockResolvedValueOnce({
      brokers: [
        { broker: 'huatai', aliases: [], displayName: '华泰', fileExtensions: ['csv'] },
        { broker: 'ibkr', aliases: ['interactivebrokers'], displayName: 'Interactive Brokers', fileExtensions: ['xml'] },
      ],
    });
    listBrokerConnections.mockResolvedValue({
      connections: [
        {
          id: 9,
          portfolioAccountId: 1,
          connectionName: 'Primary IBKR',
          brokerType: 'ibkr',
          brokerAccountRef: 'U1234567',
          importMode: 'file',
          status: 'active',
          syncMetadata: {},
        },
      ],
    });

    render(<PortfolioPage />);

    await waitForInitialLoad();

    const accountSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(accountSelect, { target: { value: '1' } });

    await waitFor(() => expect(listBrokerConnections).toHaveBeenCalledWith(1));

    const brokerSelect = screen.getAllByRole('combobox').find((element) =>
      (element as HTMLSelectElement).value === 'huatai'
    ) as HTMLSelectElement;
    fireEvent.change(brokerSelect, { target: { value: 'ibkr' } });

    expect(screen.getByText(translate('zh', 'portfolio.ibkrImportHint'))).toBeInTheDocument();
    expect(screen.getByText('Primary IBKR')).toBeInTheDocument();
    expect(screen.getByText('U1234567')).toBeInTheDocument();
    expect(screen.getByText(translate('zh', 'portfolio.currentImportAccount'))).toBeInTheDocument();
  });

  it('triggers read-only IBKR sync from the existing data sync surface', async () => {
    listImportBrokers.mockResolvedValueOnce({
      brokers: [
        { broker: 'huatai', aliases: [], displayName: '华泰', fileExtensions: ['csv'] },
        { broker: 'ibkr', aliases: ['interactivebrokers'], displayName: 'Interactive Brokers', fileExtensions: ['xml'] },
      ],
    });
    listBrokerConnections.mockResolvedValue({
      connections: [
        {
          id: 9,
          portfolioAccountId: 1,
          connectionName: 'Primary IBKR',
          brokerType: 'ibkr',
          brokerAccountRef: 'U1234567',
          importMode: 'file',
          status: 'active',
          syncMetadata: {
            ibkrApi: {
              apiBaseUrl: 'https://localhost:5000/v1/api',
              verifySsl: false,
              brokerAccountRef: 'U1234567',
            },
          },
        },
      ],
    });

    render(<PortfolioPage />);

    await waitForInitialLoad();

    const accountSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(accountSelect, { target: { value: '1' } });
    await waitFor(() => expect(listBrokerConnections).toHaveBeenCalledWith(1));

    const brokerSelect = screen.getAllByRole('combobox').find((element) =>
      (element as HTMLSelectElement).value === 'huatai'
    ) as HTMLSelectElement;
    fireEvent.change(brokerSelect, { target: { value: 'ibkr' } });

    fireEvent.change(
      screen.getByPlaceholderText(translate('zh', 'portfolio.ibkrSessionTokenPlaceholder')),
      { target: { value: 'session-token-123' } },
    );
    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'portfolio.syncIbkr') }));

    await waitFor(() => expect(syncIbkrReadOnly).toHaveBeenCalledWith({
      accountId: 1,
      brokerConnectionId: 9,
      brokerAccountRef: 'U1234567',
      sessionToken: 'session-token-123',
      apiBaseUrl: 'https://localhost:5000/v1/api',
      verifySsl: false,
    }));
    expect(await screen.findByText(/账户引用:/)).toBeInTheDocument();
    expect(
      screen.getByText((_, element) =>
        element?.tagName.toLowerCase() === 'span'
        && (element.textContent || '').includes(translate('zh', 'portfolio.syncOverlay')),
      ),
    ).toBeInTheDocument();
  });

  it('keeps the IBKR sync result visible after metadata refresh and preserves the broker selector', async () => {
    const initialSnapshot = makeSnapshot({ accountId: 1, fxStale: true });
    const syncedSnapshot = {
      ...makeSnapshot({ accountId: 1, fxStale: false }),
      currency: 'USD',
      totalCash: 5000,
      totalMarketValue: 1600,
      totalEquity: 6600,
      unrealizedPnl: 100,
      fxStale: false,
      accounts: [
        {
          accountId: 1,
          accountName: 'Account 1',
          ownerId: null,
          broker: 'IBKR',
          market: 'us',
          baseCurrency: 'USD',
          asOf: '2026-03-19',
          costMethod: 'fifo' as const,
          totalCash: 5000,
          totalMarketValue: 1600,
          totalEquity: 6600,
          realizedPnl: 0,
          unrealizedPnl: 100,
          feeTotal: 0,
          taxTotal: 0,
          fxStale: false,
          positions: [
            {
              symbol: 'AAPL',
              market: 'us',
              currency: 'USD',
              quantity: 10,
              avgCost: 150,
              totalCost: 1500,
              lastPrice: 160,
              marketValueBase: 1600,
              unrealizedPnlBase: 100,
              valuationCurrency: 'USD',
            },
          ],
        },
      ],
    };

    getSnapshot
      .mockResolvedValueOnce(initialSnapshot)
      .mockResolvedValueOnce(initialSnapshot)
      .mockResolvedValueOnce(syncedSnapshot);
    listImportBrokers.mockResolvedValueOnce({
      brokers: [
        { broker: 'huatai', aliases: [], displayName: '华泰', fileExtensions: ['csv'] },
        { broker: 'ibkr', aliases: ['interactivebrokers'], displayName: 'Interactive Brokers', fileExtensions: ['xml'] },
      ],
    });
    listBrokerConnections
      .mockResolvedValueOnce({
        connections: [
          {
            id: 9,
            portfolioAccountId: 1,
            connectionName: 'Primary IBKR',
            brokerType: 'ibkr',
            brokerAccountRef: 'U1234567',
            importMode: 'file',
            status: 'active',
            syncMetadata: {
              ibkrApi: {
                apiBaseUrl: 'https://localhost:5000/v1/api',
                verifySsl: false,
                brokerAccountRef: 'U1234567',
              },
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        connections: [
          {
            id: 9,
            portfolioAccountId: 1,
            connectionName: 'Primary IBKR',
            brokerType: 'ibkr',
            brokerAccountRef: 'U1234567',
            importMode: 'api',
            status: 'active',
            syncMetadata: {
              ibkrApi: {
                apiBaseUrl: 'https://localhost:5000/v1/api',
                verifySsl: false,
                brokerAccountRef: 'U1234567',
              },
              lastSyncAt: '2026-03-19T10:00:00',
            },
          },
        ],
      });

    render(<PortfolioPage />);

    await waitForInitialLoad();

    const accountSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(accountSelect, { target: { value: '1' } });
    await waitFor(() => expect(listBrokerConnections).toHaveBeenCalledWith(1));

    const brokerSelect = screen.getAllByRole('combobox').find((element) =>
      (element as HTMLSelectElement).value === 'huatai'
    ) as HTMLSelectElement;
    fireEvent.change(brokerSelect, { target: { value: 'ibkr' } });
    fireEvent.change(
      screen.getByPlaceholderText(translate('zh', 'portfolio.ibkrSessionTokenPlaceholder')),
      { target: { value: 'session-token-123' } },
    );

    const brokerConnectionCallCount = listBrokerConnections.mock.calls.length;
    const snapshotCallCount = getSnapshot.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'portfolio.syncIbkr') }));

    await waitFor(() => expect(syncIbkrReadOnly).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(listBrokerConnections.mock.calls.length).toBeGreaterThan(brokerConnectionCallCount));
    await waitFor(() => expect(getSnapshot.mock.calls.length).toBeGreaterThan(snapshotCallCount));

    expect(await screen.findByText(new RegExp(`${translate('zh', 'portfolio.accountRef')}:`))).toBeInTheDocument();
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(brokerSelect.value).toBe('ibkr');
    const syncResultCard = screen.getByText(translate('zh', 'portfolio.syncResult')).closest('div');
    expect(syncResultCard?.textContent || '').toContain(`${translate('zh', 'portfolio.positionsCountLabel')} 1`);
    expect(syncResultCard?.textContent || '').toContain(`${translate('zh', 'portfolio.cashCurrenciesLabel')} 1`);
    expect(syncResultCard?.textContent || '').toContain('USD 6,600.00');
  });

  it('refreshes FX for a single selected account and only reloads snapshot/risk', async () => {
    getSnapshot
      .mockResolvedValueOnce(makeSnapshot({ fxStale: true }))
      .mockResolvedValueOnce(makeSnapshot({ accountId: 1, fxStale: true }))
      .mockResolvedValueOnce(makeSnapshot({ accountId: 1, fxStale: false }));

    render(<PortfolioPage />);

    await waitForInitialLoad();

    const accountSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(accountSelect, { target: { value: '1' } });

    await waitFor(() => {
      expect(getSnapshot).toHaveBeenLastCalledWith({ accountId: 1, costMethod: 'fifo' });
    });

    const snapshotCallsBeforeRefresh = getSnapshot.mock.calls.length;
    const riskCallsBeforeRefresh = getRisk.mock.calls.length;
    const tradeCallsBeforeRefresh = listTrades.mock.calls.length;

    const refreshFxButton = screen.getByRole('button', { name: translate('zh', 'portfolio.refreshFx') });
    await waitFor(() => expect(refreshFxButton).not.toBeDisabled());
    fireEvent.click(refreshFxButton);

    await waitFor(() => expect(refreshFx).toHaveBeenCalledWith({ accountId: 1 }));
    expect(await screen.findByText(/汇率已刷新，共更新 1 对。/)).toBeInTheDocument();
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(snapshotCallsBeforeRefresh + 1));
    await waitFor(() => expect(getRisk).toHaveBeenCalledTimes(riskCallsBeforeRefresh + 1));
    expect(listTrades).toHaveBeenCalledTimes(tradeCallsBeforeRefresh);
    expect(listCashLedger).not.toHaveBeenCalled();
    expect(listCorporateActions).not.toHaveBeenCalled();
    expect(screen.getByText(translate('zh', 'portfolio.fxFresh'))).toBeInTheDocument();
  });

  it('refreshes FX for the full portfolio without sending accountId and shows neutral feedback when no pair exists', async () => {
    refreshFx.mockResolvedValueOnce({
      asOf: '2026-03-19',
      accountCount: 1,
      refreshEnabled: true,
      disabledReason: null,
      pairCount: 0,
      updatedCount: 0,
      staleCount: 0,
      errorCount: 0,
    });

    render(<PortfolioPage />);

    await waitForInitialLoad();

    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'portfolio.refreshFx') }));

    await waitFor(() => expect(refreshFx).toHaveBeenCalledWith({ accountId: undefined }));
    expect(await screen.findByText('当前范围无可刷新的汇率对。')).toBeInTheDocument();
  });

  it('shows disabled feedback when FX online refresh is disabled even without a disabled reason', async () => {
    refreshFx.mockResolvedValueOnce({
      asOf: '2026-03-19',
      accountCount: 1,
      refreshEnabled: false,
      pairCount: 1,
      updatedCount: 0,
      staleCount: 0,
      errorCount: 0,
    });

    render(<PortfolioPage />);

    await waitForInitialLoad();

    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'portfolio.refreshFx') }));

    expect(await screen.findByText('汇率在线刷新已被禁用。')).toBeInTheDocument();
  });

  it('prefers disabled feedback over empty-pair feedback when refresh is disabled', async () => {
    refreshFx.mockResolvedValueOnce({
      asOf: '2026-03-19',
      accountCount: 1,
      refreshEnabled: false,
      disabledReason: 'portfolio_fx_update_disabled',
      pairCount: 0,
      updatedCount: 0,
      staleCount: 0,
      errorCount: 0,
    });

    render(<PortfolioPage />);

    await waitForInitialLoad();

    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'portfolio.refreshFx') }));

    expect(await screen.findByText('汇率在线刷新已被禁用。')).toBeInTheDocument();
    expect(screen.queryByText('当前范围无可刷新的汇率对。')).not.toBeInTheDocument();
  });

  it('shows warning feedback when FX refresh still falls back to stale rates', async () => {
    refreshFx.mockResolvedValueOnce({
      asOf: '2026-03-19',
      accountCount: 1,
      pairCount: 2,
      updatedCount: 1,
      staleCount: 1,
      errorCount: 0,
    });

    render(<PortfolioPage />);

    await waitForInitialLoad();

    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'portfolio.refreshFx') }));

    expect(await screen.findByText(/旧汇率或备用汇率/)).toBeInTheDocument();
  });

  it('shows warning feedback when FX refresh returns online errors without stale pairs', async () => {
    refreshFx.mockResolvedValueOnce({
      asOf: '2026-03-19',
      accountCount: 1,
      pairCount: 1,
      updatedCount: 0,
      staleCount: 0,
      errorCount: 1,
    });

    render(<PortfolioPage />);

    await waitForInitialLoad();

    const snapshotCallsBeforeRefresh = getSnapshot.mock.calls.length;
    const riskCallsBeforeRefresh = getRisk.mock.calls.length;
    const tradeCallsBeforeRefresh = listTrades.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'portfolio.refreshFx') }));

    expect(await screen.findByText(/在线刷新未完全成功/)).toBeInTheDocument();
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(snapshotCallsBeforeRefresh + 1));
    await waitFor(() => expect(getRisk).toHaveBeenCalledTimes(riskCallsBeforeRefresh + 1));
    expect(listTrades).toHaveBeenCalledTimes(tradeCallsBeforeRefresh);
    expect(listCashLedger).not.toHaveBeenCalled();
    expect(listCorporateActions).not.toHaveBeenCalled();
  });

  it('restores the button state and shows the existing error alert when FX refresh fails', async () => {
    refreshFx.mockRejectedValueOnce(
      createApiError(
        createParsedApiError({
          title: '刷新失败',
          message: '汇率服务暂时不可用',
        }),
      ),
    );

    render(<PortfolioPage />);

    await waitForInitialLoad();

    const refreshButton = screen.getByRole('button', { name: translate('zh', 'portfolio.refreshFx') });
    fireEvent.click(refreshButton);

    expect(await screen.findByRole('alert')).toHaveTextContent('刷新失败');
    expect(screen.getByRole('alert')).toHaveTextContent('汇率服务暂时不可用');
    await waitFor(() => expect(screen.getByRole('button', { name: translate('zh', 'portfolio.refreshFx') })).not.toBeDisabled());
  });

  it('does not keep success feedback when snapshot reload fails after FX refresh succeeds', async () => {
    getSnapshot
      .mockResolvedValueOnce(makeSnapshot({ fxStale: true }))
      .mockRejectedValueOnce(
        createApiError(
          createParsedApiError({
            title: '快照刷新失败',
            message: '无法加载最新持仓快照',
          }),
        ),
      );

    render(<PortfolioPage />);

    await waitForInitialLoad();

    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'portfolio.refreshFx') }));

    expect(await screen.findByRole('alert')).toHaveTextContent('快照刷新失败');
    expect(screen.getByRole('alert')).toHaveTextContent('无法加载最新持仓快照');
    await waitFor(() => expect(screen.queryByText('汇率已刷新，共更新 1 对。')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: translate('zh', 'portfolio.refreshFx') })).not.toBeDisabled());
  });

  it('drops late FX refresh results after switching to another account scope', async () => {
    getAccounts.mockResolvedValueOnce(makeAccounts([{ id: 1, name: 'Main' }, { id: 2, name: 'Alt' }]));
    getSnapshot.mockImplementation(async ({ accountId }: { accountId?: number } = {}) => {
      if (accountId === 2) {
        return makeSnapshot({ accountId: 2, fxStale: false });
      }
      return makeSnapshot({ accountId: accountId ?? 1, fxStale: true, accountCount: accountId ? 1 : 2 });
    });

    const pendingRefresh = deferredPromise<{
      asOf: string;
      accountCount: number;
      pairCount: number;
      updatedCount: number;
      staleCount: number;
      errorCount: number;
    }>();
    refreshFx.mockImplementationOnce(() => pendingRefresh.promise);

    render(<PortfolioPage />);

    await waitForInitialLoad();

    const accountSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(accountSelect, { target: { value: '1' } });
    await waitFor(() => expect(getSnapshot).toHaveBeenLastCalledWith({ accountId: 1, costMethod: 'fifo' }));

    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'portfolio.refreshFx') }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /刷新中|刷新汇率/ })).toBeDisabled();
    });

    fireEvent.change(accountSelect, { target: { value: '2' } });
    await waitFor(() => expect(getSnapshot).toHaveBeenLastCalledWith({ accountId: 2, costMethod: 'fifo' }));
    await waitFor(() => expect(screen.getByRole('button', { name: translate('zh', 'portfolio.refreshFx') })).not.toBeDisabled());

    const snapshotCallsAfterSwitch = getSnapshot.mock.calls.length;
    const riskCallsAfterSwitch = getRisk.mock.calls.length;

    await act(async () => {
      pendingRefresh.resolve({
        asOf: '2026-03-19',
        accountCount: 1,
        pairCount: 1,
        updatedCount: 1,
        staleCount: 0,
        errorCount: 0,
      });
      await pendingRefresh.promise;
    });

    expect(getSnapshot).toHaveBeenCalledTimes(snapshotCallsAfterSwitch);
    expect(getRisk).toHaveBeenCalledTimes(riskCallsAfterSwitch);
    expect(screen.queryByText('汇率已刷新，共更新 1 对。')).not.toBeInTheDocument();
  });

  it('drops late FX refresh results after switching cost method', async () => {
    const pendingRefresh = deferredPromise<{
      asOf: string;
      accountCount: number;
      pairCount: number;
      updatedCount: number;
      staleCount: number;
      errorCount: number;
    }>();
    refreshFx.mockImplementationOnce(() => pendingRefresh.promise);

    render(<PortfolioPage />);

    await waitForInitialLoad();

    const costMethodSelect = screen.getAllByRole('combobox')[1];

    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'portfolio.refreshFx') }));
    expect(await screen.findByRole('button', { name: translate('zh', 'portfolio.refreshingFx') })).toBeDisabled();

    fireEvent.change(costMethodSelect, { target: { value: 'avg' } });
    await waitFor(() => expect(getSnapshot).toHaveBeenLastCalledWith({ accountId: undefined, costMethod: 'avg' }));
    await waitFor(() => expect(screen.getByRole('button', { name: translate('zh', 'portfolio.refreshFx') })).not.toBeDisabled());

    const snapshotCallsAfterSwitch = getSnapshot.mock.calls.length;
    const riskCallsAfterSwitch = getRisk.mock.calls.length;

    await act(async () => {
      pendingRefresh.resolve({
        asOf: '2026-03-19',
        accountCount: 1,
        pairCount: 1,
        updatedCount: 1,
        staleCount: 0,
        errorCount: 0,
      });
      await pendingRefresh.promise;
    });

    expect(getSnapshot).toHaveBeenCalledTimes(snapshotCallsAfterSwitch);
    expect(getRisk).toHaveBeenCalledTimes(riskCallsAfterSwitch);
    expect(screen.queryByText('汇率已刷新，共更新 1 对。')).not.toBeInTheDocument();
  });

  it('renders localized English portfolio shell copy on /en routes', async () => {
    window.history.replaceState(window.history.state, '', '/en/portfolio');

    render(
      <UiLanguageProvider>
        <PortfolioPage />
      </UiLanguageProvider>,
    );

    await waitForInitialLoad();

    expect(screen.getByRole('heading', { name: translate('en', 'portfolio.title') })).toBeInTheDocument();
    expect(screen.getByText(translate('en', 'portfolio.description'))).toBeInTheDocument();
    expect(screen.getByText(translate('en', 'portfolio.accountView'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: translate('en', 'portfolio.createAccount') })).toBeInTheDocument();
    expect(screen.getByText(translate('en', 'portfolio.totalEquity'))).toBeInTheDocument();
    expect(screen.getByText(translate('en', 'portfolio.drawdownTitle'))).toBeInTheDocument();
    expect(screen.getByText(translate('en', 'portfolio.positionsTitle'))).toBeInTheDocument();
    expect(screen.getByText(translate('en', 'portfolio.noPositions'))).toBeInTheDocument();
    expect(screen.getByText(translate('en', 'portfolio.dataSyncTitle'))).toBeInTheDocument();
    expect(screen.getByText(translate('en', 'portfolio.brokerImport'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: translate('en', 'portfolio.refreshData') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: translate('en', 'portfolio.refreshFx') })).toBeInTheDocument();
  });

  it('renders localized English IBKR sync detail and broker connection labels on /en routes', async () => {
    window.history.replaceState(window.history.state, '', '/en/portfolio');
    listImportBrokers.mockResolvedValueOnce({
      brokers: [
        { broker: 'huatai', aliases: [], displayName: 'Huatai', fileExtensions: ['csv'] },
        { broker: 'ibkr', aliases: ['interactivebrokers'], displayName: 'Interactive Brokers', fileExtensions: ['xml'] },
      ],
    });
    listBrokerConnections.mockResolvedValueOnce({
      connections: [
        {
          id: 9,
          portfolioAccountId: 1,
          connectionName: 'Primary IBKR',
          brokerType: 'ibkr',
          brokerAccountRef: 'U1234567',
          importMode: 'api',
          status: 'active',
          syncMetadata: {
            ibkrApi: {
              apiBaseUrl: 'https://localhost:5000/v1/api',
              verifySsl: false,
              brokerAccountRef: 'U1234567',
            },
          },
        },
      ],
    });

    render(
      <UiLanguageProvider>
        <PortfolioPage />
      </UiLanguageProvider>,
    );

    await waitForInitialLoad();

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '1' } });
    await waitFor(() => expect(listBrokerConnections).toHaveBeenCalledWith(1));
    fireEvent.change(
      screen.getAllByRole('combobox').find((element) => (element as HTMLSelectElement).value === 'huatai') as HTMLSelectElement,
      { target: { value: 'ibkr' } },
    );
    fireEvent.change(screen.getByPlaceholderText(translate('en', 'portfolio.ibkrSessionTokenPlaceholder')), {
      target: { value: 'session-token-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: translate('en', 'portfolio.syncIbkr') }));

    expect(await screen.findByText(translate('en', 'portfolio.readOnlyBadge'))).toBeInTheDocument();
    expect(screen.getByText(translate('en', 'portfolio.ibkrImportHint'))).toBeInTheDocument();
    expect(
      await screen.findAllByText((_, element) => (
        element?.textContent || ''
      ).includes(`${translate('en', 'portfolio.accountRef')}:`)),
    ).not.toHaveLength(0);
    expect(screen.queryByText(/^Ref:/)).not.toBeInTheDocument();
  });

  it('keeps zh IBKR sync detail labels localized on default routes', async () => {
    listImportBrokers.mockResolvedValueOnce({
      brokers: [
        { broker: 'huatai', aliases: [], displayName: '华泰', fileExtensions: ['csv'] },
        { broker: 'ibkr', aliases: ['interactivebrokers'], displayName: 'Interactive Brokers', fileExtensions: ['xml'] },
      ],
    });
    listBrokerConnections.mockResolvedValueOnce({
      connections: [
        {
          id: 9,
          portfolioAccountId: 1,
          connectionName: 'Primary IBKR',
          brokerType: 'ibkr',
          brokerAccountRef: 'U1234567',
          importMode: 'api',
          status: 'active',
          syncMetadata: {
            ibkrApi: {
              apiBaseUrl: 'https://localhost:5000/v1/api',
              verifySsl: false,
              brokerAccountRef: 'U1234567',
            },
          },
        },
      ],
    });

    render(<PortfolioPage />);

    await waitForInitialLoad();

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '1' } });
    await waitFor(() => expect(listBrokerConnections).toHaveBeenCalledWith(1));
    fireEvent.change(
      screen.getAllByRole('combobox').find((element) => (element as HTMLSelectElement).value === 'huatai') as HTMLSelectElement,
      { target: { value: 'ibkr' } },
    );
    fireEvent.change(screen.getByPlaceholderText(translate('zh', 'portfolio.ibkrSessionTokenPlaceholder')), {
      target: { value: 'session-token-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'portfolio.syncIbkr') }));

    expect(await screen.findByText(translate('zh', 'portfolio.readOnlyBadge'))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${translate('zh', 'portfolio.accountRef')}:`))).toBeInTheDocument();
    expect(screen.queryByText(translate('en', 'portfolio.readOnlyBadge'))).not.toBeInTheDocument();
    expect(screen.queryByText(/^Ref:/)).not.toBeInTheDocument();
  });

  it('renders additive portfolio attribution blocks without changing the existing snapshot flow', async () => {
    render(<PortfolioPage />);

    await waitForInitialLoad();

    expect(screen.getByText('组合归因 / Portfolio Attribution')).toBeInTheDocument();
    expect(screen.getByText('账户归因 / Account Attribution')).toBeInTheDocument();
    expect(screen.getByText('行业归因 / Industry Attribution')).toBeInTheDocument();
    expect(screen.getAllByText('Account 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Main').length).toBeGreaterThan(0);
    expect(screen.getAllByText('半导体').length).toBeGreaterThan(0);
    expect(screen.getAllByText('61.20%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('100.00%').length).toBeGreaterThan(0);
  });

  it('renders compact attribution visual summaries for additive portfolio blocks', async () => {
    const snapshot = makeSnapshot();
    snapshot.portfolioAttribution = {
      accountAttribution: {
        topAccounts: [
          { accountId: 1, accountName: 'Account 1', equityWeightPct: 61.2 },
          { accountId: 2, accountName: 'Satellite', equityWeightPct: 38.8 },
        ],
      },
      industryAttribution: {
        topIndustries: [
          { industry: '半导体', weightPct: 61.2, symbolCount: 2 },
          { industry: '软件', weightPct: 24.8, symbolCount: 1 },
        ],
      },
    };

    const risk = makeRisk();
    risk.accountAttribution = {
      topAccounts: [
        { accountId: 1, accountName: 'Main', equityWeightPct: 61.2 },
        { accountId: 2, accountName: 'Satellite', equityWeightPct: 38.8 },
      ],
    };
    risk.industryAttribution = {
      topIndustries: [
        { industry: '半导体', weightPct: 61.2, symbolCount: 2 },
        { industry: '软件', weightPct: 24.8, symbolCount: 1 },
      ],
    };

    getSnapshot.mockImplementation(async () => snapshot);
    getRisk.mockResolvedValue(risk);

    render(<PortfolioPage />);

    await waitForInitialLoad();

    expect(screen.getByTestId('portfolio-attribution-dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('portfolio-attribution-visual-summary')).toBeInTheDocument();
    expect(screen.getByText('主导分布 / Dominant Mix')).toBeInTheDocument();
    expect(screen.getByTestId('portfolio-attribution-hero')).toHaveAttribute('title', '查看组合主导归因的聚合摘要');
    expect(screen.getByTestId('account-attribution-top-list')).toBeInTheDocument();
    expect(screen.getByText('Top 账户分布')).toBeInTheDocument();
    expect(screen.getAllByText('Satellite').length).toBeGreaterThan(0);
    expect(screen.getByTestId('account-attribution-distribution-band')).toHaveTextContent('Top coverage 100.00%');
    expect(screen.getByTestId('account-attribution-distribution-band')).toHaveAttribute('title', '账户归因 Top coverage 100.00%');
    expect(screen.getByTestId('industry-attribution-top-list')).toBeInTheDocument();
    expect(screen.getByText('Top 行业分布')).toBeInTheDocument();
    expect(screen.getAllByText('软件').length).toBeGreaterThan(0);
    expect(screen.getByTestId('industry-attribution-distribution-band')).toHaveTextContent('Top coverage 86.00%');
    expect(screen.getByTestId('industry-attribution-distribution-band')).toHaveAttribute('title', '行业归因 Top coverage 86.00%');
  });

  it('shows attribution hover details and linked highlights across the additive dashboard panels', async () => {
    const snapshot = makeSnapshot();
    snapshot.portfolioAttribution = {
      accountAttribution: {
        topAccounts: [
          { accountId: 1, accountName: 'Account 1', equityWeightPct: 70 },
          { accountId: 2, accountName: 'Satellite', equityWeightPct: 30 },
        ],
      },
      industryAttribution: {
        topIndustries: [
          { industry: '半导体', weightPct: 55, symbolCount: 2 },
          { industry: '软件', weightPct: 25, symbolCount: 1 },
        ],
      },
    };

    const risk = makeRisk();
    risk.accountAttribution = {
      topAccounts: [
        { accountId: 1, accountName: 'Main', equityWeightPct: 70 },
        { accountId: 2, accountName: 'Satellite', equityWeightPct: 30 },
      ],
    };
    risk.industryAttribution = {
      topIndustries: [
        { industry: '半导体', weightPct: 55, symbolCount: 2 },
        { industry: '软件', weightPct: 25, symbolCount: 1 },
      ],
    };

    getSnapshot.mockImplementation(async () => snapshot);
    getRisk.mockResolvedValue(risk);

    render(<PortfolioPage />);

    await waitForInitialLoad();

    expect(screen.queryByTestId('portfolio-attribution-hover-tooltip')).not.toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByTestId('portfolio-attribution-hero'));

    expect(screen.getByTestId('portfolio-attribution-hover-tooltip')).toHaveTextContent('Top account focus');
    expect(screen.getByTestId('account-attribution-top-list-row-0')).toHaveAttribute('data-linked-highlight', 'true');

    fireEvent.mouseLeave(screen.getByTestId('portfolio-attribution-hero'));
    expect(screen.queryByTestId('portfolio-attribution-hover-tooltip')).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByTestId('industry-attribution-distribution-band-legend-0'));
    expect(screen.getByTestId('industry-attribution-distribution-band-tooltip')).toHaveTextContent('半导体');
    expect(screen.getByTestId('industry-attribution-top-list-row-0')).toHaveAttribute('data-linked-highlight', 'true');
  });

  it('supports keyboard focus details and linked highlights across attribution panels', async () => {
    const snapshot = makeSnapshot();
    snapshot.portfolioAttribution = {
      accountAttribution: {
        topAccounts: [
          { accountId: 1, accountName: 'Account 1', equityWeightPct: 70 },
          { accountId: 2, accountName: 'Satellite', equityWeightPct: 30 },
        ],
      },
      industryAttribution: {
        topIndustries: [
          { industry: '半导体', weightPct: 55, symbolCount: 2 },
          { industry: '软件', weightPct: 25, symbolCount: 1 },
        ],
      },
    };

    const risk = makeRisk();
    risk.accountAttribution = {
      topAccounts: [
        { accountId: 1, accountName: 'Main', equityWeightPct: 70 },
        { accountId: 2, accountName: 'Satellite', equityWeightPct: 30 },
      ],
    };
    risk.industryAttribution = {
      topIndustries: [
        { industry: '半导体', weightPct: 55, symbolCount: 2 },
        { industry: '软件', weightPct: 25, symbolCount: 1 },
      ],
    };

    getSnapshot.mockImplementation(async () => snapshot);
    getRisk.mockResolvedValue(risk);

    render(<PortfolioPage />);

    await waitForInitialLoad();

    const portfolioHero = screen.getByTestId('portfolio-attribution-hero');
    expect(portfolioHero).toHaveAttribute('tabindex', '0');
    fireEvent.focus(portfolioHero);

    const portfolioTooltip = screen.getByTestId('portfolio-attribution-hover-tooltip');
    expect(portfolioTooltip).toHaveTextContent('Top account focus');
    expect(portfolioTooltip).toHaveAttribute('role', 'tooltip');
    expect(portfolioTooltip).toHaveAttribute('id', 'portfolio-attribution-hover-tooltip');
    expect(portfolioHero).toHaveAttribute('aria-describedby', 'portfolio-attribution-hover-tooltip');
    expect(screen.getByTestId('account-attribution-top-list-row-0')).toHaveAttribute('data-linked-highlight', 'true');

    fireEvent.blur(portfolioHero);
    expect(screen.queryByTestId('portfolio-attribution-hover-tooltip')).not.toBeInTheDocument();
    expect(portfolioHero).not.toHaveAttribute('aria-describedby');

    const accountLegend = screen.getByTestId('account-attribution-distribution-band-legend-1');
    expect(accountLegend).toHaveAttribute('tabindex', '0');
    fireEvent.focus(accountLegend);

    const accountTooltip = screen.getByTestId('account-attribution-distribution-band-tooltip');
    expect(accountTooltip).toHaveTextContent('Satellite');
    expect(accountTooltip).toHaveAttribute('role', 'tooltip');
    expect(accountTooltip).toHaveAttribute('id', 'account-attribution-distribution-band-tooltip');
    expect(accountLegend).toHaveAttribute('aria-describedby', 'account-attribution-distribution-band-tooltip');
    expect(screen.getByTestId('account-attribution-top-list-row-1')).toHaveAttribute('data-linked-highlight', 'true');

    fireEvent.blur(accountLegend);
    expect(screen.queryByTestId('account-attribution-distribution-band-tooltip')).not.toBeInTheDocument();
    expect(accountLegend).not.toHaveAttribute('aria-describedby');

    const industrySegment = screen.getByTestId('industry-attribution-distribution-band-segment-0');
    expect(industrySegment).toHaveAttribute('tabindex', '0');
    fireEvent.focus(industrySegment);

    const industryTooltip = screen.getByTestId('industry-attribution-distribution-band-tooltip');
    expect(industryTooltip).toHaveTextContent('半导体');
    expect(industryTooltip).toHaveAttribute('role', 'tooltip');
    expect(industryTooltip).toHaveAttribute('id', 'industry-attribution-distribution-band-tooltip');
    expect(industrySegment).toHaveAttribute('aria-describedby', 'industry-attribution-distribution-band-tooltip');
    expect(screen.getByTestId('industry-attribution-top-list-row-0')).toHaveAttribute('data-linked-highlight', 'true');

    fireEvent.blur(industrySegment);
    expect(screen.queryByTestId('industry-attribution-distribution-band-tooltip')).not.toBeInTheDocument();
    expect(industrySegment).not.toHaveAttribute('aria-describedby');
  });
});
