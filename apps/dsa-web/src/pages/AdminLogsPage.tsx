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

const AdminLogsPage: React.FC = () => {
  const { language, t } = useI18n();
  const locale = language as AdminLogsLanguage;
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
      className="flex h-full min-h-0 w-full flex-1 min-w-0 flex-col gap-6 overflow-y-auto px-6 py-8 md:px-8 xl:px-12"
    >
      <section className="rounded-[24px] border border-white/5 bg-white/[0.02] p-6 backdrop-blur-sm">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,64rem)] xl:items-end">
          <div>
            <h1 className="text-[1.65rem] font-semibold tracking-tight text-foreground">{t('adminLogs.pageTitle')}</h1>
            <p className="mt-2 text-[14px] leading-relaxed text-secondary-text">{t('adminLogs.pageSubtitle')}</p>
            <p className="mt-4 text-[10px] uppercase tracking-[0.28em] text-white/36">{t('adminLogs.scopeTitle')}</p>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-text">{t('adminLogs.filterHintDetailed', { count: filteredSessions.length })}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[10rem_9rem_11rem_minmax(0,1fr)_9rem_auto]">
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
      </section>

      {error ? <ApiErrorAlert error={error} /> : null}

      <section className="rounded-[24px] border border-white/5 bg-white/[0.02] p-6 backdrop-blur-sm">
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
            <div className="hidden grid-cols-[11rem_8rem_11rem_minmax(0,1fr)] gap-4 border-b border-white/5 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38 md:grid">
              <div>{locale === 'zh' ? '时间' : 'Time'}</div>
              <div>{locale === 'zh' ? '级别' : 'Level'}</div>
              <div>{locale === 'zh' ? '模块' : 'Module'}</div>
              <div>{locale === 'zh' ? '摘要' : 'Summary'}</div>
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
                return (
                  <button
                    key={item.sessionId}
                    type="button"
                    onClick={() => setSelectedSessionId(item.sessionId)}
                    className={`grid w-full gap-3 px-4 py-4 text-left transition-colors md:grid-cols-[11rem_8rem_11rem_minmax(0,1fr)] ${selected ? 'bg-white/[0.05]' : 'hover:bg-white/[0.02]'}`}
                  >
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-white/32 md:hidden">{locale === 'zh' ? '时间' : 'Time'}</p>
                      <p className="mt-1 text-sm text-secondary-text md:mt-0">{timeText}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-white/32 md:hidden">{locale === 'zh' ? '级别' : 'Level'}</p>
                      <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] md:mt-0 ${cls}`}>
                        {resolveStatusLabel(item.overallStatus, t)}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-white/32 md:hidden">{locale === 'zh' ? '模块' : 'Module'}</p>
                      <p className="mt-1 text-sm text-secondary-text md:mt-0">{moduleText}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-white/32 md:hidden">{locale === 'zh' ? '摘要' : 'Summary'}</p>
                      <p className="mt-1 break-words text-sm font-medium text-foreground md:mt-0">{summaryTitle}</p>
                      <p className="break-all text-xs text-muted-text">{item.sessionId}</p>
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
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-[24px] border border-white/5 bg-white/[0.02] p-6 backdrop-blur-sm">
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
                return (
                  <>
                    <div>
                      <h2 className="break-words text-base font-semibold text-foreground">
                        {detail.name || detail.code || t('adminLogs.unavailable')}
                      </h2>
                      <p className="mt-1 break-all text-xs text-muted-text">{detail.sessionId}</p>
                    </div>
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
      </section>
    </section>
  );
};

export default AdminLogsPage;
