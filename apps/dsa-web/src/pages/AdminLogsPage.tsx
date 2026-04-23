import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { adminLogsApi, type ExecutionLogSessionDetail, type ExecutionLogSessionSummary } from '../api/adminLogs';
import { useI18n } from '../contexts/UiLanguageContext';
import { ApiErrorAlert } from '../components/common';
import type { ParsedApiError } from '../api/error';

const STATUS_CLASS: Record<string, string> = {
  running: 'theme-log-status theme-log-status--running',
  completed: 'theme-log-status theme-log-status--success',
  failed: 'theme-log-status theme-log-status--danger',
  success: 'theme-log-status theme-log-status--success',
  partial_success: 'theme-log-status theme-log-status--warning',
  timeout_unknown: 'theme-log-status theme-log-status--warning',
  not_configured: 'theme-log-status',
  failed_runtime: 'theme-log-status theme-log-status--danger',
  empty_result: 'theme-log-status',
  invalid_response: 'theme-log-status theme-log-status--danger',
  insufficient_fields: 'theme-log-status theme-log-status--warning',
  switched_to_fallback: 'theme-log-status theme-log-status--info',
  succeeded: 'theme-log-status theme-log-status--success',
  timed_out: 'theme-log-status theme-log-status--warning',
};

type AdminLogsLanguage = 'zh' | 'en';

