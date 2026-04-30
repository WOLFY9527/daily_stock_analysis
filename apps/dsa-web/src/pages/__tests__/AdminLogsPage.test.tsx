import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '../../i18n/core';
import AdminLogsPage from '../AdminLogsPage';

const { listBusinessEvents, getBusinessEventDetail, listSessions, getSessionDetail } = vi.hoisted(() => ({
  listBusinessEvents: vi.fn(),
  getBusinessEventDetail: vi.fn(),
  listSessions: vi.fn(),
  getSessionDetail: vi.fn(),
}));

vi.mock('../../api/adminLogs', () => ({
  adminLogsApi: {
    listBusinessEvents,
    getBusinessEventDetail,
    listSessions,
    getSessionDetail,
  },
}));

let mockLanguage: 'zh' | 'en' = 'zh';

vi.mock('../../contexts/UiLanguageContext', () => ({
  useI18n: () => ({
    language: mockLanguage,
    t: (key: string, params?: Record<string, string | number | undefined>) => translate(mockLanguage, key, params),
  }),
}));

vi.mock('../../components/common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/common')>();
  return {
    ...actual,
    ApiErrorAlert: () => <div>api-error</div>,
  };
});

const businessEvents = [
  {
    id: 'analysis-tsla',
    event: 'TSLA',
    category: 'analysis',
    type: 'stock_analysis',
    status: 'partial',
    summary: '用户分析 TSLA，部分数据源失败',
    symbol: 'TSLA',
    market: 'US',
    startedAt: '2026-04-30T13:20:00Z',
    durationMs: 12345,
    stepCount: 4,
    successStepCount: 3,
    failedStepCount: 1,
    skippedStepCount: 0,
    unknownStepCount: 0,
    recordId: 'record-tsla',
  },
  {
    id: 'analysis-aapl',
    event: 'AAPL',
    category: 'analysis',
    type: 'stock_analysis',
    status: 'success',
    summary: '用户分析 AAPL',
    symbol: 'AAPL',
    market: 'US',
    startedAt: '2026-04-30T12:20:00Z',
    durationMs: 4300,
    stepCount: 4,
    successStepCount: 4,
    failedStepCount: 0,
    skippedStepCount: 0,
    unknownStepCount: 0,
    recordId: 'record-aapl',
  },
  {
    id: 'scanner-mainland',
    event: 'Scanner: 大盘单机游戏',
    category: 'scanner',
    type: 'scan_run',
    status: 'success',
    summary: '扫描器运行：大盘单机游戏',
    subject: '大盘单机游戏',
    scannerId: 'scanner-mainland',
    startedAt: '2026-04-30T11:20:00Z',
    durationMs: 2200,
    stepCount: 3,
    successStepCount: 2,
    skippedStepCount: 1,
    failedStepCount: 0,
    unknownStepCount: 0,
    metadata: { matchedCount: 18 },
  },
  {
    id: 'backtest-ma20',
    event: 'Backtest: MA20 Breakout',
    category: 'backtest',
    type: 'backtest_run',
    status: 'success',
    summary: '回测策略 MA20 Breakout',
    subject: 'MA20 Breakout',
    strategyId: 'strategy-ma20',
    backtestId: 'bt-1',
    startedAt: '2026-04-30T10:20:00Z',
    durationMs: 5200,
    stepCount: 3,
    successStepCount: 3,
    skippedStepCount: 0,
    failedStepCount: 0,
    unknownStepCount: 0,
    metadata: { startDate: '2024-01-01', endDate: '2024-12-31' },
  },
];

const businessDetail = {
  ...businessEvents[0],
  stepCount: 5,
  successStepCount: 3,
  skippedStepCount: 1,
  failedStepCount: 1,
  steps: [
    {
      name: 'fetch_quote',
      label: '获取行情',
      provider: 'yahoo',
      status: 'success',
      startedAt: '2026-04-30T13:20:00Z',
      finishedAt: '2026-04-30T13:20:00.320Z',
      durationMs: 320,
      metadata: { symbol: 'TSLA' },
    },
    {
      name: 'fetch_news',
      label: '获取新闻',
      provider: 'newsapi',
      status: 'failed',
      startedAt: '2026-04-30T13:20:01Z',
      finishedAt: '2026-04-30T13:20:04Z',
      durationMs: 3000,
      errorType: 'TimeoutError',
      errorMessage: 'News API timeout after 3000ms token=FRONTENDTOKEN',
      metadata: { source: 'newsapi', apiKey: 'FRONTENDSECRET', nested: { token: 'FRONTENDTOKEN' } },
    },
    {
      name: 'fetch_fundamentals',
      label: '获取财务数据',
      provider: 'fmp',
      status: 'skipped',
      reason: 'previous_provider_succeeded',
      message: '主数据源已成功，无需调用备用源',
      durationMs: 0,
      metadata: { apiKey: '***' },
    },
    {
      name: 'ai_analysis',
      label: 'AI 分析',
      provider: 'deepseek',
      status: 'success',
      durationMs: 8600,
      metadata: {},
    },
    {
      name: 'save_record',
      label: '保存分析记录',
      status: 'success',
      recordId: 'record-tsla',
      metadata: {},
    },
  ],
};

