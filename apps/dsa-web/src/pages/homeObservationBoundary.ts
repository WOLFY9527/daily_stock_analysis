import type { MarketBriefingResponse } from '../api/market';
import type { ResearchQualityFacet } from '../components/research/anatomy';
import type { HistoryItem } from '../types/analysis';

export type DashboardLocale = 'zh' | 'en';

export type HomeMarketHealthState =
  | 'loading'
  | 'ready'
  | 'cached'
  | 'delayed'
  | 'stale'
  | 'fallback'
  | 'synthetic'
  | 'partial'
  | 'unknown'
  | 'unavailable';

const HISTORY_TIMESTAMP_FORMATTERS = {
  en: new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }),
  zh: new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }),
} as const;

export function formatHistoryTimestamp(value?: string, locale: DashboardLocale = 'zh'): string {
  const text = String(value || '').trim();
  if (!text) return '';

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;

  const parts = HISTORY_TIMESTAMP_FORMATTERS[locale].formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`;
}

export function resolveHistoryTimestampLabel(historyItem: HistoryItem, locale: DashboardLocale): string {
  const generatedAt = formatHistoryTimestamp(historyItem.generatedAt, locale);
  if (generatedAt) {
    return `${locale === 'en' ? 'Report generated at' : '报告生成于'} ${generatedAt}`;
  }
  const createdAt = formatHistoryTimestamp(historyItem.createdAt, locale);
  return createdAt ? `${locale === 'en' ? 'Record created at' : '记录创建于'} ${createdAt}` : '';
}

export function resolveHomeMarketHealth(
  locale: DashboardLocale,
  briefing: MarketBriefingResponse | null,
  isLoading: boolean,
  isUnavailable: boolean,
): {
  state: HomeMarketHealthState;
  label: string;
  detail: string;
  freshnessLabel: string;
  healthFacets: ResearchQualityFacet[];
} {
  const isEnglish = locale === 'en';
  const copy: Record<HomeMarketHealthState, { label: string; detail: string; freshnessLabel: string }> = {
    loading: {
      label: isEnglish ? 'Checking market evidence' : '正在检查市场证据',
      detail: isEnglish ? 'Waiting for the returned market observation.' : '正在等待市场观察返回。',
      freshnessLabel: isEnglish ? 'Freshness: checking' : '新鲜度：检查中',
    },
    ready: {
      label: isEnglish ? 'Research-ready' : '研究可读',
      detail: isEnglish ? 'Returned market facts are explicitly fresh enough for research observation.' : '已返回市场事实明确为新鲜，可支持研究观察。',
      freshnessLabel: isEnglish ? 'Freshness: fresh' : '新鲜度：新鲜',
    },
    cached: {
      label: isEnglish ? 'Saved market snapshot' : '已保存市场快照',
      detail: isEnglish ? 'The observation comes from a saved snapshot and does not prove live market freshness.' : '当前观察来自已保存快照，不能证明实时市场新鲜度。',
      freshnessLabel: isEnglish ? 'Freshness: cached' : '新鲜度：缓存',
    },
    delayed: {
      label: isEnglish ? 'Delayed market evidence' : '市场证据延迟',
      detail: isEnglish ? 'The returned observation is delayed and remains bounded by its as-of time.' : '已返回观察存在延迟，仅在其截至时间范围内使用。',
      freshnessLabel: isEnglish ? 'Freshness: delayed' : '新鲜度：延迟',
    },
    stale: {
      label: isEnglish ? 'Stale market evidence' : '市场证据已过期',
      detail: isEnglish ? 'The latest returned observation is stale and must not be treated as current.' : '最近返回的市场观察已经过期，不能视为当前状态。',
      freshnessLabel: isEnglish ? 'Freshness: stale' : '新鲜度：过期',
    },
    fallback: {
      label: isEnglish ? 'Latest fallback observation' : '最近可用替代观察',
      detail: isEnglish ? 'The observation uses a fallback path and does not carry primary-source authority.' : '当前观察使用替代路径，不具有主要来源权威。',
      freshnessLabel: isEnglish ? 'Freshness: fallback' : '新鲜度：替代',
    },
    synthetic: {
      label: isEnglish ? 'Synthetic market evidence' : '样本市场证据',
      detail: isEnglish ? 'Sample or demo evidence is visible for observation only and is not a fallback market feed.' : '样本或演示证据仅供观察，不属于回退市场数据源。',
      freshnessLabel: isEnglish ? 'Freshness: sample / demo' : '新鲜度：样本 / 演示',
    },
    partial: {
      label: isEnglish ? 'Partially usable' : '部分可用',
      detail: isEnglish ? 'Returned market facts are incomplete or the source is degraded; keep the reading bounded.' : '已返回市场事实不完整或来源降级，需要保持有边界的解读。',
      freshnessLabel: isEnglish ? 'Freshness: partial' : '新鲜度：部分可用',
    },
    unknown: {
      label: isEnglish ? 'Market freshness pending' : '市场新鲜度待确认',
      detail: isEnglish ? 'Freshness was not returned, so this observation is not treated as healthy.' : '接口未返回新鲜度，因此当前观察不视为健康。',
      freshnessLabel: isEnglish ? 'Freshness: pending' : '新鲜度：待确认',
    },
    unavailable: {
      label: isEnglish ? 'Market evidence unavailable' : '市场证据暂不可用',
      detail: isEnglish ? 'No usable market observation is available right now.' : '当前没有可用的市场观察。',
      freshnessLabel: isEnglish ? 'Freshness: unavailable' : '新鲜度：不可用',
    },
  };

  const freshness = String(briefing?.freshness || '').trim().toLowerCase();
  const source = String(briefing?.source || '').trim().toLowerCase();
  const providerStatus = String(briefing?.providerHealth?.status || '').trim().toLowerCase();
  const providerError = String(briefing?.providerHealth?.errorSummary || '').trim();
  const hasItems = Boolean(briefing?.items.some((item) => Boolean(String(item.title || item.message || '').trim())));
  const returnedUnavailable = Boolean(
    isUnavailable
    || ['unavailable', 'error'].includes(freshness)
    || ['unavailable', 'error'].includes(providerStatus),
  );
  const noUsableItems = Boolean(briefing && !hasItems && !isLoading);
  const explicitlySynthetic = Boolean(
    ['synthetic', 'mock', 'sample', 'fixture'].includes(freshness)
    || ['synthetic', 'mock', 'sample', 'fixture'].includes(source),
  );
  const explicitlyStale = Boolean(
    briefing?.isStale
    || briefing?.providerHealth?.isStale
    || freshness === 'stale'
    || providerStatus === 'stale',
  );
  const explicitlyFallback = Boolean(
    briefing?.isFallback
    || briefing?.providerHealth?.isFallback
    || source === 'fallback'
    || ['fallback', 'proxy'].includes(freshness)
    || providerStatus === 'fallback'
    || (briefing?.fallbackInputCount ?? 0) > 0,
  );
  const explicitlyCached = freshness === 'cached' || providerStatus === 'cache';
  const explicitlyDelayed = freshness === 'delayed' || (briefing?.delayMinutes ?? 0) > 0;
  const explicitPartialFreshness = Boolean(briefing?.isPartial || source === 'mixed' || freshness === 'partial');
  const explicitlyPartial = Boolean(
    explicitPartialFreshness
    || briefing?.isReliable === false
    || providerStatus === 'partial'
    || briefing?.isRefreshing
    || briefing?.providerHealth?.isRefreshing
    || providerError
    || (briefing?.excludedInputCount ?? 0) > 0
    || /timeout|cooldown/i.test(providerError),
  );

  const state: HomeMarketHealthState = !briefing
    ? (isLoading && !isUnavailable ? 'loading' : 'unavailable')
    : returnedUnavailable || noUsableItems
      ? 'unavailable'
      : explicitlySynthetic
        ? 'synthetic'
        : explicitlyStale
          ? 'stale'
          : explicitlyFallback
            ? 'fallback'
            : explicitlyPartial
              ? 'partial'
              : explicitlyCached
                ? 'cached'
                : explicitlyDelayed
                  ? 'delayed'
                  : ['live', 'fresh'].includes(freshness)
                    ? 'ready'
                    : 'unknown';

  const freshnessFacetState: HomeMarketHealthState = !briefing
    ? state
    : returnedUnavailable
      ? 'unavailable'
      : explicitlySynthetic
        ? 'synthetic'
        : explicitlyStale
          ? 'stale'
          : explicitPartialFreshness
            ? 'partial'
            : explicitlyDelayed
              ? 'delayed'
              : explicitlyCached
                ? 'cached'
                : ['live', 'fresh'].includes(freshness)
                  ? 'ready'
                  : 'unknown';
  const freshnessLabel = copy[freshnessFacetState].freshnessLabel;
  const cacheKnown = Boolean(briefing && (freshness || providerStatus));
  const cacheValue = explicitlyCached
    ? (isEnglish ? 'yes' : '是')
    : cacheKnown
      ? (isEnglish ? 'no' : '否')
      : (isEnglish ? 'pending' : '待确认');
  const fallbackKnown = typeof briefing?.isFallback === 'boolean'
    || typeof briefing?.providerHealth?.isFallback === 'boolean'
    || Boolean(source || freshness || providerStatus);
  const fallbackValue = explicitlyFallback
    ? (isEnglish ? 'yes' : '是')
    : fallbackKnown
      ? (isEnglish ? 'no' : '否')
      : (isEnglish ? 'pending' : '待确认');
  const availabilityValue = returnedUnavailable || noUsableItems
    ? (hasItems
      ? (isEnglish ? 'unavailable marker; retained observation only' : '不可用标记；仅保留既有观察')
      : (isEnglish ? 'unavailable' : '不可用'))
    : explicitlySynthetic
      ? (isEnglish ? 'observation only' : '仅供观察')
      : explicitlyPartial
        ? (isEnglish ? 'partially usable' : '部分可用')
        : hasItems
          ? (isEnglish ? 'returned' : '已返回')
          : isLoading
            ? (isEnglish ? 'checking' : '检查中')
            : (isEnglish ? 'unavailable' : '不可用');
  const freshnessKind: ResearchQualityFacet['kind'] = freshnessFacetState === 'stale'
    ? 'stale'
    : freshnessFacetState === 'cached'
      ? 'cached'
      : freshnessFacetState === 'delayed'
        ? 'delayed'
        : freshnessFacetState === 'unavailable'
          ? 'unavailable'
          : freshnessFacetState === 'partial'
            ? 'partial'
            : freshnessFacetState === 'synthetic'
              ? 'observation-only'
              : 'freshness';
  const healthFacets: ResearchQualityFacet[] = [
    {
      key: 'freshness',
      kind: freshnessKind,
      label: isEnglish ? 'Freshness' : '新鲜度',
      value: freshnessLabel.replace(/^[^:：]+[:：]\s*/, ''),
      tone: freshnessFacetState === 'ready'
        ? 'success'
        : freshnessFacetState === 'unavailable'
          ? 'danger'
          : freshnessFacetState === 'synthetic'
            ? 'info'
            : 'caution',
    },
    {
      key: 'cache',
      kind: explicitlyCached ? 'cached' : 'lineage',
      label: isEnglish ? 'Cache' : '缓存',
      value: cacheValue,
      tone: explicitlyCached ? 'info' : cacheKnown ? 'neutral' : 'caution',
    },
    {
      key: 'fallback',
      kind: explicitlyFallback ? 'degraded' : 'authority',
      label: isEnglish ? 'Alternate path' : '替代路径',
      value: fallbackValue,
      tone: explicitlyFallback ? 'caution' : fallbackKnown ? 'neutral' : 'caution',
    },
    {
      key: 'availability',
      kind: returnedUnavailable || noUsableItems
        ? 'unavailable'
        : explicitlySynthetic
          ? 'observation-only'
          : explicitlyPartial
            ? 'partial'
            : 'coverage',
      label: isEnglish ? 'Availability' : '可用性',
      value: availabilityValue,
      tone: returnedUnavailable || noUsableItems
        ? 'danger'
        : explicitlySynthetic
          ? 'info'
          : explicitlyPartial
            ? 'caution'
            : hasItems
              ? 'success'
              : 'caution',
    },
  ];

  return { state, ...copy[state], freshnessLabel, healthFacets };
}
