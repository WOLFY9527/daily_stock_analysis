import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminLogsApi, type ExecutionLogSessionDetail, type ExecutionLogSessionSummary } from '../api/adminLogs';
import type { ParsedApiError } from '../api/error';
import { ApiErrorAlert, Drawer, GlassCard } from '../components/common';
import { useI18n } from '../contexts/UiLanguageContext';

type AdminLogsLanguage = 'zh' | 'en';
type TranslateFn = (key: string, params?: Record<string, string | number | undefined>) => string;
type OperationType = 'single_stock_analysis' | 'market_scan' | 'backtest' | 'other';
type NormalizedStatus = 'success' | 'partial' | 'failed' | 'running' | 'unknown';

const STATUS_CLASS: Record<NormalizedStatus, string> = {
  success: 'theme-log-status theme-log-status--success',
  partial: 'theme-log-status theme-log-status--warning',
  failed: 'theme-log-status theme-log-status--danger',
  running: 'theme-log-status theme-log-status--running',
  unknown: 'theme-log-status',
};

const OPERATION_OPTIONS: OperationType[] = ['single_stock_analysis', 'market_scan', 'backtest'];
const STATUS_OPTIONS: NormalizedStatus[] = ['success', 'partial', 'failed'];

const MOCK_WOLFY_LOG_DETAILS: ExecutionLogSessionDetail[] = [
  {
    sessionId: 'mock-analysis-tsla',
    code: 'TSLA',
    name: 'TSLA analysis',
    overallStatus: 'partial_success',
    truthLevel: 'mock',
    startedAt: '2026-04-29T20:40:00',
    endedAt: '2026-04-29T20:42:12',
    readableSummary: {
      actorDisplay: 'admin',
      actorRole: 'admin',
      sessionKind: 'user_activity',
      subsystem: 'analysis',
      operationCategory: 'single_stock_analysis',
      operationType: '单股票分析',
      operationTarget: 'TSLA',
      operationStatus: '部分失败',
      keyMetric: 'LLM fallback used',
      finalAiModel: 'alpaca',
      aiAttemptsCount: 2,
      aiFallbackUsed: true,
      dataFallbackUsed: true,
      topFailureReason: '高负载 / Yahoo 超时',
      summaryParagraph: '主模型失败后回退到 alpaca，Finnhub 数据成功，Yahoo 数据超时，最终报告部分生成。',
    },
    operationDetail: {
      operationCategory: 'single_stock_analysis',
      operationType: '单股票分析',
      target: 'TSLA',
      status: '部分失败',
      keyMetric: 'LLM fallback used',
      aiCalls: [
        {
          model: 'deepseek-v4-pro',
          version: '1.0',
          request: { temperature: 0.2, max_tokens: 3200, symbol: 'TSLA' },
          response: { error: 'rate_limited' },
          status: '失败',
          reason: '高负载',
          fallback: '回退使用 alpaca',
        },
        {
          model: 'alpaca',
          version: '2026-04',
          request: { temperature: 0.1, symbol: 'TSLA' },
          response: { decision: 'hold', confidence: 0.61 },
          status: '成功',
          fallback: '备用模型完成',
        },
      ],
      dataSourceCalls: [
        {
          api: 'Finnhub',
          request: { symbol: 'TSLA', modules: ['quote', 'news'] },
          response: { quote: 'ok', newsCount: 8 },
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
        { timestamp: '2026-04-29T20:40:00', label: '单股票分析启动', category: 'analysis', status: '成功' },
        { timestamp: '2026-04-29T20:40:18', label: 'deepseek-v4-pro 高负载失败', category: 'llm', status: '失败' },
        { timestamp: '2026-04-29T20:41:03', label: 'alpaca 回退完成', category: 'llm', status: '成功' },
      ],
      diagnostics: [
        { severity: 'warning', message: '回退到备用模型', source: 'LLM Router' },
        { severity: 'error', message: 'Yahoo 超时', source: 'Yahoo' },
      ],
    },
    events: [],
  },
  {
    sessionId: 'mock-scan-us-preopen',
    name: 'US pre-open scanner',
    overallStatus: 'success',
    truthLevel: 'mock',
    startedAt: '2026-04-29T19:20:00',
    endedAt: '2026-04-29T19:22:44',
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
      scannerShortlistCount: 12,
      scannerProvidersUsed: ['alpaca', 'finnhub'],
      summaryParagraph: '扫描完成，数据源全部成功，输出 12 个候选标的。',
    },
    operationDetail: {
      operationCategory: 'market_scan',
      operationType: '市场扫描',
      target: 'US pre-open',
      status: '成功',
      keyMetric: 'Shortlist 12',
      aiCalls: [],
      dataSourceCalls: [
        { api: 'Alpaca', request: { market: 'us', profile: 'preopen' }, response: { symbols: 450 }, status: '成功' },
        { api: 'Finnhub', request: { market: 'us', modules: ['news'] }, response: { newsCount: 72 }, status: '成功' },
      ],
      timeline: [
        { timestamp: '2026-04-29T19:20:00', label: '扫描启动', category: 'scanner', status: '成功' },
        { timestamp: '2026-04-29T19:22:44', label: '候选名单生成', category: 'scanner', status: '成功' },
      ],
      diagnostics: [],
    },
    events: [],
  },
  {
    sessionId: 'mock-backtest-ma-cross',
    name: 'MA crossover backtest',
    overallStatus: 'failed',
    truthLevel: 'mock',
    startedAt: '2026-04-29T18:05:00',
    endedAt: '2026-04-29T18:05:19',
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
      topFailureReason: '历史数据不足',
    },
    operationDetail: {
      operationCategory: 'backtest',
      operationType: '回测',
      target: 'MA crossover',
      status: '失败',
      keyMetric: 'Data gap',
      aiCalls: [],
      dataSourceCalls: [
        { api: 'Local Parquet', request: { symbol: 'MSFT', range: '5y' }, response: { rows: 0 }, status: '失败', reason: '历史数据不足' },
      ],
      timeline: [
        { timestamp: '2026-04-29T18:05:00', label: '回测启动', category: 'backtest', status: '成功' },
        { timestamp: '2026-04-29T18:05:19', label: '历史数据不足，任务终止', category: 'data', status: '失败' },
      ],
      diagnostics: [
        { severity: 'error', message: 'Local parquet returned no rows', source: 'Backtest Engine' },
      ],
    },
    events: [],
  },
];

