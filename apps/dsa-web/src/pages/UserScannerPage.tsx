import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PanelRightOpen, Play } from 'lucide-react';
import { getParsedApiError, type ParsedApiError } from '../api/error';
import { scannerApi } from '../api/scanner';
import { ApiErrorAlert, Drawer, Pagination, PillBadge, SectionShell } from '../components/common';
import { useI18n } from '../contexts/UiLanguageContext';
import {
  getSafariReadySurfaceClassName,
  shouldApplySafariA11yGuard,
  useSafariRenderReady,
  useSafariWarmActivation,
} from '../hooks/useSafariInteractionReady';
import type { ScannerRunDetail, ScannerRunHistoryItem } from '../types/scanner';
import {
  getScannerDetailOptions,
  getScannerProfileOptions,
  getScannerUniverseOptions,
  SCANNER_PROFILE_DEFAULTS,
} from './scannerPageShared';

const HISTORY_PAGE_SIZE = 8;

type PillOption = { value: string; label: string };
type TacticalTagTone = 'indigo' | 'neutral';
type TacticalTag = { name: string; description: string; tone: TacticalTagTone };
type ScannerResultContext = {
  companyName: string;
  aiScore?: number;
  tags: TacticalTag[];
};

const SCANNER_RESULT_CONTEXT: Record<string, ScannerResultContext> = {
  AVGO: {
    companyName: 'Broadcom Inc.',
    aiScore: 94,
    tags: [
      { name: '半导体设备', description: '全球领先的有线和无线通信半导体公司。', tone: 'neutral' },
      { name: 'AI 算力基建', description: '定制化 AI 芯片与网络交换芯片的核心供应商。', tone: 'indigo' },
    ],
  },
  NVDA: {
    companyName: 'NVIDIA Corp.',
    aiScore: 97,
    tags: [
      { name: 'GPU 核心', description: '垄断全球 AI 训练端算力芯片市场。', tone: 'neutral' },
      { name: '算力霸主', description: '数据中心业务维持三位数增长，是行业绝对龙头。', tone: 'indigo' },
    ],
  },
  AMD: {
    companyName: 'Advanced Micro Devices',
    aiScore: 88,
    tags: [
      { name: '边缘推理', description: '终端侧 AI 推理正在扩散，部署速度与性价比优势明显。', tone: 'indigo' },
      { name: 'GPU 替代链', description: '在训练与推理两端持续争夺高性能算力份额。', tone: 'neutral' },
    ],
  },
  AMZN: {
    companyName: 'Amazon.com Inc.',
    aiScore: 84,
    tags: [
      { name: '云算力租赁', description: 'AWS 持续受益于企业级 AI 基础设施需求外溢。', tone: 'indigo' },
      { name: '资本开支扩张', description: '云与物流双轮驱动，支撑中长期自由现金流修复。', tone: 'neutral' },
    ],
  },
  SMH: {
    companyName: 'VanEck Semiconductor ETF',
    aiScore: 79,
    tags: [
      { name: '板块贝塔', description: '覆盖半导体核心权重股，可快速观察板块风险偏好。', tone: 'indigo' },
      { name: '景气温度计', description: '适合跟踪芯片产业链整体强弱与资金轮动节奏。', tone: 'neutral' },
    ],
  },
  NFLX: {
    companyName: 'Netflix Inc.',
    aiScore: 83,
    tags: [
      { name: '流媒体龙头', description: '订阅用户与内容投入形成双重护城河，现金流改善明显。', tone: 'indigo' },
      { name: '广告变现', description: '广告版订阅持续扩容，提升单用户收入的弹性。', tone: 'neutral' },
    ],
  },
  C: {
    companyName: 'Citigroup Inc.',
    aiScore: 82,
    tags: [
      { name: '全球银行', description: '跨境结算与投行业务覆盖全球，是美元流动性的重要受益者。', tone: 'indigo' },
      { name: '利率敏感', description: '收益率曲线变化会直接影响净息差与估值修复节奏。', tone: 'neutral' },
    ],
  },
  INTC: {
    companyName: 'Intel Corp.',
    aiScore: 82,
    tags: [
      { name: '晶圆代工转型', description: '正通过先进制程与代工战略争取产业链重新定价。', tone: 'indigo' },
      { name: 'CPU 基座', description: 'PC 与服务器 CPU 仍是其核心现金流来源。', tone: 'neutral' },
    ],
  },
};

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
  return tone === 'neutral'
    ? 'bg-white/[0.04] border-white/10 text-white/72 group-hover:border-white/20 group-hover:bg-white/[0.07]'
    : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-300 group-hover:border-indigo-400/35 group-hover:bg-indigo-500/14';
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
  const context = SCANNER_RESULT_CONTEXT[candidate.symbol.toUpperCase()];
  if (candidate.tags?.length) {
    return candidate.tags
      .map((tag, index) => {
        const tone: TacticalTagTone = tag.tone === 'indigo' ? 'indigo' : index === 0 ? 'indigo' : 'neutral';
        return {
          name: tag.name.trim(),
          description: tag.description.trim(),
          tone,
        };
      })
      .filter((tag) => tag.name && tag.description)
      .slice(0, 2);
  }

  if (context?.tags.length) {
    return context.tags;
  }

  const rawTags = [
    ...candidate.featureSignals.map((signal) => signal.value?.trim()).filter(Boolean),
    ...candidate.boards.map((board) => board.trim()),
    candidate.qualityHint?.trim(),
  ].filter((tag): tag is string => Boolean(tag));

  return Array.from(new Set(rawTags))
    .filter((tag) => {
      const normalized = tag.toLowerCase();
      const looksLikeNumericTechMetric = /\d/.test(tag) || normalized.includes('/') || normalized.includes('trend');
      return !['行业', '主线', 'board', 'theme'].includes(normalized) && !looksLikeNumericTechMetric;
    })
    .slice(0, 2)
    .map((tag, index) => ({
      name: tag,
      description: tagDescriptionFor(tag, language),
      tone: index === 0 ? 'indigo' : 'neutral',
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
  variant = 'default',
  testId,
}: {
  label: string;
  value: string;
  options: PillOption[];
  onChange: (next: string) => void;
  variant?: 'default' | 'market';
  testId?: string;
}) {
  const isMarketGroup = variant === 'market';

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs uppercase tracking-widest text-white/40">{label}</span>
      <div
        className={isMarketGroup ? 'flex w-fit rounded-xl border border-white/5 bg-black/40 p-1' : 'flex flex-wrap gap-2'}
        role="group"
        aria-label={label}
        data-testid={testId}
      >
        {options.map((option) => {
          const isActive = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => onChange(option.value)}
              className={isActive
                ? isMarketGroup
                  ? 'rounded-lg bg-white/10 px-5 py-1.5 text-sm font-bold text-white shadow-[0_2px_10px_rgba(0,0,0,0.5)] transition-all'
                  : 'rounded-full border border-white/10 bg-white/10 px-4 py-1.5 text-sm text-white transition-colors'
                : isMarketGroup
                  ? 'rounded-lg bg-transparent px-5 py-1.5 text-sm font-medium text-white/40 transition-all hover:text-white/70'
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
  if (score >= 90) return 'bg-white/[0.08] text-white border-white/12';
  if (score >= 80) return 'bg-indigo-500/12 text-indigo-200 border-indigo-500/20';
  return 'bg-white/[0.04] text-white/72 border-white/10';
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
  const { isReady: isSafariReady, surfaceRef } = useSafariRenderReady();
  const shouldGuardA11y = shouldApplySafariA11yGuard();
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
  const runScannerButton = useSafariWarmActivation<HTMLButtonElement>(() => {
    void handleRun();
  });
  const openHistoryDrawerButton = useSafariWarmActivation<HTMLButtonElement>(() => setIsRationaleDrawerOpen(true));
  const shortlistCount = runDetail?.shortlist?.length ?? 0;
  const generatedAt = runDetail?.completedAt || runDetail?.runAt || null;
  const elapsedTime = formatDuration(runDetail?.runAt, runDetail?.completedAt, language);
  const tacticalCards = runDetail?.shortlist.map((candidate) => ({
    symbol: candidate.symbol,
    name: candidate.name,
    companyName: candidate.companyName?.trim() || SCANNER_RESULT_CONTEXT[candidate.symbol.toUpperCase()]?.companyName || candidate.name,
    aiScore: formatAiScore(SCANNER_RESULT_CONTEXT[candidate.symbol.toUpperCase()]?.aiScore ?? candidate.score),
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
    const matchedSymbols = dedupeTickerSymbols(item.topSymbols);
    return {
      ...item,
      historyHeadline: formatHistoryHeadline(item.headline, item.topSymbols, fallbackTitle),
      matchedSymbols: matchedSymbols.slice(0, 10),
      overflowSymbolCount: Math.max(0, matchedSymbols.length - 10),
    };
  }), [historyItems, t]);
  const emptyStateTitle = language === 'en' ? 'No matching scanner results' : '当前无匹配的扫描结果';
  const emptyStateBody = language === 'en' ? 'Adjust the filters on the left or try again later' : '请调整左侧参数或稍后再试';

  return (
    <>
      <div
        ref={surfaceRef}
        data-testid="user-scanner-bento-page"
        data-bento-surface="true"
        aria-hidden={shouldGuardA11y && !isSafariReady ? true : undefined}
        aria-live={shouldGuardA11y ? (isSafariReady ? 'polite' : 'off') : undefined}
        className={getSafariReadySurfaceClassName(
          isSafariReady,
          'bento-surface-root flex w-full flex-1 min-h-0 min-w-0 bg-transparent text-foreground',
        )}
      >
        <div
          data-testid="user-scanner-workspace"
          className="flex w-full flex-1 min-h-0 min-w-0 flex-col bg-transparent px-6 py-8 md:px-8 xl:px-12"
        >
          <header className="shrink-0 flex justify-between items-start mb-3 mt-0">
            <div>
              <p className="text-[10px] uppercase tracking-[0.28em] text-white/36">{language === 'en' ? 'TACTICAL ROUTER' : 'TACTICAL ROUTER'}</p>
              <h1 className="mt-3 text-[1.7rem] tracking-[-0.03em] text-foreground md:text-[1.9rem]">{language === 'en' ? 'MARKET SCANNER' : '市场扫描'}</h1>
            </div>
          </header>

          {pageError ? <ApiErrorAlert error={pageError} /> : null}

          <main className="mt-6 flex w-full flex-1 min-h-0 min-w-0 flex-col gap-6 xl:flex-row">
            <section
              data-testid="scanner-sidebar"
              className="w-full xl:w-[320px] 2xl:w-[360px] shrink-0 flex flex-col gap-6 bg-white/[0.02] border border-white/5 rounded-[24px] p-6 h-fit sticky top-6"
            >
              <SectionShell className="rounded-[24px] p-0 bg-transparent shadow-none">
                <div className="flex flex-col gap-6">
                  <PillTagGroup label={t('scanner.marketLabel')} value={market} onChange={(next) => handleMarketChange(next as 'cn' | 'us' | 'hk')} options={[{ value: 'cn', label: t('scanner.marketCn') }, { value: 'us', label: t('scanner.marketUs') }, { value: 'hk', label: t('scanner.marketHk') }]} variant="market" testId="scanner-market-toggle" />
                  <PillTagGroup label={t('scanner.profileLabel')} value={profile} onChange={setProfile} options={profileOptions} />
                  <PillTagGroup label={t('scanner.shortlistLabel')} value={shortlistSize} onChange={setShortlistSize} options={[{ value: '5', label: language === 'en' ? 'Top 5' : '前 5' }, { value: '8', label: language === 'en' ? 'Top 8' : '前 8' }, { value: '10', label: language === 'en' ? 'Top 10' : '前 10' }]} />
                  <PillTagGroup label={t('scanner.universeLabel')} value={universeLimit} onChange={setUniverseLimit} options={universeOptions} />
                  <PillTagGroup label={t('scanner.detailLabel')} value={detailLimit} onChange={setDetailLimit} options={detailOptions} />
                  <div className="flex flex-col gap-4">
                    <button
                      ref={runScannerButton.ref}
                      type="button"
                      onClick={runScannerButton.onClick}
                      onPointerUp={runScannerButton.onPointerUp}
                      disabled={isRunning}
                      aria-busy={isRunning}
                      data-testid="scanner-run-button"
                      className="group mt-8 flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-8 py-4 text-sm font-bold text-indigo-400 transition-all hover:border-indigo-500/50 hover:bg-indigo-500/20 hover:shadow-[0_0_25px_rgba(99,102,241,0.2)] active:scale-95 disabled:pointer-events-none disabled:opacity-60 disabled:shadow-none disabled:transform-none"
                    >
                      <Play className="h-4 w-4 group-hover:animate-pulse" />
                      <span>{isRunning ? t('scanner.running') : t('scanner.run')}</span>
                    </button>
                  </div>
                </div>
              </SectionShell>
            </section>

            <section
              data-testid="scanner-results-pane"
              className="flex-1 min-h-0 min-w-0 overflow-y-auto no-scrollbar pb-24"
            >
              <div data-testid="user-scanner-bento-hero" className="mb-5 flex shrink-0 items-end justify-between gap-3 border-b border-white/5 pb-4">
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
                <div className="flex items-center gap-4">
                  <span
                    data-testid="user-scanner-bento-hero-shortlist-value"
                    className="shrink-0 rounded-full border border-white/12 bg-white/[0.08] px-3 py-1 text-xs font-bold text-white"
                  >
                    {language === 'en' ? `${shortlistCount} symbols hit` : `命中 ${shortlistCount} 只标的`}
                  </span>
                  <button
                    ref={openHistoryDrawerButton.ref}
                    type="button"
                    data-testid="user-scanner-bento-drawer-trigger"
                    onClick={openHistoryDrawerButton.onClick}
                    onPointerUp={openHistoryDrawerButton.onPointerUp}
                    className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/[0.1]"
                  >
                    <PanelRightOpen className="h-4 w-4" />
                    <span>{language === 'en' ? 'Run history' : '历史运行记录'}</span>
                  </button>
                </div>
              </div>

              {tacticalCards.length ? (
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  {tacticalCards.map((candidate) => (
                    <article
                      key={`watchlist-${candidate.symbol}`}
                      className="rounded-[24px] border border-white/5 bg-white/[0.02] p-5 transition-colors hover:border-white/16 hover:bg-white/[0.04]"
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
                          <div className="font-bold text-white">{candidate.forecastValue}</div>
                          <div className="text-xs text-white/30 mt-1">{language === 'en' ? 'Annualized return forecast' : '年化收益预测'}</div>
                        </div>
                      </div>

                      <p className="text-sm text-white/60 mb-5 leading-relaxed">
                        {language === 'en' ? 'AI insight: ' : 'AI 洞察：'}
                        {candidate.insight}
                      </p>

                      <div className="grid grid-cols-1 gap-2 rounded-[20px] border border-white/5 bg-white/[0.02] p-3 sm:grid-cols-3">
                        <div>
                          <div className="text-[10px] text-white/40 mb-1 uppercase">{language === 'en' ? 'Entry zone' : '建仓区间'}</div>
                          <div className="text-sm text-white font-medium">{candidate.entryZone}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-white/40 mb-1 uppercase">{language === 'en' ? 'Target' : '目标位'}</div>
                          <div className="text-sm font-medium text-white">{candidate.targetLevel}</div>
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
                        {item.matchedSymbols.length ? (
                          <div className="product-chip-list product-chip-list--tight mt-3 w-full" data-testid={`scanner-history-symbols-${item.id}`}>
                            {item.matchedSymbols.map((symbol) => (
                              <span
                                key={`${item.id}-${symbol}`}
                                className="product-chip shrink-0 text-[10px] px-2 py-1"
                              >
                                {symbol}
                              </span>
                            ))}
                            {item.overflowSymbolCount > 0 ? (
                              <span className="product-chip shrink-0 text-[10px] px-2 py-1">
                                +{item.overflowSymbolCount}
                              </span>
                            ) : null}
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
