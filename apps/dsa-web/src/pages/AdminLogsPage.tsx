import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { adminLogsApi, type ExecutionLogSessionDetail, type ExecutionLogSessionSummary } from '../api/adminLogs';
import { useI18n } from '../contexts/UiLanguageContext';
import { ApiErrorAlert, GlassCard } from '../components/common';
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
type TranslateFn = (key: string, params?: Record<string, string | number | undefined>) => string;

function sourceText(value?: string | null, fallback = '--'): string {
  const text = String(value || '').trim();
  return text || fallback;
}

function normalizeCategory(value?: string | null): string {
  return String(value || '').trim().toLowerCase();
}

function resolveCategoryLabel(
  category: string,
  t: TranslateFn,
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
    return t('adminLogs.scannerLabel');
  }
  return mapping[key] ? t(mapping[key]) : (category || t('adminLogs.unavailable'));
}

function resolveActionLabel(action: string, t: TranslateFn): string {
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

function resolveStatusLabel(status: string, t: TranslateFn): string {
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

function resolveRoleLabel(role: string, t: TranslateFn): string {
  const key = String(role || '').trim().toLowerCase();
  if (key === 'admin') return t('adminLogs.role.admin');
  if (key === 'user') return t('adminLogs.role.user');
  return role || t('adminLogs.unavailable');
}

function resolveSessionKindLabel(kind: string, t: TranslateFn): string {
  const key = String(kind || '').trim().toLowerCase();
  if (key === 'admin_action' || key === 'user_activity') {
    return t(`adminLogs.activityType.${key}`);
  }
  return kind || '--';
}

function resolveSubsystemLabel(subsystem: string, t: TranslateFn): string {
  const key = String(subsystem || '').trim().toLowerCase();
  if (key === 'system_control') return t('adminLogs.subsystemLabel.system_control');
  if (key === 'analysis') return t('adminLogs.subsystemLabel.analysis');
  if (key === 'scanner') return t('adminLogs.subsystemLabel.scanner');
  return subsystem || t('adminLogs.unavailable');
}

function formatScannerRunMeta(runId: number, t: TranslateFn): string {
  return t('adminLogs.scannerRunMeta', { runId });
}

function formatScannerShortlistMeta(count: number, t: TranslateFn): string {
  return t('adminLogs.scannerShortlistMeta', { count });
}

function formatBooleanState(value: boolean | undefined, t: TranslateFn): string {
  if (value == null) return t('adminLogs.unavailable');
  return value ? t('adminLogs.boolean.yes') : t('adminLogs.boolean.no');
}

function formatOptionalCount(value: number | null | undefined, t: TranslateFn): string {
  if (value == null) return t('adminLogs.unavailable');
  return String(value);
}

function formatScannerCoverageMeta(
  readable: ExecutionLogSessionDetail['readableSummary'],
  t: TranslateFn,
): string {
  const providers = (readable?.scannerProvidersUsed || []).join(', ') || t('adminLogs.unavailable');
  const fallbackCount = readable?.scannerFallbackCount || 0;
  const failureCount = readable?.scannerProviderFailureCount || 0;
  return t('adminLogs.providersMeta', { providers, fallbackCount, failureCount });
}

function operationText(value: unknown, fallback = '--'): string {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function operationStatusClass(status?: string | null): string {
  const normalized = String(status || '').trim().toLowerCase();
  if (['success', 'succeeded', 'completed', 'ok'].includes(normalized)) {
    return 'theme-log-status theme-log-status--success';
  }
  if (['partial fail', 'partial_success', 'fallback', 'warning', 'switched_to_fallback'].includes(normalized)) {
    return 'theme-log-status theme-log-status--warning';
  }
  if (['fail', 'failed', 'error'].includes(normalized)) {
    return 'theme-log-status theme-log-status--danger';
  }
  return 'theme-log-status';
}

function asRecordList(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)) : [];
}

function downloadLogJson(detail: ExecutionLogSessionDetail): void {
  const blob = new Blob([JSON.stringify(detail, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `wolfystock-log-${detail.sessionId}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function copyLogJson(detail: ExecutionLogSessionDetail): Promise<void> {
  const text = JSON.stringify(detail, null, 2);
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  }
}

const AdminLogsPage: React.FC = () => {
  const { language, t } = useI18n();
  const locale = language as AdminLogsLanguage;
  const [activityTypeFilter, setActivityTypeFilter] = useState<'all' | 'admin_action' | 'user_activity'>('all');
  const [stockFilter, setStockFilter] = useState('');
  const [taskIdFilter, setTaskIdFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [keywordFilter, setKeywordFilter] = useState('');
  const [modelFilter, setModelFilter] = useState('');
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
          taskId: taskIdFilter.trim() || undefined,
          stock: stockFilter.trim() || undefined,
          status: statusFilter.trim() || undefined,
          category: categoryFilter.trim() || undefined,
          provider: keywordFilter.trim() || undefined,
          model: modelFilter.trim() || undefined,
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
  }, [categoryFilter, keywordFilter, modelFilter, statusFilter, stockFilter, taskIdFilter]);

  useEffect(() => {
    document.title = t('adminLogs.documentTitle');
  }, [t]);

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
    <section
      data-testid="admin-logs-workspace"
      className="flex min-h-0 w-full flex-1 min-w-0 flex-col gap-6"
    >
      <GlassCard as="section" className="p-6">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,64rem)] xl:items-end">
          <div>
            <h1 className="text-[1.65rem] font-semibold tracking-tight text-foreground">{t('adminLogs.pageTitle')}</h1>
            <p className="mt-2 text-[14px] leading-relaxed text-secondary-text">{t('adminLogs.pageSubtitle')}</p>
            <p className="mt-4 text-[10px] uppercase tracking-[0.28em] text-white/36">{t('adminLogs.scopeTitle')}</p>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-text">{t('adminLogs.filterHintDetailed', { count: filteredSessions.length })}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[10rem_9rem_12rem_12rem_minmax(0,1fr)_9rem_auto]">
            <label className="sr-only" htmlFor="admin-logs-activity-type">{t('adminLogs.activityTypeLabel')}</label>
            <select
              id="admin-logs-activity-type"
              aria-label={t('adminLogs.activityTypeLabel')}
              className="input-surface h-10 w-full rounded-xl px-3 text-sm"
              value={activityTypeFilter}
              onChange={(e) => setActivityTypeFilter(e.target.value as 'all' | 'admin_action' | 'user_activity')}
            >
              <option value="all">{t('adminLogs.activityType.all')}</option>
              <option value="admin_action">{t('adminLogs.activityType.admin_action')}</option>
              <option value="user_activity">{t('adminLogs.activityType.user_activity')}</option>
            </select>
            <label className="sr-only" htmlFor="admin-logs-stock-filter">{t('adminLogs.stockFilterLabel')}</label>
            <input
              id="admin-logs-stock-filter"
              aria-label={t('adminLogs.stockFilterLabel')}
              className="input-surface h-10 w-full rounded-xl px-3 text-sm"
              placeholder={t('adminLogs.stockFilterPlaceholder')}
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value)}
            />
            <label className="sr-only" htmlFor="admin-logs-task-filter">{locale === 'en' ? 'Task ID' : '任务 ID'}</label>
            <input
              id="admin-logs-task-filter"
              aria-label={locale === 'en' ? 'Task ID' : '任务 ID'}
              className="input-surface h-10 w-full rounded-xl px-3 text-sm"
              placeholder={locale === 'en' ? 'Filter task ID' : '按任务 ID 过滤'}
              value={taskIdFilter}
              onChange={(e) => setTaskIdFilter(e.target.value)}
            />
            <label className="sr-only" htmlFor="admin-logs-category-filter">{t('adminLogs.categoryFilterLabel')}</label>
            <select
              id="admin-logs-category-filter"
              aria-label={t('adminLogs.categoryFilterLabel')}
              className="input-surface h-10 w-full rounded-xl px-3 text-sm"
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
              <option value="scanner">{resolveCategoryLabel('scanner', t)}</option>
              <option value="system">{t('adminLogs.category.system')}</option>
            </select>
            <label className="sr-only" htmlFor="admin-logs-provider-filter">{t('adminLogs.providerFilterLabel')}</label>
            <input
              id="admin-logs-provider-filter"
              aria-label={t('adminLogs.providerFilterLabel')}
              className="input-surface h-10 w-full rounded-xl px-3 text-sm"
              placeholder={t('adminLogs.providerFilterPlaceholder')}
              value={keywordFilter}
              onChange={(e) => setKeywordFilter(e.target.value)}
            />
            <label className="sr-only" htmlFor="admin-logs-model-filter">{locale === 'en' ? 'Model version' : '模型版本'}</label>
            <input
              id="admin-logs-model-filter"
              aria-label={locale === 'en' ? 'Model version' : '模型版本'}
              className="input-surface h-10 w-full rounded-xl px-3 text-sm"
              placeholder={locale === 'en' ? 'LLM model version' : 'LLM 模型版本'}
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
            />
            <label className="sr-only" htmlFor="admin-logs-status-filter">{t('adminLogs.statusFilterLabel')}</label>
            <select
              id="admin-logs-status-filter"
              aria-label={t('adminLogs.statusFilterLabel')}
              className="input-surface h-10 w-full rounded-xl px-3 text-sm"
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
              className="btn-secondary h-10 rounded-xl px-4 py-1.5 text-sm sm:col-span-2 xl:col-span-1"
              onClick={() => void loadSessions()}
              disabled={isLoadingList}
            >
              {isLoadingList ? t('adminLogs.loading') : t('adminLogs.refreshButton')}
            </button>
          </div>
        </div>
      </GlassCard>

      {error ? <ApiErrorAlert error={error} /> : null}

      <GlassCard as="section" className="p-6">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-foreground">{t('adminLogs.sessionListTitle')}</h2>
          <p className="mt-1 text-xs text-muted-text">{t('adminLogs.sessionListHint')}</p>
        </div>
        {filteredSessions.length === 0 ? (
          <div className="rounded-2xl bg-white/[0.02] px-4 py-6">
            <p className="text-sm font-medium text-foreground">{t('adminLogs.noSessionsTitle')}</p>
            <p className="mt-1 text-sm text-muted-text">{t('adminLogs.noSessionsBody')}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-white/[0.015]">
            <div className="hidden grid-cols-[11rem_minmax(7rem,1fr)_12rem_8rem_minmax(8rem,1fr)_8rem] gap-4 border-b border-white/5 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38 md:grid">
              <div>{locale === 'zh' ? '时间' : 'Time'}</div>
              <div>{t('adminLogs.operationTarget')}</div>
              <div>{t('adminLogs.operationType')}</div>
              <div>{locale === 'zh' ? '状态' : 'Status'}</div>
              <div>{t('adminLogs.keyMetric')}</div>
              <div>{locale === 'zh' ? '操作' : 'Action'}</div>
            </div>
            <div className="divide-y divide-white/5">
              {filteredSessions.map((item) => {
                const cls = STATUS_CLASS[item.overallStatus] || STATUS_CLASS.running;
                const selected = selectedSessionId === item.sessionId;
                const summary = item.readableSummary || {};
                const notifState = String(summary.notificationClassification || '').trim();
                const summaryTitle = item.name || item.code || t('adminLogs.unavailable');
                const timeText = (item.startedAt && new Date(item.startedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')) || t('adminLogs.unavailable');
                const moduleText = `${resolveSubsystemLabel(String(summary.subsystem || ''), t)}${summary.sessionKind ? ` · ${resolveSessionKindLabel(String(summary.sessionKind || ''), t)}` : ''}`;
                const operationType = sourceText(summary.operationType, moduleText);
                const operationTarget = sourceText(summary.operationTarget, summaryTitle);
                const operationStatus = sourceText(summary.operationStatus, item.overallStatus);
                const keyMetric = sourceText(summary.keyMetric, t('adminLogs.unavailable'));
                return (
                  <button
                    key={item.sessionId}
                    type="button"
                    onClick={() => setSelectedSessionId(item.sessionId)}
                    className={`grid w-full gap-3 px-4 py-4 text-left transition-colors md:grid-cols-[11rem_minmax(7rem,1fr)_12rem_8rem_minmax(8rem,1fr)_8rem] ${selected ? 'bg-white/[0.05]' : 'hover:bg-white/[0.02]'}`}
                  >
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-white/32 md:hidden">{locale === 'zh' ? '时间' : 'Time'}</p>
                      <p className="mt-1 text-sm text-secondary-text md:mt-0">{timeText}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-white/32 md:hidden">{t('adminLogs.operationTarget')}</p>
                      <p className="mt-1 break-words text-sm font-medium text-foreground md:mt-0">{operationTarget}</p>
                      <p className="break-all text-[11px] text-muted-text">{item.sessionId}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-white/32 md:hidden">{t('adminLogs.operationType')}</p>
                      <p className="mt-1 break-words text-sm text-secondary-text md:mt-0">{operationType}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-white/32 md:hidden">{locale === 'zh' ? '状态' : 'Status'}</p>
                      <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] md:mt-0 ${operationStatusClass(operationStatus) || cls}`}>
                        {operationStatus}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-white/32 md:hidden">{t('adminLogs.keyMetric')}</p>
                      <p className="mt-1 break-words text-sm text-secondary-text md:mt-0">{keyMetric}</p>
                      {item.taskId ? (
                        <p className="break-all text-xs text-muted-text">
                          {locale === 'en' ? 'Task ID' : '任务 ID'}: {item.taskId}
                        </p>
                      ) : null}
                      <p className="mt-2 break-words text-xs text-secondary-text">
                        {summary.actorDisplay || t('adminLogs.unavailable')} · {resolveRoleLabel(String(summary.actorRole || ''), t)} · {resolveSessionKindLabel(String(summary.sessionKind || ''), t)}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-secondary-text">
                        {summary.actionName ? <span>{summary.actionName}</span> : null}
                        {summary.scannerRunId ? <span>{formatScannerRunMeta(summary.scannerRunId, t)}</span> : null}
                        {summary.scannerMarket ? <span>{summary.scannerMarket}</span> : null}
                        {summary.scannerShortlistCount != null ? <span>{formatScannerShortlistMeta(summary.scannerShortlistCount, t)}</span> : null}
                        <span>{t('adminLogs.finalAiModel')}: {summary.finalAiModel || t('adminLogs.unavailable')}</span>
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
                            {t('adminLogs.notification')}: {resolveStatusLabel(notifState, t)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <span className="btn-secondary inline-flex rounded-xl px-3 py-1.5 text-xs">
                        {t('adminLogs.viewDetails')}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </GlassCard>

      <GlassCard as="section" className="p-6">
        <div className="mb-4 border-b border-white/5 pb-4">
          <h2 className="text-sm font-semibold text-foreground">{t('adminLogs.sessionDetailTitle')}</h2>
          <p className="mt-1 text-xs text-muted-text">{t('adminLogs.sessionDetailHint')}</p>
        </div>
          {detailError ? <ApiErrorAlert error={detailError} /> : null}
          {isLoadingDetail ? (
            <p className="pt-3 text-sm text-muted-text">{t('adminLogs.loading')}</p>
          ) : detail ? (
            <div className="space-y-5 pt-2">
              {(() => {
                const readable = detail.readableSummary || {};
                const events = Array.isArray(detail.events) ? detail.events : [];
                const notificationState = String(readable.notificationClassification || '').trim();
                const operationDetail = detail.operationDetail || {};
                const aiCalls = asRecordList(operationDetail.aiCalls);
                const dataSourceCalls = asRecordList(operationDetail.dataSourceCalls);
                const operationTimeline = asRecordList(operationDetail.timeline);
                const diagnostics = asRecordList(operationDetail.diagnostics);
                return (
                  <>
                    <div>
                      <h2 className="break-words text-base font-semibold text-foreground">
                        {detail.name || detail.code || t('adminLogs.unavailable')}
                      </h2>
                      <p className="mt-1 break-all text-xs text-muted-text">{detail.sessionId}</p>
                    </div>
                    <section className="rounded-2xl border border-white/5 bg-white/[0.018] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.22em] text-white/36">{t('adminLogs.operationType')}</p>
                          <h3 className="mt-1 text-lg font-semibold text-foreground">
                            {sourceText(operationDetail.operationType || readable.operationType, t('adminLogs.unavailable'))}
                          </h3>
                          <p className="mt-1 text-sm text-secondary-text">
                            {t('adminLogs.operationTarget')}: {sourceText(operationDetail.target || readable.operationTarget, t('adminLogs.unavailable'))}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className={`rounded-full px-2.5 py-1 text-xs ${operationStatusClass(String(operationDetail.status || readable.operationStatus || detail.overallStatus))}`}>
                            {sourceText(operationDetail.status || readable.operationStatus || detail.overallStatus, t('adminLogs.unavailable'))}
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-secondary-text">
                            {t('adminLogs.keyMetric')}: {sourceText(operationDetail.keyMetric || readable.keyMetric, t('adminLogs.unavailable'))}
                          </span>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button type="button" className="btn-secondary rounded-xl px-3 py-1.5 text-xs" onClick={() => void copyLogJson(detail)}>
                          {t('adminLogs.copyDetails')}
                        </button>
                        <button type="button" className="btn-secondary rounded-xl px-3 py-1.5 text-xs" onClick={() => downloadLogJson(detail)}>
                          {t('adminLogs.exportDetails')}
                        </button>
                      </div>
                    </section>
                    <details className="rounded-2xl bg-white/[0.015] p-4" open>
                      <summary className="cursor-pointer text-sm font-semibold text-foreground">{t('adminLogs.aiInvocationTable')}</summary>
                      <div className="mt-3 overflow-x-auto">
                        <table className="min-w-full text-left text-xs">
                          <thead className="text-white/40">
                            <tr>
                              <th className="py-2 pr-4">{t('adminLogs.modelColumn')}</th>
                              <th className="py-2 pr-4">{t('adminLogs.versionColumn')}</th>
                              <th className="py-2 pr-4">{t('adminLogs.statusColumn')}</th>
                              <th className="py-2 pr-4">{t('adminLogs.notesColumn')}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {aiCalls.length ? aiCalls.map((call, index) => (
                              <tr key={`${operationText(call.model)}-${index}`}>
                                <td className="py-2 pr-4 text-foreground">{operationText(call.model)}</td>
                                <td className="py-2 pr-4 text-secondary-text">{operationText(call.version)}</td>
                                <td className="py-2 pr-4"><span className={`rounded-full px-2 py-0.5 ${operationStatusClass(String(call.status || ''))}`}>{operationText(call.status)}</span></td>
                                <td className="py-2 pr-4 text-secondary-text">{operationText(call.notes || call.fallbackChain || call.error)}</td>
                              </tr>
                            )) : (
                              <tr><td className="py-3 text-muted-text" colSpan={4}>{t('adminLogs.emptyOperationTable')}</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </details>
                    <details className="rounded-2xl bg-white/[0.015] p-4" open>
                      <summary className="cursor-pointer text-sm font-semibold text-foreground">{t('adminLogs.dataSourceTable')}</summary>
                      <div className="mt-3 overflow-x-auto">
                        <table className="min-w-full text-left text-xs">
                          <thead className="text-white/40">
                            <tr>
                              <th className="py-2 pr-4">{t('adminLogs.sourceColumn')}</th>
                              <th className="py-2 pr-4">{t('adminLogs.statusColumn')}</th>
                              <th className="py-2 pr-4">{t('adminLogs.errorColumn')}</th>
                              <th className="py-2 pr-4">{t('adminLogs.retryFallbackColumn')}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {dataSourceCalls.length ? dataSourceCalls.map((call, index) => (
                              <tr key={`${operationText(call.source)}-${index}`}>
                                <td className="py-2 pr-4 text-foreground">{operationText(call.source)}</td>
                                <td className="py-2 pr-4"><span className={`rounded-full px-2 py-0.5 ${operationStatusClass(String(call.status || ''))}`}>{operationText(call.status)}</span></td>
                                <td className="py-2 pr-4 text-secondary-text">{operationText(call.error)}</td>
                                <td className="py-2 pr-4 text-secondary-text">{operationText(call.retryFallback || call.notes)}</td>
                              </tr>
                            )) : (
                              <tr><td className="py-3 text-muted-text" colSpan={4}>{t('adminLogs.emptyOperationTable')}</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </details>
                    <details className="rounded-2xl bg-white/[0.015] p-4" open>
                      <summary className="cursor-pointer text-sm font-semibold text-foreground">{t('adminLogs.operationTimelineTitle')}</summary>
                      <div className="mt-3 space-y-2">
                        {operationTimeline.length ? operationTimeline.map((item, index) => (
                          <div key={`${operationText(item.label)}-${index}`} className="rounded-xl border border-white/5 bg-black/10 px-3 py-2 text-xs">
                            <p className="text-foreground">{operationText(item.label)}</p>
                            <p className="mt-1 text-muted-text">{operationText(item.timestamp)} · {operationText(item.category)} · {operationText(item.status)}</p>
                          </div>
                        )) : <p className="text-xs text-muted-text">{t('adminLogs.emptyTimelineBody')}</p>}
                      </div>
                    </details>
                    <details className="rounded-2xl bg-white/[0.015] p-4" open>
                      <summary className="cursor-pointer text-sm font-semibold text-foreground">{t('adminLogs.diagnosticsTitle')}</summary>
                      <div className="mt-3 space-y-2">
                        {diagnostics.length ? diagnostics.map((item, index) => (
                          <div key={`${operationText(item.source)}-${index}`} className="rounded-xl border border-rose-400/15 bg-rose-500/5 px-3 py-2 text-xs">
                            <p className="text-rose-100">{operationText(item.message)}</p>
                            <p className="mt-1 text-muted-text">{operationText(item.source)} · {operationText(item.severity)}</p>
                            {item.stackTrace ? <p className="mt-1 break-words font-mono text-[11px] text-rose-100/80">{operationText(item.stackTrace)}</p> : null}
                          </div>
                        )) : <p className="text-xs text-muted-text">{t('adminLogs.noDiagnostics')}</p>}
                      </div>
                    </details>
                    <section className="rounded-2xl bg-white/[0.015] p-4">
                      <h3 className="text-sm font-semibold text-foreground">{t('adminLogs.executiveSummary')}</h3>
                      <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
                      <p className="break-words text-secondary-text">{t('adminLogs.actor')}: <span className="break-words text-foreground">{sourceText(readable.actorDisplay, t('adminLogs.unavailable'))}</span></p>
                      <p className="break-words text-secondary-text">{t('adminLogs.actorRole')}: <span className="break-words text-foreground">{resolveRoleLabel(sourceText(readable.actorRole, t('adminLogs.unavailable')), t)}</span></p>
                      <p className="break-words text-secondary-text">{t('adminLogs.sessionKind')}: <span className="break-words text-foreground">{resolveSessionKindLabel(sourceText(readable.sessionKind, t('adminLogs.unavailable')), t)}</span></p>
                      <p className="break-words text-secondary-text">{t('adminLogs.subsystem')}: <span className="break-words text-foreground">{resolveSubsystemLabel(sourceText(readable.subsystem, t('adminLogs.unavailable')), t)}</span></p>
                      <p className="break-all text-secondary-text">{t('adminLogs.actionName')}: <span className="break-all text-foreground">{sourceText(readable.actionName, t('adminLogs.unavailable'))}</span></p>
                      <p className="break-words text-secondary-text">{t('adminLogs.destructive')}: <span className="break-words text-foreground">{formatBooleanState(readable.destructive, t)}</span></p>
                      <p className="break-all text-secondary-text">{t('adminLogs.finalAiModel')}: <span className="break-all text-foreground">{sourceText(readable.finalAiModel, t('adminLogs.unavailable'))}</span></p>
                      <p className="break-words text-secondary-text">{t('adminLogs.aiAttempts')}: <span className="break-words text-foreground">{formatOptionalCount(readable.aiAttemptsCount, t)}</span></p>
                      <p className="break-all text-secondary-text">{t('adminLogs.finalMarketSource')}: <span className="break-all text-foreground">{sourceText(readable.finalMarketSource, t('adminLogs.unavailable'))}</span></p>
                      <p className="break-all text-secondary-text">{t('adminLogs.finalFundamentalSource')}: <span className="break-all text-foreground">{sourceText(readable.finalFundamentalSource, t('adminLogs.unavailable'))}</span></p>
                      <p className="break-all text-secondary-text">{t('adminLogs.finalNewsSource')}: <span className="break-all text-foreground">{sourceText(readable.finalNewsSource, t('adminLogs.unavailable'))}</span></p>
                      <p className="break-all text-secondary-text">{t('adminLogs.finalSentimentSource')}: <span className="break-all text-foreground">{sourceText(readable.finalSentimentSource, t('adminLogs.unavailable'))}</span></p>
                      <p className="break-words text-secondary-text">
                        {t('adminLogs.notification')}: <span className="break-words text-foreground">{notificationState ? resolveStatusLabel(notificationState, t) : t('adminLogs.unavailable')}</span>
                      </p>
                      <p className="break-words text-secondary-text">
                        {t('adminLogs.topFailureReason')}: <span className="break-words text-foreground">{sourceText(readable.topFailureReason, t('adminLogs.unavailable'))}</span>
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
                          {formatScannerCoverageMeta(readable, t)}
                        </p>
                      </div>
                    ) : null}
                    </section>
                    <div className="grid gap-2 md:grid-cols-2">
                      <p className="break-all text-xs text-secondary-text">{t('adminLogs.queryId')}: <span className="break-all text-foreground">{detail.queryId || t('adminLogs.unavailable')}</span></p>
                      <p className="break-all text-xs text-secondary-text">{t('adminLogs.taskId')}: <span className="break-all text-foreground">{detail.taskId || t('adminLogs.unavailable')}</span></p>
                    </div>
                    <h3 className="text-sm font-semibold text-foreground">{t('adminLogs.timelineTitle')}</h3>
                    <div className="overflow-hidden rounded-2xl bg-white/[0.015]">
                      {events.length === 0 ? (
                        <div className="px-4 py-4">
                          <p className="text-sm font-medium text-foreground">{t('adminLogs.emptyTimelineTitle')}</p>
                          <p className="mt-1 text-sm text-muted-text">{t('adminLogs.emptyTimelineBody')}</p>
                        </div>
                      ) : events.map((event) => {
                        const statusKey = STATUS_CLASS[event.status] ? event.status : (event.status === 'failed' ? 'failed_runtime' : 'running');
                        const category = normalizeCategory(event.category || event.phase);
                        const action = String(event.action || event.step || t('adminLogs.unavailable')).trim();
                        const outcome = String(event.outcome || '').trim().toLowerCase();
                        const reason = String(event.reason || '').trim();
                        return (
                          <div key={event.id} className="border-b border-white/5 px-4 py-3 last:border-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-border/60 bg-base/60 px-2 py-0.5 text-[11px] font-medium text-foreground">
                                {resolveCategoryLabel(category, t)}
                              </span>
                              <span className="break-all rounded-full border border-border/50 px-2 py-0.5 text-[11px] text-secondary-text">
                                {resolveActionLabel(action, t)}
                              </span>
                              <span className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS_CLASS[statusKey]}`}>
                                {resolveStatusLabel(statusKey, t)}
                              </span>
                              {outcome ? (
                                <span className="rounded-full border border-border/50 bg-base/60 px-2 py-0.5 text-[11px] text-secondary-text">
                                  {t('adminLogs.outcome')}: {t(`adminLogs.outcomeState.${outcome}`)}
                                </span>
                              ) : null}
                              <span className="break-all text-xs text-muted-text">{event.target || t('adminLogs.unavailable')}</span>
                              {event.errorCode ? (
                                <span className="rounded-full border border-rose-400/20 bg-rose-500/10 px-2 py-0.5 text-[11px] text-rose-100">
                                  {event.errorCode}
                                </span>
                              ) : null}
                            </div>
                            {event.message ? (
                              <p className="mt-1 break-words text-xs text-secondary-text">{event.message}</p>
                            ) : null}
                            {reason ? (
                              <p className="mt-1 break-words text-[11px] text-muted-text">
                                {t('adminLogs.reason')}: {reason}
                              </p>
                            ) : null}
                            <p className="mt-1 text-[11px] text-muted-text">
                              {(event.eventAt && new Date(event.eventAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')) || t('adminLogs.unavailable')}
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
              <p className="text-sm font-medium text-foreground">{t('adminLogs.selectSessionTitle')}</p>
              <p className="mt-1 text-sm text-muted-text">{t('adminLogs.selectSessionBody')}</p>
            </div>
          )}
      </GlassCard>
    </section>
  );
};

export default AdminLogsPage;