function text(value: unknown, fallback = '--'): string {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizeStatus(value?: string | null): NormalizedStatus {
  const normalized = String(value || '').trim().toLowerCase();
  if (['success', 'succeeded', 'completed', 'ok', '成功', '已完成'].includes(normalized)) return 'success';
  if (['partial', 'partial_success', 'partial fail', 'warning', 'fallback', 'switched_to_fallback', '部分失败', '部分成功'].includes(normalized)) return 'partial';
  if (['fail', 'failed', 'error', 'failed_runtime', 'invalid_response', '失败'].includes(normalized)) return 'failed';
  if (['running', 'queued', 'pending', '运行中'].includes(normalized)) return 'running';
  return 'unknown';
}

function normalizeOperationType(summary?: ExecutionLogSessionSummary['readableSummary']): OperationType {
  const raw = `${summary?.operationCategory || ''} ${summary?.operationType || ''} ${summary?.subsystem || ''}`.toLowerCase();
  if (raw.includes('backtest') || raw.includes('回测')) return 'backtest';
  if (raw.includes('market_scan') || raw.includes('scanner') || raw.includes('扫描')) return 'market_scan';
  if (raw.includes('single_stock') || raw.includes('单股票') || raw.includes('analysis')) return 'single_stock_analysis';
  return 'other';
}

function operationIcon(type: OperationType): string {
  if (type === 'single_stock_analysis') return 'A';
  if (type === 'market_scan') return 'S';
  if (type === 'backtest') return 'B';
  return 'L';
}

function operationLabel(type: OperationType, locale: AdminLogsLanguage): string {
  const labels: Record<OperationType, { zh: string; en: string }> = {
    single_stock_analysis: { zh: '单股票分析', en: 'Single stock analysis' },
    market_scan: { zh: '市场扫描', en: 'Market scan' },
    backtest: { zh: '回测', en: 'Backtest' },
    other: { zh: '其他', en: 'Other' },
  };
  return labels[type][locale];
}

function statusLabel(status: NormalizedStatus, locale: AdminLogsLanguage): string {
  const labels: Record<NormalizedStatus, { zh: string; en: string }> = {
    success: { zh: '成功', en: 'Success' },
    partial: { zh: '部分失败', en: 'Partial failure' },
    failed: { zh: '失败', en: 'Failed' },
    running: { zh: '运行中', en: 'Running' },
    unknown: { zh: '未知', en: 'Unknown' },
  };
  return labels[status][locale];
}

function roleLabel(role: unknown, t: TranslateFn): string {
  const normalized = String(role || '').trim().toLowerCase();
  if (normalized === 'admin') return t('adminLogs.role.admin');
  if (normalized === 'user') return t('adminLogs.role.user');
  return text(role, t('adminLogs.unavailable'));
}

function asRecordList(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)) : [];
}