const ADMIN_LOGS_COPY: Record<AdminLogsLanguage, {
  documentTitle: string;
  title: string;
  subtitle: string;
  scopeTitle: string;
  filterHint: (count: number) => string;
  activityTypeFilter: string;
  stockFilterLabel: string;
  stockFilterPlaceholder: string;
  categoryFilterLabel: string;
  providerFilterLabel: string;
  providerFilterPlaceholder: string;
  statusFilterLabel: string;
  refresh: string;
  loading: string;
  sessionListTitle: string;
  sessionListHint: string;
  noSessionsTitle: string;
  noSessionsBody: string;
  sessionDetailTitle: string;
  sessionDetailHint: string;
  selectSessionTitle: string;
  selectSessionBody: string;
  executiveSummary: string;
  timelineTitle: string;
  emptyTimelineTitle: string;
  emptyTimelineBody: string;
  queryId: string;
  taskId: string;
  notification: string;
  actor: string;
  actorRole: string;
  sessionKind: string;
  subsystem: string;
  actionName: string;
  destructive: string;
  finalAiModel: string;
  aiAttempts: string;
  finalMarketSource: string;
  finalFundamentalSource: string;
  finalNewsSource: string;
  finalSentimentSource: string;
  topFailureReason: string;
  outcome: string;
  reason: string;
  unavailable: string;
  roleAdmin: string;
  roleUser: string;
  subsystemSystemControl: string;
  subsystemAnalysis: string;
  subsystemScanner: string;
  scannerLabel: string;
  scannerRunMeta: (runId: number) => string;
  scannerShortlistMeta: (count: number) => string;
  providersMeta: (providers: string, fallbackCount: number, failureCount: number) => string;
  yes: string;
  no: string;
}> = {
  zh: {
    documentTitle: '管理员日志 - WolfyStock',
    title: '管理员日志',
    subtitle: '查看管理员动作、用户活动与系统 fallback 轨迹。',
    scopeTitle: '全局管理员可观测性视图',
    filterHint: (count) => `当前筛选结果共 ${count} 条会话，可按活动类型、股票、类别、数据源和状态继续收窄范围。`,
    activityTypeFilter: '活动类型',
    stockFilterLabel: '股票代码',
    stockFilterPlaceholder: '按股票代码筛选',
    categoryFilterLabel: '事件类别',
    providerFilterLabel: '数据源或关键字',
    providerFilterPlaceholder: '按数据源或关键字筛选',
    statusFilterLabel: '执行状态',
    refresh: '刷新列表',
    loading: '加载中...',
    sessionListTitle: '会话列表',
    sessionListHint: '左侧保留筛选结果，右侧展示当前会话详情。',
    noSessionsTitle: '暂无匹配会话',
    noSessionsBody: '调整筛选条件，或等待新的管理员动作和用户活动写入后再查看。',
    sessionDetailTitle: '会话详情',
    sessionDetailHint: '选中左侧会话后，可在这里查看摘要、关键字段和时间线。',
    selectSessionTitle: '请选择一条会话',
    selectSessionBody: '从左侧列表选择一条会话后，这里会显示对应的执行摘要与时间线。',
    executiveSummary: '执行摘要',
    timelineTitle: '系统动作时间线',
    emptyTimelineTitle: '暂无时间线事件',
    emptyTimelineBody: '本次会话没有记录可展示的事件明细。',
    queryId: '查询 ID',
    taskId: '任务 ID',
    notification: '通知终态',
    actor: '执行者',
    actorRole: '角色',
    sessionKind: '活动类型',
    subsystem: '子系统',
    actionName: '动作',
    destructive: '破坏性动作',
    finalAiModel: '最终 AI 模型',
    aiAttempts: 'AI 尝试次数',
    finalMarketSource: '最终行情源',
    finalFundamentalSource: '最终基本面源',
    finalNewsSource: '最终新闻源',
    finalSentimentSource: '最终情绪源',
    topFailureReason: '主要失败原因',
    outcome: '结果',
    reason: '原因',
    unavailable: '--',
    roleAdmin: '管理员',
    roleUser: '用户',
    subsystemSystemControl: '系统控制',
    subsystemAnalysis: '分析',
    subsystemScanner: '扫描器',
    scannerLabel: '扫描器',
    scannerRunMeta: (runId) => `运行 #${runId}`,
    scannerShortlistMeta: (count) => `候选 ${count}`,
    providersMeta: (providers, fallbackCount, failureCount) => `使用数据源：${providers} · fallback 次数 ${fallbackCount} · 失败次数 ${failureCount}`,
    yes: '是',
    no: '否',
  },
  en: {
    documentTitle: 'Admin Logs - WolfyStock',
    title: 'Admin logs',
    subtitle: 'Review admin actions, user activity, and fallback traces in one place.',
    scopeTitle: 'Global admin observability view',
    filterHint: (count) => `${count} sessions match the current filters. Narrow the list by activity, ticker, category, provider, or status.`,
    activityTypeFilter: 'Activity type',
    stockFilterLabel: 'Ticker',
    stockFilterPlaceholder: 'Filter by ticker',
    categoryFilterLabel: 'Category',
    providerFilterLabel: 'Provider or keyword',
    providerFilterPlaceholder: 'Filter by provider or keyword',
    statusFilterLabel: 'Status',
    refresh: 'Refresh list',
    loading: 'Loading...',
    sessionListTitle: 'Sessions',
    sessionListHint: 'Choose a session on the left to inspect its summary and timeline.',
    noSessionsTitle: 'No sessions match these filters',
    noSessionsBody: 'Adjust the filters or wait for a new admin action or user activity to be recorded.',
    sessionDetailTitle: 'Session details',
    sessionDetailHint: 'The selected session shows its summary, key fields, and timeline here.',
    selectSessionTitle: 'Select a session',
    selectSessionBody: 'Pick a session from the list to inspect its execution summary and event timeline.',
    executiveSummary: 'Executive summary',
    timelineTitle: 'System action timeline',
    emptyTimelineTitle: 'No timeline events yet',
    emptyTimelineBody: 'This session did not record any detailed events.',
    queryId: 'Query ID',
    taskId: 'Task ID',
    notification: 'Notification outcome',
    actor: 'Actor',
    actorRole: 'Role',
    sessionKind: 'Activity type',
    subsystem: 'Subsystem',
    actionName: 'Action',
    destructive: 'Destructive action',
    finalAiModel: 'Final AI model',
    aiAttempts: 'AI attempts',
    finalMarketSource: 'Final market source',
    finalFundamentalSource: 'Final fundamentals source',
    finalNewsSource: 'Final news source',
    finalSentimentSource: 'Final sentiment source',
    topFailureReason: 'Top failure reason',
    outcome: 'Outcome',
    reason: 'Reason',
    unavailable: '--',
    roleAdmin: 'Admin',
    roleUser: 'User',
    subsystemSystemControl: 'System control',
    subsystemAnalysis: 'Analysis',
    subsystemScanner: 'Scanner',
    scannerLabel: 'Scanner',
    scannerRunMeta: (runId) => `Run #${runId}`,
    scannerShortlistMeta: (count) => `Shortlist ${count}`,
    providersMeta: (providers, fallbackCount, failureCount) => `Providers: ${providers} · fallback runs ${fallbackCount} · provider failures ${failureCount}`,
    yes: 'Yes',
    no: 'No',
  },
};

