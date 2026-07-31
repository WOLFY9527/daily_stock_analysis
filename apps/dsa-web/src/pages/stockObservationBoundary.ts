import type {
  StockHistoryPoint,
  StockHistoryResponse,
  StockQuote,
  StockStructureDecisionResponse,
  StockTechnicalIndicatorsResponse,
  SymbolResearchPacket,
} from '../api/stocks';
import type { OptionsStructureSummary } from '../api/optionsLab';

export type StockObservationLocale = 'zh' | 'en';

export type QuoteBoundaryChipVariant = 'success' | 'caution' | 'danger' | 'info' | 'neutral';

export type QuoteBoundaryChip = {
  id: 'state' | 'source' | 'freshness' | 'timestamp' | 'cache' | 'fallback';
  label: string;
  variant: QuoteBoundaryChipVariant;
};

export type QuoteBoundaryView = {
  title: string;
  detail: string;
  chips: QuoteBoundaryChip[];
};

export type StockQuoteObservationOrigin = 'providerQuote' | 'researchPacket' | 'unavailable';
export type StockQuoteTimestampScope = 'marketAsOf' | 'observedAt' | 'fetchedAt' | 'packetAsOf' | 'none';

export type StockQuoteObservationView = {
  origin: StockQuoteObservationOrigin;
  price: number | null;
  changePercent: number | null;
  rawTimestamp: string | null;
  formattedTimestamp: string | null;
  timestampScope: StockQuoteTimestampScope;
  timestampLabel: string;
  sourceLabel: string;
  sourceKnown: boolean;
  freshness: string | null;
  freshnessLabel: string;
  stateLabel: string;
  stateVariant: QuoteBoundaryChipVariant;
  cached: boolean | null;
  fallback: boolean | null;
  stale: boolean | null;
  partial: boolean | null;
  synthetic: boolean | null;
  unavailable: boolean | null;
  confidenceWeight: number | null;
  coverage: number | null;
  limitation: string;
};

export type StockHistoryComputationState = {
  label: string;
  detail: string;
  tone: 'success' | 'caution' | 'danger';
};

export type StockHistoryObservationView = {
  sourceLabel: string;
  freshnessLabel: string;
  rangeLabel: string;
  availableBars: number;
  requiredBars: number;
  missingBars: number;
  cached: boolean | null;
  fallback: boolean | null;
  limitation: string;
};

export type ConsumerTextProjection = {
  safeOptionalConsumerText: (
    value: string | number | null | undefined,
    language: StockObservationLocale,
  ) => string | null;
  compactUnique: (values: string[]) => string[];
};

export const QUOTE_TIMESTAMP_FORMATTERS = {
  en: new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }),
  zh: new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }),
} as const;