function detailForSummary(summary: ExecutionLogSessionSummary): ExecutionLogSessionDetail {
  const mockDetail = MOCK_WOLFY_LOG_DETAILS.find((item) => item.sessionId === summary.sessionId);
  if (mockDetail) return mockDetail;
  return {
    ...summary,
    events: [],
    operationDetail: {
      operationCategory: summary.readableSummary?.operationCategory,
      operationType: summary.readableSummary?.operationType,
      target: summary.readableSummary?.operationTarget || summary.code || summary.name,
      status: summary.readableSummary?.operationStatus || summary.overallStatus,
      keyMetric: summary.readableSummary?.keyMetric,
      aiCalls: [],
      dataSourceCalls: [],
      timeline: [],
      diagnostics: [],
    },
  };
}

function formatDateTime(value: unknown, locale: AdminLogsLanguage): string {
  const raw = String(value || '').trim();
  if (!raw) return '--';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US');
}

function formatDateInput(value: string): number | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function JsonBlock({ value }: { value: unknown }) {
  if (value == null || value === '') return <span>--</span>;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <span>{String(value)}</span>;
  }
  return (
    <pre className="mt-2 max-h-44 overflow-auto rounded-xl border border-white/5 bg-black/30 p-3 text-[11px] leading-5 text-white/68">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function CallCard({
  item,
  index,
  type,
  locale,
}: {
  item: Record<string, unknown>;
  index: number;
  type: 'llm' | 'data';
  locale: AdminLogsLanguage;
}) {
  const name = type === 'llm' ? text(item.model) : text(item.api || item.source);
  const status = normalizeStatus(String(item.status || ''));
  const reason = text(item.reason || item.error || item.failureReason, '');
  const fallback = text(item.fallback || item.fallbackChain || item.retryFallback, '');
  return (
    <details className="rounded-2xl border border-white/6 bg-white/[0.025] p-4" open={index === 0}>
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/36">{type === 'llm' ? 'LLM' : 'API'} #{index + 1}</p>
            <h4 className="mt-1 text-sm font-semibold text-foreground">{name}</h4>
          </div>
          <span className={`${STATUS_CLASS[status]} shrink-0`}>{statusLabel(status, locale)}</span>
        </div>
      </summary>
      <div className="mt-4 grid gap-4 text-xs text-secondary-text lg:grid-cols-2">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/36">{locale === 'zh' ? '请求参数' : 'Request'}</p>
          <JsonBlock value={item.request || item.params || item.requestParams} />
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/36">{locale === 'zh' ? '响应' : 'Response'}</p>
          <JsonBlock value={item.response || item.result} />
        </div>
        {type === 'llm' ? (
          <p className="break-words">{locale === 'zh' ? '版本' : 'Version'}: <span className="text-foreground">{text(item.version)}</span></p>
        ) : null}
        <p className="break-words">{locale === 'zh' ? '失败原因' : 'Failure reason'}: <span className="text-foreground">{reason || '--'}</span></p>
        <p className="break-words lg:col-span-2">{locale === 'zh' ? '回退情况' : 'Fallback'}: <span className="text-foreground">{fallback || '--'}</span></p>
      </div>
    </details>
  );
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
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(JSON.stringify(detail, null, 2));
  }
}

