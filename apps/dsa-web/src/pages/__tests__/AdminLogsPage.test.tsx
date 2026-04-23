import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const translations: Record<'zh' | 'en', Record<string, string>> = {
  zh: {
    'adminLogs.activityType.all': '全部活动',
    'adminLogs.activityType.admin_action': '管理员 / 系统动作',
    'adminLogs.activityType.user_activity': '用户活动',
    'adminLogs.allCategory': '全部类别',
    'adminLogs.allStatus': '全部状态',
    'adminLogs.category.ai_route': 'AI 路由',
    'adminLogs.category.ai_model': 'AI 模型',
    'adminLogs.category.data_market': '行情数据',
    'adminLogs.category.data_fundamentals': '基本面数据',
    'adminLogs.category.data_news': '新闻数据',
    'adminLogs.category.data_sentiment': '情绪数据',
    'adminLogs.category.notification': '通知',
    'adminLogs.category.system': '系统',
    'adminLogs.status.completed': '已完成',
    'adminLogs.status.running': '运行中',
    'adminLogs.status.failed': '失败',
    'adminLogs.badge.aiFallback': 'AI fallback',
    'adminLogs.badge.dataFallback': '数据 fallback',
    'adminLogs.action.completed': '完成',
    'adminLogs.outcomeState.completed': '已完成',
  },
  en: {
    'adminLogs.activityType.all': 'All activity',
    'adminLogs.activityType.admin_action': 'Admin / system actions',
    'adminLogs.activityType.user_activity': 'User activity',
    'adminLogs.allCategory': 'All categories',
    'adminLogs.allStatus': 'All status',
    'adminLogs.category.ai_route': 'AI routing',
    'adminLogs.category.ai_model': 'AI model',
    'adminLogs.category.data_market': 'Market data',
    'adminLogs.category.data_fundamentals': 'Fundamentals',
    'adminLogs.category.data_news': 'News',
    'adminLogs.category.data_sentiment': 'Sentiment',
    'adminLogs.category.notification': 'Notifications',
    'adminLogs.category.system': 'System',
    'adminLogs.status.completed': 'Completed',
    'adminLogs.status.running': 'Running',
    'adminLogs.status.failed': 'Failed',
    'adminLogs.badge.aiFallback': 'AI fallback',
    'adminLogs.badge.dataFallback': 'Data fallback',
    'adminLogs.action.completed': 'Completed',
    'adminLogs.outcomeState.completed': 'Completed',
  },
};

vi.mock('../../contexts/UiLanguageContext', () => ({
  useI18n: () => ({
    language: mockLanguage,
    t: (key: string, params?: Record<string, unknown>) => {
      void params;
      return translations[mockLanguage][key] || key;
    },
  }),
}));

vi.mock('../../components/common', () => ({
  ApiErrorAlert: () => <div>api-error</div>,
}));