function sourceText(value?: string | null, fallback = '--'): string {
  const text = String(value || '').trim();
  return text || fallback;
}

function normalizeCategory(value?: string | null): string {
  return String(value || '').trim().toLowerCase();
}

function resolveCategoryLabel(
  category: string,
  t: (key: string) => string,
  copy: (typeof ADMIN_LOGS_COPY)[AdminLogsLanguage],
): string {
  const key = normalizeCategory(category);
  const mapping: Record<string, string> = {
    ai_route: 'adminLogs.category.ai_route',
    ai_model: 'adminLogs.category.ai_model',
    data_market: 'adminLogs.category.data_market',
    data_fundamentals: 'adminLogs.category.data_fundamentals',
    data_news: 'adminLogs.category.data_news',
    data_sentiment: 'adminLogs.category.data_sentiment',
    notification: 'adminLogs.category.notification',
    system: 'adminLogs.category.system',
  };
  if (key === 'scanner') {
    return copy.scannerLabel;
  }
  return mapping[key] ? t(mapping[key]) : (category || copy.unavailable);
}

function resolveActionLabel(action: string, t: (key: string) => string): string {
  const key = String(action || '').trim().toLowerCase();
  const mapping: Record<string, string> = {
    selected: 'adminLogs.action.selected',
    attempting: 'adminLogs.action.attempting',
    succeeded: 'adminLogs.action.succeeded',
    failed: 'adminLogs.action.failed',
    timeout: 'adminLogs.action.timeout',
    switched: 'adminLogs.action.switched',
    skipped: 'adminLogs.action.skipped',
    empty_result: 'adminLogs.action.empty_result',
    invalid_response: 'adminLogs.action.invalid_response',
    insufficient_fields: 'adminLogs.action.insufficient_fields',
    completed: 'adminLogs.action.completed',
    unknown: 'adminLogs.action.unknown',
  };
  return mapping[key] ? t(mapping[key]) : (action || '--');
}

function resolveStatusLabel(status: string, t: (key: string) => string): string {
  const key = String(status || '').trim().toLowerCase();
  const mapping: Record<string, string> = {
    running: 'adminLogs.status.running',
    completed: 'adminLogs.status.completed',
    failed: 'adminLogs.status.failed',
    success: 'adminLogs.status.success',
    partial_success: 'adminLogs.status.partial_success',
    timeout_unknown: 'adminLogs.status.timeout_unknown',
    not_configured: 'adminLogs.status.not_configured',
    failed_runtime: 'adminLogs.status.failed',
    empty_result: 'adminLogs.status.empty_result',
    invalid_response: 'adminLogs.status.invalid_response',
    insufficient_fields: 'adminLogs.status.insufficient_fields',
    switched_to_fallback: 'adminLogs.status.switched_to_fallback',
    skipped_because_previous_succeeded: 'adminLogs.status.skipped_because_previous_succeeded',
    succeeded: 'adminLogs.status.succeeded',
    timed_out: 'adminLogs.status.timed_out',
  };
  return mapping[key] ? t(mapping[key]) : (status || '--');
}

function resolveRoleLabel(role: string, copy: (typeof ADMIN_LOGS_COPY)[AdminLogsLanguage]): string {
  const key = String(role || '').trim().toLowerCase();
  if (key === 'admin') return copy.roleAdmin;
  if (key === 'user') return copy.roleUser;
  return role || copy.unavailable;
}

