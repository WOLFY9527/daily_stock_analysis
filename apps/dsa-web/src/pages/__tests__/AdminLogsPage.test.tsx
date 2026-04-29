import { fireEvent, render, screen, within } from '@testing-library/react';
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
    events: [],
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
    events: [],
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
    events: [],
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
    events: [],
  },
};

describe('AdminLogsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLanguage = 'zh';
    listSessions.mockResolvedValue({
      total: sessionItems.length,
      items: sessionItems,
    });
    getSessionDetail.mockImplementation(async (sessionId: keyof typeof detailById) => detailById[sessionId]);
  });

  it('renders the WolfyStock log list with operation icons, statuses, and filters', async () => {
    render(<AdminLogsPage />);

    expect(screen.getByTestId('admin-logs-workspace')).toHaveClass('w-full', 'flex-1', 'min-w-0');
    expect(await screen.findByText('TSLA')).toBeInTheDocument();
    expect(screen.getByText('登录')).toBeInTheDocument();
    expect(screen.getByText('US pre-open')).toBeInTheDocument();
    expect(screen.getByText('MA crossover')).toBeInTheDocument();
    expect(screen.getAllByText('系统操作').length).toBeGreaterThan(0);
    expect(screen.getAllByText('单股票分析').length).toBeGreaterThan(0);
    expect(screen.getAllByText('市场扫描').length).toBeGreaterThan(0);
    expect(screen.getAllByText('回测').length).toBeGreaterThan(0);
    expect(screen.getAllByText('部分失败').length).toBeGreaterThan(0);
    expect(screen.getAllByText('成功').length).toBeGreaterThan(0);
    expect(screen.getAllByText('失败').length).toBeGreaterThan(0);
  });

  it('filters by operation type, target, status, and time range', async () => {
    render(<AdminLogsPage />);

    expect(await screen.findByText('TSLA')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(translate('zh', 'adminLogs.operationType')), {
      target: { value: 'market_scan' },
    });
    expect(screen.getByText('US pre-open')).toBeInTheDocument();
    expect(screen.queryByText('登录')).not.toBeInTheDocument();
    expect(screen.queryByText('TSLA')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(translate('zh', 'adminLogs.operationType')), {
      target: { value: 'all' },
    });
    fireEvent.change(screen.getByLabelText(translate('zh', 'adminLogs.operationTarget')), {
      target: { value: 'MA' },
    });
    expect(screen.getByText('MA crossover')).toBeInTheDocument();
    expect(screen.queryByText('US pre-open')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(translate('zh', 'adminLogs.operationTarget')), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByLabelText(translate('zh', 'adminLogs.statusFilterLabel')), {
      target: { value: 'partial' },
    });
    expect(screen.getByText('TSLA')).toBeInTheDocument();
    expect(screen.queryByText('MA crossover')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(translate('zh', 'adminLogs.statusFilterLabel')), {
      target: { value: 'all' },
    });
    fireEvent.change(screen.getByLabelText(translate('zh', 'adminLogs.userFilterLabel')), {
      target: { value: 'admin' },
    });
    expect(screen.getByText('登录')).toBeInTheDocument();
    expect(screen.getByText('TSLA')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('开始时间'), {
      target: { value: '2026-04-29T00:00' },
    });
    expect(screen.getByText('TSLA')).toBeInTheDocument();
    expect(screen.getByText('US pre-open')).toBeInTheDocument();
    expect(screen.queryByText('MA crossover')).not.toBeInTheDocument();
  });

  it('orders log entries by newest operation time first', async () => {
    render(<AdminLogsPage />);

    expect(await screen.findByText('TSLA')).toBeInTheDocument();
    const rows = screen.getAllByTestId('admin-log-row');
    expect(within(rows[0]).getByText('登录')).toBeInTheDocument();
    expect(within(rows[1]).getByText('TSLA')).toBeInTheDocument();
  });

  it('opens a drawer with complete LLM calls, data-source calls, fallback records, and final result', async () => {
    render(<AdminLogsPage />);

    const row = await screen.findByText('TSLA');
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
    expect(screen.getByText('复制完整日志')).toBeInTheDocument();
    expect(screen.getByText('导出 JSON')).toBeInTheDocument();
  });

  it('opens system operation details with operation user, time, result, and reason fields', async () => {
    render(<AdminLogsPage />);

    const row = await screen.findByText('登录');
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

    const row = await screen.findByText('TSLA');
    const rowContainer = row.closest('.grid');
    fireEvent.click(within(rowContainer as HTMLElement).getByRole('button', { name: translate('zh', 'adminLogs.viewDetails') }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('api-error')).toBeInTheDocument();
    expect(screen.getAllByText('TSLA').length).toBeGreaterThan(1);
  });

  it('renders English page-local copy on English routes', async () => {
    mockLanguage = 'en';

    render(<AdminLogsPage />);

    expect(await screen.findByRole('heading', { name: translate('en', 'adminLogs.pageTitle') })).toBeInTheDocument();
    expect(screen.getByLabelText(translate('en', 'adminLogs.operationType'))).toBeInTheDocument();
    expect(screen.getByLabelText(translate('en', 'adminLogs.statusFilterLabel'))).toBeInTheDocument();
    expect(screen.getByLabelText(translate('en', 'adminLogs.userFilterLabel'))).toBeInTheDocument();
    expect(screen.getAllByText('Single stock analysis').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Market scan').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Backtest').length).toBeGreaterThan(0);
    expect(screen.getAllByText('System operation').length).toBeGreaterThan(0);
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
      },
      operationDetail: {
        target: longName,
        status: '成功',
        aiCalls: [],
        dataSourceCalls: [],
        timeline: [],
        diagnostics: [],
      },
      events: [],
    });

    render(<AdminLogsPage />);

    const listName = await screen.findByText(longName);
    expect(listName.className).toContain('break-words');
    expect(listName.className).not.toContain('truncate');
    expect(screen.getByText(longSessionId).className).toContain('break-all');
  });
});