describe('AdminLogsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLanguage = 'zh';
    listSessions.mockResolvedValue({
      total: 2,
      items: [
        {
          sessionId: 'admin-action-1',
          name: 'Factory reset',
          overallStatus: 'completed',
          startedAt: '2026-04-15T10:00:00Z',
          readableSummary: {
            actorDisplay: 'Bootstrap Admin',
            actorRole: 'admin',
            sessionKind: 'admin_action',
            subsystem: 'system_control',
            actionName: 'factory_reset_system',
            destructive: true,
          },
        },
        {
          sessionId: 'scanner-run-1',
          name: 'Scanner run',
          overallStatus: 'completed',
          startedAt: '2026-04-15T08:40:00Z',
          readableSummary: {
            actorDisplay: 'Bootstrap Admin',
            actorRole: 'admin',
            sessionKind: 'admin_action',
            subsystem: 'scanner',
            actionName: 'scanner_run',
            destructive: false,
            scannerRunId: 88,
            scannerMarket: 'us',
            scannerShortlistCount: 5,
            scannerFallbackCount: 1,
            scannerProvidersUsed: ['alpaca', 'twelve_data'],
            scannerCoverageSummary: 'Scanned 180 symbols, shortlisted 5.',
          },
        },
        {
          sessionId: 'user-activity-1',
          name: 'AAPL analysis',
          overallStatus: 'completed',
          startedAt: '2026-04-15T09:00:00Z',
          readableSummary: {
            actorDisplay: 'Alice',
            actorRole: 'user',
            sessionKind: 'user_activity',
            subsystem: 'analysis',
            actionName: 'analyze_stock',
            destructive: false,
          },
        },
      ],
    });
    getSessionDetail.mockImplementation(async (sessionId: string) => ({
      sessionId,
      name: sessionId === 'admin-action-1' ? 'Factory reset' : sessionId === 'scanner-run-1' ? 'Scanner run' : 'AAPL analysis',
      overallStatus: 'completed',
      readableSummary: {
        actorDisplay: sessionId === 'admin-action-1' || sessionId === 'scanner-run-1' ? 'Bootstrap Admin' : 'Alice',
        actorRole: sessionId === 'admin-action-1' || sessionId === 'scanner-run-1' ? 'admin' : 'user',
        sessionKind: sessionId === 'admin-action-1' || sessionId === 'scanner-run-1' ? 'admin_action' : 'user_activity',
        subsystem: sessionId === 'admin-action-1' ? 'system_control' : sessionId === 'scanner-run-1' ? 'scanner' : 'analysis',
        actionName: sessionId === 'admin-action-1' ? 'factory_reset_system' : sessionId === 'scanner-run-1' ? 'scanner_run' : 'analyze_stock',
        destructive: sessionId === 'admin-action-1',
        scannerRunId: sessionId === 'scanner-run-1' ? 88 : undefined,
        scannerMarket: sessionId === 'scanner-run-1' ? 'us' : undefined,
        scannerShortlistCount: sessionId === 'scanner-run-1' ? 5 : undefined,
        scannerFallbackCount: sessionId === 'scanner-run-1' ? 1 : undefined,
        scannerProvidersUsed: sessionId === 'scanner-run-1' ? ['alpaca', 'twelve_data'] : undefined,
        scannerCoverageSummary: sessionId === 'scanner-run-1' ? 'Scanned 180 symbols, shortlisted 5.' : undefined,
      },
      events: [
        {
          id: 1,
          phase: sessionId === 'admin-action-1' ? 'system' : sessionId === 'scanner-run-1' ? 'scanner' : 'ai_model',
          status: 'completed',
          detail: {
            action: sessionId === 'admin-action-1' ? 'factory_reset_system' : sessionId === 'scanner-run-1' ? 'scanner_run' : 'analyze_stock',
          },
        },
      ],
    }));
  });

  it('renders global admin observability metadata for both admin actions and user activity', async () => {
    render(<AdminLogsPage />);

    expect(await screen.findByText('全局管理员可观测性视图')).toBeInTheDocument();
    expect(screen.getByText('会话列表')).toBeInTheDocument();
    expect(screen.getByText('会话详情')).toBeInTheDocument();
    expect((await screen.findAllByText('Bootstrap Admin')).length).toBeGreaterThan(0);
    expect(screen.getByText('AAPL analysis')).toBeInTheDocument();
    expect(screen.getAllByText(/系统控制|分析/).length).toBeGreaterThan(0);
  });

  it('filters between admin/system actions and user activity', async () => {
    render(<AdminLogsPage />);

    expect((await screen.findAllByText('Factory reset')).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('活动类型'), {
      target: { value: 'admin_action' },
    });

    await waitFor(() => {
      expect(screen.getAllByText('Factory reset').length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('AAPL analysis')).not.toBeInTheDocument();
  });

  it('renders scanner observability metadata in admin logs', async () => {
    render(<AdminLogsPage />);

    expect(await screen.findByText('Scanner run')).toBeInTheDocument();
    expect(screen.getByText('运行 #88')).toBeInTheDocument();
    expect(screen.getByText('候选 5')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Scanner run/ }));

    await waitFor(() => {
      expect(screen.getByText(/Scanned 180 symbols, shortlisted 5./)).toBeInTheDocument();
    });
    expect(screen.getByText(/alpaca/)).toBeInTheDocument();
    expect(screen.getByText(/twelve_data/)).toBeInTheDocument();
    expect(screen.getByText(/fallback 次数 1/)).toBeInTheDocument();
  });

  it('renders a visible empty timeline state instead of crashing when detail events are missing', async () => {
    getSessionDetail.mockResolvedValueOnce({
      sessionId: 'admin-action-1',
      name: 'Factory reset',
      overallStatus: 'completed',
      readableSummary: {
        actorDisplay: 'Bootstrap Admin',
        actorRole: 'admin',
        sessionKind: 'admin_action',
        subsystem: 'system_control',
        actionName: 'factory_reset_system',
      },
    });

    render(<AdminLogsPage />);

    expect(await screen.findByText('Factory reset')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Factory reset/ }));

    await waitFor(() => {
      expect(screen.getByText('暂无时间线事件')).toBeInTheDocument();
    });
    expect(screen.getByText('本次会话没有记录可展示的事件明细。')).toBeInTheDocument();
  });

  it('formats detail summary values instead of exposing raw role and confirmation keys', async () => {
    render(<AdminLogsPage />);

    expect(await screen.findByText('Factory reset')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Factory reset/ }));

    await waitFor(() => {
      expect(screen.getByText('角色:')).toBeInTheDocument();
    });
    expect(screen.getByText('管理员')).toBeInTheDocument();
    expect(screen.getAllByText('管理员 / 系统动作').length).toBeGreaterThan(0);
    expect(screen.getByText('系统控制')).toBeInTheDocument();
    expect(screen.getByText('是')).toBeInTheDocument();
    expect(screen.queryByText('common.confirm')).not.toBeInTheDocument();
  });

  it('renders English page-local copy on /en routes', async () => {
    mockLanguage = 'en';

    render(<AdminLogsPage />);

    expect(await screen.findByRole('heading', { name: 'Admin logs' })).toBeInTheDocument();
    expect(screen.getByText('Global admin observability view')).toBeInTheDocument();
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.getByText('Session details')).toBeInTheDocument();
    expect(screen.getByLabelText('Ticker')).toHaveAttribute('placeholder', 'Filter by ticker');
    expect(screen.getByLabelText('Provider or keyword')).toHaveAttribute('placeholder', 'Filter by provider or keyword');
    expect(screen.getByRole('button', { name: 'Refresh list' })).toBeInTheDocument();
    expect(screen.getByText('Run #88')).toBeInTheDocument();
    expect(screen.getByText('Shortlist 5')).toBeInTheDocument();
  });

  it('keeps long values readable and shows page-local placeholders for missing detail fields', async () => {
    const longSessionId = 'session-with-an-extremely-long-identifier-that-should-wrap-instead-of-being-cut-off-0123456789';
    const longName = 'Very long admin log title that should stay readable in the list instead of truncating the only visible copy';
    const longTarget = 'provider/fallback/target/with/a/very/long/path/that/should-wrap-cleanly/without-breaking-the-detail-layout';
    const longMessage = 'A very long timeline message that should remain fully visible to operators while wrapping inside the card instead of forcing horizontal overflow in the detail column.';

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
            sessionKind: 'admin_action',
            subsystem: 'system_control',
            actionName: 'factory_reset_system',
            finalAiModel: null,
          },
        },
      ],
    });
    getSessionDetail.mockResolvedValueOnce({
      sessionId: longSessionId,
      name: longName,
      overallStatus: 'completed',
      queryId: null,
      taskId: null,
      readableSummary: {
        actorDisplay: 'Bootstrap Admin',
        actorRole: 'admin',
        sessionKind: 'admin_action',
        subsystem: 'system_control',
        actionName: 'factory_reset_system',
        destructive: false,
        finalAiModel: null,
        finalMarketSource: null,
        finalFundamentalSource: null,
        finalNewsSource: null,
        finalSentimentSource: null,
        topFailureReason: null,
      },
      events: [
        {
          id: 7,
          phase: 'system',
          category: 'system',
          action: 'completed',
          outcome: 'completed',
          target: longTarget,
          status: 'completed',
          truthLevel: 'confirmed',
          message: longMessage,
          eventAt: null,
        },
      ],
    });

    render(<AdminLogsPage />);

    const listButton = await screen.findByRole('button', { name: new RegExp(longName) });
    expect(listButton).toBeInTheDocument();

    const listName = within(listButton).getByText(longName);
    expect(listName.className).toContain('break-words');
    expect(listName.className).not.toContain('truncate');

    const listSessionId = within(listButton).getByText(longSessionId);
    expect(listSessionId.className).toContain('break-all');
    expect(listSessionId.className).not.toContain('truncate');

    fireEvent.click(listButton);

    await waitFor(() => {
      expect(screen.getByText('系统动作时间线')).toBeInTheDocument();
    });
    expect(screen.getByText('结果: 已完成')).toBeInTheDocument();
    expect(screen.getByText(longTarget).className).toContain('break-all');
    expect(screen.getByText(longMessage).className).toContain('break-words');
    expect(screen.getAllByText('--').length).toBeGreaterThan(0);
  });
});
