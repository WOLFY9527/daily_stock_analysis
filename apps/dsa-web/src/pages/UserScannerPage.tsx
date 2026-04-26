import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PanelRightOpen, Play } from 'lucide-react';
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
type TacticalTagTone = 'indigo' | 'emerald';
type TacticalTag = { name: string; description: string; tone: TacticalTagTone };

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

function tooltipToneClass(tone: TacticalTagTone): string {
  return tone === 'emerald'
    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 group-hover:bg-emerald-500/20'
    : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400 group-hover:bg-indigo-500/20';
}

function tagDescriptionFor(name: string, language: 'zh' | 'en'): string {
  const zhDescriptions: Record<string, string> = {
    'AI 算力基建': '涵盖 GPU、光模块、液冷等核心硬件，当前处于行业高景气周期，业绩确定性极强。',
    '半导体设备': '提供芯片制造与封测设备，是半导体产业链的上游核心。',
    '数据中心': '受益于云厂商与企业级算力扩容，订单兑现速度快。',
    '网络芯片': '聚焦交换、互联与高速传输，是 AI 集群扩容的关键底座。',
    '边缘推理': '终端侧 AI 推理正在扩散，具备成本与部署速度优势。',
    GPU: '兼具训练与推理能力，是 AI 计算平台的核心芯片。',
  };
  const enDescriptions: Record<string, string> = {
    'AI infrastructure': 'Covers GPUs, optical links, and liquid cooling, with strong demand and visible earnings momentum.',
    'Semiconductor equipment': 'Provides manufacturing and packaging equipment for the upstream semiconductor chain.',
    'Data center': 'Benefits from cloud and enterprise compute expansion with fast order conversion.',
    'Networking silicon': 'Powers switching and high-speed connectivity inside AI clusters.',
    'Edge inference': 'AI inference is spreading to endpoint devices where deployment speed matters.',
    GPU: 'Core compute silicon that serves both model training and inference workloads.',
  };
  const dictionary = language === 'en' ? enDescriptions : zhDescriptions;
  return dictionary[name] || (language === 'en' ? 'Part of the current market leadership cluster with active capital attention.' : '属于当前市场主线中持续获得资金关注的方向。');
}

