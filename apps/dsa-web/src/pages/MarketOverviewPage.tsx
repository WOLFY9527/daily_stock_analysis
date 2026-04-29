import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MarketOverviewItem, MarketOverviewPanel } from '../api/marketOverview';
import { marketOverviewApi } from '../api/marketOverview';
import type {
  CnShortSentimentResponse,
  MarketBriefingResponse,
  MarketFutureItem,
  MarketFuturesResponse,
  MarketTemperatureResponse,
  MarketTemperatureScore,
} from '../api/market';
import { marketApi } from '../api/market';
import { CryptoCard } from '../components/market-overview/CryptoCard';
import { FundsFlowCard } from '../components/market-overview/FundsFlowCard';
import { IndexTrendsCard } from '../components/market-overview/IndexTrendsCard';
import { MacroIndicatorsCard } from '../components/market-overview/MacroIndicatorsCard';
import { MarketSentimentCard } from '../components/market-overview/MarketSentimentCard';
import { MarketOverviewCard } from '../components/market-overview/MarketOverviewCard';
import { VolatilityCard } from '../components/market-overview/VolatilityCard';
import { resolveMarketOverviewDisplayLabel } from '../components/market-overview/marketOverviewLabels';
import {
  MarketOverviewPanelFooter,
  MarketOverviewRefreshButton,
  MarketOverviewSparkline,
} from '../components/market-overview/marketOverviewPrimitives';
import { useI18n } from '../contexts/UiLanguageContext';
import { GlassCard } from '../components/common';
import { cn } from '../utils/cn';

type PanelState = {
  indices?: MarketOverviewPanel;
  volatility?: MarketOverviewPanel;
  crypto?: MarketOverviewPanel;
  sentiment?: MarketOverviewPanel;
  fundsFlow?: MarketOverviewPanel;
  macro?: MarketOverviewPanel;
  cnIndices?: MarketOverviewPanel;
  cnBreadth?: MarketOverviewPanel;
  cnFlows?: MarketOverviewPanel;
  sectorRotation?: MarketOverviewPanel;
  rates?: MarketOverviewPanel;
  fxCommodities?: MarketOverviewPanel;
  temperature: MarketTemperatureResponse;
  briefing: MarketBriefingResponse;
  futures: MarketFuturesResponse;
  cnShortSentiment: CnShortSentimentResponse;
};

type PanelKey = keyof PanelState;
type CardKey = Exclude<PanelKey, 'temperature' | 'briefing'>;
type CategoryKey = 'all' | 'us' | 'cn' | 'macro' | 'crypto';

const CATEGORY_CARDS: Record<CategoryKey, CardKey[]> = {
  all: ['futures', 'cnShortSentiment', 'sentiment', 'fxCommodities', 'rates', 'indices', 'fundsFlow', 'volatility', 'cnIndices', 'cnFlows', 'cnBreadth', 'sectorRotation', 'crypto'],
  us: ['futures', 'indices', 'fundsFlow', 'sentiment', 'volatility'],
  cn: ['cnShortSentiment', 'futures', 'cnIndices', 'cnFlows', 'cnBreadth', 'sectorRotation'],
  macro: ['futures', 'rates', 'fxCommodities', 'macro', 'volatility'],
  crypto: ['crypto'],
};
const CATEGORY_STORAGE_KEYS: Record<CategoryKey, string> = {
  all: 'market-overview-order-all',
  us: 'market-overview-order-us',
  cn: 'market-overview-order-cn',
  macro: 'market-overview-order-macro',
  crypto: 'market-overview-order-crypto',
};
const AUTO_REFRESH_MS = 60_000;

const FALLBACK_TEMPERATURE: MarketTemperatureResponse = {
  source: 'fallback',
  updatedAt: new Date(0).toISOString(),
  scores: {
    overall: { value: 50, label: '中性', trend: 'stable', description: '市场温度数据暂用备用源。' },
    usRiskAppetite: { value: 50, label: '中性', trend: 'stable', description: '美股风险偏好暂用备用源。' },
    cnMoneyEffect: { value: 50, label: '中性', trend: 'stable', description: 'A股赚钱效应暂用备用源。' },
    macroPressure: { value: 50, label: '中性', trend: 'stable', description: '宏观压力暂用备用源。' },
    liquidity: { value: 50, label: '中性', trend: 'stable', description: '流动性环境暂用备用源。' },
  },
};