function resolveSessionKindLabel(kind: string, t: (key: string) => string): string {
  const key = String(kind || '').trim().toLowerCase();
  if (key === 'admin_action' || key === 'user_activity') {
    return t(`adminLogs.activityType.${key}`);
  }
  return kind || '--';
}

function resolveSubsystemLabel(subsystem: string, copy: (typeof ADMIN_LOGS_COPY)[AdminLogsLanguage]): string {
  const key = String(subsystem || '').trim().toLowerCase();
  if (key === 'system_control') return copy.subsystemSystemControl;
  if (key === 'analysis') return copy.subsystemAnalysis;
  if (key === 'scanner') return copy.subsystemScanner;
  return subsystem || copy.unavailable;
}

function formatScannerRunMeta(runId: number, copy: (typeof ADMIN_LOGS_COPY)[AdminLogsLanguage]): string {
  return copy.scannerRunMeta(runId);
}

function formatScannerShortlistMeta(count: number, copy: (typeof ADMIN_LOGS_COPY)[AdminLogsLanguage]): string {
  return copy.scannerShortlistMeta(count);
}

function formatBooleanState(value: boolean | undefined, copy: (typeof ADMIN_LOGS_COPY)[AdminLogsLanguage]): string {
  if (value == null) return copy.unavailable;
  return value ? copy.yes : copy.no;
}

function formatOptionalCount(value: number | null | undefined, copy: (typeof ADMIN_LOGS_COPY)[AdminLogsLanguage]): string {
  if (value == null) return copy.unavailable;
  return String(value);
}

function formatScannerCoverageMeta(
  readable: ExecutionLogSessionDetail['readableSummary'],
  copy: (typeof ADMIN_LOGS_COPY)[AdminLogsLanguage],
): string {
  const providers = (readable?.scannerProvidersUsed || []).join(', ') || copy.unavailable;
  const fallbackCount = readable?.scannerFallbackCount || 0;
  const failureCount = readable?.scannerProviderFailureCount || 0;
  return copy.providersMeta(providers, fallbackCount, failureCount);
}

