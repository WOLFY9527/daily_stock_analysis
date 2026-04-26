import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PanelRightOpen } from 'lucide-react';
import { getParsedApiError, type ParsedApiError } from '../api/error';
import { scannerApi } from '../api/scanner';
import { ApiErrorAlert, Button, Drawer, Pagination, PillBadge, SectionShell } from '../components/common';
import { CARD_BUTTON_CLASS } from '../components/home-bento';
import { useI18n } from '../contexts/UiLanguageContext';
import type { ScannerRunDetail, ScannerRunHistoryItem } from '../types/scanner';
import {
  getScannerDetailOptions,
  getScannerProfileOptions,
  getScannerUniverseOptions,
  SCANNER_PROFILE_DEFAULTS,
} from './scannerPageShared';

const HISTORY_PAGE_SIZE = 8;

type PillOption = { value: string; label: string };

function ScannerEmptyState({
  title,
  body,
  className = '',
}: {
  title: string;
  body: string;
  className?: string;
}) {
  return (
    <div className={`w-full flex flex-col items-center justify-center py-16 px-4 border border-white/5 border-dashed rounded-2xl bg-white/[0.01] ${className}`.trim()}>
      <div className="w-12 h-12 rounded-full bg-white/[0.02] border border-white/5 flex items-center justify-center mb-4">
        <svg className="w-6 h-6 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <p className="text-white/40 text-sm font-medium text-center">{title}</p>
      <p className="text-white/20 text-xs mt-1 text-center">{body}</p>
    </div>
  );
}

function normalizeTacticalLabel(label?: string | null): string {
  return (label || '').trim().toLowerCase();
}

function findCandidateValue(
  candidate: ScannerRunDetail['shortlist'][number],
  keywords: string[],
): string | null {
  const entries = [...candidate.keyMetrics, ...candidate.watchContext, ...candidate.featureSignals];
  const match = entries.find((entry) => keywords.some((keyword) => normalizeTacticalLabel(entry.label).includes(keyword)));
  return match?.value?.trim() || null;
}