const FALLBACK_BRIEFING: MarketBriefingResponse = {
  source: 'fallback',
  updatedAt: new Date(0).toISOString(),
  items: [
    { title: '市场数据备用源', message: '当前部分数据为备用源，仅供趋势参考。', severity: 'risk', category: 'risk' },
    { title: '美股风险偏好中性', message: '等待主要指数、VIX 与情绪指标同步更新。', severity: 'neutral', category: 'us' },
    { title: 'A股赚钱效应中性', message: '等待市场宽度、涨跌停与资金流向确认。', severity: 'neutral', category: 'cn' },
  ],
};

const FALLBACK_FUTURES: MarketFuturesResponse = {
  source: 'fallback',
  updatedAt: new Date(0).toISOString(),
  items: [
    { name: '纳指期货', symbol: 'NQ', value: 18420.5, change: 65.2, changePercent: 0.35, market: 'US', session: 'premarket', sparkline: [18320, 18380, 18420.5], source: 'fallback' },
    { name: '标普500期货', symbol: 'ES', value: 5238.25, change: 14.5, changePercent: 0.28, market: 'US', session: 'premarket', sparkline: [5208, 5218, 5238.25], source: 'fallback' },
    { name: '道指期货', symbol: 'YM', value: 38980, change: 72, changePercent: 0.19, market: 'US', session: 'premarket', sparkline: [38820, 38930, 38980], source: 'fallback' },
    { name: '罗素2000期货', symbol: 'RTY', value: 2094.6, change: -3.8, changePercent: -0.18, market: 'US', session: 'premarket', sparkline: [2108, 2098, 2094.6], source: 'fallback' },
    { name: '富时A50期货', symbol: 'CN00Y', value: 12580, change: 38, changePercent: 0.3, market: 'CN', session: 'day', sparkline: [12420, 12542, 12580], source: 'fallback' },
    { name: '恒指期货', symbol: 'HSI_F', value: 17712, change: 128, changePercent: 0.73, market: 'HK', session: 'day', sparkline: [17490, 17640, 17712], source: 'fallback' },
  ],
};

const FALLBACK_CN_SHORT_SENTIMENT: CnShortSentimentResponse = {
  source: 'fallback',
  updatedAt: new Date(0).toISOString(),
  sentimentScore: 64,
  summary: '涨停家数占优，炸板率可控，短线情绪偏暖。',
  metrics: {
    limitUpCount: 68,
    limitDownCount: 18,
    failedLimitUpRate: 24.5,
    maxConsecutiveLimitUps: 5,
    yesterdayLimitUpPerformance: 2.8,
    firstBoardCount: 42,
    secondBoardCount: 12,
    highBoardCount: 6,
    twentyCmLimitUpCount: 9,
    stRiskLevel: 'normal',
  },
};

function readStoredCardOrder(category: CategoryKey): CardKey[] {
  const defaultOrder = CATEGORY_CARDS[category];
  if (typeof window === 'undefined') {
    return defaultOrder;
  }
  try {
    const raw = window.localStorage.getItem(CATEGORY_STORAGE_KEYS[category]);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) {
      return defaultOrder;
    }
    const filtered = parsed.filter((item): item is CardKey => defaultOrder.includes(item));
    const missing = defaultOrder.filter((item) => !filtered.includes(item));
    return filtered.length ? [...filtered, ...missing] : defaultOrder;
  } catch {
    return defaultOrder;
  }
}

function persistCardOrder(category: CategoryKey, order: CardKey[]): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(CATEGORY_STORAGE_KEYS[category], JSON.stringify(order));
}

type HeroAnchor = {
  key: string;
  label: string;
  item?: MarketOverviewItem;
};

function findPanelItem(panel: MarketOverviewPanel | undefined, symbols: string[]): MarketOverviewItem | undefined {
  const normalizedSymbols = symbols.map((symbol) => symbol.toUpperCase());
  return panel?.items.find((item) => normalizedSymbols.includes(item.symbol.toUpperCase()));
}

function filterPanelItems(panel: MarketOverviewPanel | undefined, symbols: string[]): MarketOverviewPanel | undefined {
  if (!panel) {
    return undefined;
  }
  const normalizedSymbols = new Set(symbols.map((symbol) => symbol.toUpperCase()));
  return {
    ...panel,
    items: panel.items.filter((item) => normalizedSymbols.has(item.symbol.toUpperCase())),
  };
}

function buildHeroAnchors(panels: PanelState): HeroAnchor[] {
  return [
    { key: 'SPX', label: '标普500', item: findPanelItem(panels.indices, ['SPX']) },
    { key: 'CSI300', label: '沪深300', item: findPanelItem(panels.cnIndices, ['CSI300', '000300.SH']) || findPanelItem(panels.indices, ['CSI300']) },
    { key: 'BTC', label: '比特币', item: findPanelItem(panels.crypto, ['BTC']) },
    { key: 'VIX', label: '恐慌指数', item: findPanelItem(panels.volatility, ['VIX']) },
    { key: 'US10Y', label: '美债10年期', item: findPanelItem(panels.rates, ['US10Y']) || findPanelItem(panels.macro, ['US10Y']) },
    { key: 'DXY', label: '美元指数', item: findPanelItem(panels.fxCommodities, ['DXY']) || findPanelItem(panels.macro, ['DXY']) },
  ];
}