const AdminLogsPage: React.FC = () => {
  const { language, t } = useI18n();
  const locale = language as AdminLogsLanguage;
  const copy = ADMIN_LOGS_COPY[locale];
  const [activityTypeFilter, setActivityTypeFilter] = useState<'all' | 'admin_action' | 'user_activity'>('all');
  const [stockFilter, setStockFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [keywordFilter, setKeywordFilter] = useState('');
  const [sessions, setSessions] = useState<ExecutionLogSessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ExecutionLogSessionDetail | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [error, setError] = useState<ParsedApiError | null>(null);
  const [detailError, setDetailError] = useState<ParsedApiError | null>(null);

  const filteredSessions = sessions.filter((item) => {
    if (activityTypeFilter === 'all') {
      return true;
    }
    return String(item.readableSummary?.sessionKind || '').trim() === activityTypeFilter;
  });

  const loadSessions = useCallback(async () => {
    setIsLoadingList(true);
    setError(null);
    try {
      const response = await adminLogsApi.listSessions(
        {
          stock: stockFilter.trim() || undefined,
          status: statusFilter.trim() || undefined,
          category: categoryFilter.trim() || undefined,
          provider: keywordFilter.trim() || undefined,
          limit: 100,
        },
      );
      setSessions(response.items || []);
      if ((response.items || []).length) {
        setSelectedSessionId((prev) => prev || response.items[0].sessionId);
      }
    } catch (err) {
      setError((err as { parsedError?: ParsedApiError }).parsedError || null);
    } finally {
      setIsLoadingList(false);
    }
  }, [categoryFilter, keywordFilter, statusFilter, stockFilter]);

  useEffect(() => {
    document.title = copy.documentTitle;
  }, [copy.documentTitle]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (filteredSessions.length === 0) {
      setSelectedSessionId(null);
      return;
    }
    if (!filteredSessions.some((item) => item.sessionId === selectedSessionId)) {
      setSelectedSessionId(filteredSessions[0].sessionId);
    }
  }, [filteredSessions, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setIsLoadingDetail(true);
    setDetailError(null);
    void adminLogsApi.getSessionDetail(selectedSessionId)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch((err) => {
        if (!cancelled) {
          setDetailError((err as { parsedError?: ParsedApiError }).parsedError || null);
          setDetail(null);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSessionId]);

  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-4 py-4 md:px-6">
      <section className="theme-panel-solid rounded-[1rem] border border-border/60 p-4">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,56rem)] xl:items-end">
          <div>
            <h1 className="text-lg font-semibold text-foreground">{copy.title}</h1>
            <p className="text-sm text-secondary-text">{copy.subtitle}</p>
            <p className="mt-2 text-xs text-muted-text">{copy.scopeTitle}</p>
            <p className="mt-2 text-xs text-muted-text">{copy.filterHint(filteredSessions.length)}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[10rem_9rem_12rem_minmax(0,1fr)_9rem_auto]">
            <label className="sr-only" htmlFor="admin-logs-activity-type">{copy.activityTypeFilter}</label>
            <select
              id="admin-logs-activity-type"
              aria-label={copy.activityTypeFilter}
              className="input-surface h-10 w-full rounded-[var(--theme-control-radius)] px-3 text-sm"
              value={activityTypeFilter}
              onChange={(e) => setActivityTypeFilter(e.target.value as 'all' | 'admin_action' | 'user_activity')}
            >
              <option value="all">{t('adminLogs.activityType.all')}</option>
              <option value="admin_action">{t('adminLogs.activityType.admin_action')}</option>
              <option value="user_activity">{t('adminLogs.activityType.user_activity')}</option>
            </select>
            <label className="sr-only" htmlFor="admin-logs-stock-filter">{copy.stockFilterLabel}</label>
            <input
              id="admin-logs-stock-filter"
              aria-label={copy.stockFilterLabel}
              className="input-surface h-10 w-full rounded-[var(--theme-control-radius)] px-3 text-sm"
              placeholder={copy.stockFilterPlaceholder}
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value)}
            />
            <label className="sr-only" htmlFor="admin-logs-category-filter">{copy.categoryFilterLabel}</label>
            <select
              id="admin-logs-category-filter"
              aria-label={copy.categoryFilterLabel}
              className="input-surface h-10 w-full rounded-[var(--theme-control-radius)] px-3 text-sm"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">{t('adminLogs.allCategory')}</option>
              <option value="ai_route">{t('adminLogs.category.ai_route')}</option>
              <option value="ai_model">{t('adminLogs.category.ai_model')}</option>
              <option value="data_market">{t('adminLogs.category.data_market')}</option>
              <option value="data_fundamentals">{t('adminLogs.category.data_fundamentals')}</option>
              <option value="data_news">{t('adminLogs.category.data_news')}</option>
              <option value="data_sentiment">{t('adminLogs.category.data_sentiment')}</option>
              <option value="notification">{t('adminLogs.category.notification')}</option>
              <option value="scanner">{resolveCategoryLabel('scanner', t, copy)}</option>
              <option value="system">{t('adminLogs.category.system')}</option>
            </select>
            <label className="sr-only" htmlFor="admin-logs-provider-filter">{copy.providerFilterLabel}</label>
            <input
              id="admin-logs-provider-filter"
              aria-label={copy.providerFilterLabel}
              className="input-surface h-10 w-full rounded-[var(--theme-control-radius)] px-3 text-sm"
              placeholder={copy.providerFilterPlaceholder}
              value={keywordFilter}
              onChange={(e) => setKeywordFilter(e.target.value)}
            />
            <label className="sr-only" htmlFor="admin-logs-status-filter">{copy.statusFilterLabel}</label>
            <select
              id="admin-logs-status-filter"
              aria-label={copy.statusFilterLabel}
              className="input-surface h-10 w-full rounded-[var(--theme-control-radius)] px-3 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">{t('adminLogs.allStatus')}</option>
              <option value="running">{t('adminLogs.status.running')}</option>
              <option value="completed">{t('adminLogs.status.completed')}</option>
              <option value="failed">{t('adminLogs.status.failed')}</option>
            </select>
            <button
              type="button"
              className="btn-secondary h-10 px-3 py-1.5 text-sm sm:col-span-2 xl:col-span-1"
              onClick={() => void loadSessions()}
              disabled={isLoadingList}
            >
              {isLoadingList ? copy.loading : copy.refresh}
            </button>
          </div>
        </div>
      </section>

      {error ? <ApiErrorAlert error={error} /> : null}

      <section className="grid gap-4 lg:grid-cols-[420px,minmax(0,1fr)]">
        <div className="theme-panel-solid rounded-[1rem] border border-border/60 p-3 lg:max-h-[72vh] lg:overflow-y-auto">
          <div className="border-b border-border/50 px-2 pb-3">
            <h2 className="text-sm font-semibold text-foreground">{copy.sessionListTitle}</h2>
            <p className="mt-1 text-xs text-muted-text">{copy.sessionListHint}</p>
          </div>
          {filteredSessions.length === 0 ? (
            <div className="px-2 py-6">
              <p className="text-sm font-medium text-foreground">{copy.noSessionsTitle}</p>
              <p className="mt-1 text-sm text-muted-text">{copy.noSessionsBody}</p>
            </div>
          ) : (
            <div className="space-y-2 pt-3">
              {filteredSessions.map((item) => {
                const cls = STATUS_CLASS[item.overallStatus] || STATUS_CLASS.running;
                const selected = selectedSessionId === item.sessionId;
                const summary = item.readableSummary || {};
                const notifState = String(summary.notificationClassification || '').trim();
                return (
                  <button
                    key={item.sessionId}
                    type="button"
                    onClick={() => setSelectedSessionId(item.sessionId)}
                    className={`w-full rounded-lg border px-3 py-2 text-left ${selected ? 'border-accent bg-accent/10' : 'border-border/50 bg-muted/10 hover:bg-muted/20'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium text-foreground">{item.name || item.code || copy.unavailable}</p>
                        <p className="break-all text-xs text-muted-text">{item.sessionId}</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${cls}`}>
                        {resolveStatusLabel(item.overallStatus, t)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-secondary-text">
                      {(item.startedAt && new Date(item.startedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')) || copy.unavailable}
                    </p>
                    <p className="mt-1 break-words text-xs text-secondary-text">
                      {summary.actorDisplay || copy.unavailable} · {resolveRoleLabel(String(summary.actorRole || ''), copy)} · {resolveSubsystemLabel(String(summary.subsystem || ''), copy)}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-secondary-text">
                      <span>{resolveSessionKindLabel(String(summary.sessionKind || ''), t)}</span>
                      {summary.actionName ? <span>{summary.actionName}</span> : null}
                      {summary.scannerRunId ? <span>{formatScannerRunMeta(summary.scannerRunId, copy)}</span> : null}
                      {summary.scannerMarket ? <span>{summary.scannerMarket}</span> : null}
                      {summary.scannerShortlistCount != null ? <span>{formatScannerShortlistMeta(summary.scannerShortlistCount, copy)}</span> : null}
                      <span>{copy.finalAiModel}: {summary.finalAiModel || copy.unavailable}</span>
                      {summary.aiFallbackUsed ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                          {t('adminLogs.badge.aiFallback')}
                        </span>
                      ) : null}
                      {summary.dataFallbackUsed ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                          {t('adminLogs.badge.dataFallback')}
                        </span>
                      ) : null}
                      {notifState ? (
                        <span className={`rounded-full px-2 py-0.5 ${STATUS_CLASS[notifState] || STATUS_CLASS.running}`}>
                          {copy.notification}: {resolveStatusLabel(notifState, t)}
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="theme-panel-solid rounded-[1rem] border border-border/60 p-4 lg:max-h-[72vh] lg:overflow-y-auto">
          <div className="border-b border-border/50 pb-3">
            <h2 className="text-sm font-semibold text-foreground">{copy.sessionDetailTitle}</h2>
            <p className="mt-1 text-xs text-muted-text">{copy.sessionDetailHint}</p>
          </div>
          {detailError ? <ApiErrorAlert error={detailError} /> : null}
          {isLoadingDetail ? (
            <p className="pt-3 text-sm text-muted-text">{copy.loading}</p>
          ) : detail ? (
            <div className="space-y-4 pt-3">
              {(() => {
                const readable = detail.readableSummary || {};
                const events = Array.isArray(detail.events) ? detail.events : [];
                const notificationState = String(readable.notificationClassification || '').trim();
                return (
                  <>
                    <div>
                      <h2 className="break-words text-base font-semibold text-foreground">
                        {detail.name || detail.code || copy.unavailable}
                      </h2>
                      <p className="mt-1 break-all text-xs text-muted-text">{detail.sessionId}</p>
                    </div>
                    <section className="rounded-lg border border-border/60 bg-muted/10 p-3">
                      <h3 className="text-sm font-semibold text-foreground">{copy.executiveSummary}</h3>
                      <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
                      <p className="break-words text-secondary-text">{copy.actor}: <span className="break-words text-foreground">{sourceText(readable.actorDisplay, copy.unavailable)}</span></p>
                      <p className="break-words text-secondary-text">{copy.actorRole}: <span className="break-words text-foreground">{resolveRoleLabel(sourceText(readable.actorRole, copy.unavailable), copy)}</span></p>
                      <p className="break-words text-secondary-text">{copy.sessionKind}: <span className="break-words text-foreground">{resolveSessionKindLabel(sourceText(readable.sessionKind, copy.unavailable), t)}</span></p>
                      <p className="break-words text-secondary-text">{copy.subsystem}: <span className="break-words text-foreground">{resolveSubsystemLabel(sourceText(readable.subsystem, copy.unavailable), copy)}</span></p>
                      <p className="break-all text-secondary-text">{copy.actionName}: <span className="break-all text-foreground">{sourceText(readable.actionName, copy.unavailable)}</span></p>
                      <p className="break-words text-secondary-text">{copy.destructive}: <span className="break-words text-foreground">{formatBooleanState(readable.destructive, copy)}</span></p>
                      <p className="break-all text-secondary-text">{copy.finalAiModel}: <span className="break-all text-foreground">{sourceText(readable.finalAiModel, copy.unavailable)}</span></p>
                      <p className="break-words text-secondary-text">{copy.aiAttempts}: <span className="break-words text-foreground">{formatOptionalCount(readable.aiAttemptsCount, copy)}</span></p>
                      <p className="break-all text-secondary-text">{copy.finalMarketSource}: <span className="break-all text-foreground">{sourceText(readable.finalMarketSource, copy.unavailable)}</span></p>
                      <p className="break-all text-secondary-text">{copy.finalFundamentalSource}: <span className="break-all text-foreground">{sourceText(readable.finalFundamentalSource, copy.unavailable)}</span></p>
                      <p className="break-all text-secondary-text">{copy.finalNewsSource}: <span className="break-all text-foreground">{sourceText(readable.finalNewsSource, copy.unavailable)}</span></p>
                      <p className="break-all text-secondary-text">{copy.finalSentimentSource}: <span className="break-all text-foreground">{sourceText(readable.finalSentimentSource, copy.unavailable)}</span></p>
                      <p className="break-words text-secondary-text">
                        {copy.notification}: <span className="break-words text-foreground">{notificationState ? resolveStatusLabel(notificationState, t) : copy.unavailable}</span>
                      </p>
                      <p className="break-words text-secondary-text">
                        {copy.topFailureReason}: <span className="break-words text-foreground">{sourceText(readable.topFailureReason, copy.unavailable)}</span>
                      </p>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {readable.aiFallbackUsed ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                          {t('adminLogs.badge.aiFallback')}
                        </span>
                      ) : null}
                      {readable.dataFallbackUsed ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                          {t('adminLogs.badge.dataFallback')}
                        </span>
                      ) : null}
                      {notificationState ? (
                        <span className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS_CLASS[notificationState] || STATUS_CLASS.running}`}>
                          {resolveStatusLabel(notificationState, t)}
                        </span>
                      ) : null}
                    </div>
                    {readable.summaryParagraph ? (
                      <p className="mt-2 rounded-md border border-border/40 bg-base/60 px-2.5 py-2 text-xs leading-5 text-secondary-text">
                        {readable.summaryParagraph}
                      </p>
                    ) : null}
                    {readable.scannerCoverageSummary ? (
                      <div className="mt-2 rounded-md border border-border/40 bg-base/60 px-2.5 py-2 text-xs leading-5 text-secondary-text">
                        <p className="text-foreground">{readable.scannerCoverageSummary}</p>
                        <p className="mt-1">
                          {formatScannerCoverageMeta(readable, copy)}
                        </p>
                      </div>
                    ) : null}
                    </section>
                    <div className="grid gap-2 md:grid-cols-2">
                      <p className="break-all text-xs text-secondary-text">{copy.queryId}: <span className="break-all text-foreground">{detail.queryId || copy.unavailable}</span></p>
                      <p className="break-all text-xs text-secondary-text">{copy.taskId}: <span className="break-all text-foreground">{detail.taskId || copy.unavailable}</span></p>
                    </div>
                    <h3 className="text-sm font-semibold text-foreground">{copy.timelineTitle}</h3>
                    <div className="space-y-2">
                      {events.length === 0 ? (
                        <div className="rounded-md border border-border/50 bg-muted/10 px-3 py-3">
                          <p className="text-sm font-medium text-foreground">{copy.emptyTimelineTitle}</p>
                          <p className="mt-1 text-sm text-muted-text">{copy.emptyTimelineBody}</p>
                        </div>
                      ) : events.map((event) => {
                        const statusKey = STATUS_CLASS[event.status] ? event.status : (event.status === 'failed' ? 'failed_runtime' : 'running');
                        const category = normalizeCategory(event.category || event.phase);
                        const action = String(event.action || event.step || copy.unavailable).trim();
                        const outcome = String(event.outcome || '').trim().toLowerCase();
                        const reason = String(event.reason || '').trim();
                        return (
                          <div key={event.id} className="rounded-md border border-border/50 bg-muted/10 px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-border/60 bg-base/60 px-2 py-0.5 text-[11px] font-medium text-foreground">
                                {resolveCategoryLabel(category, t, copy)}
                              </span>
                              <span className="break-all rounded-full border border-border/50 px-2 py-0.5 text-[11px] text-secondary-text">
                                {resolveActionLabel(action, t)}
                              </span>
                              <span className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS_CLASS[statusKey]}`}>
                                {resolveStatusLabel(statusKey, t)}
                              </span>
                              {outcome ? (
                                <span className="rounded-full border border-border/50 bg-base/60 px-2 py-0.5 text-[11px] text-secondary-text">
                                  {copy.outcome}: {t(`adminLogs.outcomeState.${outcome}`)}
                                </span>
                              ) : null}
                              <span className="break-all text-xs text-muted-text">{event.target || copy.unavailable}</span>
                            </div>
                            {event.message ? (
                              <p className="mt-1 break-words text-xs text-secondary-text">{event.message}</p>
                            ) : null}
                            {reason ? (
                              <p className="mt-1 break-words text-[11px] text-muted-text">
                                {copy.reason}: {reason}
                              </p>
                            ) : null}
                            <p className="mt-1 text-[11px] text-muted-text">
                              {(event.eventAt && new Date(event.eventAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')) || copy.unavailable}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </div>
          ) : (
            <div className="pt-3">
              <p className="text-sm font-medium text-foreground">{copy.selectSessionTitle}</p>
              <p className="mt-1 text-sm text-muted-text">{copy.selectSessionBody}</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
};

export default AdminLogsPage;
