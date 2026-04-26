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
    const { container } = render(<AdminLogsPage />);

    expect(container.querySelectorAll('main')).toHaveLength(0);
    expect(await screen.findByText(translate('zh', 'adminLogs.scopeTitle'))).toBeInTheDocument();
    expect(screen.getByText(translate('zh', 'adminLogs.sessionListTitle'))).toBeInTheDocument();
    expect(screen.getByText(translate('zh', 'adminLogs.sessionDetailTitle'))).toBeInTheDocument();
    expect((await screen.findAllByText('Bootstrap Admin')).length).toBeGreaterThan(0);
    expect(screen.getByText('AAPL analysis')).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(`${translate('zh', 'adminLogs.subsystemLabel.system_control')}|${translate('zh', 'adminLogs.subsystemLabel.analysis')}`)).length).toBeGreaterThan(0);
  });

  it('filters between admin/system actions and user activity', async () => {
    render(<AdminLogsPage />);

    expect((await screen.findAllByText('Factory reset')).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText(translate('zh', 'adminLogs.activityTypeLabel')), {
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
    expect(screen.getByText(translate('zh', 'adminLogs.scannerRunMeta', { runId: 88 }))).toBeInTheDocument();
    expect(screen.getByText(translate('zh', 'adminLogs.scannerShortlistMeta', { count: 5 }))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Scanner run/ }));

    await waitFor(() => {
      expect(screen.getByText(/Scanned 180 symbols, shortlisted 5./)).toBeInTheDocument();
    });
    expect(screen.getByText(/alpaca/)).toBeInTheDocument();
    expect(screen.getByText(/twelve_data/)).toBeInTheDocument();
    expect(screen.getByText(translate('zh', 'adminLogs.providersMeta', {
      providers: 'alpaca, twelve_data',
      fallbackCount: 1,
      failureCount: 0,
    }))).toBeInTheDocument();
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
      expect(screen.getByText(translate('zh', 'adminLogs.emptyTimelineTitle'))).toBeInTheDocument();
    });
    expect(screen.getByText(translate('zh', 'adminLogs.emptyTimelineBody'))).toBeInTheDocument();
  });

  it('formats detail summary values instead of exposing raw role and confirmation keys', async () => {
    render(<AdminLogsPage />);

    expect(await screen.findByText('Factory reset')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Factory reset/ }));

    await waitFor(() => {
      expect(screen.getByText(`${translate('zh', 'adminLogs.actorRole')}:`)).toBeInTheDocument();
    });
    expect(screen.getByText(translate('zh', 'adminLogs.role.admin'))).toBeInTheDocument();
    expect(screen.getAllByText(translate('zh', 'adminLogs.activityType.admin_action')).length).toBeGreaterThan(0);
    expect(screen.getByText(translate('zh', 'adminLogs.subsystemLabel.system_control'))).toBeInTheDocument();
    expect(screen.getByText(translate('zh', 'adminLogs.boolean.yes'))).toBeInTheDocument();
    expect(screen.queryByText('common.confirm')).not.toBeInTheDocument();
  });

  it('renders English page-local copy on /en routes', async () => {
    mockLanguage = 'en';

    render(<AdminLogsPage />);

    expect(await screen.findByRole('heading', { name: translate('en', 'adminLogs.pageTitle') })).toBeInTheDocument();
    expect(screen.getByText(translate('en', 'adminLogs.scopeTitle'))).toBeInTheDocument();
    expect(screen.getByText(translate('en', 'adminLogs.sessionListTitle'))).toBeInTheDocument();
    expect(screen.getByText(translate('en', 'adminLogs.sessionDetailTitle'))).toBeInTheDocument();
    expect(screen.getByLabelText(translate('en', 'adminLogs.stockFilterLabel'))).toHaveAttribute('placeholder', translate('en', 'adminLogs.stockFilterPlaceholder'));
    expect(screen.getByLabelText(translate('en', 'adminLogs.providerFilterLabel'))).toHaveAttribute('placeholder', translate('en', 'adminLogs.providerFilterPlaceholder'));
    expect(screen.getByRole('button', { name: translate('en', 'adminLogs.refreshButton') })).toBeInTheDocument();
    expect(screen.getByText(translate('en', 'adminLogs.scannerRunMeta', { runId: 88 }))).toBeInTheDocument();
    expect(screen.getByText(translate('en', 'adminLogs.scannerShortlistMeta', { count: 5 }))).toBeInTheDocument();
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
      expect(screen.getByText(translate('zh', 'adminLogs.timelineTitle'))).toBeInTheDocument();
    });
    expect(screen.getByText(`${translate('zh', 'adminLogs.outcome')}: ${translate('zh', 'adminLogs.outcomeState.completed')}`)).toBeInTheDocument();
    expect(screen.getByText(longTarget).className).toContain('break-all');
    expect(screen.getByText(longMessage).className).toContain('break-words');
    expect(screen.getAllByText(translate('zh', 'adminLogs.unavailable')).length).toBeGreaterThan(0);
  });
});