function formatHeroValue(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: Math.abs(value) >= 100 ? 2 : 3,
  }).format(value);
}

function formatHeroChange(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'N/A';
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function heroToneClass(item: MarketOverviewItem | undefined): string {
  if (!item || item.changePct == null) {
    return 'text-white/35';
  }
  return item.changePct >= 0 ? 'text-emerald-400' : 'text-red-400';
}

const CrossAssetHeroRibbon: React.FC<{ anchors: HeroAnchor[] }> = ({ anchors }) => (
  <GlassCard
    as="section"
    data-testid="market-overview-hero-ribbon"
    className="overflow-hidden p-0"
    aria-label="Cross asset hero ribbon"
  >
    <div className="grid grid-cols-2 divide-x divide-y divide-white/5 sm:grid-cols-3 md:grid-cols-6 md:divide-y-0">
      {anchors.map((anchor) => {
        const displayLabel = anchor.item ? resolveMarketOverviewDisplayLabel(anchor.item) : { primary: anchor.label, secondary: anchor.key };
        return (
          <div
            key={anchor.key}
            data-testid={`market-overview-hero-${anchor.key}`}
            className="min-w-0 bg-white/[0.018] px-4 py-3.5"
          >
            <p className="block truncate text-[10px] font-semibold uppercase tracking-widest text-white/50">
              {displayLabel.primary}
              {displayLabel.secondary ? <span className="ml-1 text-white/28">({displayLabel.secondary})</span> : null}
            </p>
            <p className="mt-1 truncate font-mono text-[22px] font-semibold leading-none text-white md:text-2xl">
              {formatHeroValue(anchor.item?.value)}
            </p>
            <p className={`mt-1 font-mono text-xs font-semibold ${heroToneClass(anchor.item)}`}>
              {formatHeroChange(anchor.item?.changePct)}
            </p>
          </div>
        );
      })}
    </div>
  </GlassCard>
);

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
}

function scoreTone(score: MarketTemperatureScore, pressure = false): string {
  if (pressure) {
    return score.value >= 65 ? 'text-red-300' : score.value >= 55 ? 'text-amber-300' : 'text-emerald-300';
  }
  return score.value >= 76 ? 'text-amber-200' : score.value >= 61 ? 'text-emerald-300' : score.value <= 45 ? 'text-sky-300' : 'text-white';
}