const AdminLogsPage: React.FC = () => {
  const { language, t } = useI18n();
  const locale = language as AdminLogsLanguage;
  const [operationFilter, setOperationFilter] = useState<'all' | OperationType>('all');
  const [targetFilter, setTargetFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | NormalizedStatus>('all');
  const [fromTime, setFromTime] = useState('');
  const [toTime, setToTime] = useState('');
  const [sessions, setSessions] = useState<ExecutionLogSessionSummary[]>([]);
  const [selectedDetail, setSelectedDetail] = useState<ExecutionLogSessionDetail | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [error, setError] = useState<ParsedApiError | null>(null);
  const [detailError, setDetailError] = useState<ParsedApiError | null>(null);

  const loadSessions = useCallback(async () => {
    setIsLoadingList(true);
    setError(null);
    try {
      const response = await adminLogsApi.listSessions({
        stock: targetFilter.trim() || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit: 100,
      });
      const items = response.items || [];
      setSessions(items.length ? items : (import.meta.env.DEV ? MOCK_WOLFY_LOG_DETAILS : []));
    } catch (err) {
      setError((err as { parsedError?: ParsedApiError }).parsedError || null);
      setSessions(import.meta.env.DEV ? MOCK_WOLFY_LOG_DETAILS : []);
    } finally {
      setIsLoadingList(false);
    }
  }, [statusFilter, targetFilter]);

  useEffect(() => {
    document.title = t('adminLogs.documentTitle');
  }, [t]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const filteredSessions = useMemo(() => {
    const fromMs = formatDateInput(fromTime);
    const toMs = formatDateInput(toTime);
    const target = targetFilter.trim().toLowerCase();
    return sessions.filter((item) => {
      const summary = item.readableSummary || {};
      const operationType = normalizeOperationType(summary);
      const status = normalizeStatus(summary.operationStatus || item.overallStatus);
      const startedMs = item.startedAt ? new Date(item.startedAt).getTime() : null;
      const targetText = `${summary.operationTarget || ''} ${item.code || ''} ${item.name || ''}`.toLowerCase();
      if (operationFilter !== 'all' && operationType !== operationFilter) return false;
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (target && !targetText.includes(target)) return false;
      if (fromMs != null && startedMs != null && startedMs < fromMs) return false;
      if (toMs != null && startedMs != null && startedMs > toMs) return false;
      return true;
    });
  }, [fromTime, operationFilter, sessions, statusFilter, targetFilter, toTime]);

  const openDetail = useCallback(async (summary: ExecutionLogSessionSummary) => {
    setSelectedDetail(detailForSummary(summary));
    setIsDrawerOpen(true);
    setIsLoadingDetail(true);
    setDetailError(null);
    try {
      const detail = await adminLogsApi.getSessionDetail(summary.sessionId);
      setSelectedDetail(detail);
    } catch (err) {
      setDetailError((err as { parsedError?: ParsedApiError }).parsedError || null);
    } finally {
      setIsLoadingDetail(false);
    }
  }, []);

  const drawerDetail = selectedDetail;
  const readable = drawerDetail?.readableSummary || {};
  const operationDetail = drawerDetail?.operationDetail || {};
  const aiCalls = asRecordList(operationDetail.aiCalls);
  const dataSourceCalls = asRecordList(operationDetail.dataSourceCalls);
  const timeline = asRecordList(operationDetail.timeline);
  const diagnostics = asRecordList(operationDetail.diagnostics);
  const systemFallbacks = diagnostics.filter((item) => /fallback|回退/i.test(`${item.message || ''} ${item.source || ''}`));
  const drawerStatus = normalizeStatus(String(operationDetail.status || readable.operationStatus || drawerDetail?.overallStatus || ''));
  const drawerOperationType = normalizeOperationType(readable);

  return (
    <section data-testid="admin-logs-workspace" className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-6">
      <GlassCard as="section" className="overflow-hidden p-0">
        <div className="relative p-6">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_30%),radial-gradient(circle_at_top_right,rgba(239,68,68,0.14),transparent_28%)]" />
          <div className="relative grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,60rem)] xl:items-end">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-emerald-200/70">WolfyStock Ops Trace</p>
              <h1 className="mt-3 text-[1.75rem] font-semibold tracking-tight text-foreground">{t('adminLogs.pageTitle')}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-secondary-text">{t('adminLogs.pageSubtitle')}</p>
              <p className="mt-3 text-xs text-muted-text">{t('adminLogs.filterHintDetailed', { count: filteredSessions.length })}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[12rem_minmax(0,1fr)_10rem_12rem_12rem_auto]">
              <label className="sr-only" htmlFor="admin-logs-operation-filter">{t('adminLogs.operationType')}</label>
              <select
                id="admin-logs-operation-filter"
                aria-label={t('adminLogs.operationType')}
                className="input-surface h-10 w-full rounded-xl px-3 text-sm"
                value={operationFilter}
                onChange={(event) => setOperationFilter(event.target.value as 'all' | OperationType)}
              >
                <option value="all">{locale === 'zh' ? '全部操作类别' : 'All operation types'}</option>
                {OPERATION_OPTIONS.map((type) => (
                  <option key={type} value={type}>{operationLabel(type, locale)}</option>
                ))}
              </select>
              <label className="sr-only" htmlFor="admin-logs-target-filter">{t('adminLogs.operationTarget')}</label>
              <input
                id="admin-logs-target-filter"
                aria-label={t('adminLogs.operationTarget')}
                className="input-surface h-10 w-full rounded-xl px-3 text-sm"
                placeholder={locale === 'zh' ? '股票 / 策略名称' : 'Ticker / strategy'}
                value={targetFilter}
                onChange={(event) => setTargetFilter(event.target.value)}
              />
              <label className="sr-only" htmlFor="admin-logs-status-filter">{t('adminLogs.statusFilterLabel')}</label>
              <select
                id="admin-logs-status-filter"
                aria-label={t('adminLogs.statusFilterLabel')}
                className="input-surface h-10 w-full rounded-xl px-3 text-sm"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as 'all' | NormalizedStatus)}
              >
                <option value="all">{t('adminLogs.allStatus')}</option>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>{statusLabel(status, locale)}</option>
                ))}
              </select>
              <input
                aria-label={locale === 'zh' ? '开始时间' : 'Start time'}
                className="input-surface h-10 w-full rounded-xl px-3 text-sm"
                type="datetime-local"
                value={fromTime}
                onChange={(event) => setFromTime(event.target.value)}
              />
              <input
                aria-label={locale === 'zh' ? '结束时间' : 'End time'}
                className="input-surface h-10 w-full rounded-xl px-3 text-sm"
                type="datetime-local"
                value={toTime}
                onChange={(event) => setToTime(event.target.value)}
              />
              <button type="button" className="btn-secondary h-10 rounded-xl px-4 text-sm sm:col-span-2 xl:col-span-1" onClick={() => void loadSessions()} disabled={isLoadingList}>
                {isLoadingList ? t('adminLogs.loading') : t('adminLogs.refreshButton')}
              </button>
            </div>
          </div>
        </div>
      </GlassCard>

      {error ? <ApiErrorAlert error={error} /> : null}

      <GlassCard as="section" className="p-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{t('adminLogs.sessionListTitle')}</h2>
            <p className="mt-1 text-xs text-muted-text">{locale === 'zh' ? '点击查看详情会打开右侧抽屉，调用链和数据源可独立折叠。' : 'View Details opens a right drawer; LLM and data-source chains collapse independently.'}</p>
          </div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-white/36">{filteredSessions.length} records</p>
        </div>
        {filteredSessions.length === 0 ? (
          <div className="rounded-2xl bg-white/[0.02] px-4 py-6">
            <p className="text-sm font-medium text-foreground">{t('adminLogs.noSessionsTitle')}</p>
            <p className="mt-1 text-sm text-muted-text">{t('adminLogs.noSessionsBody')}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-white/6 bg-black/15">
            <div className="hidden grid-cols-[11rem_minmax(9rem,1fr)_11rem_8rem_minmax(8rem,1fr)_8rem] gap-4 border-b border-white/6 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38 md:grid">
              <div>{locale === 'zh' ? '时间' : 'Time'}</div>
              <div>{locale === 'zh' ? '股票 / 策略名称' : 'Ticker / strategy'}</div>
              <div>{t('adminLogs.operationType')}</div>
              <div>{t('adminLogs.operationStatus')}</div>
              <div>{t('adminLogs.keyMetric')}</div>
              <div>{locale === 'zh' ? '操作' : 'Action'}</div>
            </div>
            <div className="divide-y divide-white/6">
              {filteredSessions.map((item) => {
                const summary = item.readableSummary || {};
                const operationType = normalizeOperationType(summary);
                const status = normalizeStatus(summary.operationStatus || item.overallStatus);
                const target = text(summary.operationTarget || item.code || item.name, t('adminLogs.unavailable'));
                return (
                  <div key={item.sessionId} className="grid gap-3 px-4 py-4 md:grid-cols-[11rem_minmax(9rem,1fr)_11rem_8rem_minmax(8rem,1fr)_8rem] md:items-center">
                    <p className="text-sm text-secondary-text">{formatDateTime(item.startedAt, locale)}</p>
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold text-foreground">{target}</p>
                      <p className="mt-1 break-all text-[11px] text-muted-text">{item.sessionId}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-xs font-bold text-emerald-100">{operationIcon(operationType)}</span>
                      <span className="text-sm text-secondary-text">{operationLabel(operationType, locale)}</span>
                    </div>
                    <span className={`${STATUS_CLASS[status]} w-fit`}>{statusLabel(status, locale)}</span>
                    <div className="min-w-0">
                      <p className="break-words text-sm text-secondary-text">{text(summary.keyMetric, t('adminLogs.unavailable'))}</p>
                      <p className="mt-1 text-xs text-muted-text">{text(summary.actorDisplay, t('adminLogs.unavailable'))} · {roleLabel(summary.actorRole, t)}</p>
                    </div>
                    <button type="button" className="btn-secondary w-fit rounded-xl px-3 py-1.5 text-xs" onClick={() => void openDetail(item)}>
                      {t('adminLogs.viewDetails')}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </GlassCard>

      <Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title={t('adminLogs.sessionDetailTitle')}
        width="max-w-5xl"
      >
        {drawerDetail ? (
          <div className="space-y-5">
            {detailError ? <ApiErrorAlert error={detailError} /> : null}
            {isLoadingDetail ? <p className="text-sm text-muted-text">{t('adminLogs.loading')}</p> : null}
            <section className="rounded-3xl border border-white/8 bg-black/25 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-sm font-bold text-emerald-100">{operationIcon(drawerOperationType)}</span>
                    <span className={`${STATUS_CLASS[drawerStatus]}`}>{statusLabel(drawerStatus, locale)}</span>
                  </div>
                  <h2 className="break-words text-2xl font-semibold text-foreground">
                    {text(operationDetail.target || readable.operationTarget || drawerDetail.name || drawerDetail.code)}
                  </h2>
                  <p className="mt-2 text-sm text-secondary-text">{operationLabel(drawerOperationType, locale)} · {formatDateTime(drawerDetail.startedAt, locale)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary rounded-xl px-3 py-1.5 text-xs" onClick={() => void copyLogJson(drawerDetail)}>
                    {t('adminLogs.copyDetails')}
                  </button>
                  <button type="button" className="btn-secondary rounded-xl px-3 py-1.5 text-xs" onClick={() => downloadLogJson(drawerDetail)}>
                    {t('adminLogs.exportDetails')}
                  </button>
                </div>
              </div>
              <div className="mt-5 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
                <p className="text-secondary-text">{t('adminLogs.actor')}: <span className="text-foreground">{text(readable.actorDisplay || readable.actorUsername, 'admin')}</span></p>
                <p className="text-secondary-text">{t('adminLogs.actorRole')}: <span className="text-foreground">{roleLabel(readable.actorRole, t)}</span></p>
                <p className="text-secondary-text">{t('adminLogs.operationType')}: <span className="text-foreground">{text(operationDetail.operationType || readable.operationType || operationLabel(drawerOperationType, locale))}</span></p>
                <p className="text-secondary-text">{t('adminLogs.keyMetric')}: <span className="text-foreground">{text(operationDetail.keyMetric || readable.keyMetric, t('adminLogs.unavailable'))}</span></p>
              </div>
            </section>

            <details className="rounded-3xl border border-white/8 bg-white/[0.018] p-5" open>
              <summary className="cursor-pointer text-sm font-semibold text-foreground">{locale === 'zh' ? 'LLM 调用链' : 'LLM call chain'}</summary>
              <div className="mt-4 space-y-3">
                {aiCalls.length ? aiCalls.map((item, index) => (
                  <CallCard key={`${text(item.model)}-${index}`} item={item} index={index} type="llm" locale={locale} />
                )) : <p className="text-sm text-muted-text">{t('adminLogs.emptyOperationTable')}</p>}
              </div>
            </details>

            <details className="rounded-3xl border border-white/8 bg-white/[0.018] p-5" open>
              <summary className="cursor-pointer text-sm font-semibold text-foreground">{locale === 'zh' ? '数据源调用' : 'Data source calls'}</summary>
              <div className="mt-4 space-y-3">
                {dataSourceCalls.length ? dataSourceCalls.map((item, index) => (
                  <CallCard key={`${text(item.api || item.source)}-${index}`} item={item} index={index} type="data" locale={locale} />
                )) : <p className="text-sm text-muted-text">{t('adminLogs.emptyOperationTable')}</p>}
              </div>
            </details>

            <section className="grid gap-4 xl:grid-cols-2">
              <details className="rounded-3xl border border-white/8 bg-white/[0.018] p-5" open>
                <summary className="cursor-pointer text-sm font-semibold text-foreground">{locale === 'zh' ? '系统回退记录' : 'System fallback records'}</summary>
                <div className="mt-4 space-y-2">
                  {systemFallbacks.length ? systemFallbacks.map((item, index) => (
                    <p key={`${text(item.source)}-${index}`} className="rounded-2xl border border-amber-300/15 bg-amber-400/5 px-3 py-2 text-xs text-amber-100">
                      {text(item.source)} · {text(item.message)}
                    </p>
                  )) : <p className="text-sm text-muted-text">{locale === 'zh' ? '暂无系统回退。' : 'No system fallback recorded.'}</p>}
                </div>
              </details>
              <section className="rounded-3xl border border-white/8 bg-white/[0.018] p-5">
                <h3 className="text-sm font-semibold text-foreground">{locale === 'zh' ? '最终执行结果' : 'Final result'}</h3>
                <p className="mt-3 text-sm leading-6 text-secondary-text">
                  {text(readable.summaryParagraph || readable.topFailureReason || operationDetail.status || drawerDetail.overallStatus, t('adminLogs.unavailable'))}
                </p>
              </section>
            </section>

            <details className="rounded-3xl border border-white/8 bg-white/[0.018] p-5" open>
              <summary className="cursor-pointer text-sm font-semibold text-foreground">{t('adminLogs.operationTimelineTitle')}</summary>
              <div className="mt-4 space-y-2">
                {timeline.length ? timeline.map((item, index) => {
                  const status = normalizeStatus(String(item.status || ''));
                  return (
                    <div key={`${text(item.label)}-${index}`} className="rounded-2xl border border-white/6 bg-black/20 px-3 py-3 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium text-foreground">{text(item.label)}</p>
                        <span className={STATUS_CLASS[status]}>{statusLabel(status, locale)}</span>
                      </div>
                      <p className="mt-1 text-muted-text">{text(item.timestamp)} · {text(item.category)}</p>
                    </div>
                  );
                }) : <p className="text-sm text-muted-text">{t('adminLogs.emptyTimelineBody')}</p>}
              </div>
            </details>

            <details className="rounded-3xl border border-rose-400/15 bg-rose-500/[0.025] p-5" open>
              <summary className="cursor-pointer text-sm font-semibold text-foreground">{t('adminLogs.diagnosticsTitle')}</summary>
              <div className="mt-4 space-y-2">
                {diagnostics.length ? diagnostics.map((item, index) => (
                  <div key={`${text(item.source)}-${index}`} className="rounded-2xl border border-rose-400/15 bg-rose-500/5 px-3 py-3 text-xs">
                    <p className="text-rose-100">{text(item.message)}</p>
                    <p className="mt-1 text-muted-text">{text(item.source)} · {text(item.severity)}</p>
                  </div>
                )) : <p className="text-sm text-muted-text">{t('adminLogs.noDiagnostics')}</p>}
              </div>
            </details>
          </div>
        ) : (
          <p className="text-sm text-muted-text">{t('adminLogs.selectSessionBody')}</p>
        )}
      </Drawer>
    </section>
  );
};

export default AdminLogsPage;
