import type { MarketDataMeta } from '../../api/marketOverview';
import { projectMarketTruth } from '../../utils/consumerDataQualityViewModel';

export type MarketObservationFreshnessState =
  | 'unavailable'
  | 'error'
  | 'synthetic'
  | 'stale'
  | 'partial'
  | 'fallback'
  | 'delayed'
  | 'cached'
  | 'live'
  | 'unknown';

const MARKET_OBSERVATION_FRESHNESS_PRECEDENCE: MarketObservationFreshnessState[] = [
  'unavailable',
  'error',
  'synthetic',
  'stale',
  'delayed',
  'partial',
  'fallback',
  'cached',
  'live',
  'unknown',
];

function normalizedMarketObservationValue(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

export function marketObservationState(
  meta?: Partial<MarketDataMeta>,
): MarketObservationFreshnessState {
  const truth = projectMarketTruth(meta);
  const freshness = normalizedMarketObservationValue(meta?.freshness);
  const source = normalizedMarketObservationValue(meta?.source);
  const providerFreshness = normalizedMarketObservationValue(meta?.providerFreshness?.state);
  const providerStatus = normalizedMarketObservationValue(meta?.providerHealth?.status);
  const dataQuality = normalizedMarketObservationValue(meta?.dataQuality?.state);
  const truthFreshness = truth.freshness;
  const truthAvailability = truth.availability;
  const truthSourceClass = truth.source.class;
  const sampleState = normalizedMarketObservationValue(meta?.sampleState);
  const isSample = meta?.isSynthetic
    || meta?.isFixture
    || ['synthetic', 'fixture'].includes(truthSourceClass)
    || ['sample', 'synthetic', 'fixture', 'mock'].includes(sampleState)
    || ['synthetic', 'fixture', 'mock'].includes(truthFreshness)
    || ['synthetic', 'fixture', 'mock'].includes(freshness)
    || ['synthetic', 'fixture', 'mock'].includes(source)
    || ['synthetic', 'fixture', 'mock'].includes(providerFreshness);

  if (
    meta?.isUnavailable
    || meta?.providerFreshness?.isUnavailable
    || ['unavailable', 'malformed', 'incomplete', 'missing', 'blocked'].includes(truthAvailability)
    || ['unavailable', 'error', 'failure', 'failed', 'no_evidence', 'missing'].includes(dataQuality)
    || ['unavailable'].includes(freshness)
    || ['unavailable'].includes(source)
    || ['unavailable', 'unknown'].includes(providerFreshness)
    || providerStatus === 'unavailable'
  ) {
    return 'unavailable';
  }
  if (truthFreshness === 'error' || ['error'].includes(freshness) || ['error'].includes(source) || providerFreshness === 'error' || providerStatus === 'error') {
    return 'error';
  }
  if (isSample) {
    return 'synthetic';
  }
  if (
    meta?.isStale
    || meta?.providerHealth?.isStale
    || meta?.providerFreshness?.isStale
    || freshness === 'stale'
    || ['stale', 'expired'].includes(truthFreshness)
    || providerFreshness === 'stale'
    || providerStatus === 'stale'
  ) {
    return 'stale';
  }
  if (['delayed', 'aging'].includes(truthFreshness) || freshness === 'delayed' || providerFreshness === 'delayed' || dataQuality === 'delayed') {
    return 'delayed';
  }
  if (
    meta?.isPartial
    || freshness === 'partial'
    || providerFreshness === 'partial'
    || providerStatus === 'partial'
    || dataQuality === 'partial'
    || ['partial', 'incomplete'].includes(truthAvailability)
    || truthFreshness === 'partial'
    || truthSourceClass === 'proxy'
    || truthFreshness === 'proxy'
    || meta?.isProxy
    || meta?.providerFreshness?.isProxy
    || freshness === 'proxy'
    || providerFreshness === 'proxy'
  ) {
    return 'partial';
  }
  if (
    meta?.isFallback
    || meta?.providerHealth?.isFallback
    || truthSourceClass === 'fallback'
    || truthFreshness === 'fallback'
    || ['fallback'].includes(freshness)
    || ['fallback'].includes(source)
    || providerFreshness === 'fallback'
    || providerStatus === 'fallback'
  ) {
    return 'fallback';
  }
  if (truthFreshness === 'cached' || freshness === 'cached' || providerFreshness === 'cached' || providerStatus === 'cache' || dataQuality === 'cached') {
    return 'cached';
  }
  if (['live', 'fresh'].includes(truthFreshness) || ['live', 'fresh'].includes(freshness) || ['live', 'fresh'].includes(providerFreshness) || providerStatus === 'live') {
    return 'live';
  }
  return 'unknown';
}

export function marketObservationCollectionState(
  metas: Array<Partial<MarketDataMeta> | undefined>,
): MarketObservationFreshnessState {
  const states = new Set(metas.map((meta) => marketObservationState(meta)));
  return MARKET_OBSERVATION_FRESHNESS_PRECEDENCE.find((state) => states.has(state)) || 'unknown';
}

export type MarketOverviewDataStateStripView = {
  availableCount: number;
  cachedCount: number;
  delayedCount: number;
  partialCount: number;
  syntheticCount: number;
  fallbackCount: number;
  staleCount: number;
  hasUnavailable: boolean;
  unavailableCount: number;
  hasFallback: boolean;
  needsRefresh: boolean;
  isRefreshing: boolean;
  localSnapshotSavedAtLabel: string;
  variant: 'neutral' | 'info' | 'caution';
};

export type MarketOverviewTemperatureSummaryView = {
  reliable: boolean;
  valueText: string;
  toneClass: string;
  label: string;
  confidenceLabel: string;
  reliableInputCount: number;
  fallbackInputCount: number;
  excludedInputCount: number;
};

export type MarketOverviewBriefingSummaryView = {
  confidenceLabel: string;
  toneClass: string;
  leadMessage: string;
  warning?: string;
};

export type MarketOverviewDecisionSemanticsLineView = {
  key: string;
  label: string;
  meta?: string;
};

export type MarketOverviewDecisionSemanticsBoundaryView = {
  key: string;
  label: string;
  allowed: boolean;
  reasonCode?: string;
};

export type MarketOverviewDirectionReadinessPillarView = {
  key: string;
  label: string;
  reasonCode?: string;
};

export type MarketOverviewDirectionReadinessView = {
  status: 'direction_ready' | 'partial_context_only' | 'data_insufficient' | string;
  statusLabel: string;
  statusVariant: 'neutral' | 'success' | 'caution' | 'danger' | 'info';
  confidenceLabel: string;
  scoreGradeCount: number;
  observationOnlyCount: number;
  missingCount: number;
  scoreGradePillars: MarketOverviewDirectionReadinessPillarView[];
  observationOnlyPillars: MarketOverviewDirectionReadinessPillarView[];
  missingPillars: MarketOverviewDirectionReadinessPillarView[];
  blockingReasons: string[];
  notInvestmentAdvice: boolean;
};

export type MarketOverviewDecisionSemanticsView = {
  postureLabel: string;
  confidenceLabel: string;
  confidenceValueText: string;
  exposureBiasLabel: string;
  insufficient: boolean;
  capReasons: string[];
  styleTilts: MarketOverviewDecisionSemanticsLineView[];
  confirmationSignals: MarketOverviewDecisionSemanticsLineView[];
  invalidationTriggers: MarketOverviewDecisionSemanticsLineView[];
  counterEvidence: MarketOverviewDecisionSemanticsLineView[];
  dataGaps: MarketOverviewDecisionSemanticsLineView[];
  directionReadiness?: MarketOverviewDirectionReadinessView;
  claimBoundaries: MarketOverviewDecisionSemanticsBoundaryView[];
  notInvestmentAdvice: boolean;
};