function parseFirstNumericValue(value?: string | null): number | null {
  if (!value) return null;
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCandidateTags(candidate: ScannerRunDetail['shortlist'][number]): string[] {
  const tags = [
    candidate.qualityHint,
    ...candidate.featureSignals.map((signal) => signal.value || signal.label),
    ...candidate.boards,
  ]
    .map((tag) => tag?.trim())
    .filter((tag): tag is string => Boolean(tag));
  return Array.from(new Set(tags)).slice(0, 2);
}

function shouldRenderDisplayName(symbol?: string | null, name?: string | null): boolean {
  const normalizedSymbol = (symbol || '').trim().toLowerCase();
  const normalizedName = (name || '').trim().toLowerCase();
  return Boolean(normalizedName && normalizedName !== normalizedSymbol);
}

function formatEntryZone(candidate: ScannerRunDetail['shortlist'][number], language: 'zh' | 'en'): string {
  const explicitEntry = findCandidateValue(candidate, ['建仓', '入场', 'entry', 'buy', 'support']);
  if (explicitEntry) return explicitEntry;
  const latestMetric = candidate.keyMetrics.find((metric) => ['最新价', '现价', 'close', 'price', 'last'].some((keyword) => normalizeTacticalLabel(metric.label).includes(keyword)));
  const latestValue = parseFirstNumericValue(latestMetric?.value);
  if (latestValue != null) {
    const lower = latestValue * 0.992;
    const upper = latestValue * 1.006;
    return `${lower.toFixed(2)} - ${upper.toFixed(2)}`;
  }
  return language === 'en' ? 'Wait for open support' : '等待开盘承接';
}

function formatTargetLevel(candidate: ScannerRunDetail['shortlist'][number], language: 'zh' | 'en'): string {
  const explicitTarget = findCandidateValue(candidate, ['目标', 'target', 'tp', 'resistance']);
  if (explicitTarget) return explicitTarget;
  const latestMetric = candidate.keyMetrics.find((metric) => ['最新价', '现价', 'close', 'price', 'last'].some((keyword) => normalizeTacticalLabel(metric.label).includes(keyword)));
  const latestValue = parseFirstNumericValue(latestMetric?.value);
  if (latestValue != null) {
    return (latestValue * 1.04).toFixed(2);
  }
  return language === 'en' ? 'Breakout follow-through' : '放量突破后上看';
}

function formatStopLevel(candidate: ScannerRunDetail['shortlist'][number], language: 'zh' | 'en'): string {
  const explicitStop = findCandidateValue(candidate, ['止损', 'stop', 'risk', 'invalid']);
  if (explicitStop) return explicitStop;
  const latestMetric = candidate.keyMetrics.find((metric) => ['最新价', '现价', 'close', 'price', 'last'].some((keyword) => normalizeTacticalLabel(metric.label).includes(keyword)));
  const latestValue = parseFirstNumericValue(latestMetric?.value);
  if (latestValue != null) {
    return (latestValue * 0.982).toFixed(2);
  }
  return candidate.riskNotes[0] || (language === 'en' ? 'Exit on failed support' : '跌破承接位离场');
}

function PillTagGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: PillOption[];
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs uppercase tracking-widest text-white/40">{label}</span>
      <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
        {options.map((option) => {
          const isActive = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => onChange(option.value)}
              className={isActive
                ? 'rounded-full border border-white/10 bg-white/10 px-4 py-1.5 text-sm text-white transition-colors'
                : 'rounded-full border border-white/5 bg-transparent px-4 py-1.5 text-sm text-white/50 transition-colors hover:bg-white/[0.05]'}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatTimestamp(value?: string | null, language: 'zh' | 'en' = 'zh'): string {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatDateOnly(value?: string | null, language: 'zh' | 'en' = 'zh'): string {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function statusVariant(status?: string | null): 'success' | 'warning' | 'danger' | 'history' {
  if (status === 'completed') return 'success';
  if (status === 'empty') return 'warning';
  if (status === 'failed') return 'danger';
  return 'history';
}

function marketVariant(market?: string | null): 'success' | 'info' | 'warning' | 'history' {
  if (market === 'us') return 'success';
  if (market === 'hk') return 'warning';
  if (market === 'cn') return 'info';
  return 'history';
}

function dedupeTickerSymbols(symbols: string[]): string[] {
  return Array.from(
    new Set(
      symbols
        .map((symbol) => symbol.trim())
        .filter(Boolean),
    ),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatHistoryHeadline(
  headline: string | null | undefined,
  topSymbols: string[],
  fallbackTitle: string,
): { title: string; detail: string | null; symbols: string[] } {
  const symbols = dedupeTickerSymbols(topSymbols);
  const trimmedHeadline = headline?.trim() || '';
  if (!trimmedHeadline) {
    return { title: fallbackTitle, detail: null, symbols };
  }

  if (!symbols.length) {
    return { title: trimmedHeadline, detail: null, symbols };
  }

  const symbolPattern = new RegExp(`\\b(?:${symbols.map(escapeRegExp).join('|')})\\b`, 'i');
  const explicitSplit = trimmedHeadline.match(/^(.*?)[：:]\s*(.+)$/);
  if (explicitSplit && symbolPattern.test(explicitSplit[2] || '')) {
    return {
      title: explicitSplit[1]?.trim() || fallbackTitle,
      detail: null,
      symbols,
    };
  }

  const firstSymbolIndex = trimmedHeadline.search(symbolPattern);
  if (firstSymbolIndex > 0) {
    const titleCandidate = trimmedHeadline.slice(0, firstSymbolIndex).replace(/[/,，:：\-\s]+$/, '').trim();
    if (titleCandidate) {
      return {
        title: titleCandidate,
        detail: null,
        symbols,
      };
    }
  }

  return { title: trimmedHeadline, detail: null, symbols };
}

const UserScannerPage: React.FC = () => {
  const { t, language } = useI18n();
  const [market, setMarket] = useState<'cn' | 'us' | 'hk'>('cn');
  const [profile, setProfile] = useState('cn_preopen_v1');
  const [shortlistSize, setShortlistSize] = useState('5');
  const [universeLimit, setUniverseLimit] = useState('300');
  const [detailLimit, setDetailLimit] = useState('60');
  const [runDetail, setRunDetail] = useState<ScannerRunDetail | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [historyItems, setHistoryItems] = useState<ScannerRunHistoryItem[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [pageError, setPageError] = useState<ParsedApiError | null>(null);
  const [historyError, setHistoryError] = useState<ParsedApiError | null>(null);
  const [isRationaleDrawerOpen, setIsRationaleDrawerOpen] = useState(false);

  useEffect(() => {
    document.title = t('scanner.documentTitle');
  }, [t]);

  const profileOptions = useMemo(() => getScannerProfileOptions(market, t), [market, t]);
  const universeOptions = useMemo(() => getScannerUniverseOptions(market, language), [language, market]);
  const detailOptions = useMemo(() => getScannerDetailOptions(market, language), [language, market]);

  const selectedMarketCopy = useMemo(() => (
    market === 'us'
      ? {
        runHint: t('scanner.runHintUs'),
        currentRunFallback: t('scanner.currentRunFallbackUs'),
        emptyState: language === 'en'
          ? 'No personal US scanner result is available yet.'
          : '当前还没有可展示的美股个人扫描结果。',
      }
      : market === 'hk'
        ? {
          runHint: t('scanner.runHintHk'),
          currentRunFallback: t('scanner.currentRunFallbackHk'),
          emptyState: language === 'en'
            ? 'No personal Hong Kong scanner result is available yet.'
            : '当前还没有可展示的港股个人扫描结果。',
        }
      : {
        runHint: t('scanner.runHintCn'),
        currentRunFallback: t('scanner.currentRunFallbackCn'),
        emptyState: language === 'en'
          ? 'No personal A-share scanner result is available yet.'
          : '当前还没有可展示的 A 股个人扫描结果。',
      }
  ), [language, market, t]);

  const handleMarketChange = useCallback((nextMarket: string) => {
    const normalizedMarket = nextMarket === 'us' ? 'us' : nextMarket === 'hk' ? 'hk' : 'cn';
    const defaults = SCANNER_PROFILE_DEFAULTS[normalizedMarket];
    setMarket(normalizedMarket);
    setProfile(defaults.profile);
    setShortlistSize(defaults.shortlistSize);
    setUniverseLimit(defaults.universeLimit);
    setDetailLimit(defaults.detailLimit);
  }, []);

  const loadRun = useCallback(async (runId: number) => {
    try {
      const response = await scannerApi.getRun(runId);
      setRunDetail(response);
      setSelectedRunId(response.id);
      setPageError(null);
    } catch (error) {
      setPageError(getParsedApiError(error));
    }
  }, []);

  const fetchHistory = useCallback(async (page = 1, preferredRunId?: number | null) => {
    setIsLoadingHistory(true);
    try {
      const response = await scannerApi.getRuns({
        market,
        profile,
        page,
        limit: HISTORY_PAGE_SIZE,
      });
      setHistoryItems(response.items);
      setHistoryTotal(response.total);
      setHistoryPage(response.page);
      setHistoryError(null);

      const targetRunId = preferredRunId
        || (selectedRunId && response.items.some((item) => item.id === selectedRunId) ? selectedRunId : null)
        || response.items[0]?.id
        || null;
      if (targetRunId && targetRunId !== selectedRunId) {
        void loadRun(targetRunId);
      }
      if (!targetRunId) {
        setRunDetail(null);
        setSelectedRunId(null);
      }
    } catch (error) {
      setHistoryError(getParsedApiError(error));
    } finally {
      setIsLoadingHistory(false);
    }
  }, [loadRun, market, profile, selectedRunId]);

  useEffect(() => {
    setRunDetail(null);
    setSelectedRunId(null);
  }, [market, profile]);

  useEffect(() => {
    void fetchHistory(1);
  }, [fetchHistory]);

  const handleRun = useCallback(async () => {
    setIsRunning(true);
    try {
      const response = await scannerApi.run({
        market,
        profile,
        shortlistSize: Number.parseInt(shortlistSize, 10),
        universeLimit: Number.parseInt(universeLimit, 10),
        detailLimit: Number.parseInt(detailLimit, 10),
      });
      setRunDetail(response);
      setSelectedRunId(response.id);
      setPageError(null);
      await fetchHistory(1, response.id);
    } catch (error) {
      setPageError(getParsedApiError(error));
    } finally {
      setIsRunning(false);
    }
  }, [detailLimit, fetchHistory, market, profile, shortlistSize, universeLimit]);

  const totalHistoryPages = useMemo(
    () => Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE)),
    [historyTotal],
  );
  const shortlistCount = runDetail?.shortlist?.length ?? 0;
  const watchlistTitle = market === 'us'
    ? (language === 'en' ? 'US pre-market candidates' : '美股盘前候选名单')
    : market === 'hk'
      ? (language === 'en' ? 'Hong Kong pre-open candidates' : '港股盘前候选名单')
      : (language === 'en' ? 'A-share pre-open candidates' : 'A股盘前候选名单');
  const tacticalCards = runDetail?.shortlist.map((candidate) => ({
    symbol: candidate.symbol,
    name: candidate.name,
    tags: formatCandidateTags(candidate),
    signalValue: `${candidate.score >= 0 ? '+' : ''}${candidate.score.toFixed(1)}%`,
    signalLabel: candidate.qualityHint || (language === 'en' ? 'Signal score' : '综合强度'),
    insight: candidate.aiInterpretation.summary || candidate.reasonSummary || candidate.reasons[0] || (language === 'en' ? 'Awaiting AI insight generation.' : '等待 AI 生成更完整的战术解读。'),
    entryZone: formatEntryZone(candidate, language),
    targetLevel: formatTargetLevel(candidate, language),
    stopLevel: formatStopLevel(candidate, language),
  })) || [];
  const historyCards = useMemo(() => historyItems.map((item) => {
    const fallbackTitle = item.market === 'us'
      ? t('scanner.currentRunFallbackUs')
      : item.market === 'hk'
        ? t('scanner.currentRunFallbackHk')
        : t('scanner.currentRunFallbackCn');
    return {
      ...item,
      historyHeadline: formatHistoryHeadline(item.headline, item.topSymbols, fallbackTitle),
    };
  }), [historyItems, t]);
  const emptyStateTitle = language === 'en' ? 'No matching scanner results' : '当前无匹配的扫描结果';
  const emptyStateBody = language === 'en' ? 'Adjust the filters on the left or try again later' : '请调整左侧参数或稍后再试';

  return (
    <>
      <div
        data-testid="user-scanner-bento-page"
        data-bento-surface="true"
        className="bento-surface-root h-[calc(100vh-80px)] overflow-hidden bg-transparent text-foreground"
      >
        <div className="workspace-width-wide w-full max-w-[1920px] 2xl:max-w-full mx-auto px-4 md:px-8 xl:px-12 pt-0 pb-4 h-[calc(100vh-64px)] flex flex-col overflow-hidden bg-transparent">
          <header className="shrink-0 flex justify-between items-start mb-3 mt-0">
            <div>
              <h1 className="text-[2rem] tracking-[-0.04em] text-foreground">{language === 'en' ? 'MARKET SCANNER' : '市场扫描'}</h1>
            </div>
            <Button
              type="button"
              variant="secondary"
              className={CARD_BUTTON_CLASS}
              data-testid="user-scanner-bento-drawer-trigger"
              onClick={() => setIsRationaleDrawerOpen(true)}
            >
              <PanelRightOpen className="h-4 w-4" />
              <span>{language === 'en' ? 'Run history' : '历史运行记录'}</span>
            </Button>
          </header>

          {pageError ? <ApiErrorAlert error={pageError} /> : null}

          <main className="w-full flex-1 flex flex-col lg:flex-row gap-6 min-h-0 min-w-0 mt-6">
            <section className="w-full lg:w-[320px] xl:w-[360px] shrink-0 flex flex-col gap-6 bg-white/[0.02] border border-white/5 rounded-[24px] p-6 h-fit">
              <SectionShell className="rounded-[24px] p-0 bg-transparent shadow-none">
                <div className="flex flex-col gap-6">
                  <PillTagGroup label={t('scanner.marketLabel')} value={market} onChange={(next) => handleMarketChange(next as 'cn' | 'us' | 'hk')} options={[{ value: 'cn', label: t('scanner.marketCn') }, { value: 'us', label: t('scanner.marketUs') }, { value: 'hk', label: t('scanner.marketHk') }]} />
                  <PillTagGroup label={t('scanner.profileLabel')} value={profile} onChange={setProfile} options={profileOptions} />
                  <PillTagGroup label={t('scanner.shortlistLabel')} value={shortlistSize} onChange={setShortlistSize} options={[{ value: '5', label: language === 'en' ? 'Top 5' : '前 5' }, { value: '8', label: language === 'en' ? 'Top 8' : '前 8' }, { value: '10', label: language === 'en' ? 'Top 10' : '前 10' }]} />
                  <PillTagGroup label={t('scanner.universeLabel')} value={universeLimit} onChange={setUniverseLimit} options={universeOptions} />
                  <PillTagGroup label={t('scanner.detailLabel')} value={detailLimit} onChange={setDetailLimit} options={detailOptions} />
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-secondary-text">{selectedMarketCopy.runHint}</p>
                      <button
                        type="button"
                        onClick={() => void handleRun()}
                        disabled={isRunning}
                        aria-busy={isRunning}
                        className="w-full md:w-auto mt-4 px-8 py-3.5 bg-white text-black font-bold text-sm rounded-xl hover:bg-white/90 active:scale-95 transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)] shrink-0 disabled:pointer-events-none disabled:opacity-60 disabled:transform-none"
                      >
                        {isRunning ? t('scanner.running') : t('scanner.run')}
                      </button>
                    </div>
                    {!tacticalCards.length ? (
                      <ScannerEmptyState title={emptyStateTitle} body={emptyStateBody} />
                    ) : null}
                  </div>
                </div>
              </SectionShell>

              <div className="rounded-[20px] border border-white/5 bg-[#050505] px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-secondary-text">{language === 'en' ? 'Current mode' : '当前模式'}</p>
                <h2 className="mt-2 text-base font-semibold text-foreground">{watchlistTitle}</h2>
              </div>
            </section>

            <section className="flex-1 min-w-0 flex flex-col min-h-0 gap-4 overflow-hidden">
              <div data-testid="user-scanner-bento-hero" className="flex justify-between items-center gap-3 pb-2 border-b border-white/5 shrink-0">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-white">{language === 'en' ? 'Scanner results and execution plan' : '扫描结果与执行计划'}</h2>
                  <p className="mt-1 truncate text-sm text-secondary-text">{runDetail?.headline || selectedMarketCopy.currentRunFallback}</p>
                </div>
                <span
                  data-testid="user-scanner-bento-hero-shortlist-value"
                  className="shrink-0 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-full"
                  style={{ textShadow: '0 0 30px rgba(52, 211, 153, 0.45)' }}
                >
                  {language === 'en' ? `${shortlistCount} symbols hit` : `命中 ${shortlistCount} 只标的`}
                </span>
              </div>

              {tacticalCards.length ? (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 overflow-y-auto no-scrollbar pb-24">
                  {tacticalCards.map((candidate) => (
                    <article
                      key={`watchlist-${candidate.symbol}`}
                      className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 hover:bg-white/[0.04] transition-colors"
                    >
                      <div className="flex justify-between items-start gap-4 mb-4">
                        <div className="min-w-0">
                          <h3 className="text-xl font-bold text-white tracking-tight">
                            {candidate.symbol}
                            {shouldRenderDisplayName(candidate.symbol, candidate.name) ? (
                              <span className="ml-2 text-sm font-normal text-white/40">{candidate.name}</span>
                            ) : null}
                          </h3>
                          <div className="flex flex-wrap gap-2 mt-2">
                            {candidate.tags.map((tag) => (
                              <span key={`${candidate.symbol}-${tag}`} className="text-[10px] px-2 py-0.5 rounded border border-indigo-500/30 text-indigo-400 bg-indigo-500/10">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-emerald-400 font-bold">{candidate.signalValue}</div>
                          <div className="text-xs text-white/30 mt-1">{candidate.signalLabel}</div>
                        </div>
                      </div>

                      <p className="text-sm text-white/60 mb-5 leading-relaxed">
                        {language === 'en' ? 'AI insight: ' : 'AI 洞察：'}
                        {candidate.insight}
                      </p>

                      <div className="grid grid-cols-1 gap-2 p-3 bg-[#050505] rounded-xl border border-white/5 sm:grid-cols-3">
                        <div>
                          <div className="text-[10px] text-white/40 mb-1 uppercase">{language === 'en' ? 'Entry zone' : '建仓区间'}</div>
                          <div className="text-sm text-white font-medium">{candidate.entryZone}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-white/40 mb-1 uppercase">{language === 'en' ? 'Target' : '目标位'}</div>
                          <div className="text-sm text-emerald-400 font-medium">{candidate.targetLevel}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-white/40 mb-1 uppercase">{language === 'en' ? 'Hard stop' : '严格止损'}</div>
                          <div className="text-sm text-red-400 font-medium">{candidate.stopLevel}</div>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <ScannerEmptyState
                  title={emptyStateTitle}
                  body={pageError?.message || emptyStateBody}
                />
              )}
            </section>
          </main>
        </div>
      </div>

      <Drawer
        isOpen={isRationaleDrawerOpen}
        onClose={() => setIsRationaleDrawerOpen(false)}
        title={language === 'en' ? 'Run history' : '历史运行记录'}
        width="max-w-4xl"
      >
        <div data-testid="user-scanner-bento-drawer" className="theme-panel-glass ml-auto h-full w-full max-w-4xl rounded-l-[40px] p-6 text-foreground sm:p-8">
          <div className="grid gap-6">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-text">{language === 'en' ? 'Run history' : '运行历史'}</p>
              <h2 className="mt-1 text-xl text-foreground">{language === 'en' ? 'Recent scanner runs' : '近期扫描记录'}</h2>
            </div>

            {historyError ? <ApiErrorAlert error={historyError} /> : null}
            {isLoadingHistory ? <div className="theme-panel-subtle rounded-[28px] px-4 py-5 text-sm text-secondary-text">{t('scanner.loadingHistory')}</div> : null}
            {!isLoadingHistory && historyCards.length ? (
              <div className="space-y-3">
                {historyCards.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void loadRun(item.id)}
                    className={`w-full flex flex-col gap-3 bg-white/[0.02] border border-white/5 rounded-2xl p-5 hover:bg-white/[0.04] transition-colors text-left ${item.id === selectedRunId ? 'border-white/15 bg-white/[0.05]' : ''}`}
                  >
                    <div className="flex w-full max-w-full items-start gap-3 overflow-hidden">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <PillBadge variant={marketVariant(item.market)}>{item.market === 'us' ? t('scanner.marketUs') : item.market === 'hk' ? t('scanner.marketHk') : t('scanner.marketCn')}</PillBadge>
                          <PillBadge variant={statusVariant(item.status)}>{t(`scanner.status.${item.status}`)}</PillBadge>
                          {item.watchlistDate ? <PillBadge variant="history">{formatDateOnly(item.watchlistDate, language)}</PillBadge> : null}
                        </div>
                        <h4 className="mt-3 mb-2 w-full truncate font-bold text-white">
                          {item.historyHeadline.title}
                        </h4>
                        {item.historyHeadline.detail ? (
                          <p className="break-words whitespace-normal w-full text-sm text-white/70 leading-relaxed">
                            {item.historyHeadline.detail}
                          </p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-secondary-text">
                          <span>{`${t('scanner.metricShortlist')}: ${item.shortlistSize}`}</span>
                          <span>{`${t('scanner.metricUniverse')}: ${item.universeSize}`}</span>
                          <span>{formatTimestamp(item.runAt, language)}</span>
                        </div>
                        {item.historyHeadline.symbols.length ? (
                          <div className="product-chip-list product-chip-list--tight mt-3 w-full" data-testid={`scanner-history-symbols-${item.id}`}>
                            {item.historyHeadline.symbols.map((symbol) => (
                              <span
                                key={`${item.id}-${symbol}`}
                                className="product-chip shrink-0 text-[10px] px-2 py-1"
                              >
                                {symbol}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
            {!isLoadingHistory && !historyItems.length ? <ScannerEmptyState title={emptyStateTitle} body={emptyStateBody} className="py-12" /> : null}
            {totalHistoryPages > 1 ? <div className="pt-2"><Pagination currentPage={historyPage} totalPages={totalHistoryPages} onPageChange={(page) => void fetchHistory(page)} /></div> : null}
          </div>
        </div>
      </Drawer>
    </>
  );
};

export default UserScannerPage;