function formatCandidateTags(candidate: ScannerRunDetail['shortlist'][number], language: 'zh' | 'en'): TacticalTag[] {
  if (candidate.tags?.length) {
    return candidate.tags
      .map((tag, index) => ({
        name: tag.name.trim(),
        description: tag.description.trim(),
        tone: tag.tone || (index === 0 ? 'indigo' : 'emerald'),
      }))
      .filter((tag) => tag.name && tag.description)
      .slice(0, 2);
  }

  const rawTags = [
    ...candidate.featureSignals.map((signal) => signal.value?.trim()).filter(Boolean),
    ...candidate.boards.map((board) => board.trim()),
    candidate.qualityHint?.trim(),
  ].filter((tag): tag is string => Boolean(tag));

  return Array.from(new Set(rawTags))
    .filter((tag) => !['行业', '主线', 'board', 'theme'].includes(tag.toLowerCase()))
    .slice(0, 2)
    .map((tag, index) => ({
      name: tag,
      description: tagDescriptionFor(tag, language),
      tone: index === 0 ? 'indigo' : 'emerald',
    }));
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

function formatDuration(start?: string | null, end?: string | null, language: 'zh' | 'en' = 'zh'): string {
  if (!start || !end) return '--';
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (Number.isNaN(startTime) || Number.isNaN(endTime) || endTime <= startTime) return '--';
  const totalSeconds = Math.round((endTime - startTime) / 1000);
  if (totalSeconds < 60) {
    return language === 'en' ? `${totalSeconds}s` : `${totalSeconds}秒`;
  }
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) {
    return language === 'en' ? `${totalMinutes}m` : `${totalMinutes}分钟`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return language === 'en' ? `${hours}h ${minutes}m` : `${hours}小时${minutes}分钟`;
}

function formatAiScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreBadgeClass(score: number): string {
  if (score >= 90) return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/20';
  if (score >= 80) return 'bg-amber-500/18 text-amber-300 border-amber-500/20';
  return 'bg-sky-500/18 text-sky-300 border-sky-500/20';
}

function formatForecastValue(candidate: ScannerRunDetail['shortlist'][number]): string {
  const explicitForecast = findCandidateValue(candidate, ['年化收益', '收益预测', 'forecast', 'expected return']);
  if (explicitForecast) return explicitForecast;
  const forecastValue = candidate.score >= 0 ? candidate.score : 0;
  return `+${forecastValue.toFixed(1)}%`;
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
  const generatedAt = runDetail?.completedAt || runDetail?.runAt || null;
  const elapsedTime = formatDuration(runDetail?.runAt, runDetail?.completedAt, language);
  const tacticalCards = runDetail?.shortlist.map((candidate) => ({
    symbol: candidate.symbol,
    name: candidate.name,
    companyName: candidate.companyName?.trim() || candidate.name,
    aiScore: formatAiScore(candidate.score),
    tags: formatCandidateTags(candidate, language),
    forecastValue: formatForecastValue(candidate),
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
            <section className="w-full lg:w-[320px] xl:w-[360px] shrink-0 flex flex-col gap-6 bg-white/[0.02] border border-white/5 rounded-[24px] p-6 sticky top-8 h-fit max-h-[calc(100vh-100px)] overflow-y-auto no-scrollbar">
              <SectionShell className="rounded-[24px] p-0 bg-transparent shadow-none">
                <div className="flex flex-col gap-6">
                  <PillTagGroup label={t('scanner.marketLabel')} value={market} onChange={(next) => handleMarketChange(next as 'cn' | 'us' | 'hk')} options={[{ value: 'cn', label: t('scanner.marketCn') }, { value: 'us', label: t('scanner.marketUs') }, { value: 'hk', label: t('scanner.marketHk') }]} />
                  <PillTagGroup label={t('scanner.profileLabel')} value={profile} onChange={setProfile} options={profileOptions} />
                  <PillTagGroup label={t('scanner.shortlistLabel')} value={shortlistSize} onChange={setShortlistSize} options={[{ value: '5', label: language === 'en' ? 'Top 5' : '前 5' }, { value: '8', label: language === 'en' ? 'Top 8' : '前 8' }, { value: '10', label: language === 'en' ? 'Top 10' : '前 10' }]} />
                  <PillTagGroup label={t('scanner.universeLabel')} value={universeLimit} onChange={setUniverseLimit} options={universeOptions} />
                  <PillTagGroup label={t('scanner.detailLabel')} value={detailLimit} onChange={setDetailLimit} options={detailOptions} />
                  <div className="flex flex-col gap-4">
                    <button
                      type="button"
                      onClick={() => void handleRun()}
                      disabled={isRunning}
                      aria-busy={isRunning}
                      className="w-full mt-6 px-8 py-3.5 bg-emerald-500/10 text-emerald-400 font-bold text-sm rounded-xl border border-emerald-500/30 hover:bg-emerald-500/20 hover:border-emerald-500/50 hover:shadow-[0_0_20px_rgba(16,185,129,0.15)] active:scale-95 transition-all shrink-0 flex items-center justify-center gap-2 disabled:pointer-events-none disabled:opacity-60 disabled:transform-none"
                    >
                      <Play className="h-4 w-4" />
                      <span>{isRunning ? t('scanner.running') : t('scanner.run')}</span>
                    </button>
                  </div>
                </div>
              </SectionShell>
            </section>

            <section className="flex-1 min-w-0 flex flex-col min-h-0 gap-4 overflow-hidden">
              <div data-testid="user-scanner-bento-hero" className="flex items-end justify-between gap-3 border-b border-white/5 pb-4 mb-2 shrink-0">
                <div className="min-w-0">
                  <h2 className="text-xl font-bold text-white mb-1">{language === 'en' ? 'Scanner results and tactical plan' : '扫描结果与战术计划'}</h2>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-white/40">
                    <span>
                      {language === 'en' ? 'Generated:' : '生成时间：'}
                      {generatedAt ? ` ${formatTimestamp(generatedAt, language)}` : ' --'}
                    </span>
                    <span className="w-1 h-1 rounded-full bg-white/20" aria-hidden="true" />
                    <span>
                      {language === 'en' ? 'Elapsed:' : '耗时：'}
                      {` ${elapsedTime}`}
                    </span>
                  </div>
                </div>
                <span
                  data-testid="user-scanner-bento-hero-shortlist-value"
                  className="shrink-0 text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-full"
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
                        <div className="min-w-0 flex flex-col gap-1.5">
                          <div className="flex items-baseline gap-2 mb-1 min-w-0">
                            <h3 className="text-xl font-bold text-white tracking-tight">
                              {candidate.symbol}
                            </h3>
                            <span className="text-xs text-white/40 font-medium truncate max-w-[150px]">
                              {candidate.companyName}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-bold ${scoreBadgeClass(candidate.aiScore)}`}>
                              {language === 'en' ? `AI score ${candidate.aiScore}/100` : `AI 评分 ${candidate.aiScore}/100`}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {candidate.tags.map((tag) => (
                              <div
                                key={`${candidate.symbol}-${tag.name}`}
                                className="relative group cursor-help"
                              >
                                <span className={`text-[10px] px-2 py-1 rounded border transition-colors ${tooltipToneClass(tag.tone)}`}>
                                  {tag.name}
                                </span>
                                <div className="absolute bottom-full left-0 mb-2 w-48 rounded-lg border border-white/10 bg-[#111] p-2.5 shadow-2xl opacity-0 invisible transition-all duration-200 z-50 group-hover:opacity-100 group-hover:visible">
                                  <p className="text-[10px] text-white/70 leading-relaxed font-normal whitespace-normal">
                                    {tag.description}
                                  </p>
                                  <div className="absolute top-full left-4 -mt-px border-4 border-transparent border-t-[#111]" />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-emerald-400 font-bold">{candidate.forecastValue}</div>
                          <div className="text-xs text-white/30 mt-1">{language === 'en' ? 'Annualized return forecast' : '年化收益预测'}</div>
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
        <div data-testid="user-scanner-bento-drawer" className="ml-auto w-full max-w-4xl rounded-l-[40px] bg-transparent p-6 text-foreground sm:p-8">
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
