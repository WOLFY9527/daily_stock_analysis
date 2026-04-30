import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '../../i18n/core';
import AdminLogsPage from '../AdminLogsPage';

const { listSessions, getSessionDetail } = vi.hoisted(() => ({
  listSessions: vi.fn(),
  getSessionDetail: vi.fn(),
}));

vi.mock('../../api/adminLogs', () => ({
  adminLogsApi: {
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

const sessionItems = [
  {
    sessionId: 'analysis-tsla',
    code: 'TSLA',
    name: 'TSLA analysis',
    overallStatus: 'partial_success',
    startedAt: '2026-04-29T11:02:00Z',
    readableSummary: {
      actorDisplay: 'admin',
      actorRole: 'admin',
      sessionKind: 'user_activity',
      subsystem: 'analysis',
      operationCategory: 'single_stock_analysis',
      operationType: '单股票分析',
      operationTarget: 'TSLA',
      operationStatus: '部分失败',
      keyMetric: 'Score 5.2',
      logLevel: 'WARNING',
      logCategory: 'data_source',
      eventName: 'ExternalSourceTimeout',
      eventMessage: 'Yahoo 超时',
      source: 'Yahoo',
      requestId: 'req-tsla',
    },
  },
  {
    sessionId: 'scanner-us',
    name: 'US pre-open scanner',
    overallStatus: 'completed',
    startedAt: '2026-04-29T09:20:00Z',
    readableSummary: {
      actorDisplay: 'admin',
      actorRole: 'admin',
      sessionKind: 'admin_action',
      subsystem: 'scanner',
      operationCategory: 'market_scan',
      operationType: '市场扫描',
      operationTarget: 'US pre-open',
      operationStatus: '成功',
      keyMetric: 'Shortlist 12',
      logLevel: 'NOTICE',
      logCategory: 'market',
      eventName: 'MarketDataStaleServed',
      eventMessage: 'served stale market snapshot',
      source: 'market-overview',
    },
  },
  {
    sessionId: 'backtest-ma',
    name: 'MA crossover backtest',
    overallStatus: 'failed',
    startedAt: '2026-04-28T08:05:00Z',
    readableSummary: {
      actorDisplay: 'admin',
      actorRole: 'admin',
      sessionKind: 'user_activity',
      subsystem: 'analysis',
      operationCategory: 'backtest',
      operationType: '回测',
      operationTarget: 'MA crossover',
      operationStatus: '失败',
      keyMetric: 'Data gap',
      logLevel: 'ERROR',
      logCategory: 'analysis',
      eventName: 'AnalysisFailed',
      eventMessage: 'Local parquet returned no rows',
      source: 'Backtest Engine',
    },
  },
  {
    sessionId: 'system-login-admin',
    name: 'Admin login',
    overallStatus: 'completed',
    startedAt: '2026-04-29T12:10:00Z',
    readableSummary: {
      actorDisplay: 'admin',
      actorRole: 'admin',
      sessionKind: 'system_event',
      subsystem: 'auth',
      operationCategory: 'system_operation',
      operationType: '系统操作',
      operationTarget: '登录',
      operationStatus: '成功',
      keyMetric: 'IP 127.0.0.1',
      logLevel: 'INFO',
      logCategory: 'auth',
      eventName: 'AuthSessionRefreshed',
      eventMessage: 'Admin session refreshed',
      source: 'auth',
    },
  },
];

const detailById = {
  'analysis-tsla': {
    ...sessionItems[0],
    operationDetail: {
      operationCategory: 'single_stock_analysis',
      operationType: '单股票分析',
      target: 'TSLA',
      status: '部分失败',
      keyMetric: 'Score 5.2',
      aiCalls: [
        {
          model: 'deepseek-v4-pro',
          version: '1.0',
          request: { symbol: 'TSLA', temperature: 0.2 },
          response: { error: 'rate_limited' },
          status: '失败',
          reason: '高负载',
          fallback: '回退使用 alpaca',
        },
        {
          model: 'alpaca',
          version: '2026-04',
          request: { symbol: 'TSLA' },
          response: { decision: 'hold' },
          status: '成功',
        },
      ],
      dataSourceCalls: [
        {
          api: 'Finnhub',
          request: { symbol: 'TSLA' },
          response: { quote: 'ok' },
          status: '成功',
        },
        {
          api: 'Yahoo',
          request: { symbol: 'TSLA', range: '6mo' },
          response: { error: 'timeout' },
          status: '失败',
          reason: '超时',
        },
      ],
      timeline: [
        { timestamp: '2026-04-29T11:02:01Z', label: 'deepseek-v4-pro call started', status: '成功', category: 'llm' },
      ],
      diagnostics: [
        { severity: 'warning', message: '回退到备用模型', source: 'LLM Router' },
        { severity: 'error', message: 'Yahoo 超时', source: 'Yahoo' },
      ],
    },
    events: [
      {
        id: 1,
        level: 'WARNING',
        phase: 'data_source',
        category: 'data_source',
        eventName: 'ExternalSourceTimeout',
        step: 'ExternalSourceTimeout',
        status: 'timed_out',
        truthLevel: 'actual',
        message: 'Yahoo 超时',
        detail: { request_id: 'req-tsla', source: 'Yahoo', symbol: 'TSLA' },
      },
    ],
  },
  'scanner-us': {
    ...sessionItems[1],
    operationDetail: {
      operationCategory: 'market_scan',
      operationType: '市场扫描',
      target: 'US pre-open',
      status: '成功',
      keyMetric: 'Shortlist 12',
      aiCalls: [],
      dataSourceCalls: [
        { api: 'Alpaca', request: { market: 'us' }, response: { symbols: 450 }, status: '成功' },
      ],
      timeline: [],
      diagnostics: [],
    },
    events: [
      {
        id: 2,
        level: 'NOTICE',
        phase: 'market',
        category: 'market',
        eventName: 'MarketDataStaleServed',
        step: 'MarketDataStaleServed',
        status: 'completed',
        truthLevel: 'actual',
        message: 'served stale market snapshot',
        detail: { source: 'market-overview' },
      },
    ],
  },
  'backtest-ma': {
    ...sessionItems[2],
    operationDetail: {
      operationCategory: 'backtest',
      operationType: '回测',
      target: 'MA crossover',
      status: '失败',
      keyMetric: 'Data gap',
      aiCalls: [],
      dataSourceCalls: [
        { api: 'Local Parquet', request: { symbol: 'MSFT' }, response: { rows: 0 }, status: '失败', reason: '历史数据不足' },
      ],
      timeline: [],
      diagnostics: [
        { severity: 'error', message: 'Local parquet returned no rows', source: 'Backtest Engine' },
      ],
    },
    events: [
      {
        id: 3,
        level: 'ERROR',
        phase: 'analysis',
        category: 'analysis',
        eventName: 'AnalysisFailed',
        step: 'AnalysisFailed',
        status: 'failed',
        truthLevel: 'actual',
        message: 'Local parquet returned no rows',
        detail: { source: 'Backtest Engine' },
      },
    ],
  },
  'system-login-admin': {
    ...sessionItems[3],
    operationDetail: {
      operationCategory: 'system_operation',
      operationType: '系统操作',
      target: '登录',
      status: '成功',
      keyMetric: 'IP 127.0.0.1',
      systemOperation: {
        action: 'login',
        actor: 'admin',
        time: '2026-04-29T12:10:00Z',
        status: '成功',
      },
      aiCalls: [],
      dataSourceCalls: [],
      systemFallbacks: [],
      finalResult: '成功',
      timeline: [
        { timestamp: '2026-04-29T12:10:00Z', label: '管理员登录成功', status: '成功', category: 'auth' },
      ],
      diagnostics: [],
    },
    events: [
      {
        id: 4,
        level: 'INFO',
        phase: 'auth',
        category: 'auth',
        eventName: 'AuthSessionRefreshed',
        step: 'AuthSessionRefreshed',
        status: 'completed',
        truthLevel: 'actual',
        message: 'Admin session refreshed',
        detail: { user: 'admin' },
      },
    ],
  },
};

describe('AdminLogsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLanguage = 'zh';
    listSessions.mockResolvedValue({
      total: sessionItems.length,
      items: sessionItems,
      summary: {
        errorCount: 1,
        warningCount: 1,
        dataSourceFailureCount: 1,
        slowRequestCount: 0,
        latestCriticalAt: null,
      },
    });
    getSessionDetail.mockImplementation(async (sessionId: keyof typeof detailById) => detailById[sessionId]);
  });

  it('defaults to WARNING+ and shows severity summary', async () => {
    render(<AdminLogsPage />);

    expect(screen.getByTestId('admin-logs-workspace')).toHaveClass('w-full', 'flex-1', 'min-w-0');
    expect(await screen.findByText(/TSLA/)).toBeInTheDocument();
    expect(screen.getByText(/MA crossover/)).toBeInTheDocument();
    expect(screen.queryByText('登录')).not.toBeInTheDocument();
    expect(screen.queryByText('US pre-open')).not.toBeInTheDocument();
    expect(screen.getByText('ExternalSourceTimeout')).toBeInTheDocument();
    expect(screen.getByText('AnalysisFailed')).toBeInTheDocument();
    expect(screen.getAllByText('ERROR').length).toBeGreaterThan(0);
    expect(screen.getAllByText('WARNING').length).toBeGreaterThan(0);
    await waitFor(() => expect(listSessions).toHaveBeenLastCalledWith(expect.objectContaining({ minLevel: 'WARNING', since: '24h', limit: 100 })));
  });

  it('filters by level, category, search, time range, and debug toggle', async () => {
    render(<AdminLogsPage />);

    expect(await screen.findByText(/TSLA/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('级别筛选'), {
      target: { value: 'all' },
    });
    expect(screen.getByText(/US pre-open/)).toBeInTheDocument();
    expect(screen.queryByText('登录')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('显示调试日志'));
    expect(screen.getByText(/登录/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('分类筛选'), {
      target: { value: 'data_source' },
    });
    expect(screen.getByText(/TSLA/)).toBeInTheDocument();
    expect(screen.queryByText(/MA crossover/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('分类筛选'), {
      target: { value: 'all' },
    });
    fireEvent.change(screen.getByLabelText('搜索日志'), {
      target: { value: 'Yahoo' },
    });
    expect(screen.getByText(/TSLA/)).toBeInTheDocument();
    expect(screen.queryByText('US pre-open')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('搜索日志'), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByLabelText('时间范围'), {
      target: { value: '1h' },
    });
    await waitFor(() => expect(listSessions).toHaveBeenLastCalledWith(expect.objectContaining({ since: '1h' })));
  });

  it('orders log entries by newest operation time first', async () => {
    render(<AdminLogsPage />);

    expect(await screen.findByText(/TSLA/)).toBeInTheDocument();
    const rows = screen.getAllByTestId('admin-log-row');
    expect(within(rows[0]).getByText(/TSLA/)).toBeInTheDocument();
    expect(within(rows[1]).getByText(/MA crossover/)).toBeInTheDocument();
  });

  it('opens a drawer with complete LLM calls, data-source calls, fallback records, and final result', async () => {
    render(<AdminLogsPage />);

    const row = await screen.findByText(/TSLA/);
    const rowContainer = row.closest('.grid');
    expect(rowContainer).not.toBeNull();
    fireEvent.click(within(rowContainer as HTMLElement).getByRole('button', { name: translate('zh', 'adminLogs.viewDetails') }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(await screen.findByText('LLM 调用链')).toBeInTheDocument();
    expect(screen.getByText('deepseek-v4-pro')).toBeInTheDocument();
    expect(screen.getByText('alpaca')).toBeInTheDocument();
    expect(screen.getByText('数据源调用')).toBeInTheDocument();
    expect(screen.getByText('Finnhub')).toBeInTheDocument();
    expect(screen.getByText('Yahoo')).toBeInTheDocument();
    expect(screen.getByText('系统回退记录')).toBeInTheDocument();
    expect(screen.getAllByText(/回退到备用模型/).length).toBeGreaterThan(0);
    expect(screen.getByText('最终执行结果')).toBeInTheDocument();
    expect(screen.getByText('metadata 详情')).toBeInTheDocument();
    expect(screen.getAllByText(/req-tsla/).length).toBeGreaterThan(0);
    expect(screen.getByText('复制完整日志')).toBeInTheDocument();
    expect(screen.getByText('导出 JSON')).toBeInTheDocument();
  });

  it('opens system operation details with operation user, time, result, and reason fields', async () => {
    render(<AdminLogsPage />);

    fireEvent.change(await screen.findByLabelText('级别筛选'), {
      target: { value: 'all' },
    });
    fireEvent.click(screen.getByLabelText('显示调试日志'));
    const row = await screen.findByText(/登录/);
    const rowContainer = row.closest('[data-testid="admin-log-row"]');
    expect(rowContainer).not.toBeNull();
    fireEvent.click(within(rowContainer as HTMLElement).getByRole('button', { name: translate('zh', 'adminLogs.viewDetails') }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByText('系统操作').length).toBeGreaterThan(0);
    const detail = screen.getByTestId('system-operation-detail');
    expect(within(detail).getByText('操作类型:')).toBeInTheDocument();
    expect(within(detail).getByText('操作用户:')).toBeInTheDocument();
    expect(within(detail).getByText('操作时间:')).toBeInTheDocument();
    expect(within(detail).getByText('失败原因:')).toBeInTheDocument();
  });

  it('keeps the drawer usable when the detail request fails after opening from summary data', async () => {
    getSessionDetail.mockRejectedValueOnce({ parsedError: { message: 'failed' } });
    render(<AdminLogsPage />);

    const row = await screen.findByText(/TSLA/);
    const rowContainer = row.closest('.grid');
    fireEvent.click(within(rowContainer as HTMLElement).getByRole('button', { name: translate('zh', 'adminLogs.viewDetails') }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('api-error')).toBeInTheDocument();
    expect(screen.getAllByText(/TSLA/).length).toBeGreaterThan(1);
  });

  it('renders English page-local copy on English routes', async () => {
    mockLanguage = 'en';

    render(<AdminLogsPage />);

    expect(await screen.findByRole('heading', { name: translate('en', 'adminLogs.pageTitle') })).toBeInTheDocument();
    expect(screen.getByLabelText('Level filter')).toBeInTheDocument();
    expect(screen.getByLabelText('Category filter')).toBeInTheDocument();
    expect(screen.getByLabelText('Search logs')).toBeInTheDocument();
    expect(screen.getByLabelText('Time range')).toBeInTheDocument();
    expect(await screen.findByText('ExternalSourceTimeout')).toBeInTheDocument();
  });

  it('keeps long values readable in the list and drawer', async () => {
    const longSessionId = 'session-with-an-extremely-long-identifier-that-should-wrap-instead-of-being-cut-off-0123456789';
    const longName = 'Very long admin log title that should stay readable in the list instead of truncating the only visible copy';
    listSessions.mockResolvedValueOnce({
      total: 1,
      items: [
        {
          sessionId: longSessionId,
          name: longName,
          overallStatus: 'completed',
          startedAt: '2026-04-15T10:00:00Z',
          readableSummary: {
            actorDisplay: 'Bootstrap Admin',
            actorRole: 'admin',
            operationTarget: longName,
            operationStatus: '成功',
            logLevel: 'WARNING',
            logCategory: 'system',
            eventName: 'SlowRequest',
            eventMessage: longName,
            requestId: longSessionId,
          },
        },
      ],
    });
    getSessionDetail.mockResolvedValueOnce({
      sessionId: longSessionId,
      name: longName,
      overallStatus: 'completed',
      readableSummary: {
        actorDisplay: 'Bootstrap Admin',
        actorRole: 'admin',
        operationTarget: longName,
        operationStatus: '成功',
        logLevel: 'WARNING',
        logCategory: 'system',
        eventName: 'SlowRequest',
        eventMessage: longName,
        requestId: longSessionId,
      },
      operationDetail: {
        target: longName,
        status: '成功',
        aiCalls: [],
        dataSourceCalls: [],
        timeline: [],
        diagnostics: [],
      },
      events: [
        {
          id: 99,
          level: 'WARNING',
          phase: 'system',
          category: 'system',
          eventName: 'SlowRequest',
          status: 'partial_success',
          truthLevel: 'actual',
          message: longName,
          detail: {},
        },
      ],
    });

    render(<AdminLogsPage />);

    const listName = await screen.findByText(longName);
    expect(listName.className).toContain('break-words');
    expect(listName.className).not.toContain('truncate');
    expect(screen.getByText(new RegExp(longSessionId)).className).toContain('break-all');
  });
});