export function normalizeStockConsumerToken(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[:=./\\\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function formatQuoteTimestamp(
  value: string | null | undefined,
  language: StockObservationLocale,
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return QUOTE_TIMESTAMP_FORMATTERS[language].format(date);
}

export function optionsStructureSourceLabel(
  structure: OptionsStructureSummary,
  language: StockObservationLocale,
): string {
  return structure.providerConfigured
    ? (language === 'en' ? 'Structure source identity pending' : '结构来源身份待确认')
    : (language === 'en' ? 'Structure source needed' : '结构来源待配置');
}

export function optionsStructureFreshnessLabel(
  structure: OptionsStructureSummary,
  language: StockObservationLocale,
): string {
  const freshness = normalizeStockConsumerToken(structure.freshness || structure.snapshot.freshness);
  if (['live', 'fresh', 'current'].includes(freshness)) return language === 'en' ? 'Fresh' : '新鲜';
  if (freshness === 'stale') return language === 'en' ? 'Stale' : '已过期';
  if (freshness === 'delayed') return language === 'en' ? 'Delayed' : '延迟';
  if (freshness === 'cached') return language === 'en' ? 'Cached' : '缓存';
  if (freshness === 'partial') return language === 'en' ? 'Partial' : '部分可用';
  if (freshness === 'unavailable') return language === 'en' ? 'Unavailable' : '不可用';
  if (['synthetic', 'mock', 'fixture', 'sample', 'demo'].includes(freshness)) {
    return language === 'en' ? 'Sample / demo' : '样本 / 演示';
  }
  return language === 'en' ? 'Freshness pending' : '新鲜度待确认';
}

function hasQuoteCurrentPrice(quote: StockQuote | null | undefined): quote is StockQuote & { currentPrice: number } {
  return typeof quote?.currentPrice === 'number' && Number.isFinite(quote.currentPrice);
}

function nullableQuoteFlag(
  primary: boolean | null | undefined,
  secondary: boolean | null | undefined,
): boolean | null {
  if (primary === true || secondary === true) return true;
  if (primary === false || secondary === false) return false;
  return null;
}

function safeStockQuoteSourceLabel(
  quote: StockQuote,
  language: StockObservationLocale,
  projection: ConsumerTextProjection,
): string | null {
  const explicitLabel = projection.safeOptionalConsumerText(quote.sourceConfidence?.sourceLabel, language);
  if (explicitLabel) return explicitLabel;

  const sourceToken = normalizeStockConsumerToken(quote.sourceConfidence?.source || quote.source);
  const knownLabels: Record<string, string> = {
    alpaca: 'Alpaca',
    yahoo: 'Yahoo Finance',
    yahoo_finance: 'Yahoo Finance',
    yfinance: 'Yahoo Finance',
  };
  return knownLabels[sourceToken] || null;
}

function selectProviderQuoteTimestamp(
  quote: StockQuote,
  language: StockObservationLocale,
): { rawTimestamp: string | null; formattedTimestamp: string | null; timestampScope: StockQuoteTimestampScope } {
  const candidates: Array<{ value: string | null | undefined; scope: StockQuoteTimestampScope }> = [
    { value: quote.sourceConfidence?.asOf, scope: 'marketAsOf' },
    { value: quote.marketTimestamp, scope: 'marketAsOf' },
    { value: quote.observedAt, scope: 'observedAt' },
    { value: quote.updateTime || quote.update_time, scope: 'fetchedAt' },
  ];
  for (const candidate of candidates) {
    const formattedTimestamp = formatQuoteTimestamp(candidate.value, language);
    if (formattedTimestamp) {
      return {
        rawTimestamp: candidate.value || null,
        formattedTimestamp,
        timestampScope: candidate.scope,
      };
    }
  }
  return { rawTimestamp: null, formattedTimestamp: null, timestampScope: 'none' };
}

export function quoteTimestampLabel(
  scope: StockQuoteTimestampScope,
  formattedTimestamp: string | null,
  language: StockObservationLocale,
): string {
  if (!formattedTimestamp || scope === 'none') {
    return language === 'en' ? 'Quote time pending' : '报价时间待确认';
  }
  const labels: Record<Exclude<StockQuoteTimestampScope, 'none'>, { zh: string; en: string }> = {
    marketAsOf: { zh: '市场截至', en: 'Market as of' },
    observedAt: { zh: '观察于', en: 'Observed at' },
    fetchedAt: { zh: '获取于', en: 'Fetched at' },
    packetAsOf: { zh: '研究包截至', en: 'Packet as of' },
  };
  return `${labels[scope][language]} ${formattedTimestamp}`;
}

export function quoteBooleanStateLabel(
  label: { zh: string; en: string },
  value: boolean | null,
  language: StockObservationLocale,
): string {
  const state = value === null
    ? (language === 'en' ? 'pending' : '待确认')
    : value
      ? (language === 'en' ? 'yes' : '是')
      : (language === 'en' ? 'no' : '否');
  return `${label[language]}: ${state}`;
}

function quoteFreshnessTokens(quote: StockQuote): string[] {
  return [
    quote.sourceConfidence?.freshness,
    quote.freshness,
  ].map((value) => normalizeStockConsumerToken(value));
}

function quoteClassificationTokens(quote: StockQuote): string[] {
  return [
    ...quoteFreshnessTokens(quote),
    quote.availabilityState,
    quote.providerState,
    quote.sourceConfidence?.source,
    quote.source,
    quote.sourceType,
  ].map((value) => normalizeStockConsumerToken(value));
}

function hasFreshnessToken(tokens: string[], values: string[]): boolean {
  return tokens.some((token) => values.includes(token));
}

function resolveQuoteFreshness(
  quote: StockQuote,
): {
  freshness: string | null;
  cached: boolean | null;
  fallback: boolean | null;
  stale: boolean | null;
  partial: boolean | null;
  synthetic: boolean | null;
  unavailable: boolean | null;
} {
  const sourceConfidence = quote.sourceConfidence;
  const freshnessTokens = quoteFreshnessTokens(quote);
  const tokens = quoteClassificationTokens(quote);
  const fallbackFlag = nullableQuoteFlag(sourceConfidence?.isFallback, quote.isFallback);
  const stale = nullableQuoteFlag(sourceConfidence?.isStale, quote.isStale);
  const partial = nullableQuoteFlag(sourceConfidence?.isPartial, quote.isPartial);
  const synthetic = nullableQuoteFlag(sourceConfidence?.isSynthetic, quote.isSynthetic);
  const unavailable = nullableQuoteFlag(sourceConfidence?.isUnavailable, quote.isUnavailable);
  const isUnavailable = unavailable === true || hasFreshnessToken(tokens, ['unavailable', 'missing', 'not_available']);
  const isSynthetic = synthetic === true || hasFreshnessToken(tokens, ['synthetic', 'synthetic_placeholder', 'synthetic_fixture', 'mock', 'mocked', 'fixture', 'sample', 'demo', 'placeholder']);
  const isStale = stale === true || hasFreshnessToken(tokens, ['stale']);
  const isDelayed = hasFreshnessToken(tokens, ['delayed']);
  const isPartial = partial === true || hasFreshnessToken(tokens, ['partial']);
  const isCached = hasFreshnessToken(tokens, ['cached']);
  const explicitFreshness = freshnessTokens.find((token) => ['fresh', 'current', 'live'].includes(token)) || null;
  const isFresh = Boolean(explicitFreshness);
  const isFallback = fallbackFlag === true
    || hasFreshnessToken(tokens, ['fallback', 'proxy']);
  const freshness = isUnavailable
    ? 'unavailable'
    : isSynthetic
      ? 'synthetic'
      : isStale
        ? 'stale'
        : isDelayed
          ? 'delayed'
          : isPartial
            ? 'partial'
            : isCached
              ? 'cached'
              : isFresh
                ? explicitFreshness
                : null;
  return {
    freshness,
    cached: isCached ? true : freshnessTokens.some(Boolean) ? false : null,
    fallback: isFallback ? true : fallbackFlag,
    stale: isStale ? true : stale,
    partial: isPartial ? true : partial,
    synthetic: isSynthetic ? true : synthetic,
    unavailable: isUnavailable ? true : unavailable,
  };
}

export function resolveStockQuoteObservation(
  quote: StockQuote | null,
  quoteFailed: boolean,
  researchPacket: SymbolResearchPacket | null,
  language: StockObservationLocale,
  projection: ConsumerTextProjection,
): StockQuoteObservationView {
  if (quote && (hasQuoteCurrentPrice(quote) || resolveQuoteFreshness(quote).unavailable === true)) {
    const sourceConfidence = quote.sourceConfidence;
    const timestamp = selectProviderQuoteTimestamp(quote, language);
    const confidence = resolveQuoteFreshness(quote);
    const explicitSourceLabel = safeStockQuoteSourceLabel(quote, language, projection);
    const sourceLabel = explicitSourceLabel || (language === 'en' ? 'Source pending' : '来源待确认');
    const unavailable = confidence.unavailable === true;
    const synthetic = confidence.synthetic === true;
    const stale = confidence.stale === true;
    const partial = confidence.partial === true;
    const cached = confidence.cached === true;
    const fallback = confidence.fallback === true;

    let stateLabel: string;
    let stateVariant: QuoteBoundaryChipVariant;
    let freshnessLabel: string;
    if (unavailable) {
      stateLabel = language === 'en' ? 'Quote marked unavailable' : '报价标记为不可用';
      stateVariant = 'danger';
      freshnessLabel = language === 'en' ? 'Unavailable' : '不可用';
    } else if (synthetic) {
      stateLabel = language === 'en' ? 'Sample quote' : '样本报价';
      stateVariant = 'info';
      freshnessLabel = language === 'en' ? 'Sample / demo' : '样本 / 演示';
    } else if (stale) {
      stateLabel = language === 'en' ? 'Stale quote available' : '过期报价可用';
      stateVariant = 'caution';
      freshnessLabel = language === 'en' ? 'Stale' : '已过期';
    } else if (confidence.freshness === 'delayed') {
      stateLabel = language === 'en' ? 'Delayed quote available' : '延迟报价可用';
      stateVariant = 'caution';
      freshnessLabel = language === 'en' ? 'Delayed' : '延迟';
    } else if (partial) {
      stateLabel = language === 'en' ? 'Partial quote available' : '部分报价可用';
      stateVariant = 'caution';
      freshnessLabel = language === 'en' ? 'Partial' : '部分可用';
    } else if (cached) {
      stateLabel = language === 'en' ? 'Cached quote available' : '缓存报价可用';
      stateVariant = 'info';
      freshnessLabel = language === 'en' ? 'Cached' : '缓存';
    } else if (fallback) {
      stateLabel = language === 'en' ? 'Alternate-path quote available' : '替代路径报价可用';
      stateVariant = 'caution';
      freshnessLabel = ['fresh', 'current', 'live'].includes(confidence.freshness || '')
        ? (language === 'en' ? 'Fresh' : '新鲜')
        : (language === 'en' ? 'Freshness pending' : '新鲜度待确认');
    } else if (['fresh', 'current', 'live'].includes(confidence.freshness || '')) {
      stateLabel = language === 'en' ? 'Quote available' : '报价可用';
      stateVariant = 'success';
      freshnessLabel = language === 'en' ? 'Fresh' : '新鲜';
    } else {
      stateLabel = language === 'en' ? 'Quote freshness pending' : '报价新鲜度待确认';
      stateVariant = 'caution';
      freshnessLabel = language === 'en' ? 'Freshness pending' : '新鲜度待确认';
    }

    const limitations = projection.compactUnique([
      sourceLabel === (language === 'en' ? 'Source pending' : '来源待确认')
        ? (language === 'en' ? 'The price was returned without a consumer-safe source identity.' : '价格已返回，但未提供消费者安全的来源标识。')
        : '',
      timestamp.timestampScope === 'none'
        ? (language === 'en' ? 'The provider observation time is pending and is not borrowed from the research packet.' : '提供方观察时间待确认，未借用研究包时间。')
        : '',
      unavailable
        ? (language === 'en' ? 'The provider marks this quote unavailable; keep it out of evidence export.' : '提供方将该报价标记为不可用，不纳入证据导出。')
        : '',
      synthetic
        ? (language === 'en' ? 'Sample or demo data is visible for observation only.' : '当前为样本或演示数据，仅供观察。')
        : '',
      stale
        ? (language === 'en' ? 'The quote is stale and must not be treated as current.' : '该报价已经过期，不能视为当前状态。')
        : '',
      partial
        ? (language === 'en' ? 'The quote is partial and does not support a complete market view.' : '该报价为部分可用，不能支持完整市场判断。')
        : '',
      cached
        ? (language === 'en' ? 'The quote comes from a saved snapshot and does not prove live freshness.' : '该报价来自已保存快照，不能证明实时新鲜度。')
        : '',
      fallback
        ? (language === 'en' ? 'The quote uses an alternate path and does not carry primary-source authority.' : '该报价使用替代路径，不具有主要来源权威。')
        : '',
    ]);

    return {
      origin: 'providerQuote',
      price: unavailable || synthetic ? null : quote.currentPrice,
      changePercent: unavailable || synthetic || typeof quote.changePercent !== 'number' || !Number.isFinite(quote.changePercent)
        ? null
        : quote.changePercent,
      ...timestamp,
      timestampLabel: quoteTimestampLabel(timestamp.timestampScope, timestamp.formattedTimestamp, language),
      sourceLabel,
      sourceKnown: Boolean(explicitSourceLabel),
      freshness: confidence.freshness,
      freshnessLabel,
      stateLabel,
      stateVariant,
      cached: confidence.cached,
      fallback: confidence.fallback,
      stale: confidence.stale,
      partial: confidence.partial,
      synthetic: confidence.synthetic,
      unavailable: confidence.unavailable,
      confidenceWeight: typeof sourceConfidence?.confidenceWeight === 'number' && Number.isFinite(sourceConfidence.confidenceWeight)
        ? sourceConfidence.confidenceWeight
        : null,
      coverage: typeof sourceConfidence?.coverage === 'number' && Number.isFinite(sourceConfidence.coverage)
        ? sourceConfidence.coverage
        : null,
      limitation: limitations.join(' ') || (language === 'en'
        ? 'This provider quote is for research observation only.'
        : '该提供方报价仅供研究观察。'),
    };
  }

  const packetState = normalizeStockConsumerToken(researchPacket?.quote.state);
  const packetPrice = researchPacket?.quote.price;
  const packetAllowed = ['available', 'stale'].includes(packetState)
    && typeof packetPrice === 'number'
    && Number.isFinite(packetPrice);
  if (packetAllowed && researchPacket) {
    const packetStale = packetState === 'stale';
    const rawTimestamp = formatQuoteTimestamp(researchPacket.quote.asOf, language)
      ? researchPacket.quote.asOf || null
      : null;
    const formattedTimestamp = formatQuoteTimestamp(rawTimestamp, language);
    return {
      origin: 'researchPacket',
      price: packetPrice,
      changePercent: typeof researchPacket.quote.changePercent === 'number' && Number.isFinite(researchPacket.quote.changePercent)
        ? researchPacket.quote.changePercent
        : null,
      rawTimestamp,
      formattedTimestamp,
      timestampScope: rawTimestamp ? 'packetAsOf' : 'none',
      timestampLabel: quoteTimestampLabel(rawTimestamp ? 'packetAsOf' : 'none', formattedTimestamp, language),
      sourceLabel: language === 'en' ? 'Research packet projection; provider pending' : '研究包投影；提供方待确认',
      sourceKnown: true,
      freshness: packetStale ? 'stale' : null,
      freshnessLabel: packetStale
        ? (language === 'en' ? 'Stale' : '已过期')
        : (language === 'en' ? 'Freshness pending' : '新鲜度待确认'),
      stateLabel: packetStale
        ? (language === 'en' ? 'Stale research-packet quote available' : '过期研究包报价可用')
        : (language === 'en' ? 'Research packet quote available' : '研究包报价可用'),
      stateVariant: packetStale ? 'caution' : 'info',
      cached: null,
      fallback: null,
      stale: packetStale ? true : null,
      partial: null,
      synthetic: null,
      unavailable: false,
      confidenceWeight: null,
      coverage: null,
      limitation: packetStale
        ? (language === 'en'
          ? 'This atomic packet projection is stale and supplies price, change, and packet time only; provider, cache, and alternate-path state remain unknown.'
          : '该原子研究包投影已经过期，只提供价格、涨跌和研究包时间；提供方、缓存与替代路径状态仍待确认。')
        : (language === 'en'
          ? 'This atomic packet projection supplies price, change, and packet time only; provider, freshness, cache, and alternate-path state remain unknown.'
          : '该原子研究包投影只提供价格、涨跌和研究包时间；提供方、新鲜度、缓存与替代路径状态仍待确认。'),
    };
  }

  return {
    origin: 'unavailable',
    price: null,
    changePercent: null,
    rawTimestamp: null,
    formattedTimestamp: null,
    timestampScope: 'none',
    timestampLabel: language === 'en' ? 'Quote time unavailable' : '报价时间不可用',
    sourceLabel: language === 'en' ? 'Source unavailable' : '来源不可用',
    sourceKnown: false,
    freshness: null,
    freshnessLabel: language === 'en' ? 'Freshness unavailable' : '新鲜度不可用',
    stateLabel: language === 'en' ? 'Quote unavailable' : '报价不可用',
    stateVariant: 'danger',
    cached: null,
    fallback: null,
    stale: null,
    partial: null,
    synthetic: null,
    unavailable: true,
    confidenceWeight: null,
    coverage: null,
    limitation: quoteFailed
      ? (language === 'en' ? 'The provider quote request failed and no admissible packet quote is available.' : '提供方报价请求失败，且没有可采用的研究包报价。')
      : (language === 'en' ? 'No finite provider price or admissible packet quote is available.' : '未获得有限提供方价格或可采用的研究包报价。'),
  };
}

export function buildQuoteBoundaryView(
  observation: StockQuoteObservationView,
  language: StockObservationLocale,
): QuoteBoundaryView {
  return {
    title: language === 'en' ? 'Atomic quote observation' : '原子报价观察',
    detail: observation.limitation,
    chips: [
      { id: 'state', label: observation.stateLabel, variant: observation.stateVariant },
      {
        id: 'source',
        label: `${language === 'en' ? 'Source' : '来源'}: ${observation.sourceLabel}`,
        variant: observation.sourceLabel.includes(language === 'en' ? 'pending' : '待确认') ? 'caution' : 'neutral',
      },
      {
        id: 'freshness',
        label: `${language === 'en' ? 'Freshness' : '新鲜度'}: ${observation.freshnessLabel}`,
        variant: observation.stateVariant,
      },
      { id: 'timestamp', label: observation.timestampLabel, variant: observation.rawTimestamp ? 'neutral' : 'caution' },
      {
        id: 'cache',
        label: quoteBooleanStateLabel({ zh: '缓存', en: 'Cached' }, observation.cached, language),
        variant: observation.cached === true ? 'info' : observation.cached === null ? 'caution' : 'neutral',
      },
      {
        id: 'fallback',
        label: quoteBooleanStateLabel({ zh: '替代路径', en: 'Alternate path' }, observation.fallback, language),
        variant: observation.fallback === true ? 'caution' : observation.fallback === null ? 'caution' : 'neutral',
      },
    ],
  };
}

type StockHistoryFreshnessState = 'unavailable' | 'synthetic' | 'stale' | 'delayed' | 'partial' | 'cached' | 'fresh' | 'unknown' | 'missing';

function historyObservationTokens(history: StockHistoryResponse | null): string[] {
  return [
    history?.sourceConfidence?.freshness,
    history?.sourceConfidence?.source,
    history?.source,
    history?.diagnostics?.source,
    history?.diagnostics?.status,
  ].map((value) => normalizeStockConsumerToken(value));
}

function historyFreshnessState(history: StockHistoryResponse | null, failed: boolean): StockHistoryFreshnessState {
  if (failed) return 'unavailable';
  const confidence = history?.sourceConfidence;
  const tokens = historyObservationTokens(history);
  if (confidence?.isUnavailable || hasFreshnessToken(tokens, ['unavailable', 'not_available'])) return 'unavailable';
  if (hasFreshnessToken(tokens, ['missing', 'missing_cache'])) return 'missing';
  if (confidence?.isSynthetic || hasFreshnessToken(tokens, ['synthetic', 'mock', 'mocked', 'fixture', 'sample', 'demo', 'placeholder', 'synthetic_placeholder'])) return 'synthetic';
  if (confidence?.isStale || hasFreshnessToken(tokens, ['stale'])) return 'stale';
  if (hasFreshnessToken(tokens, ['delayed'])) return 'delayed';
  if (confidence?.isPartial || hasFreshnessToken(tokens, ['partial'])) return 'partial';
  if (hasFreshnessToken(tokens, ['cached'])) return 'cached';
  if (hasFreshnessToken(tokens, ['fresh', 'current', 'live'])) return 'fresh';
  return history?.data.length ? 'unknown' : 'missing';
}

export function isSyntheticStockHistory(history: StockHistoryResponse | null, failed: boolean): boolean {
  return historyFreshnessState(history, failed) === 'synthetic';
}

export function selectAdmissibleStockHistoryPoints(
  history: StockHistoryResponse | null,
  failed: boolean,
): StockHistoryPoint[] {
  const freshness = historyFreshnessState(history, failed);
  if (freshness === 'unavailable' || freshness === 'synthetic' || freshness === 'missing') return [];
  return (history?.data ?? []).filter((point) => (
    Boolean(String(point.date || '').trim())
    && Number.isFinite(point.close)
  ));
}

export function historyBarsCount(history: StockHistoryResponse | null, failed: boolean): number {
  return selectAdmissibleStockHistoryPoints(history, failed).length;
}

export function requiredHistoryBars(
  history: StockHistoryResponse | null,
  data: StockStructureDecisionResponse,
): number {
  const positiveInteger = (value: unknown): number | null => {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
  };
  return positiveInteger(data.dataQuality.requestedDays)
    ?? positiveInteger(history?.diagnostics?.requestedDays)
    ?? 90;
}

export function historyMissingBars(
  history: StockHistoryResponse | null,
  data: StockStructureDecisionResponse,
  failed: boolean,
): number {
  return Math.max(requiredHistoryBars(history, data) - historyBarsCount(history, failed), 0);
}

export function latestHistoryDate(history: StockHistoryResponse | null, failed: boolean): string | null {
  return selectAdmissibleStockHistoryPoints(history, failed).at(-1)?.date || null;
}

export function stockHistorySourceLabel(
  history: StockHistoryResponse | null,
  language: StockObservationLocale,
  projection: Pick<ConsumerTextProjection, 'safeOptionalConsumerText'>,
): string {
  const source = normalizeStockConsumerToken(history?.source || history?.diagnostics?.source);
  const explicit = projection.safeOptionalConsumerText(history?.sourceConfidence?.sourceLabel, language);
  const explicitToken = normalizeStockConsumerToken(explicit);
  if (source.includes('local') || source.includes('cache') || explicitToken.includes('local')) {
    return language === 'en' ? 'Local history data' : '本地历史数据';
  }
  if (/fixture|mock|test/.test(source) || /fixture|mock|test/.test(explicitToken)) {
    return language === 'en' ? 'History source pending' : '历史来源待确认';
  }
  if (explicit) return explicit;
  if (source.includes('yahoo')) return 'Yahoo Finance';
  if (source.includes('alpaca')) return 'Alpaca';
  return language === 'en' ? 'History source pending' : '历史来源待确认';
}

export function stockHistoryFreshnessLabel(
  history: StockHistoryResponse | null,
  failed: boolean,
  language: StockObservationLocale,
): string {
  const freshness = historyFreshnessState(history, failed);
  if (freshness === 'unavailable') return language === 'en' ? 'History unavailable' : '历史数据不可用';
  if (freshness === 'missing') return language === 'en' ? 'History missing' : '历史数据待补';
  if (freshness === 'synthetic') return language === 'en' ? 'Sample / demo' : '样本 / 演示';
  if (freshness === 'stale') return language === 'en' ? 'Stale' : '已过期';
  if (freshness === 'delayed') return language === 'en' ? 'Delayed' : '延迟';
  if (freshness === 'partial') return language === 'en' ? 'Partial' : '部分可用';
  if (freshness === 'cached') return language === 'en' ? 'Cached' : '缓存';
  if (freshness === 'fresh') return language === 'en' ? 'Fresh' : '新鲜';
  return language === 'en' ? 'Freshness pending' : '新鲜度待确认';
}

export function historyRangeLabel(points: StockHistoryPoint[], language: StockObservationLocale): string {
  const first = points[0]?.date;
  const last = points.at(-1)?.date;
  if (!first || !last) return language === 'en' ? 'Range pending' : '区间待确认';
  return `${first} → ${last}`;
}

export function hasDisabledHistoryBoundary(history: StockHistoryResponse | null, failed: boolean): boolean {
  if (failed || history?.sourceConfidence?.isUnavailable) return false;
  if (!history) return false;
  const boundaryStates = [
    history.diagnostics?.status,
    history.diagnostics?.reason,
    history.sourceConfidence?.degradationReason,
    history.sourceConfidence?.capReason,
  ].map((value) => normalizeStockConsumerToken(value));
  return boundaryStates.some((state) => state.includes('disabled') || state.includes('not_configured'))
    && selectAdmissibleStockHistoryPoints(history, failed).length === 0;
}

export function stockHistoryReadinessState({
  history,
  failed,
  data,
  language,
}: {
  history: StockHistoryResponse | null;
  failed: boolean;
  data: StockStructureDecisionResponse;
  language: StockObservationLocale;
}): StockHistoryComputationState {
  const isEnglish = language === 'en';
  const bars = historyBarsCount(history, failed);
  const missing = historyMissingBars(history, data, failed);
  if (hasDisabledHistoryBoundary(history, failed)) {
    return {
      label: isEnglish ? 'History source disabled' : '历史来源未启用',
      detail: isEnglish
        ? 'The configured history source is explicitly disabled or not configured.'
        : '当前历史来源已明确停用或尚未配置。',
      tone: 'danger',
    };
  }
  if (isSyntheticStockHistory(history, failed)) {
    return {
      label: isEnglish ? 'Sample history returned' : '样本历史已返回',
      detail: isEnglish
        ? 'Returned sample history is for observation only and is not charted.'
        : '已返回的样本历史仅供观察，不绘制图表。',
      tone: 'caution',
    };
  }
  if (historyFreshnessState(history, failed) === 'unavailable') {
    return {
      label: isEnglish ? 'History unavailable' : '历史数据不可用',
      detail: isEnglish
        ? 'The history request did not return admissible bars for this symbol.'
        : '当前历史请求未返回该标的可采用的 K 线数据。',
      tone: 'danger',
    };
  }
  if (bars > 0) {
    return {
      label: isEnglish ? 'History available' : '历史数据可用',
      detail: missing > 0
        ? (isEnglish
          ? 'Historical bars are present, but the structure read still needs more bars.'
          : '历史 K 线已返回，但结构计算仍缺少部分样本。')
        : (isEnglish
          ? 'Historical bars are present for this symbol.'
          : '该标的已有历史 K 线可用于页面展示。'),
      tone: missing > 0 ? 'caution' : 'success',
    };
  }
  return {
    label: isEnglish ? 'History missing' : '历史数据待补',
    detail: isEnglish
      ? 'The page did not receive historical bars for this symbol.'
      : '页面暂未收到该标的历史 K 线。',
    tone: 'caution',
  };
}

export function buildStockHistoryObservationView(
  history: StockHistoryResponse | null,
  failed: boolean,
  data: StockStructureDecisionResponse,
  language: StockObservationLocale,
  projection: Pick<ConsumerTextProjection, 'safeOptionalConsumerText'>,
): StockHistoryObservationView {
  const points = selectAdmissibleStockHistoryPoints(history, failed);
  const availableBars = points.length;
  const requiredBars = requiredHistoryBars(history, data);
  const missingBars = historyMissingBars(history, data, failed);
  const state = stockHistoryReadinessState({ history, failed, data, language });
  return {
    sourceLabel: stockHistorySourceLabel(history, language, projection),
    freshnessLabel: stockHistoryFreshnessLabel(history, failed, language),
    rangeLabel: historyRangeLabel(points, language),
    availableBars,
    requiredBars,
    missingBars,
    cached: (() => {
      const token = normalizeStockConsumerToken(history?.sourceConfidence?.freshness);
      return token ? token === 'cached' : null;
    })(),
    fallback: typeof history?.sourceConfidence?.isFallback === 'boolean'
      ? history.sourceConfidence.isFallback
      : null,
    limitation: state.detail,
  };
}

export function technicalFreshnessLabel(
  indicators: StockTechnicalIndicatorsResponse,
  language: StockObservationLocale,
): string {
  const freshness = normalizeStockConsumerToken(indicators.freshness || indicators.dataQuality.freshness || indicators.dataQuality.freshnessState);
  if (['current', 'fresh', 'live'].includes(freshness)) return language === 'en' ? 'Fresh' : '新鲜';
  if (freshness === 'stale') return language === 'en' ? 'Stale' : '已过期';
  if (freshness === 'delayed') return language === 'en' ? 'Delayed' : '延迟';
  if (freshness === 'cached') return language === 'en' ? 'Cached' : '缓存';
  if (freshness === 'partial') return language === 'en' ? 'Partial' : '部分可用';
  if (freshness === 'unavailable') return language === 'en' ? 'Unavailable' : '不可用';
  if (['synthetic', 'mock', 'mocked', 'fixture', 'sample', 'demo', 'placeholder', 'synthetic_placeholder', 'synthetic_fixture'].includes(freshness)) {
    return language === 'en' ? 'Sample / demo' : '样本 / 演示';
  }
  return language === 'en' ? 'Freshness pending' : '新鲜度待确认';
}

export function technicalSourceBoundaryLabel(
  indicators: StockTechnicalIndicatorsResponse,
  language: StockObservationLocale,
  projection: Pick<ConsumerTextProjection, 'safeOptionalConsumerText'>,
): string {
  const safeLabel = projection.safeOptionalConsumerText(indicators.sourceLabel, language);
  if (safeLabel) return safeLabel;
  return language === 'en' ? 'Technical indicator source pending' : '技术指标来源待确认';
}