const rawSessions = [
  {
    sessionId: 'raw-timeout',
    name: 'ExternalSourceTimeout',
    overallStatus: 'failed',
    startedAt: '2026-04-30T13:21:00Z',
    readableSummary: {
      logLevel: 'WARNING',
      logCategory: 'data_source',
      eventName: 'ExternalSourceTimeout',
      eventMessage: 'source timeout',
      source: 'newsapi',
      operationTarget: 'newsapi',
    },
  },
];

describe('AdminLogsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLanguage = 'zh';
    listBusinessEvents.mockResolvedValue({
      total: businessEvents.length,
      limit: 20,
      offset: 0,
      hasMore: true,
      items: businessEvents,
    });
    getBusinessEventDetail.mockResolvedValue(businessDetail);
    listSessions.mockResolvedValue({
      total: rawSessions.length,
      items: rawSessions,
      summary: {
        errorCount: 0,
        warningCount: 1,
        dataSourceFailureCount: 1,
        slowRequestCount: 0,
        latestCriticalAt: null,
      },
    });
    getSessionDetail.mockResolvedValue({ ...rawSessions[0], events: [], operationDetail: {} });
  });

  it('defaults to business events and does not show raw step names as the main list', async () => {
    render(<AdminLogsPage />);

    expect(screen.getByTestId('admin-logs-workspace')).toHaveClass('w-full', 'flex-1', 'min-w-0', 'overflow-x-hidden');
    expect(screen.getByRole('tab', { name: '业务事件' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '股票分析' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '扫描器' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '回测' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '数据源' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '安全事件' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '原始日志' })).toBeInTheDocument();
    expect(screen.getByTestId('admin-logs-filter-bar')).toBeInTheDocument();
    expect(screen.getByLabelText('搜索日志')).toBeInTheDocument();
    expect(screen.getByLabelText('状态筛选')).toBeInTheDocument();
    expect(screen.getByLabelText('时间范围')).toBeInTheDocument();
    expect(screen.getByTestId('admin-logs-summary-grid')).toHaveClass('grid-cols-1', 'sm:grid-cols-2', 'lg:grid-cols-5');
    expect(await screen.findByText('TSLA')).toBeInTheDocument();
    expect(screen.getByText('用户分析 TSLA，部分数据源失败')).toBeInTheDocument();
    expect(screen.getByText('Scanner: 大盘单机游戏')).toBeInTheDocument();
    expect(screen.getByText('Backtest: MA20 Breakout')).toBeInTheDocument();
    expect(screen.getByTestId('business-events-table-shell')).toHaveClass('overflow-x-auto');
    expect(screen.getByTestId('admin-logs-pagination')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上一页' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一页' })).toBeInTheDocument();
    expect(screen.queryByText('fetch_news')).not.toBeInTheDocument();
    expect(screen.queryByText('ExternalSourceTimeout')).not.toBeInTheDocument();
    await waitFor(() => expect(listBusinessEvents).toHaveBeenLastCalledWith(expect.objectContaining({ since: '24h', limit: 20, offset: 0 })));
  });

  it('filters the stock-analysis view by symbol, status, time range, and pagination', async () => {
    render(<AdminLogsPage />);

    fireEvent.click(await screen.findByRole('tab', { name: '股票分析' }));
    fireEvent.change(screen.getByLabelText('搜索日志'), { target: { value: 'TSLA' } });
    fireEvent.change(screen.getByLabelText('状态筛选'), { target: { value: 'partial' } });
    fireEvent.change(screen.getByLabelText('时间范围'), { target: { value: '1h' } });

    await waitFor(() => expect(listBusinessEvents).toHaveBeenLastCalledWith(expect.objectContaining({
      category: 'analysis',
      symbol: 'TSLA',
      status: 'partial',
      since: '1h',
    })));

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(listBusinessEvents).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 20 })));
  });

  it('opens business-event detail with call-chain steps and failed error message', async () => {
    render(<AdminLogsPage />);

    const row = await screen.findByText('TSLA');
    const rowContainer = row.closest('[data-testid="business-event-row"]');
    expect(rowContainer).not.toBeNull();
    fireEvent.click(within(rowContainer as HTMLElement).getByRole('button', { name: translate('zh', 'adminLogs.viewDetails') }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('admin-logs-workspace')).toHaveClass('overflow-x-hidden');
    expect(screen.getByTestId('business-events-table-shell')).toHaveClass('overflow-x-auto');
    expect(screen.getByText('调用链 timeline')).toBeInTheDocument();
    expect(screen.getByText(/获取行情/)).toBeInTheDocument();
    expect(screen.getByText(/获取新闻/)).toBeInTheDocument();
    expect(screen.getByText(/获取财务数据/)).toBeInTheDocument();
    expect(screen.getByText(/AI 分析/)).toBeInTheDocument();
    expect(screen.getByText(/保存分析记录/)).toBeInTheDocument();
    expect(screen.getByText('News API timeout after 3000ms token=***')).toBeInTheDocument();
    expect(screen.queryByText(/FRONTENDSECRET/)).not.toBeInTheDocument();
    expect(screen.queryByText(/FRONTENDTOKEN/)).not.toBeInTheDocument();
    expect(screen.getAllByText('主数据源已成功，无需调用备用源').length).toBeGreaterThan(0);
    expect(screen.getByText('成功/跳过/失败')).toBeInTheDocument();
    expect(screen.getByText('3/1/1')).toBeInTheDocument();
    expect(screen.getByText(/record-tsla/)).toBeInTheDocument();
    expect(document.querySelector('[data-status="success"]')).not.toBeNull();
    expect(document.querySelector('[data-status="skipped"]')).not.toBeNull();
    expect(document.querySelector('[data-status="failed"]')).not.toBeNull();
  });

  it('renders running step status as 运行中 in the detail timeline', async () => {
    getBusinessEventDetail.mockResolvedValueOnce({
      ...businessDetail,
      steps: businessDetail.steps.map((step) => (
        step.name === 'ai_analysis'
          ? { ...step, status: 'running', message: '分析任务仍在执行' }
          : step
      )),
    });

    render(<AdminLogsPage />);

    const row = await screen.findByText('TSLA');
    const rowContainer = row.closest('[data-testid="business-event-row"]');
    expect(rowContainer).not.toBeNull();
    fireEvent.click(within(rowContainer as HTMLElement).getByRole('button', { name: translate('zh', 'adminLogs.viewDetails') }));

    expect(await screen.findByText('运行中')).toBeInTheDocument();
  });

  it('filters scanner and backtest business tabs by category', async () => {
    render(<AdminLogsPage />);

    fireEvent.click(await screen.findByRole('tab', { name: '扫描器' }));
    await waitFor(() => expect(listBusinessEvents).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'scanner' })));

    fireEvent.click(screen.getByRole('tab', { name: '回测' }));
    await waitFor(() => expect(listBusinessEvents).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'backtest' })));
  });

  it('keeps raw logs available in the advanced raw tab', async () => {
    render(<AdminLogsPage />);

    fireEvent.click(await screen.findByRole('tab', { name: '原始日志' }));

    expect(await screen.findByText('ExternalSourceTimeout')).toBeInTheDocument();
    expect(screen.getByLabelText('级别筛选')).toBeInTheDocument();
    expect(screen.getByTestId('raw-logs-table-shell')).toHaveClass('overflow-x-auto');
    await waitFor(() => expect(listSessions).toHaveBeenCalledWith(expect.objectContaining({ minLevel: 'WARNING' })));
  });

  it('renders English page-local copy on English routes', async () => {
    mockLanguage = 'en';

    render(<AdminLogsPage />);

    expect(await screen.findByRole('heading', { name: translate('en', 'adminLogs.pageTitle') })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Business events' })).toBeInTheDocument();
    expect(screen.getByLabelText('Status filter')).toBeInTheDocument();
    expect(await screen.findByText('TSLA')).toBeInTheDocument();
  });
});