const MarketTemperatureStrip: React.FC<{
  data: MarketTemperatureResponse;
  refreshing: boolean;
  onRefresh: () => void;
}> = ({ data, refreshing, onRefresh }) => {
  const { t } = useI18n();
  const scores: Array<{ key: keyof MarketTemperatureResponse['scores']; label: string; pressure?: boolean }> = [
    { key: 'overall', label: t('marketOverviewPage.temperature.overall') },
    { key: 'usRiskAppetite', label: t('marketOverviewPage.temperature.usRiskAppetite') },
    { key: 'cnMoneyEffect', label: t('marketOverviewPage.temperature.cnMoneyEffect') },
    { key: 'macroPressure', label: t('marketOverviewPage.temperature.macroPressure'), pressure: true },
    { key: 'liquidity', label: t('marketOverviewPage.temperature.liquidity') },
  ];
  return (
    <GlassCard as="section" data-testid="market-temperature-strip" className="p-4">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40">{t('marketOverviewPage.temperature.eyebrow')}</p>
          <h2 className="mt-1 text-lg font-semibold text-white">{t('marketOverviewPage.temperature.title')}</h2>
        </div>
        <MarketOverviewRefreshButton label={t('marketOverviewPage.refreshCard', { title: t('marketOverviewPage.temperature.title') })} refreshing={refreshing} onRefresh={onRefresh} />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {scores.map(({ key, label, pressure }) => {
          const score = data.scores[key];
          return (
            <div key={key} className="min-w-[188px] flex-1 rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2.5" title={score.description}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-[11px] font-semibold text-white/60">{label}</p>
                <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold text-white/55">{score.label}</span>
              </div>
              <div className="mt-2 flex items-end gap-2">
                <span className={cn('font-mono text-3xl font-semibold leading-none', scoreTone(score, pressure))}>{score.value}</span>
                <span className="pb-0.5 text-[10px] uppercase tracking-widest text-white/30">{score.trend}</span>
              </div>
              <p className="mt-2 line-clamp-2 text-xs leading-5 text-white/45">{score.description}</p>
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-[10px] uppercase tracking-widest text-white/28">SOURCE: {data.source}</div>
    </GlassCard>
  );
};

const severityClass: Record<string, string> = {
  positive: 'border-emerald-300/20 bg-emerald-400/8 text-emerald-100',
  neutral: 'border-white/8 bg-white/[0.025] text-white/70',
  warning: 'border-amber-300/20 bg-amber-400/8 text-amber-100',
  risk: 'border-red-300/20 bg-red-400/8 text-red-100',
};

const MarketBriefingCard: React.FC<{
  data: MarketBriefingResponse;
  refreshing: boolean;
  onRefresh: () => void;
}> = ({ data, refreshing, onRefresh }) => {
  const { t } = useI18n();
  const title = t('marketOverviewPage.briefing.title');
  return (
    <GlassCard as="section" data-testid="market-briefing-card" className="p-4">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40">{t('marketOverviewPage.briefing.eyebrow')}</p>
          <h2 className="mt-1 text-lg font-semibold text-white">{title}</h2>
        </div>
        <MarketOverviewRefreshButton label={t('marketOverviewPage.refreshCard', { title })} refreshing={refreshing} onRefresh={onRefresh} />
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        {data.items.slice(0, 5).map((item) => (
          <article key={`${item.category}-${item.title}`} className={cn('rounded-lg border px-3 py-2.5', severityClass[item.severity] || severityClass.neutral)}>
            <p className="text-xs font-semibold">{item.title}</p>
            <p className="mt-1 text-xs leading-5 opacity-75">{item.message}</p>
          </article>
        ))}
      </div>
      <div className="mt-2 text-[10px] uppercase tracking-widest text-white/28">SOURCE: {data.source}</div>
    </GlassCard>
  );
};

const FuturesPremarketCard: React.FC<{
  data: MarketFuturesResponse;
  loading?: boolean;
  refreshing?: boolean;
  onRefresh: () => void;
}> = ({ data, loading = false, refreshing = false, onRefresh }) => {
  const { t } = useI18n();
  const title = t('marketOverviewPage.cards.futures.title');
  const panel = { lastRefreshAt: data.updatedAt } as MarketOverviewPanel;
  return (
    <GlassCard as="section" className="flex h-full flex-col p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40">{t('marketOverviewPage.cards.futures.eyebrow')}</p>
          <h2 className="mt-2 text-xl font-semibold text-white">{title}</h2>
          <p className="mt-1 text-sm text-white/55">{t('marketOverviewPage.cards.futures.description')}</p>
        </div>
        <MarketOverviewRefreshButton label={t('marketOverviewPage.refreshCard', { title })} refreshing={refreshing} onRefresh={onRefresh} />
      </div>
      <div className="flex flex-col">
        {data.items.map((item: MarketFutureItem) => {
          const positive = (item.changePercent || 0) >= 0;
          return (
            <article key={item.symbol} className="flex min-h-12 items-center gap-3 border-b border-white/[0.045] py-2.5 last:border-b-0">
              <div className="w-32 shrink-0 min-w-0">
                <p className="truncate text-[10px] font-semibold tracking-widest text-white/65">{item.name}</p>
                <p className="mt-0.5 truncate text-[9px] font-semibold uppercase tracking-widest text-white/25">{item.symbol} / {item.market}</p>
              </div>
              <div className="w-24 shrink-0">
                <MarketOverviewSparkline values={item.sparkline} tone={positive ? 'text-emerald-400' : 'text-red-400'} className="h-8" />
              </div>
              <div className="min-w-0 flex-1 text-right font-mono">
                <p className="truncate text-lg font-semibold leading-none text-white">{formatNumber(item.value)}</p>
                <p className={cn('mt-1 text-[11px] font-bold leading-none', positive ? 'text-emerald-400' : 'text-red-400')}>
                  {item.changePercent == null ? 'N/A' : `${item.changePercent >= 0 ? '+' : ''}${item.changePercent.toFixed(2)}%`}
                </p>
              </div>
            </article>
          );
        })}
      </div>
      {loading ? <div className="mt-3 rounded-lg border border-white/8 bg-white/[0.03] p-3 text-sm text-white/60">{t('marketOverviewPage.loading')}</div> : null}
      <MarketOverviewPanelFooter panel={panel} sourceLabel={`${t('marketOverviewPage.cards.futures.source')}: ${data.source.toUpperCase()}`} />
    </GlassCard>
  );
};

const CnShortSentimentCard: React.FC<{
  data: CnShortSentimentResponse;
  loading?: boolean;
  refreshing?: boolean;
  onRefresh: () => void;
}> = ({ data, loading = false, refreshing = false, onRefresh }) => {
  const { t } = useI18n();
  const title = t('marketOverviewPage.cards.cnShortSentiment.title');
  const panel = { lastRefreshAt: data.updatedAt } as MarketOverviewPanel;
  const metrics = [
    ['limitUpCount', t('marketOverviewPage.cards.cnShortSentiment.metrics.limitUpCount'), data.metrics.limitUpCount],
    ['limitDownCount', t('marketOverviewPage.cards.cnShortSentiment.metrics.limitDownCount'), data.metrics.limitDownCount],
    ['failedLimitUpRate', t('marketOverviewPage.cards.cnShortSentiment.metrics.failedLimitUpRate'), `${data.metrics.failedLimitUpRate}%`],
    ['maxConsecutiveLimitUps', t('marketOverviewPage.cards.cnShortSentiment.metrics.maxConsecutiveLimitUps'), data.metrics.maxConsecutiveLimitUps],
    ['yesterdayLimitUpPerformance', t('marketOverviewPage.cards.cnShortSentiment.metrics.yesterdayLimitUpPerformance'), `${data.metrics.yesterdayLimitUpPerformance >= 0 ? '+' : ''}${data.metrics.yesterdayLimitUpPerformance}%`],
    ['firstBoardCount', t('marketOverviewPage.cards.cnShortSentiment.metrics.firstBoardCount'), data.metrics.firstBoardCount],
    ['secondBoardCount', t('marketOverviewPage.cards.cnShortSentiment.metrics.secondBoardCount'), data.metrics.secondBoardCount],
    ['highBoardCount', t('marketOverviewPage.cards.cnShortSentiment.metrics.highBoardCount'), data.metrics.highBoardCount],
    ['twentyCmLimitUpCount', t('marketOverviewPage.cards.cnShortSentiment.metrics.twentyCmLimitUpCount'), data.metrics.twentyCmLimitUpCount],
  ] as const;
  return (
    <GlassCard as="section" className="flex h-full flex-col p-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40">{t('marketOverviewPage.cards.cnShortSentiment.eyebrow')}</p>
          <h2 className="mt-2 text-xl font-semibold text-white">{title}</h2>
        </div>
        <MarketOverviewRefreshButton label={t('marketOverviewPage.refreshCard', { title })} refreshing={refreshing} onRefresh={onRefresh} />
      </div>
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs text-white/45">{t('marketOverviewPage.cards.cnShortSentiment.score')}</p>
            <p className="mt-1 font-mono text-4xl font-semibold text-emerald-300">{data.sentimentScore}</p>
          </div>
          <p className="max-w-[220px] text-right text-xs leading-5 text-white/55">{data.summary}</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {metrics.map(([key, label, value]) => (
          <div key={key} className="rounded-lg border border-white/[0.045] bg-white/[0.018] px-3 py-2">
            <p className="truncate text-[10px] text-white/38">{label}</p>
            <p className="mt-1 font-mono text-sm font-semibold text-white">{value}</p>
          </div>
        ))}
      </div>
      {loading ? <div className="mt-3 rounded-lg border border-white/8 bg-white/[0.03] p-3 text-sm text-white/60">{t('marketOverviewPage.loading')}</div> : null}
      <MarketOverviewPanelFooter panel={panel} sourceLabel={`${t('marketOverviewPage.cards.cnShortSentiment.source')}: ${data.source.toUpperCase()}`} />
    </GlassCard>
  );
};

function assignPanelValue(nextPanels: PanelState, panelKey: PanelKey, value: PanelState[PanelKey]): void {
  switch (panelKey) {
    case 'indices':
    case 'volatility':
    case 'crypto':
    case 'sentiment':
    case 'fundsFlow':
    case 'macro':
    case 'cnIndices':
    case 'cnBreadth':
    case 'cnFlows':
    case 'sectorRotation':
    case 'rates':
    case 'fxCommodities':
      nextPanels[panelKey] = value as MarketOverviewPanel;
      break;
    case 'temperature':
      nextPanels.temperature = value as MarketTemperatureResponse;
      break;
    case 'briefing':
      nextPanels.briefing = value as MarketBriefingResponse;
      break;
    case 'futures':
      nextPanels.futures = value as MarketFuturesResponse;
      break;
    case 'cnShortSentiment':
      nextPanels.cnShortSentiment = value as CnShortSentimentResponse;
      break;
  }
}

const MarketOverviewPage: React.FC = () => {
  const { t } = useI18n();
  const [panels, setPanels] = useState<PanelState>({
    temperature: FALLBACK_TEMPERATURE,
    briefing: FALLBACK_BRIEFING,
    futures: FALLBACK_FUTURES,
    cnShortSentiment: FALLBACK_CN_SHORT_SENTIMENT,
  });
  const [loading, setLoading] = useState(true);
  const [refreshingPanel, setRefreshingPanel] = useState<PanelKey | null>(null);
  const [activeCategory, setActiveCategory] = useState<CategoryKey>('all');
  const [cardOrders, setCardOrders] = useState<Record<CategoryKey, CardKey[]>>(() => ({
    all: readStoredCardOrder('all'),
    us: readStoredCardOrder('us'),
    cn: readStoredCardOrder('cn'),
    macro: readStoredCardOrder('macro'),
    crypto: readStoredCardOrder('crypto'),
  }));
  const [draggingCard, setDraggingCard] = useState<CardKey | null>(null);

  const loadPanels = useCallback(async (cancelledRef?: { current: boolean }) => {
    setLoading(true);
    const requests: Array<[PanelKey, () => Promise<PanelState[PanelKey]>]> = [
      ['indices', marketOverviewApi.getIndices],
      ['volatility', marketOverviewApi.getVolatility],
      ['crypto', marketApi.getCrypto],
      ['sentiment', marketApi.getSentiment],
      ['fundsFlow', marketOverviewApi.getFundsFlow],
      ['macro', marketOverviewApi.getMacro],
      ['cnIndices', marketApi.getCnIndices],
      ['cnBreadth', marketApi.getCnBreadth],
      ['cnFlows', marketApi.getCnFlows],
      ['sectorRotation', marketApi.getSectorRotation],
      ['rates', marketApi.getRates],
      ['fxCommodities', marketApi.getFxCommodities],
      ['temperature', marketApi.getTemperature],
      ['briefing', marketApi.getMarketBriefing],
      ['futures', marketApi.getFutures],
      ['cnShortSentiment', marketApi.getCnShortSentiment],
    ];
    const results = await Promise.allSettled(requests.map(([, loadPanel]) => loadPanel()));
    if (!cancelledRef?.current) {
      setPanels((currentPanels) => {
        const nextPanels = { ...currentPanels };
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            assignPanelValue(nextPanels, requests[index][0], result.value);
          }
        });
        return nextPanels;
      });
      setLoading(false);
    }
  }, []);

  const refreshPanel = useCallback(async (
    panelKey: PanelKey,
    loadPanel: () => Promise<PanelState[PanelKey]>,
  ) => {
    setRefreshingPanel(panelKey);
    try {
      const panel = await loadPanel();
      setPanels((currentPanels) => {
        const nextPanels = { ...currentPanels };
        assignPanelValue(nextPanels, panelKey, panel);
        return nextPanels;
      });
    } finally {
      setRefreshingPanel((currentPanel) => (currentPanel === panelKey ? null : currentPanel));
    }
  }, []);

  const moveCard = useCallback((source: CardKey, target: CardKey) => {
    if (source === target) {
      return;
    }
    setCardOrders((currentOrders) => {
      const currentOrder = currentOrders[activeCategory];
      const next = currentOrder.filter((item) => item !== source);
      const targetIndex = next.indexOf(target);
      next.splice(targetIndex < 0 ? next.length : targetIndex, 0, source);
      persistCardOrder(activeCategory, next);
      return {
        ...currentOrders,
        [activeCategory]: next,
      };
    });
  }, [activeCategory]);

  useEffect(() => {
    const cancelledRef = { current: false };

    void loadPanels(cancelledRef).catch(() => {
      if (!cancelledRef.current) {
        setLoading(false);
      }
    });

    return () => {
      cancelledRef.current = true;
    };
  }, [loadPanels]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const cancelledRef = { current: false };
      void loadPanels(cancelledRef);
    }, AUTO_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [loadPanels]);

  const categoryTabs = useMemo<Array<{ key: CategoryKey; label: string }>>(() => [
    { key: 'all', label: t('marketOverviewPage.categories.all') },
    { key: 'us', label: t('marketOverviewPage.categories.us') },
    { key: 'cn', label: t('marketOverviewPage.categories.cn') },
    { key: 'macro', label: t('marketOverviewPage.categories.macro') },
    { key: 'crypto', label: t('marketOverviewPage.categories.crypto') },
  ], [t]);

  const usIndicesPanel = useMemo(
    () => filterPanelItems(panels.indices, ['SPX', 'NASDAQ', 'DJIA', 'RUT']),
    [panels.indices],
  );

  const cardNodes = useMemo<Record<CardKey, React.ReactNode>>(() => ({
    futures: (
      <FuturesPremarketCard
        data={panels.futures}
        loading={loading && panels.futures === FALLBACK_FUTURES}
        refreshing={refreshingPanel === 'futures'}
        onRefresh={() => {
          void refreshPanel('futures', marketApi.getFutures);
        }}
      />
    ),
    cnShortSentiment: (
      <CnShortSentimentCard
        data={panels.cnShortSentiment}
        loading={loading && panels.cnShortSentiment === FALLBACK_CN_SHORT_SENTIMENT}
        refreshing={refreshingPanel === 'cnShortSentiment'}
        onRefresh={() => {
          void refreshPanel('cnShortSentiment', marketApi.getCnShortSentiment);
        }}
      />
    ),
    indices: (
      <IndexTrendsCard
        panel={usIndicesPanel}
        loading={loading && !panels.indices}
        refreshing={refreshingPanel === 'indices'}
        onRefresh={() => {
          void refreshPanel('indices', marketOverviewApi.getIndices);
        }}
      />
    ),
    volatility: (
      <VolatilityCard
        panel={panels.volatility}
        loading={loading && !panels.volatility}
        refreshing={refreshingPanel === 'volatility'}
        onRefresh={() => {
          void refreshPanel('volatility', marketOverviewApi.getVolatility);
        }}
      />
    ),
    crypto: (
      <CryptoCard
        panel={panels.crypto}
        loading={loading && !panels.crypto}
        refreshing={refreshingPanel === 'crypto'}
        onRefresh={() => {
          void refreshPanel('crypto', marketApi.getCrypto);
        }}
      />
    ),
    sentiment: (
      <MarketSentimentCard
        panel={panels.sentiment}
        loading={loading && !panels.sentiment}
        refreshing={refreshingPanel === 'sentiment'}
        onRefresh={() => {
          void refreshPanel('sentiment', marketApi.getSentiment);
        }}
      />
    ),
    fundsFlow: (
      <FundsFlowCard
        panel={panels.fundsFlow}
        loading={loading && !panels.fundsFlow}
        refreshing={refreshingPanel === 'fundsFlow'}
        onRefresh={() => {
          void refreshPanel('fundsFlow', marketOverviewApi.getFundsFlow);
        }}
      />
    ),
    macro: (
      <MacroIndicatorsCard
        panel={panels.macro}
        loading={loading && !panels.macro}
        refreshing={refreshingPanel === 'macro'}
        onRefresh={() => {
          void refreshPanel('macro', marketOverviewApi.getMacro);
        }}
      />
    ),
    cnIndices: (
      <MarketOverviewCard
        title={t('marketOverviewPage.cards.cnIndices.title')}
        eyebrow={t('marketOverviewPage.cards.cnIndices.eyebrow')}
        description={t('marketOverviewPage.cards.cnIndices.description')}
        sourceLabel={t('marketOverviewPage.cards.cnIndices.source')}
        panel={panels.cnIndices}
        loading={loading && !panels.cnIndices}
        refreshing={refreshingPanel === 'cnIndices'}
        onRefresh={() => {
          void refreshPanel('cnIndices', marketApi.getCnIndices);
        }}
      />
    ),
    cnBreadth: (
      <MarketOverviewCard
        title={t('marketOverviewPage.cards.cnBreadth.title')}
        eyebrow={t('marketOverviewPage.cards.cnBreadth.eyebrow')}
        description={t('marketOverviewPage.cards.cnBreadth.description')}
        sourceLabel={t('marketOverviewPage.cards.cnBreadth.source')}
        panel={panels.cnBreadth}
        loading={loading && !panels.cnBreadth}
        refreshing={refreshingPanel === 'cnBreadth'}
        onRefresh={() => {
          void refreshPanel('cnBreadth', marketApi.getCnBreadth);
        }}
      />
    ),
    cnFlows: (
      <MarketOverviewCard
        title={t('marketOverviewPage.cards.cnFlows.title')}
        eyebrow={t('marketOverviewPage.cards.cnFlows.eyebrow')}
        description={t('marketOverviewPage.cards.cnFlows.description')}
        sourceLabel={t('marketOverviewPage.cards.cnFlows.source')}
        panel={panels.cnFlows}
        loading={loading && !panels.cnFlows}
        refreshing={refreshingPanel === 'cnFlows'}
        onRefresh={() => {
          void refreshPanel('cnFlows', marketApi.getCnFlows);
        }}
      />
    ),
    sectorRotation: (
      <MarketOverviewCard
        title={t('marketOverviewPage.cards.sectorRotation.title')}
        eyebrow={t('marketOverviewPage.cards.sectorRotation.eyebrow')}
        description={t('marketOverviewPage.cards.sectorRotation.description')}
        sourceLabel={t('marketOverviewPage.cards.sectorRotation.source')}
        panel={panels.sectorRotation ? { ...panels.sectorRotation, items: panels.sectorRotation.items.slice(0, 5) } : undefined}
        loading={loading && !panels.sectorRotation}
        refreshing={refreshingPanel === 'sectorRotation'}
        onRefresh={() => {
          void refreshPanel('sectorRotation', marketApi.getSectorRotation);
        }}
      />
    ),
    rates: (
      <MarketOverviewCard
        title={t('marketOverviewPage.cards.rates.title')}
        eyebrow={t('marketOverviewPage.cards.rates.eyebrow')}
        description={t('marketOverviewPage.cards.rates.description')}
        sourceLabel={t('marketOverviewPage.cards.rates.source')}
        panel={panels.rates}
        loading={loading && !panels.rates}
        refreshing={refreshingPanel === 'rates'}
        onRefresh={() => {
          void refreshPanel('rates', marketApi.getRates);
        }}
      />
    ),
    fxCommodities: (
      <MarketOverviewCard
        title={t('marketOverviewPage.cards.fxCommodities.title')}
        eyebrow={t('marketOverviewPage.cards.fxCommodities.eyebrow')}
        description={t('marketOverviewPage.cards.fxCommodities.description')}
        sourceLabel={t('marketOverviewPage.cards.fxCommodities.source')}
        panel={panels.fxCommodities}
        loading={loading && !panels.fxCommodities}
        refreshing={refreshingPanel === 'fxCommodities'}
        onRefresh={() => {
          void refreshPanel('fxCommodities', marketApi.getFxCommodities);
        }}
      />
    ),
  }), [loading, panels, refreshPanel, refreshingPanel, t, usIndicesPanel]);

  const visibleOrder = cardOrders[activeCategory].filter((cardKey) => CATEGORY_CARDS[activeCategory].includes(cardKey));
  const columns = [0, 1, 2].map((columnIndex) => visibleOrder.filter((_, index) => index % 3 === columnIndex));
  const heroAnchors = useMemo(() => buildHeroAnchors(panels), [panels]);

  return (
    <div className="w-full flex-1 flex flex-col min-w-0 min-h-0 bg-[#030303] text-white">
      <div className="flex-1 overflow-y-auto pb-12 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-6 px-3 sm:px-5">
          <div className="sticky top-0 z-10 -mx-3 overflow-x-auto border-b border-white/5 bg-[#030303]/95 px-3 py-3 backdrop-blur sm:-mx-5 sm:px-5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex w-max min-w-full gap-2 rounded-lg bg-white/[0.03] p-1">
              {categoryTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  aria-pressed={activeCategory === tab.key}
                  onClick={() => setActiveCategory(tab.key)}
                  className={`whitespace-nowrap rounded-md px-3 py-2 text-xs font-semibold transition ${
                    activeCategory === tab.key
                      ? 'bg-white/10 text-white shadow-sm'
                      : 'bg-transparent text-white/45 hover:text-white/75'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          {activeCategory === 'all' ? <CrossAssetHeroRibbon anchors={heroAnchors} /> : null}
          <MarketTemperatureStrip
            data={panels.temperature}
            refreshing={refreshingPanel === 'temperature'}
            onRefresh={() => {
              void refreshPanel('temperature', marketApi.getTemperature);
            }}
          />
          {activeCategory !== 'crypto' ? (
            <MarketBriefingCard
              data={panels.briefing}
              refreshing={refreshingPanel === 'briefing'}
              onRefresh={() => {
                void refreshPanel('briefing', marketApi.getMarketBriefing);
              }}
            />
          ) : null}
          <main className="flex flex-col items-start gap-6 xl:flex-row">
            {columns.map((columnCards, columnIndex) => (
              <div key={columnIndex} className="flex w-full flex-col gap-6 xl:w-[calc((100%_-_3rem)/3)]">
                {columnCards.map((cardKey) => (
                  <div
                    key={cardKey}
                    data-testid={`market-overview-card-${cardKey}`}
                    data-market-card-rank={visibleOrder.indexOf(cardKey)}
                    draggable
                    onDragStart={() => setDraggingCard(cardKey)}
                    onDragEnd={() => setDraggingCard(null)}
                    onDragOver={(event) => {
                      event.preventDefault();
                    }}
                    onDrop={() => {
                      if (draggingCard) {
                        moveCard(draggingCard, cardKey);
                      }
                      setDraggingCard(null);
                    }}
                    className={`transition-transform ${draggingCard === cardKey ? 'scale-[0.985] opacity-80' : ''}`}
                  >
                    {cardNodes[cardKey]}
                  </div>
                ))}
              </div>
            ))}
          </main>
        </div>
      </div>
    </div>
  );
};

export default MarketOverviewPage;
