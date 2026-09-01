import type React from 'react';
import { useEffect, useReducer, useRef, useState } from 'react';
import { Gauge, RefreshCcw, Search, SlidersHorizontal } from 'lucide-react';
import { ApiErrorAlert } from '../components/common/ApiErrorAlert';
import {
  ConsoleContextRail,
  DataWorkbenchFrame,
  DenseRows,
  WolfyCommandBar,
} from '../components/linear/LinearPrimitives';
import { DataFreshnessBadge } from '../components/market-overview/marketOverviewPrimitives';
import {
  TerminalButton,
  TerminalChip,
  TerminalEmptyState,
  TerminalGrid,
  TerminalNestedBlock,
  TerminalNotice,
  TerminalPageHeading,
  TerminalPanel,
  TerminalSectionHeader,
} from '../components/terminal/TerminalPrimitives';
import { ConsumerWorkspacePageShell, ConsumerWorkspaceScope } from '../components/layout/ConsumerWorkspaceShell';
import { useI18n } from '../contexts/UiLanguageContext';
import { createParsedApiError, getParsedApiError, type ParsedApiError } from '../api/error';
import {
  buildAlpacaQuoteAuthorityReadinessView,
  buildMarketRotationEvidenceBoundaryView,
  marketRotationApi,
  type MarketRotationEvidenceQuality,
  type MarketRotationFamilyRollupItem,
  type MarketRotationRadarResponse,
  type MarketRotationSignalType,
  type MarketRotationStage,
  type MarketRotationSummaryItem,
  type MarketRotationTheme,
  type MarketRotationThemeCorrelationBreadthSnapshot,
} from '../api/marketRotation';
import {
  compareNullableAsc,
  compareNullableDesc,
  formatConfidenceValue as formatRotationConfidenceValue,
  formatRelativeStrengthValue as formatRotationRelativeStrengthValue,
  formatRotationScore,
  hasPositiveKnownMetric,
  matrixGeometryPosition,
  parseRotationMetric,
  scoreBarGeometryWidth,
  sortThemesByEvidenceDesc,
} from '../components/market-rotation/rotationEvidenceSemantics';
import { cn } from '../utils/cn';
import { decisionReadinessVariant, sanitizeMarketGuidanceCopy, type DecisionReadinessState, type DecisionReadinessSummary } from '../utils/marketIntelligenceGuidance';

const TOP_THEME_LIMIT = 10;
const DEFAULT_MARKET = 'US';
const ROTATION_RADAR_LOADING_FALLBACK_MS = 5000;
const ROTATION_RADAR_ROUTE_TIMEOUT_MS = 12000;
const MARKET_OPTIONS = [
  { id: 'US', labelKey: 'markets.us' },
  { id: 'CN', labelKey: 'markets.cn' },
  { id: 'HK', labelKey: 'markets.hk' },
  { id: 'CRYPTO', labelKey: 'markets.crypto' },
] as const;

const STAGE_LABEL_KEYS: Record<MarketRotationStage, string> = {
  early_watch: 'stages.earlyWatch',
  confirmed_rotation: 'stages.confirmedRotation',
  extended_watch: 'stages.extendedWatch',
  cooling_watch: 'stages.coolingWatch',
  weak_or_no_signal: 'stages.weakOrNoSignal',
};

const REAL_FLOW_EVIDENCE_TYPES = new Set(['real_flow', 'mixed_real_and_proxy']);
const DATA_GAP_LABEL_KEYS: Record<string, string> = {
  true_flow_data_missing: 'gaps.signalPending',
  flow_methodology_missing: 'gaps.signalPending',
  source_authority_rejected: 'gaps.signalPending',
  stale_quote_window: 'gaps.dataDelayed',
  benchmark_proxy_missing: 'gaps.divergence',
  proxy_coverage_incomplete: 'gaps.divergence',
  taxonomy_only: 'gaps.taxonomy',
  missing_required_windows: 'gaps.signalPending',
  no_headline_theme: 'gaps.divergence',
};
const THEME_FLOW_STATE_LABEL_KEYS: Record<string, string> = {
  leading: 'flowStates.leading',
  broadening: 'flowStates.broadening',
  rotating: 'flowStates.rotating',
  crowded: 'flowStates.crowded',
  fading: 'flowStates.fading',
  mixed: 'flowStates.mixed',
  insufficient_evidence: 'flowStates.insufficientEvidence',
};
const THEME_FLOW_REASON_LABEL_KEYS: Record<string, string> = {
  fallback_source: 'flowReasons.fallbackSource',
  stale_source: 'flowReasons.staleSource',
  partial_source: 'flowReasons.partialSource',
  source_authority_missing: 'flowReasons.sourceAuthorityMissing',
  conflicting_signal_inputs: 'flowReasons.conflictingInputs',
};
const THEME_PARTICIPATION_LABEL_KEYS: Record<string, string> = {
  broad_group: 'participation.broadGroup',
  leader_concentrated: 'participation.leaderConcentrated',
  mixed_or_partial: 'participation.mixedOrPartial',
  insufficient_evidence: 'participation.insufficientEvidence',
};
const THEME_LEADERSHIP_LABEL_KEYS: Record<string, string> = {
  balanced: 'leadership.balanced',
  moderate: 'leadership.moderate',
  concentrated: 'leadership.concentrated',
  unknown: 'leadership.unknown',
};
const THEME_CORRELATION_LABEL_KEYS: Record<string, string> = {
  aligned: 'correlation.aligned',
  mixed: 'correlation.mixed',
  weak: 'correlation.weak',
  missing: 'correlation.missing',
};
const THEME_BREADTH_LABEL_KEYS: Record<string, string> = {
  broad: 'breadth.broad',
  mixed: 'breadth.mixed',
  thin: 'breadth.thin',
  missing: 'breadth.missing',
};
const SNAPSHOT_INPUT_LABEL_KEYS: Record<string, string> = {
  fallback_source: 'snapshotInputs.fallbackSource',
  stale_source: 'snapshotInputs.staleSource',
  partial_source: 'snapshotInputs.partialSource',
  breadth_percent_up: 'snapshotInputs.breadthPercentUp',
  breadth_percent_outperforming_benchmark: 'snapshotInputs.breadthOutperforming',
  correlation_same_direction_percent: 'snapshotInputs.correlationSameDirection',
  correlation_above_vwap_percent: 'snapshotInputs.correlationAboveVwap',
  leadership_concentration_percent: 'snapshotInputs.leadershipConcentration',
  market_runtime_evidence: 'snapshotInputs.marketRuntimeEvidence',
};
const ROTATION_PAPER_PANEL_CLASS = 'rounded-xl border border-[color:var(--wolfy-divider)] bg-[color:color-mix(in_srgb,var(--wolfy-surface-input)_84%,transparent)]';
const ROTATION_PAPER_SOFT_PANEL_CLASS = 'rounded-xl border border-[color:var(--wolfy-divider)] bg-[color:color-mix(in_srgb,var(--wolfy-surface-input)_70%,transparent)]';
const ROTATION_PAPER_TEXT_PRIMARY_CLASS = 'text-[color:var(--wolfy-text-primary)]';
const ROTATION_PAPER_TEXT_SECONDARY_CLASS = 'text-[color:var(--wolfy-text-secondary)]';
const ROTATION_PAPER_TEXT_MUTED_CLASS = 'text-[color:var(--wolfy-text-muted)]';

type CapitalRotationSummaryCard = {
  key: string;
  label: string;
  value: string;
  detail: string;
  variant: 'success' | 'info' | 'caution' | 'neutral' | 'danger';
};

type CapitalRotationSummaryView = {
  modeLabel: string;
  modeDetail: string;
  cards: CapitalRotationSummaryCard[];
};

type RotationConclusionView = {
  state: DecisionReadinessState;
  title: string;
  detail: string;
  whyNotConclusion: string;
  missingEvidence: string[];
  nextStep: string;
  variant: 'neutral' | 'info' | 'caution' | 'danger' | 'success';
};

type DataStateFields = {
  freshness?: MarketRotationTheme['freshness'];
  isFallback?: boolean;
  isStale?: boolean;
};

type RotationTierView = {
  libraryMode: boolean;
  confirmedLeaders: MarketRotationTheme[];
  candidateThemes: MarketRotationTheme[];
  coolingThemes: MarketRotationTheme[];
  taxonomyThemes: MarketRotationTheme[];
};

type RotationPrimaryDisplayMode = 'headline' | 'observation' | 'taxonomy' | 'unavailable';

type ThemeFlowSignalView = NonNullable<MarketRotationTheme['themeFlowSignal']>;
type RotationMatrixStageMeta = {
  key: MarketRotationStage;
  label: string;
};
type RotationFamilyView = {
  familyKey: string;
  familyName: string;
  item: MarketRotationFamilyRollupItem;
  themeCount: number;
  signalThemeCount: number;
  averageRotationScore: number | null;
  averageConfidence: number | null;
  reasonLabels: string[];
  preview: string;
  collapsedByDefault: boolean;
  hasUsefulSignal: boolean;
};

type RotationTranslate = ReturnType<typeof useI18n>['t'];
type RotationLanguage = ReturnType<typeof useI18n>['language'];

function rotationCopy(t: RotationTranslate, key: string, vars?: Record<string, string | number | undefined>): string {
  return t(`rotationRadar.${key}`, vars);
}

function themePresentationName(language: RotationLanguage, theme?: MarketRotationTheme): string {
  const primary = language === 'en' ? theme?.englishName : theme?.name;
  const fallback = language === 'en' ? theme?.name : theme?.englishName;
  return String(primary || fallback || '').trim();
}

const ROTATION_MATRIX_STAGE_ORDER: RotationMatrixStageMeta[] = [
  { key: 'confirmed_rotation', label: 'stages.confirmedRotation' },
  { key: 'extended_watch', label: 'stages.extendedWatch' },
  { key: 'early_watch', label: 'stages.earlyWatch' },
  { key: 'cooling_watch', label: 'stages.coolingWatch' },
  { key: 'weak_or_no_signal', label: 'stages.weakOrNoSignal' },
];

function hasMomentumProxyInputs(theme: MarketRotationTheme): boolean {
  return [
    theme.volume?.averageRelativeVolume,
    theme.breadth?.percentUp,
    theme.breadth?.percentOutperformingBenchmark,
    theme.synchronization?.sameDirectionPercent,
    theme.synchronization?.aboveVwapPercent,
    theme.persistenceEvidence?.score,
    theme.leadership?.topMembers?.length,
  ].some((value) => value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) > 0);
}

function isTaxonomyOnlyTheme(theme?: MarketRotationTheme): boolean {
  if (theme?.taxonomyOnly === false) {
    return false;
  }

  return Boolean(
    theme?.taxonomyOnly === true
    || theme?.dataQuality === 'taxonomy_only'
    || theme?.dataCoverage === 'taxonomy_only'
    || theme?.source === 'local_taxonomy'
    || theme?.sourceClass === 'local_taxonomy',
  );
}

function normalizeSignalType(value?: string | null): MarketRotationSignalType | null {
  switch (value) {
    case 'real_flow':
    case 'relative_strength':
    case 'momentum_proxy':
    case 'observation_only':
    case 'taxonomy_fallback':
    case 'insufficient_evidence':
      return value;
    default:
      return null;
  }
}

function resolveSignalType(theme: MarketRotationTheme): MarketRotationSignalType {
  const direct = normalizeSignalType(theme.signalType);
  if (direct) {
    return direct;
  }
  const flowEvidenceType = String(
    theme.flowEvidenceType
      || (theme.rotationStateEvidence as Record<string, unknown> | undefined)?.flowEvidenceType
      || 'none',
  ).trim();
  if (isTaxonomyOnlyTheme(theme) || theme.source === 'local_taxonomy' || theme.taxonomyOnly) {
    return 'taxonomy_fallback';
  }
  if (REAL_FLOW_EVIDENCE_TYPES.has(flowEvidenceType) && theme.flowLanguageAllowed) {
    return 'real_flow';
  }
  if (parseRotationMetric(theme.relativeStrength?.averageRelativeStrengthPercent) !== null) {
    return 'relative_strength';
  }
  if (hasMomentumProxyInputs(theme)) {
    return 'momentum_proxy';
  }
  if (theme.observationOnly) {
    return 'observation_only';
  }
  return 'insufficient_evidence';
}

function normalizeEvidenceQuality(value?: string | null): MarketRotationEvidenceQuality | null {
  switch (value) {
    case 'score_grade_real_flow':
    case 'score_grade_proxy':
    case 'degraded_proxy':
    case 'observation_only':
    case 'taxonomy_only':
    case 'insufficient':
      return value;
    default:
      return null;
  }
}

function resolveEvidenceQuality(theme: MarketRotationTheme): MarketRotationEvidenceQuality {
  const direct = normalizeEvidenceQuality(theme.evidenceQuality);
  if (direct) {
    return direct;
  }
  switch (resolveSignalType(theme)) {
    case 'real_flow':
      return 'score_grade_real_flow';
    case 'relative_strength':
    case 'momentum_proxy':
      return theme.sourceAuthorityAllowed ? 'score_grade_proxy' : 'degraded_proxy';
    case 'observation_only':
      return 'observation_only';
    case 'taxonomy_fallback':
      return 'taxonomy_only';
    default:
      return 'insufficient';
  }
}

function formatGapLabel(t: RotationTranslate, value?: string | null): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return rotationCopy(t, 'gaps.signalPending');
  }
  return DATA_GAP_LABEL_KEYS[normalized]
    ? rotationCopy(t, DATA_GAP_LABEL_KEYS[normalized])
    : rotationCopy(t, 'gaps.signalPending');
}

function themeDataGaps(theme: MarketRotationTheme): string[] {
  const gaps = Array.isArray(theme.dataGaps) ? theme.dataGaps : [];
  return gaps.reduce<string[]>((acc, gap) => {
    const g = String(gap || '').trim();
    if (g && acc.indexOf(g) === -1) acc.push(g);
    return acc;
  }, []);
}

function consumerThemeSubtitle(t: RotationTranslate, theme: MarketRotationTheme): string {
  const raw = theme.focus || theme.englishName || theme.benchmark || '';
  const normalized = String(raw).trim();
  if (!normalized) {
    return rotationCopy(t, 'labels.observationClue');
  }
  if (/^[\w\s/.:+-]+$/.test(normalized) && theme.focus) {
    return rotationCopy(t, 'labels.observationClue');
  }
  if (/proxy|provider|source|debug|trace|raw|schema|代理|来源|提供方|诊断/i.test(normalized)) {
    return rotationCopy(t, 'labels.observationClue');
  }
  return sanitizeRotationText(normalized, rotationCopy(t, 'labels.observationClue'));
}

function consumerFreshnessLabel(t: RotationTranslate, freshness?: string | null, isFallback?: boolean, isStale?: boolean): string {
  if (isFallback || freshness === 'fallback' || isStale || freshness === 'stale') {
    return rotationCopy(t, 'freshness.fallback');
  }
  if (freshness === 'delayed') {
    return rotationCopy(t, 'freshness.delayed');
  }
  if (freshness === 'live') {
    return rotationCopy(t, 'freshness.live');
  }
  return rotationCopy(t, 'freshness.pending');
}

function consumerConfidenceLabel(t: RotationTranslate, state: DecisionReadinessState): string {
  if (state === 'ready') {
    return rotationCopy(t, 'confidence.ready');
  }
  if (state === 'observe') {
    return rotationCopy(t, 'confidence.observe');
  }
  return rotationCopy(t, 'confidence.unavailable');
}

function consumerSufficiencyLabel(t: RotationTranslate, state: DecisionReadinessState): string {
  if (state === 'ready') {
    return rotationCopy(t, 'sufficiency.ready');
  }
  if (state === 'observe') {
    return rotationCopy(t, 'sufficiency.observe');
  }
  return rotationCopy(t, 'sufficiency.unavailable');
}

function consumerStatusLabel(t: RotationTranslate, state: DecisionReadinessState, payload: MarketRotationRadarResponse): string {
  if (!payload.themes.length) {
    return rotationCopy(t, 'status.directionPending');
  }
  if (state === 'ready') {
    return payload.freshness === 'delayed' ? rotationCopy(t, 'status.delayedReadable') : rotationCopy(t, 'status.strengthReadable');
  }
  if (state === 'observe') {
    return payload.isFallback || payload.isStale ? rotationCopy(t, 'gaps.dataDelayed') : rotationCopy(t, 'gaps.signalPending');
  }
  if (isRotationLibraryMode(payload)) {
    return rotationCopy(t, 'gaps.signalPending');
  }
  if (payload.isFallback || payload.isStale) {
    return rotationCopy(t, 'gaps.dataDelayed');
  }
  return payload.themes.length ? rotationCopy(t, 'gaps.signalPending') : rotationCopy(t, 'status.directionPending');
}

function formatThemeStage(t: RotationTranslate, stage?: MarketRotationStage): string {
  return stage ? rotationCopy(t, STAGE_LABEL_KEYS[stage] || 'labels.unidentified') : rotationCopy(t, 'labels.unidentified');
}

function formatThemeFlowState(t: RotationTranslate, state?: string | null): string {
  const normalized = String(state || '').trim();
  if (!normalized) {
    return rotationCopy(t, 'labels.pending');
  }
  return THEME_FLOW_STATE_LABEL_KEYS[normalized]
    ? rotationCopy(t, THEME_FLOW_STATE_LABEL_KEYS[normalized])
    : sanitizeRotationText(normalized, rotationCopy(t, 'labels.pending'));
}

function themeFlowChipVariant(state?: string | null): 'success' | 'info' | 'caution' | 'neutral' {
  switch (state) {
    case 'leading':
      return 'success';
    case 'broadening':
    case 'rotating':
      return 'info';
    case 'crowded':
    case 'fading':
    case 'mixed':
      return 'caution';
    default:
      return 'neutral';
  }
}

function formatThemeFlowConfidence(t: RotationTranslate, signal?: MarketRotationTheme['themeFlowSignal'] | null): string {
  const raw = signal?.confidence;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return `${Math.round(raw <= 1 ? raw * 100 : raw)}%`;
  }
  if (typeof raw === 'string') {
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
      return `${Math.round(numeric <= 1 ? numeric * 100 : numeric)}%`;
    }
  }
  const label = String(signal?.confidenceLabel || signal?.confidenceText || '').trim();
  return label || rotationCopy(t, 'labels.pending');
}

function extractThemeFlowLeadershipEvidence(t: RotationTranslate, signal?: MarketRotationTheme['themeFlowSignal'] | null): string | null {
  const candidate = signal && typeof signal === 'object'
    ? (signal as ThemeFlowSignalView & { leadershipEvidence?: unknown }).leadershipEvidence
    : null;
  return typeof candidate === 'string' && candidate.trim()
    ? sanitizeRotationText(candidate, rotationCopy(t, 'evidence.leadershipMissing'))
    : null;
}

function themeFlowReasonLabels(t: RotationTranslate, signal?: MarketRotationTheme['themeFlowSignal'] | null): string[] {
  const codes = Array.isArray(signal?.reasonCodes) ? signal.reasonCodes : [];
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const code of codes) {
    const labelKey = THEME_FLOW_REASON_LABEL_KEYS[String(code || '').trim()];
    const label = labelKey ? rotationCopy(t, labelKey) : '';
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
    if (labels.length === 3) break;
  }
  return labels;
}

function themeFlowEvidenceLines(t: RotationTranslate, signal?: MarketRotationTheme['themeFlowSignal'] | null): string[] {
  return [
    extractThemeFlowLeadershipEvidence(t, signal) || rotationCopy(t, 'evidence.leadershipMissing'),
    sanitizeRotationText(signal?.breadthEvidence, rotationCopy(t, 'evidence.breadthMissing')),
    sanitizeRotationText(signal?.relativeStrengthEvidence, rotationCopy(t, 'evidence.relativeStrengthMissing')),
  ];
}

function hasThemeCorrelationBreadthSnapshot(
  snapshot?: MarketRotationThemeCorrelationBreadthSnapshot | null,
): snapshot is MarketRotationThemeCorrelationBreadthSnapshot {
  if (!snapshot || typeof snapshot !== 'object') {
    return false;
  }
  return Boolean(
    snapshot.participationState
      || snapshot.leadershipConcentration
      || snapshot.correlationEvidence
      || snapshot.breadthEvidence,
  );
}

function formatSnapshotState(
  t: RotationTranslate,
  value: string | null | undefined,
  labels: Record<string, string>,
  fallbackKey: string,
): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return rotationCopy(t, fallbackKey);
  }
  return labels[normalized]
    ? rotationCopy(t, labels[normalized])
    : sanitizeRotationText(normalized, rotationCopy(t, fallbackKey));
}

function formatSnapshotPercent(t: RotationTranslate, value?: number | string | null): string {
  if (!Number.isFinite(Number(value))) {
    return rotationCopy(t, 'labels.pending');
  }
  return `${Number(value).toFixed(1)}%`;
}

function formatSnapshotMemberCount(t: RotationTranslate, observed?: number | null, configured?: number | null): string {
  const observedNumber = Number(observed);
  const configuredNumber = Number(configured);
  if (!Number.isFinite(observedNumber) || !Number.isFinite(configuredNumber) || configuredNumber <= 0) {
    return rotationCopy(t, 'snapshot.sampleMissing');
  }
  return rotationCopy(t, 'snapshot.memberCount', { observed: Math.max(0, Math.round(observedNumber)), configured: Math.max(0, Math.round(configuredNumber)) });
}

function formatSnapshotInputLabel(t: RotationTranslate, value?: string | null): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }
  const fallbackWindow = normalized.match(/^fallback_window:(.+)$/);
  if (fallbackWindow?.[1]) {
    return rotationCopy(t, 'snapshot.windowRefresh', { window: sanitizeRotationText(fallbackWindow[1], rotationCopy(t, 'snapshot.window')) });
  }
  return SNAPSHOT_INPUT_LABEL_KEYS[normalized]
    ? rotationCopy(t, SNAPSHOT_INPUT_LABEL_KEYS[normalized])
    : sanitizeRotationText(normalized, rotationCopy(t, 'snapshot.inputMissing'));
}

function formatSnapshotInputLabels(t: RotationTranslate, values?: string[] | null, fallbackKey = 'labels.none'): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const value of values || []) {
    const label = formatSnapshotInputLabel(t, value);
    if (!label || seen.has(label)) {
      continue;
    }
    seen.add(label);
    labels.push(label);
  }
  return labels.length ? labels : [rotationCopy(t, fallbackKey)];
}

function formatSnapshotNextSteps(t: RotationTranslate, values?: string[] | null): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const value of values || []) {
    const raw = String(value || '').trim();
    // researchNextSteps belongs to the response evidence contract, not product-owned UI.
    const label = sanitizeRotationText(raw, '');
    if (!label || seen.has(label)) {
      continue;
    }
    seen.add(label);
    labels.push(label);
  }
  return labels.length ? labels.slice(0, 3) : [rotationCopy(t, 'snapshotNextSteps.default')];
}

function formatSnapshotBoundaryLabels(
  t: RotationTranslate,
  boundary?: MarketRotationThemeCorrelationBreadthSnapshot['observationBoundary'] | null,
): string[] {
  if (!boundary || typeof boundary !== 'object') {
    return [rotationCopy(t, 'boundary.researchOnly')];
  }
  const labels = [
    boundary.scope === 'existing_theme_fields' ? rotationCopy(t, 'boundary.existingFields') : rotationCopy(t, 'boundary.scopeLimited'),
    boundary.rankingImpact === 'none' ? rotationCopy(t, 'boundary.noRankingChange') : null,
    boundary.dataMutation === 'none' ? rotationCopy(t, 'boundary.noDataMutation') : null,
    boundary.dataFetches === 'none' ? rotationCopy(t, 'boundary.noNewFetches') : null,
  ].filter((label): label is string => Boolean(label));
  return labels.length ? labels : [rotationCopy(t, 'boundary.researchOnly')];
}

function snapshotSummary(t: RotationTranslate, snapshot: MarketRotationThemeCorrelationBreadthSnapshot): string {
  const participation = formatSnapshotState(t, snapshot.participationState, THEME_PARTICIPATION_LABEL_KEYS, 'snapshot.participationMissing');
  const breadth = formatSnapshotState(t, snapshot.breadthEvidence?.state, THEME_BREADTH_LABEL_KEYS, 'breadth.missing');
  const correlation = formatSnapshotState(t, snapshot.correlationEvidence?.state, THEME_CORRELATION_LABEL_KEYS, 'correlation.missing');
  const staleCount = Array.isArray(snapshot.staleInputs) ? snapshot.staleInputs.length : 0;
  const missingCount = Array.isArray(snapshot.missingInputs) ? snapshot.missingInputs.length : 0;
  const dataState = missingCount > 0
    ? rotationCopy(t, 'snapshot.missingCount', { count: missingCount })
    : staleCount > 0
      ? rotationCopy(t, 'snapshot.staleCount', { count: staleCount })
      : rotationCopy(t, 'snapshot.complete');
  return `${participation} · ${breadth} · ${correlation} · ${dataState}`;
}

function resolveRotationFamilyRollup(payload: MarketRotationRadarResponse): MarketRotationFamilyRollupItem[] {
  const summaryRollup = Array.isArray(payload.summary.rotationFamilyRollup) ? payload.summary.rotationFamilyRollup : [];
  if (summaryRollup.length) {
    return summaryRollup;
  }
  return Array.isArray(payload.consumerEvidenceSnapshot?.rotationFamilyRollup)
    ? payload.consumerEvidenceSnapshot.rotationFamilyRollup
    : [];
}

function mapDataStateLabel(t: RotationTranslate, theme: DataStateFields): string {
  const candidate = theme as MarketRotationTheme;
  if (isTaxonomyOnlyTheme(candidate)) {
    return rotationCopy(t, 'status.insufficientObservation');
  }
  if (
    resolveSignalType(candidate) === 'insufficient_evidence'
    || resolveEvidenceQuality(candidate) === 'insufficient'
  ) {
    return rotationCopy(t, 'status.insufficientObservation');
  }
  if (theme.isFallback || theme.freshness === 'fallback') {
    return rotationCopy(t, 'status.latestAvailable');
  }
  if (theme.isStale || theme.freshness === 'stale') {
    return rotationCopy(t, 'status.latestAvailable');
  }
  if (theme.freshness === 'delayed') {
    return rotationCopy(t, 'status.delayedAvailable');
  }
  if (theme.freshness === 'live') {
    return rotationCopy(t, 'status.live');
  }
  return rotationCopy(t, 'status.refreshing');
}

function formatConfidenceValue(confidence?: number | null): string {
  return formatRotationConfidenceValue(confidence);
}

function formatRelativeStrengthValue(value?: number | null): string {
  return formatRotationRelativeStrengthValue(value);
}

function themeSupportsQuantitativePrecision(theme?: MarketRotationTheme): theme is MarketRotationTheme {
  if (!theme || isTaxonomyOnlyTheme(theme)) {
    return false;
  }
  return !(
    theme.isFallback
    || theme.isStale
    || theme.isPartial
    || theme.freshness === 'fallback'
    || theme.freshness === 'stale'
    || theme.freshness === 'partial'
    || resolveSignalType(theme) === 'insufficient_evidence'
    || resolveEvidenceQuality(theme) === 'insufficient'
  );
}

function themeConfidenceSummary(t: RotationTranslate, theme?: MarketRotationTheme): string {
  if (!themeSupportsQuantitativePrecision(theme)) {
    return rotationCopy(t, 'gaps.signalPending');
  }
  return rotationCopy(t, 'labels.signalValue', { value: formatConfidenceValue(theme.confidence) });
}

function themeRelativeStrengthValue(theme?: MarketRotationTheme): number | null {
  return parseRotationMetric(theme?.relativeStrength?.averageRelativeStrengthPercent);
}

function themeHasUsefulFamilySignal(theme?: MarketRotationTheme): boolean {
  if (!theme || isTaxonomyOnlyTheme(theme)) {
    return false;
  }
  return resolveSignalType(theme) !== 'insufficient_evidence'
    && resolveEvidenceQuality(theme) !== 'insufficient'
    && theme.stage !== 'weak_or_no_signal'
    && hasPositiveKnownMetric(theme.rotationScore, theme.confidence);
}

function resolveFamilyThemes(item: MarketRotationFamilyRollupItem, themes: MarketRotationTheme[]): MarketRotationTheme[] {
  const ids = [...(item.themeIds || []), ...(item.leaderThemeIds || [])];
  if (!ids.length) {
    return [];
  }
  const seen = new Set<string>();
  const themeById = new Map(themes.map((theme) => [theme.id, theme]));
  return ids.reduce<MarketRotationTheme[]>((acc, id) => {
    const normalizedId = String(id || '').trim();
    if (!normalizedId || seen.has(normalizedId)) {
      return acc;
    }
    const theme = themeById.get(normalizedId);
    if (!theme) {
      return acc;
    }
    seen.add(normalizedId);
    acc.push(theme);
    return acc;
  }, []);
}

function buildRotationFamilyViews(t: RotationTranslate, payload: MarketRotationRadarResponse): RotationFamilyView[] {
  const rollup = resolveRotationFamilyRollup(payload);
  const themes = payload.themes || [];

  return rollup
    .map((item, index) => {
      const familyThemes = resolveFamilyThemes(item, themes);
      const familyName = String(item.familyName || item.familyId || rotationCopy(t, 'family.unnamed', { index: index + 1 })).trim();
      const familyKey = item.familyId
        || item.themeIds?.join('|')
        || item.leaderThemeIds?.join('|')
        || familyName;
      const signalThemeCount = parseRotationMetric(item.signalThemeCount) ?? familyThemes.filter(themeHasUsefulFamilySignal).length;
      const themeCount = parseRotationMetric(item.themeCount) ?? familyThemes.length;
      const averageRotationScore = parseRotationMetric(item.averageRotationScore);
      const averageConfidence = parseRotationMetric(item.averageConfidence);
      const hasUsefulSignal = familyThemes.some(themeHasUsefulFamilySignal)
        || signalThemeCount > 0
        || Boolean(
          item.themeFlowSignal?.themeFlowState
          && hasPositiveKnownMetric(averageRotationScore)
          && hasPositiveKnownMetric(averageConfidence),
        );
      const collapsedByDefault = !hasUsefulSignal && (
        familyThemes.length
          ? familyThemes.every((theme) => isTaxonomyOnlyTheme(theme) || resolveEvidenceQuality(theme) === 'insufficient' || theme.stage === 'weak_or_no_signal')
          : signalThemeCount <= 0
            && !hasPositiveKnownMetric(averageRotationScore)
            && !hasPositiveKnownMetric(averageConfidence)
      );
      return {
        familyKey,
        familyName,
        item,
        themeCount,
        signalThemeCount,
        averageRotationScore,
        averageConfidence,
        reasonLabels: themeFlowReasonLabels(t, item.themeFlowSignal),
        preview: sanitizeRotationText(
          item.themeFlowSignal?.explanation,
          collapsedByDefault
            ? rotationCopy(t, 'family.collapsedPreview', { family: familyName })
            : rotationCopy(t, 'family.observationPreview', { family: familyName }),
        ),
        collapsedByDefault,
        hasUsefulSignal,
      };
    })
    .sort((a, b) => {
      if (a.collapsedByDefault !== b.collapsedByDefault) {
        return a.collapsedByDefault ? 1 : -1;
      }
      if (a.hasUsefulSignal !== b.hasUsefulSignal) {
        return a.hasUsefulSignal ? -1 : 1;
      }
      if (b.signalThemeCount !== a.signalThemeCount) {
        return b.signalThemeCount - a.signalThemeCount;
      }
      const scoreCmp = compareNullableDesc(a.averageRotationScore, b.averageRotationScore);
      if (scoreCmp !== 0) {
        return scoreCmp;
      }
      const confidenceCmp = compareNullableDesc(a.averageConfidence, b.averageConfidence);
      if (confidenceCmp !== 0) {
        return confidenceCmp;
      }
      if (b.themeCount !== a.themeCount) {
        return b.themeCount - a.themeCount;
      }
      return a.familyName.localeCompare(b.familyName, 'zh-Hans-CN');
    });
}

function isObservationTheme(theme?: MarketRotationTheme): theme is MarketRotationTheme {
  if (!theme || isTaxonomyOnlyTheme(theme)) {
    return false;
  }
  return theme.rankingLane === 'observation'
    || theme.observationOnly === true
    || theme.headlineEligible === false
    || resolveEvidenceQuality(theme) === 'degraded_proxy'
    || resolveEvidenceQuality(theme) === 'observation_only';
}

function observationStateLabel(t: RotationTranslate, theme?: MarketRotationTheme): string | null {
  if (!isObservationTheme(theme)) {
    return null;
  }
  const signalType = resolveSignalType(theme);
  if (signalType === 'relative_strength' || signalType === 'momentum_proxy' || resolveEvidenceQuality(theme) === 'degraded_proxy') {
    return rotationCopy(t, 'observation.comparisonSample');
  }
  return rotationCopy(t, 'observation.signal');
}

function observationDirectionCue(t: RotationTranslate, theme?: MarketRotationTheme): {
  indicator: '↑' | '↓' | '→';
  label: string;
  changeText: string;
} | null {
  if (!isObservationTheme(theme)) {
    return null;
  }

  const strength = themeRelativeStrengthValue(theme);
  const benchmark = String(theme?.relativeStrength?.benchmark || theme?.benchmark || '').trim();
  const benchmarkPrefix = benchmark ? rotationCopy(t, 'observation.relativeBenchmark', { benchmark }) : '';

  if (strength !== null) {
    if (strength >= 0.5) {
      return { indicator: '↑', label: rotationCopy(t, 'observation.warming'), changeText: `${benchmarkPrefix}${formatRelativeStrengthValue(strength)}` };
    }
    if (strength <= -0.5) {
      return { indicator: '↓', label: rotationCopy(t, 'observation.cooling'), changeText: `${benchmarkPrefix}${formatRelativeStrengthValue(strength)}` };
    }
    return { indicator: '→', label: rotationCopy(t, 'observation.flat'), changeText: `${benchmarkPrefix}${formatRelativeStrengthValue(strength)}` };
  }

  if (theme?.stage === 'cooling_watch' || theme?.stage === 'weak_or_no_signal') {
    return { indicator: '↓', label: rotationCopy(t, 'observation.cooling'), changeText: rotationCopy(t, 'observation.directionPending') };
  }

  if (theme?.stage === 'early_watch' || theme?.stage === 'extended_watch' || theme?.stage === 'confirmed_rotation') {
    return { indicator: '↑', label: rotationCopy(t, 'observation.warming'), changeText: rotationCopy(t, 'observation.directionPending') };
  }

  return { indicator: '→', label: rotationCopy(t, 'observation.flat'), changeText: rotationCopy(t, 'observation.directionPending') };
}

function observationThemeSummary(t: RotationTranslate, theme?: MarketRotationTheme): string | null {
  const stateLabel = observationStateLabel(t, theme);
  const directionCue = observationDirectionCue(t, theme);
  const items = [stateLabel, directionCue?.label].filter(Boolean);
  return items.length ? items.join(' · ') : null;
}

function themeSupportsVisualMatrix(theme?: MarketRotationTheme): theme is MarketRotationTheme {
  if (!themeSupportsQuantitativePrecision(theme)) {
    return false;
  }
  return themeRelativeStrengthValue(theme) !== null && Boolean(theme.stage);
}

function deriveVisualMatrixThemes(themes: MarketRotationTheme[]): MarketRotationTheme[] {
  return themes.filter(themeSupportsVisualMatrix);
}

function deriveVisualStrengthDomain(themes: MarketRotationTheme[]): { min: number; max: number } {
  const values = themes
    .map((theme) => themeRelativeStrengthValue(theme))
    .filter((value): value is number => value !== null);

  if (!values.length) {
    return { min: -1, max: 1 };
  }

  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  if (min === max) {
    return { min: min - 1, max: max + 1 };
  }
  return { min, max };
}

function isInternalRotationIssue(value?: string | null): boolean {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return /provider|timeout|schema|debug|raw|trace|cache|quote|source|proxy|fallback|static|taxonomy|not_enough|unavailable|missing|insufficient|technical_indicators|fundamentals|earnings|optional_news/.test(normalized);
}

function sanitizeTradingActionWords(value: string): string {
  return value
    .replaceAll('买卖信号', '方向结论')
    .replaceAll('买卖建议', '投资建议')
    .replaceAll('买卖', '投资动作')
    .replace(/\brecommendations?\b/gi, 'research framing')
    .replace(/\brecommended\b/gi, 'research-framed')
    .replace(/\brecommend\b/gi, 'research frame');
}

function sanitizeRotationText(value?: string | null, fallback = ''): string {
  const text = String(value || '').trim();
  if (!text) return fallback;
  if (isInternalRotationIssue(text)) {
    return fallback;
  }
  return sanitizeTradingActionWords(sanitizeMarketGuidanceCopy(text, fallback));
}

function sanitizeRotationNotes(notes?: string[]): string[] {
  return (notes || []).reduce<string[]>((acc, note) => {
    const n = sanitizeRotationText(note, '');
    if (n && acc.indexOf(n) === -1) acc.push(n);
    return acc;
  }, []);
}

function isThemeStale(theme: DataStateFields): boolean {
  return Boolean(theme.isStale || theme.freshness === 'stale');
}

function deriveTopThemes(themes: MarketRotationTheme[], limit = TOP_THEME_LIMIT): MarketRotationTheme[] {
  return sortThemesByEvidenceDesc(themes).slice(0, limit);
}

function materializeSummaryTheme(item: MarketRotationSummaryItem, fullTheme?: MarketRotationTheme): MarketRotationTheme {
  const raw = item as Partial<MarketRotationTheme>;
  return {
    ...fullTheme,
    ...raw,
    id: item.id,
    name: item.name,
    rotationScore: item.rotationScore,
    confidence: item.confidence,
    stage: item.stage,
    riskLabels: item.riskLabels,
    riskExplanations: raw.riskExplanations || fullTheme?.riskExplanations || [],
    rankEligible: item.rankEligible,
    rankExclusionReason: item.rankExclusionReason,
    taxonomyOnly: item.taxonomyOnly,
    observationOnly: item.observationOnly,
    headlineEligible: item.headlineEligible,
    rankingLane: item.rankingLane,
    scoreContributionAllowed: item.scoreContributionAllowed,
    signalType: item.signalType,
    flowEvidenceType: item.flowEvidenceType,
    flowLanguageAllowed: item.flowLanguageAllowed,
    sourceAuthorityAllowed: item.sourceAuthorityAllowed,
    evidenceQuality: item.evidenceQuality,
    dataGaps: item.dataGaps,
    sourceTier: item.sourceTier,
    trustLevel: item.trustLevel,
    englishName: raw.englishName || fullTheme?.englishName || item.name,
    focus: raw.focus ?? fullTheme?.focus,
    benchmark: raw.benchmark || fullTheme?.benchmark || '',
    sectorBenchmark: raw.sectorBenchmark ?? fullTheme?.sectorBenchmark,
    membersConfigured: Array.isArray(raw.membersConfigured)
      ? raw.membersConfigured
      : fullTheme?.membersConfigured || [],
    newslessRotation: raw.newslessRotation ?? fullTheme?.newslessRotation ?? false,
    relativeStrength: raw.relativeStrength || fullTheme?.relativeStrength || {},
    volume: raw.volume || fullTheme?.volume || {},
    breadth: raw.breadth || fullTheme?.breadth || {},
    synchronization: raw.synchronization || fullTheme?.synchronization || {},
    leadership: raw.leadership || fullTheme?.leadership || {},
    themeDetail: raw.themeDetail || fullTheme?.themeDetail,
    freshness: item.freshness,
    isFallback: item.isFallback,
    source: raw.source || fullTheme?.source,
    sourceLabel: raw.sourceLabel ?? fullTheme?.sourceLabel,
    asOf: raw.asOf ?? fullTheme?.asOf,
    updatedAt: raw.updatedAt ?? fullTheme?.updatedAt,
    evidence: Array.isArray(raw.evidence) ? raw.evidence : fullTheme?.evidence || [],
    members: Array.isArray(raw.members) ? raw.members : fullTheme?.members || [],
    noAdviceDisclosure: raw.noAdviceDisclosure || fullTheme?.noAdviceDisclosure || '',
    themeFlowSignal: raw.themeFlowSignal || fullTheme?.themeFlowSignal,
  };
}

function resolveSummaryThemes(themes: MarketRotationTheme[], summaryItems: MarketRotationSummaryItem[]): MarketRotationTheme[] {
  const themeById = new Map(themes.map((theme) => [theme.id, theme]));
  const seen = new Set<string>();
  return summaryItems
    .map((item) => materializeSummaryTheme(item, themeById.get(item.id)))
    .filter((theme) => {
      if (!theme.id || seen.has(theme.id)) {
        return false;
      }
      seen.add(theme.id);
      return true;
    });
}

function hasObservationThemeData(theme: MarketRotationTheme): boolean {
  if (isTaxonomyOnlyTheme(theme)) {
    return false;
  }
  const hasMatrixFields = themeRelativeStrengthValue(theme) !== null && Boolean(theme.stage);
  const hasScoreOrConfidence = parseRotationMetric(theme.rotationScore) !== null
    || parseRotationMetric(theme.confidence) !== null;
  const hasUsableSignal = hasMatrixFields
    || hasScoreOrConfidence
    || Boolean(theme.themeFlowSignal?.breadthEvidence || theme.themeFlowSignal?.relativeStrengthEvidence);
  // Partial evidence is kept when any usable metric exists; missing score alone is not full unavailability.
  return hasUsableSignal
    && (theme.rankingLane === 'observation' || theme.observationOnly === true || theme.headlineEligible === false);
}

function resolveObservationSummaryThemes(payload: MarketRotationRadarResponse): MarketRotationTheme[] {
  const summaryThemes = resolveSummaryThemes(payload.themes || [], payload.summary.observationThemes || []);
  return summaryThemes.filter(hasObservationThemeData).slice(0, TOP_THEME_LIMIT);
}

function deriveWeakeningThemes(themes: MarketRotationTheme[]): MarketRotationTheme[] {
  return [...themes]
    .filter((theme) => {
      const score = parseRotationMetric(theme.rotationScore);
      return theme.stage === 'cooling_watch'
        || theme.stage === 'weak_or_no_signal'
        || (score !== null && score < 50);
    })
    .sort((a, b) => {
      const scoreCmp = compareNullableAsc(
        parseRotationMetric(a.rotationScore),
        parseRotationMetric(b.rotationScore),
      );
      if (scoreCmp !== 0) {
        return scoreCmp;
      }
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN')
        || String(a.id || '').localeCompare(String(b.id || ''));
    })
    .slice(0, 4);
}

function matchesSearch(theme: MarketRotationTheme, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const haystack = [
    theme.name,
    theme.englishName,
    theme.focus,
    theme.benchmark,
    theme.sectorBenchmark,
    ...(theme.membersConfigured || []),
    ...(theme.mappedConcepts || []),
    ...(theme.representativeLabels || []),
    ...(theme.representativeSymbols || []),
    ...(theme.leadership?.topMembers || []).map((member) => `${member.symbol} ${member.name || ''}`),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(normalized);
}

function marketLabel(t: RotationTranslate, market: string): string {
  const option = MARKET_OPTIONS.find((candidate) => candidate.id === market);
  return option ? rotationCopy(t, option.labelKey) : market;
}

function rotationScoreEligibleCount(payload: MarketRotationRadarResponse): number {
  return (payload.etfLeadershipDiagnostics?.evidence || []).filter((row) => row.scoreContributionAllowed === true).length;
}

function isRotationLibraryMode(payload: MarketRotationRadarResponse): boolean {
  const themes = payload.themes || [];
  return themes.length > 0 && themes.every(isTaxonomyOnlyTheme);
}

function isConfirmedRealFlowLeader(theme: MarketRotationTheme): boolean {
  return !isTaxonomyOnlyTheme(theme)
    && resolveSignalType(theme) === 'real_flow'
    && theme.flowLanguageAllowed === true
    && resolveEvidenceQuality(theme) === 'score_grade_real_flow'
    && (theme.stage === 'confirmed_rotation' || theme.stage === 'extended_watch');
}

function isCandidateWatchTheme(theme: MarketRotationTheme, confirmedIds: Set<string>): boolean {
  const signalType = resolveSignalType(theme);
  return !isTaxonomyOnlyTheme(theme)
    && !confirmedIds.has(theme.id)
    && (theme.stage === 'confirmed_rotation' || theme.stage === 'early_watch' || theme.stage === 'extended_watch')
    && (signalType === 'relative_strength' || signalType === 'momentum_proxy')
    && resolveEvidenceQuality(theme) !== 'insufficient';
}

function deriveRotationTiers(payload: MarketRotationRadarResponse): RotationTierView {
  const themes = payload.themes || [];
  const confirmedLeaders = deriveTopThemes(themes.filter(isConfirmedRealFlowLeader), 3);
  const confirmedIds = new Set(confirmedLeaders.map((theme) => theme.id));
  const summaryObservationThemes = resolveObservationSummaryThemes(payload);
  return {
    libraryMode: isRotationLibraryMode(payload),
    confirmedLeaders,
    candidateThemes: summaryObservationThemes.length
      ? summaryObservationThemes.slice(0, 3)
      : deriveTopThemes(themes.filter((theme) => isCandidateWatchTheme(theme, confirmedIds)), 3),
    coolingThemes: deriveWeakeningThemes(themes).filter((theme) => !isTaxonomyOnlyTheme(theme)).slice(0, 3),
    taxonomyThemes: themes.filter(isTaxonomyOnlyTheme).slice(0, 3),
  };
}

function derivePrimaryDisplayThemes(
  payload: MarketRotationRadarResponse,
  tiers = deriveRotationTiers(payload),
): MarketRotationTheme[] {
  if (tiers.confirmedLeaders.length) {
    return tiers.confirmedLeaders;
  }
  if (tiers.candidateThemes.length) {
    return tiers.candidateThemes;
  }
  return [];
}

function primaryDisplayMode(tiers?: RotationTierView | null): RotationPrimaryDisplayMode {
  if (!tiers) {
    return 'unavailable';
  }
  if (tiers.libraryMode) {
    return 'taxonomy';
  }
  if (tiers.confirmedLeaders.length) {
    return 'headline';
  }
  if (tiers.candidateThemes.length) {
    return 'observation';
  }
  return 'unavailable';
}

function primaryDisplayLabel(t: RotationTranslate, mode: RotationPrimaryDisplayMode): string {
  switch (mode) {
    case 'headline':
      return rotationCopy(t, 'primary.headline');
    case 'observation':
      return rotationCopy(t, 'primary.observation');
    case 'taxonomy':
      return rotationCopy(t, 'primary.taxonomy');
    default:
      return rotationCopy(t, 'gaps.signalPending');
  }
}

function primaryDisplayDetail(t: RotationTranslate, mode: RotationPrimaryDisplayMode): string {
  if (mode === 'headline') {
    return rotationCopy(t, 'primary.headlineDetail');
  }
  if (mode === 'observation') {
    return rotationCopy(t, 'primary.observationDetail');
  }
  if (mode === 'taxonomy') {
    return rotationCopy(t, 'primary.taxonomyDetail');
  }
  return rotationCopy(t, 'primary.unavailableDetail');
}

function deriveRotationDecisionState(
  payload: MarketRotationRadarResponse,
  tiers = deriveRotationTiers(payload),
): DecisionReadinessState {
  const confirmedCount = tiers.confirmedLeaders.length;
  const candidateCount = tiers.candidateThemes.length;
  const scoreEligibleCount = rotationScoreEligibleCount(payload);

  if (confirmedCount > 0 && scoreEligibleCount > 0 && !payload.isFallback && !payload.isStale) {
    return 'ready';
  }
  if (tiers.libraryMode || payload.isFallback || payload.isStale || payload.themes.length === 0) {
    return 'unavailable';
  }
  if (candidateCount > 0 || scoreEligibleCount > 0) {
    return 'observe';
  }
  return 'unavailable';
}

function deriveConclusionScopeThemes(
  payload: MarketRotationRadarResponse,
  tiers = deriveRotationTiers(payload),
): MarketRotationTheme[] {
  const scopeThemes = resolveSummaryThemes(payload.themes || [], payload.summary.strongestThemes || []);
  const primaryThemes = derivePrimaryDisplayThemes(payload, tiers);
  return primaryThemes.length ? primaryThemes : scopeThemes.length ? scopeThemes : payload.themes || [];
}

function hasBreadthEvidence(themes: MarketRotationTheme[]): boolean {
  return themes.some((theme) => Number.isFinite(Number(theme.breadth?.percentUp)) && Number(theme.breadth?.percentUp) > 0);
}

function deriveMissingEvidence(
  t: RotationTranslate,
  payload: MarketRotationRadarResponse,
  tiers = deriveRotationTiers(payload),
  summaryThemes = deriveConclusionScopeThemes(payload, tiers),
): string[] {
  const missing = [
    payload.themes.length === 0 ? rotationCopy(t, 'missing.comparableSamples') : '',
    tiers.libraryMode ? rotationCopy(t, 'missing.observationWindows') : '',
    tiers.libraryMode ? rotationCopy(t, 'missing.memberCoverage') : '',
    tiers.confirmedLeaders.length === 0 ? rotationCopy(t, 'missing.confirmedSignals') : '',
    rotationScoreEligibleCount(payload) === 0 ? rotationCopy(t, 'missing.scoringEligibility') : '',
    !hasBreadthEvidence(summaryThemes) || tiers.confirmedLeaders.length === 0 ? rotationCopy(t, 'missing.breadth') : '',
    payload.isFallback ? rotationCopy(t, 'missing.recentData') : '',
    payload.isStale ? rotationCopy(t, 'missing.recentData') : '',
    ...summaryThemes.reduce<string[]>((acc, theme) => {
      for (const gap of themeDataGaps(theme).slice(0, 2)) {
        acc.push(formatGapLabel(t, gap));
      }
      return acc;
    }, []),
  ];
  return uniqueReadinessItems(
    missing,
    5,
    tiers.confirmedLeaders.length ? rotationCopy(t, 'missing.none') : rotationCopy(t, 'missing.default'),
  );
}

function deriveRotationConclusion(
  t: RotationTranslate,
  payload: MarketRotationRadarResponse,
  tiers = deriveRotationTiers(payload),
): RotationConclusionView {
  const state = deriveRotationDecisionState(payload, tiers);
  const summaryThemes = deriveConclusionScopeThemes(payload, tiers);
  const missingEvidence = deriveMissingEvidence(t, payload, tiers, summaryThemes);
  const themeScope = tiers.libraryMode ? rotationCopy(t, 'conclusion.taxonomyScope') : rotationCopy(t, 'conclusion.scope');

  if (state === 'ready') {
    return {
      state,
      title: rotationCopy(t, 'status.strengthReadable'),
      detail: rotationCopy(t, 'conclusion.readyDetail'),
      whyNotConclusion: rotationCopy(t, 'conclusion.readyWhy'),
      missingEvidence,
      nextStep: rotationCopy(t, 'conclusion.readyNextStep'),
      variant: 'success',
    };
  }

  if (state === 'observe') {
    return {
      state,
      title: rotationCopy(t, 'gaps.signalPending'),
      detail: rotationCopy(t, 'conclusion.observeDetail'),
      whyNotConclusion: rotationCopy(t, 'conclusion.observeWhy', { scope: themeScope }),
      missingEvidence,
      nextStep: tiers.libraryMode
        ? rotationCopy(t, 'conclusion.taxonomyNextStep')
        : rotationCopy(t, 'conclusion.observeNextStep'),
      variant: 'info',
    };
  }

  return {
    state,
    title: rotationCopy(t, 'status.directionPending'),
    detail: rotationCopy(t, 'conclusion.unavailableDetail'),
    whyNotConclusion: tiers.libraryMode || payload.themes.length === 0
      ? rotationCopy(t, 'conclusion.unavailableWhyEmpty', { scope: themeScope })
      : rotationCopy(t, 'conclusion.unavailableWhy', { scope: themeScope }),
    missingEvidence,
    nextStep: tiers.libraryMode
      ? rotationCopy(t, 'conclusion.taxonomyNextStep')
      : rotationCopy(t, 'conclusion.unavailableNextStep'),
    variant: 'danger',
  };
}

function rotationGuidance(t: RotationTranslate, payload: MarketRotationRadarResponse): {
  title: string;
  detail: string;
  variant: 'neutral' | 'info' | 'caution' | 'danger' | 'success';
} {
  const tiers = deriveRotationTiers(payload);
  const conclusion = deriveRotationConclusion(t, payload, tiers);

  if (tiers.libraryMode) {
    return {
      title: conclusion.title,
      detail: conclusion.detail,
      variant: 'caution',
    };
  }

  if (tiers.confirmedLeaders.length) {
    return {
      title: conclusion.title,
      detail: conclusion.detail,
      variant: 'success',
    };
  }

  if (tiers.candidateThemes.length) {
    return {
      title: conclusion.title,
      detail: conclusion.detail,
      variant: 'info',
    };
  }

  return {
    title: conclusion.title,
    detail: conclusion.detail,
    variant: 'danger',
  };
}

function uniqueReadinessItems(items: Array<string | null | undefined>, limit: number, fallback: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  items.forEach((item) => {
    const value = String(item || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    result.push(value);
  });
  return result.length ? result.slice(0, limit) : [fallback];
}

function buildRotationDecisionReadiness(t: RotationTranslate, payload: MarketRotationRadarResponse): DecisionReadinessSummary {
  const tiers = deriveRotationTiers(payload);
  const conclusion = deriveRotationConclusion(t, payload, tiers);
  const state = conclusion.state;

  return {
    state,
    stateLabel: consumerStatusLabel(t, state, payload),
    stateVariant: decisionReadinessVariant(state),
    qualityLabel: consumerConfidenceLabel(t, state),
    blockers: [consumerFreshnessLabel(t, payload.freshness, payload.isFallback, payload.isStale)],
    nextEvidence: [consumerSufficiencyLabel(t, state)],
    conclusion: state === 'ready'
      ? rotationCopy(t, 'readiness.readyConclusion')
      : state === 'observe'
        ? consumerConfidenceLabel(t, state)
        : consumerSufficiencyLabel(t, state),
  };
}

function themeNamesSummary(language: RotationLanguage, themes: MarketRotationTheme[], fallback: string): string {
  return themes.length ? themes.map((theme) => themePresentationName(language, theme)).join(' / ') : fallback;
}

function deriveCapitalRotationSummary(t: RotationTranslate, language: RotationLanguage, payload: MarketRotationRadarResponse): CapitalRotationSummaryView {
  const {
    libraryMode,
    confirmedLeaders,
    candidateThemes,
    coolingThemes,
    taxonomyThemes,
  } = deriveRotationTiers(payload);
  const conclusion = deriveRotationConclusion(t, payload, {
    libraryMode,
    confirmedLeaders,
    candidateThemes,
    coolingThemes,
    taxonomyThemes,
  });
  const modeLabel = conclusion.title;
  const modeDetail = conclusion.whyNotConclusion;
  const observationThemes = candidateThemes.length ? candidateThemes : taxonomyThemes;

  return {
    modeLabel,
    modeDetail,
    cards: [
      {
        key: 'confirmed',
        label: rotationCopy(t, 'labels.rotationDirection'),
        value: themeNamesSummary(language, confirmedLeaders, rotationCopy(t, 'summary.noConfirmedThemes')),
        detail: confirmedLeaders.length ? rotationCopy(t, 'summary.confirmedDetail') : rotationCopy(t, 'sufficiency.unavailable'),
        variant: confirmedLeaders.length ? 'success' : 'caution',
      },
      {
        key: 'candidate',
        label: taxonomyThemes.length && !candidateThemes.length ? rotationCopy(t, 'primary.taxonomy') : rotationCopy(t, 'observation.signal'),
        value: themeNamesSummary(language, observationThemes, taxonomyThemes.length ? rotationCopy(t, 'summary.noTaxonomyItems') : rotationCopy(t, 'summary.noObservationThemes')),
        detail: observationThemes.length ? rotationCopy(t, 'confidence.observe') : rotationCopy(t, 'sufficiency.observe'),
        variant: observationThemes.length ? 'info' : 'neutral',
      },
      {
        key: 'cooling',
        label: rotationCopy(t, 'summary.cooling'),
        value: themeNamesSummary(language, coolingThemes, rotationCopy(t, 'summary.noCoolingThemes')),
        detail: coolingThemes.length ? rotationCopy(t, 'summary.coolingDetail') : rotationCopy(t, 'summary.noCoolingDetail'),
        variant: coolingThemes.length ? 'caution' : 'neutral',
      },
    ],
  };
}

const RotationVisualPanel: React.FC<{
  themes: MarketRotationTheme[];
  selectedThemeId?: string;
  marketLabelText: string;
  displayMode: RotationPrimaryDisplayMode;
  unavailableReason: string;
  unavailableDetail: string;
  onSelectTheme: (themeId: string) => void;
}> = ({ themes, selectedThemeId, marketLabelText, displayMode, unavailableReason, unavailableDetail, onSelectTheme }) => {
  const { language, t } = useI18n();
  const visualThemes = deriveVisualMatrixThemes(themes);
  const modeLabel = primaryDisplayLabel(t, displayMode);
  const modeDetail = primaryDisplayDetail(t, displayMode);

  if (!visualThemes.length) {
    return (
      <TerminalPanel data-testid="rotation-radar-visual-unavailable" className="overflow-hidden">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={cn('text-[10px] font-medium tracking-[0.22em]', ROTATION_PAPER_TEXT_MUTED_CLASS)}>{rotationCopy(t, 'visual.relativeStrengthMatrix')}</p>
            <h3 className={cn('mt-2 text-lg font-semibold', ROTATION_PAPER_TEXT_PRIMARY_CLASS)}>{rotationCopy(t, 'visual.matrixUnavailable')}</h3>
            <p className={cn('mt-2 max-w-3xl text-sm leading-6', ROTATION_PAPER_TEXT_SECONDARY_CLASS)}>{unavailableReason}</p>
            <p className={cn('mt-2 text-[11px] leading-5', ROTATION_PAPER_TEXT_MUTED_CLASS)}>{unavailableDetail}</p>
          </div>
          <span className="shrink-0 rounded-md border border-[color:var(--wolfy-divider)] px-2.5 py-1 text-[11px] text-[color:var(--wolfy-text-muted)]">{rotationCopy(t, 'gaps.signalPending')}</span>
        </div>
      </TerminalPanel>
    );
  }

  const domain = deriveVisualStrengthDomain(visualThemes);
  const rankingThemes = deriveTopThemes(visualThemes, 6);

  return (
    <TerminalPanel data-testid="rotation-radar-visual-matrix" className="overflow-hidden">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn('text-[10px] font-medium tracking-[0.22em]', ROTATION_PAPER_TEXT_MUTED_CLASS)}>{rotationCopy(t, 'visual.relativeStrengthMatrix')}</p>
          <h3 className={cn('mt-2 text-lg font-semibold', ROTATION_PAPER_TEXT_PRIMARY_CLASS)}>{rotationCopy(t, 'visual.rankingAndStages')}</h3>
          <p className={cn('mt-2 max-w-4xl text-sm leading-6', ROTATION_PAPER_TEXT_SECONDARY_CLASS)}>
            {modeDetail}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <span className="rounded-md border border-[color:var(--wolfy-divider)] px-2.5 py-1 text-[11px] text-[color:var(--wolfy-text-muted)]">{modeLabel}</span>
          <span className="rounded-md border border-[color:var(--wolfy-divider)] px-2.5 py-1 text-[11px] text-[color:var(--wolfy-text-muted)]">{marketLabelText}</span>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(22rem,0.9fr)]">
        <div className={cn('min-w-0 p-3', ROTATION_PAPER_PANEL_CLASS)}>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <p className={cn('text-[11px] font-medium', ROTATION_PAPER_TEXT_MUTED_CLASS)}>{rotationCopy(t, 'visual.matrixView')}</p>
              <p className={cn('mt-1 text-[11px] leading-5', ROTATION_PAPER_TEXT_SECONDARY_CLASS)}>
                {rotationCopy(t, 'visual.matrixDescription')}
              </p>
            </div>
            <span className={cn('shrink-0 text-[10px]', ROTATION_PAPER_TEXT_MUTED_CLASS)}>
              {formatRelativeStrengthValue(domain.min)} - {formatRelativeStrengthValue(domain.max)}
            </span>
          </div>
          <div className="mt-4 overflow-x-auto no-scrollbar">
            <div className="min-w-[17.5rem] sm:min-w-[20rem]">
              {ROTATION_MATRIX_STAGE_ORDER.map((stageMeta) => {
                const stageThemes = visualThemes.filter((theme) => theme.stage === stageMeta.key);
                return (
                  <div key={stageMeta.key} className="grid grid-cols-[3.75rem_minmax(0,1fr)] items-stretch gap-2 border-t border-[color:var(--wolfy-divider)] py-2 first:border-t-0 first:pt-0 last:pb-0 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:gap-3">
                    <div className={cn('flex items-center text-[11px] font-medium', ROTATION_PAPER_TEXT_MUTED_CLASS)}>{rotationCopy(t, stageMeta.label)}</div>
                    <div className="relative h-12 rounded-lg border border-[color:var(--wolfy-divider)] bg-[color:color-mix(in_srgb,var(--wolfy-surface-rail)_70%,transparent)]">
                      <div className="absolute inset-y-2 left-1/2 w-px bg-[color:var(--wolfy-divider)]" aria-hidden="true" />
                      {stageThemes.map((theme) => {
                        const strength = themeRelativeStrengthValue(theme);
                        const geometry = matrixGeometryPosition({
                          evidenceValue: strength,
                          domain,
                        });
                        const directionCue = observationDirectionCue(t, theme);
                        const strengthLabel = formatRelativeStrengthValue(geometry.evidenceValue);
                        const bubbleVariant = selectedThemeId === theme.id
                          ? 'border-[color:color-mix(in_srgb,var(--wolfy-accent)_36%,transparent)] bg-[color:color-mix(in_srgb,var(--wolfy-accent)_12%,transparent)] text-[color:var(--wolfy-text-primary)]'
                          : 'border-[color:var(--wolfy-divider)] bg-[color:color-mix(in_srgb,var(--wolfy-surface-console)_78%,transparent)] text-[color:var(--wolfy-text-secondary)] hover:bg-[color:color-mix(in_srgb,var(--wolfy-surface-console)_94%,transparent)]';
                        return (
                          <button
                            key={theme.id}
                            type="button"
                            data-testid={`rotation-radar-matrix-point-${theme.id}`}
                            data-geometry-fallback={geometry.usesGeometryFallback ? 'true' : 'false'}
                            className={cn(
                              'absolute top-1/2 inline-flex h-7 -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border px-2 text-[10px] transition-colors',
                              bubbleVariant,
                            )}
                            style={{ left: `${geometry.leftPct}%` }}
                            onClick={() => onSelectTheme(theme.id)}
                            aria-label={`${themePresentationName(language, theme)} ${observationThemeSummary(t, theme) || formatThemeStage(t, theme.stage)} ${directionCue?.changeText || strengthLabel}`}
                          >
                            <span className="max-w-[5rem] truncate sm:max-w-[6.5rem]">{themePresentationName(language, theme)}</span>
                            <span className={ROTATION_PAPER_TEXT_MUTED_CLASS}>
                              {directionCue ? `${directionCue.indicator} ${strengthLabel}` : strengthLabel}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <div className={cn('mt-3 flex items-center justify-between px-[3.75rem] text-[10px] sm:px-[4.5rem]', ROTATION_PAPER_TEXT_MUTED_CLASS)}>
                <span>{rotationCopy(t, 'visual.weaker')}</span>
                <span>{rotationCopy(t, 'visual.benchmark')}</span>
                <span>{rotationCopy(t, 'visual.stronger')}</span>
              </div>
            </div>
          </div>
        </div>

        <div className={cn('min-w-0 p-3', ROTATION_PAPER_PANEL_CLASS)}>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <p className={cn('text-[11px] font-medium', ROTATION_PAPER_TEXT_MUTED_CLASS)}>{rotationCopy(t, 'visual.themeRanking')}</p>
              <p className={cn('mt-1 text-[11px] leading-5', ROTATION_PAPER_TEXT_SECONDARY_CLASS)}>
                {rotationCopy(t, 'visual.rankingDescription')}
              </p>
            </div>
            <TerminalChip variant="neutral">Top {rankingThemes.length}</TerminalChip>
          </div>
          <div className="mt-4 space-y-2">
            {rankingThemes.map((theme, index) => {
              const geometryWidth = scoreBarGeometryWidth(theme.rotationScore);
              const scoreLabel = formatRotationScore(theme.rotationScore);
              const observationSummary = observationThemeSummary(t, theme);
              const selected = selectedThemeId === theme.id;
              return (
                <button
                  key={theme.id}
                  type="button"
                  data-testid={`rotation-radar-ranking-bar-${theme.id}`}
                  data-score-available={geometryWidth !== null ? 'true' : 'false'}
                  className={cn(
                    'block w-full rounded-lg border border-[color:var(--wolfy-divider)] bg-[color:color-mix(in_srgb,var(--wolfy-surface-console)_82%,transparent)] p-2 text-left transition-colors',
                    selected ? 'bg-[color:color-mix(in_srgb,var(--wolfy-accent)_12%,transparent)]' : 'hover:bg-[color:color-mix(in_srgb,var(--wolfy-surface-console)_96%,transparent)]',
                  )}
                  onClick={() => onSelectTheme(theme.id)}
                >
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={cn('text-[10px] font-medium', ROTATION_PAPER_TEXT_MUTED_CLASS)}>{String(index + 1).padStart(2, '0')}</span>
                        <span className={cn('truncate text-sm font-semibold', ROTATION_PAPER_TEXT_PRIMARY_CLASS)}>{themePresentationName(language, theme)}</span>
                      </div>
                      <p className={cn('mt-1 truncate text-[10px]', ROTATION_PAPER_TEXT_MUTED_CLASS)}>
                        {observationSummary
                          ? `${observationSummary} · ${themeConfidenceSummary(t, theme)}`
                          : `${formatThemeStage(t, theme.stage)} · ${themeConfidenceSummary(t, theme)}`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={cn('text-[11px] font-semibold', ROTATION_PAPER_TEXT_SECONDARY_CLASS)}>{scoreLabel}</p>
                      <p className={cn('text-[10px]', ROTATION_PAPER_TEXT_MUTED_CLASS)}>{formatRelativeStrengthValue(themeRelativeStrengthValue(theme))}</p>
                    </div>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-[color:var(--wolfy-divider)]">
                    {geometryWidth !== null ? (
                      <div
                        className={cn(
                          'h-full rounded-full',
                          selected ? 'bg-[color:var(--wolfy-accent)]' : 'bg-[color:color-mix(in_srgb,var(--wolfy-text-secondary)_78%,transparent)]',
                        )}
                        style={{ width: `${geometryWidth}%` }}
                      />
                    ) : (
                      <div
                        className="h-full w-2 rounded-full bg-[color:color-mix(in_srgb,var(--wolfy-text-muted)_35%,transparent)]"
                        data-testid={`rotation-radar-ranking-bar-unavailable-${theme.id}`}
                        aria-hidden="true"
                      />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </TerminalPanel>
  );
};

const ConsumerDisclosure: React.FC<{
  testId: string;
  title: string;
  summary: string;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ testId, title, summary, defaultOpen = false, className, children }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      data-testid={testId}
      data-terminal-primitive="disclosure"
      className={cn(
        'rounded-lg border border-[color:var(--wolfy-border-subtle)] bg-[var(--wolfy-surface-input)] px-2.5 py-2 text-xs transition-colors hover:border-[color:var(--wolfy-divider)]',
        className,
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-xs font-medium text-[color:var(--wolfy-text-secondary)]">{title}</h3>
          <p className="mt-0.5 truncate text-[11px] text-[color:var(--wolfy-text-muted)]">{summary}</p>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? rotationCopy(t, 'controls.collapse') : rotationCopy(t, 'controls.expand')} ${title}`}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[color:var(--wolfy-border-subtle)] bg-transparent px-2 py-1 text-[11px] text-[color:var(--wolfy-text-secondary)] hover:text-[color:var(--wolfy-text-primary)]"
          onClick={() => setOpen((current) => !current)}
        >
          <span>{open ? rotationCopy(t, 'controls.collapse') : rotationCopy(t, 'controls.expand')}</span>
        </button>
      </div>
      {open ? <div className="mt-2">{children}</div> : null}
    </div>
  );
};

const ThemeCorrelationBreadthSnapshotPanel: React.FC<{
  snapshot?: MarketRotationThemeCorrelationBreadthSnapshot | null;
}> = ({ snapshot }) => {
  const { t } = useI18n();
  if (!hasThemeCorrelationBreadthSnapshot(snapshot)) {
    return null;
  }

  const participationLabel = formatSnapshotState(
    t,
    snapshot.participationState,
    THEME_PARTICIPATION_LABEL_KEYS,
    'snapshot.participationMissing',
  );
  const leadershipLabel = formatSnapshotState(
    t,
    snapshot.leadershipConcentration?.state,
    THEME_LEADERSHIP_LABEL_KEYS,
    'leadership.unknown',
  );
  const correlationLabel = formatSnapshotState(
    t,
    snapshot.correlationEvidence?.state,
    THEME_CORRELATION_LABEL_KEYS,
    'correlation.missing',
  );
  const breadthLabel = formatSnapshotState(
    t,
    snapshot.breadthEvidence?.state,
    THEME_BREADTH_LABEL_KEYS,
    'breadth.missing',
  );
  const staleLabels = formatSnapshotInputLabels(t, snapshot.staleInputs, 'snapshot.noStale');
  const missingLabels = formatSnapshotInputLabels(t, snapshot.missingInputs, 'snapshot.noMissing');
  const boundaryLabels = formatSnapshotBoundaryLabels(t, snapshot.observationBoundary);
  const nextSteps = formatSnapshotNextSteps(t, snapshot.researchNextSteps);
  const topMembers = (snapshot.leadershipConcentration?.topMembers || [])
    .map((item) => sanitizeRotationText(item, rotationCopy(t, 'labels.member')))
    .filter(Boolean)
    .slice(0, 4);

  return (
    <ConsumerDisclosure
      testId="rotation-theme-correlation-breadth-snapshot"
      title={rotationCopy(t, 'snapshot.title')}
      summary={snapshotSummary(t, snapshot)}
    >
      <div className="grid gap-3 text-[11px] leading-5 text-[color:var(--wolfy-text-muted)]">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <TerminalChip variant={snapshot.participationState === 'broad_group' ? 'success' : snapshot.participationState === 'insufficient_evidence' ? 'caution' : 'info'}>
            {participationLabel}
          </TerminalChip>
          <TerminalChip variant={snapshot.leadershipConcentration?.state === 'concentrated' ? 'caution' : 'neutral'}>
            {leadershipLabel}
          </TerminalChip>
          <TerminalChip variant={snapshot.correlationEvidence?.state === 'aligned' ? 'success' : 'neutral'}>
            {correlationLabel}
          </TerminalChip>
          <TerminalChip variant={snapshot.breadthEvidence?.state === 'broad' ? 'success' : 'neutral'}>
            {breadthLabel}
          </TerminalChip>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="rounded-md border border-[color:var(--wolfy-border-subtle)] bg-[var(--wolfy-surface-rail)] px-2.5 py-2">
            <p className="font-semibold text-[color:var(--wolfy-text-secondary)]">{rotationCopy(t, 'snapshot.leadershipConcentration')}</p>
            <p className="mt-1">
              {leadershipLabel} · {formatSnapshotPercent(t, snapshot.leadershipConcentration?.percent)}
            </p>
            <p className="mt-1 text-[color:var(--wolfy-text-muted)]">
              {rotationCopy(t, 'snapshot.broadParticipation')} {formatSnapshotPercent(t, snapshot.leadershipConcentration?.broadParticipationPercent)}
            </p>
            {topMembers.length ? (
              <p className="mt-1 text-[color:var(--wolfy-text-muted)]">{rotationCopy(t, 'snapshot.representativeMembers', { members: topMembers.join('、') })}</p>
            ) : null}
          </div>
          <div className="rounded-md border border-[color:var(--wolfy-border-subtle)] bg-[var(--wolfy-surface-rail)] px-2.5 py-2">
            <p className="font-semibold text-[color:var(--wolfy-text-secondary)]">{rotationCopy(t, 'snapshot.correlation')}</p>
            <p className="mt-1">
              {rotationCopy(t, 'snapshot.memberSynchronization')} {formatSnapshotPercent(t, snapshot.correlationEvidence?.sameDirectionPercent)}
            </p>
            <p className="mt-1 text-[color:var(--wolfy-text-muted)]">
              {rotationCopy(t, 'snapshot.averageSynchronization')} {formatSnapshotPercent(t, snapshot.correlationEvidence?.aboveVwapPercent)}
            </p>
            <p className="mt-1 text-[color:var(--wolfy-text-muted)]">
              {rotationCopy(t, 'snapshot.persistence')} {formatSnapshotPercent(t, snapshot.correlationEvidence?.persistencePercent)}
            </p>
          </div>
          <div className="rounded-md border border-[color:var(--wolfy-border-subtle)] bg-[var(--wolfy-surface-rail)] px-2.5 py-2">
            <p className="font-semibold text-[color:var(--wolfy-text-secondary)]">{rotationCopy(t, 'snapshot.breadthEvidence')}</p>
            <p className="mt-1">
              {formatSnapshotMemberCount(t, snapshot.breadthEvidence?.observedMembers, snapshot.breadthEvidence?.configuredMembers)}
            </p>
            <p className="mt-1 text-[color:var(--wolfy-text-muted)]">
              {rotationCopy(t, 'snapshot.upBreadth')} {formatSnapshotPercent(t, snapshot.breadthEvidence?.percentUp)}
            </p>
            <p className="mt-1 text-[color:var(--wolfy-text-muted)]">
              {rotationCopy(t, 'snapshot.outperformingBreadth')} {formatSnapshotPercent(t, snapshot.breadthEvidence?.percentOutperformingBenchmark)}
            </p>
          </div>
          <div className="rounded-md border border-[color:var(--wolfy-border-subtle)] bg-[var(--wolfy-surface-rail)] px-2.5 py-2">
            <p className="font-semibold text-[color:var(--wolfy-text-secondary)]">{rotationCopy(t, 'snapshot.observationBoundary')}</p>
            <div className="mt-1 flex min-w-0 flex-wrap gap-1.5">
              {boundaryLabels.map((label) => <TerminalChip key={label}>{label}</TerminalChip>)}
            </div>
          </div>
        </div>

        <div className="grid gap-2">
          <div>
            <p className="font-semibold text-[color:var(--wolfy-text-secondary)]">{rotationCopy(t, 'labels.dataFreshness')}</p>
            <p className="mt-1">{staleLabels.join('、')}</p>
          </div>
          <div>
            <p className="font-semibold text-[color:var(--wolfy-text-secondary)]">{rotationCopy(t, 'snapshot.inputGaps')}</p>
            <p className="mt-1">{missingLabels.join('、')}</p>
          </div>
          <div>
            <p className="font-semibold text-[color:var(--wolfy-text-secondary)]">{rotationCopy(t, 'labels.continueObserving')}</p>
            <div className="mt-1 grid gap-1">
              {nextSteps.map((step, index) => (
                <p key={`snapshot-next-step-${index}`}>· {step}</p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </ConsumerDisclosure>
  );
};

const RotationFamilyRow: React.FC<{ view: RotationFamilyView }> = ({ view }) => {
  const { t } = useI18n();
  const signal = view.item.themeFlowSignal;
  const stateLabel = formatThemeFlowState(t, signal?.themeFlowState);
  const summary = [
    stateLabel,
    rotationCopy(t, 'family.signalThemeCount', { count: Math.max(0, view.signalThemeCount), total: Math.max(view.themeCount, 0) }),
    view.averageConfidence !== null ? rotationCopy(t, 'labels.signalValue', { value: formatThemeFlowConfidence(t, signal) }) : null,
    view.averageRotationScore !== null ? rotationCopy(t, 'family.averageScore', { score: Math.round(view.averageRotationScore) }) : null,
  ].filter(Boolean).join(' · ');

  return (
    <ConsumerDisclosure
      testId={`rotation-family-rollup-row-${view.familyKey}`}
      title={view.familyName}
      summary={summary || rotationCopy(t, 'family.observation')}
      className="bg-[var(--wolfy-surface-input)] px-3 py-2.5"
    >
      <div className="grid gap-3 text-[11px] leading-5 text-[color:var(--wolfy-text-muted)]">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <TerminalChip variant={themeFlowChipVariant(signal?.themeFlowState)}>
            {stateLabel}
          </TerminalChip>
          <TerminalChip variant={view.hasUsefulSignal ? 'info' : 'neutral'}>
            {view.hasUsefulSignal ? rotationCopy(t, 'family.priorityObservation') : rotationCopy(t, 'family.lowSignal')}
          </TerminalChip>
          {view.reasonLabels.map((label) => <TerminalChip key={`${view.familyKey}-${label}`}>{label}</TerminalChip>)}
        </div>
        <p>{view.preview}</p>
        <div className="grid gap-1 text-[10px] leading-5 text-[color:var(--wolfy-text-muted)]">
          {themeFlowEvidenceLines(t, signal).map((line, lineIndex) => (
            <p key={`${view.familyKey}-family-flow-evidence-${lineIndex}`}>{line}</p>
          ))}
        </div>
      </div>
    </ConsumerDisclosure>
  );
};

const RotationEvidenceBoundaryStrip: React.FC<{ payload: MarketRotationRadarResponse }> = ({ payload }) => {
  const { t } = useI18n();
  const view = buildMarketRotationEvidenceBoundaryView(payload, t);

  return (
    <div
      data-testid="rotation-evidence-boundary"
      className="mt-3 rounded-lg border border-[color:var(--wolfy-border-subtle)] bg-[var(--wolfy-surface-rail)] px-3 py-2.5"
    >
      <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-[color:var(--wolfy-text-muted)]">{rotationCopy(t, 'labels.evidenceBoundary')}</p>
          <p className="mt-1 text-sm font-semibold text-[color:var(--wolfy-text-primary)]">{view.label}</p>
          {view.note ? <p className="mt-1 text-[11px] leading-5 text-[color:var(--wolfy-text-muted)]">{view.note}</p> : null}
        </div>
        <div className="flex min-w-0 flex-wrap gap-1.5 md:justify-end">
          <TerminalChip variant={view.variant}>{view.label}</TerminalChip>
          {view.chips.map((chip) => (
            <TerminalChip key={chip.key} variant={chip.variant}>{chip.label}</TerminalChip>
          ))}
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-[color:var(--wolfy-text-muted)]">{view.nextEvidence}</p>
    </div>
  );
};

const RotationGuidancePanel: React.FC<{ payload: MarketRotationRadarResponse }> = ({ payload }) => {
  const { language, t } = useI18n();
  const tiers = deriveRotationTiers(payload);
  const guidance = rotationGuidance(t, payload);
  const conclusion = deriveRotationConclusion(t, payload, tiers);
  const decisionSummary = buildRotationDecisionReadiness(t, payload);
  const alpacaReadiness = buildAlpacaQuoteAuthorityReadinessView(payload.alpacaQuoteAuthorityReadiness, t);
  const capitalSummary = deriveCapitalRotationSummary(t, language, payload);
  const primaryThemes = derivePrimaryDisplayThemes(payload, tiers);
  const selectedTheme = primaryThemes[0];
  const topThemeTitle = tiers.libraryMode
    ? rotationCopy(t, 'labels.taxonomyReference')
    : themeNamesSummary(language, primaryThemes, rotationCopy(t, 'status.insufficientObservation'));
  const surfaceState = decisionSummary.state === 'ready'
    ? rotationCopy(t, 'status.strengthReadable')
    : decisionSummary.state === 'observe'
      ? rotationCopy(t, 'gaps.signalPending')
      : rotationCopy(t, 'status.directionPending');
  const heroTitle = themePresentationName(language, selectedTheme) || topThemeTitle;
  const heroSummary = selectedTheme
    ? sanitizeRotationText(
      selectedTheme.stageExplanation,
      decisionSummary.state === 'ready'
        ? rotationCopy(t, 'hero.readySummary', { theme: themePresentationName(language, selectedTheme) })
        : decisionSummary.state === 'observe'
          ? rotationCopy(t, 'hero.pendingSummary', { theme: themePresentationName(language, selectedTheme) })
          : rotationCopy(t, 'hero.dataMissingSummary', { theme: themePresentationName(language, selectedTheme) }),
    )
    : guidance.detail;
  const heroCards = [
    {
      key: 'market',
      label: rotationCopy(t, 'labels.currentMarket'),
      value: marketLabel(t, payload.market || 'US'),
      detail: tiers.libraryMode ? rotationCopy(t, 'hero.taxonomyMarketDetail') : rotationCopy(t, 'hero.marketDetail'),
    },
    {
      key: 'signal',
      label: rotationCopy(t, 'labels.rotationDirection'),
      value: selectedTheme ? themeConsumerStateLabel(t, selectedTheme) : surfaceState,
      detail: selectedTheme
        ? (selectedTheme.riskExplanations?.length ? rotationCopy(t, 'hero.riskDetail') : rotationCopy(t, 'hero.signalDetail'))
        : rotationCopy(t, 'hero.noConfirmedDetail'),
    },
    {
      key: 'confidence',
      label: rotationCopy(t, 'labels.dataStatus'),
      value: selectedTheme
        ? mapDataStateLabel(t, selectedTheme)
        : rotationCopy(t, 'status.insufficientObservation'),
      detail: selectedTheme
        ? consumerFreshnessLabel(t, selectedTheme.freshness, selectedTheme.isFallback, isThemeStale(selectedTheme))
        : consumerFreshnessLabel(t, payload.freshness, payload.isFallback, payload.isStale),
    },
  ];
  const familyViews = buildRotationFamilyViews(t, payload);
  const spotlightFamilies = familyViews.filter((view) => !view.collapsedByDefault);
  const collapsedFamilies = familyViews.filter((view) => view.collapsedByDefault);

  return (
    <TerminalPanel
      data-testid="rotation-radar-guidance"
      className="relative overflow-hidden"
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[color:var(--wolfy-divider)] to-transparent" aria-hidden="true" />
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn('text-[10px] font-medium tracking-[0.24em]', ROTATION_PAPER_TEXT_MUTED_CLASS)}>{rotationCopy(t, 'labels.statusSummary')}</p>
          <h2
            data-testid="rotation-radar-hero-title"
            className={cn('mt-2 break-words text-base font-semibold leading-6 md:text-lg', ROTATION_PAPER_TEXT_PRIMARY_CLASS)}
          >
            {rotationCopy(t, 'hero.strengthTitle', { theme: heroTitle })}
          </h2>
          <p className={cn('mt-2 max-w-4xl text-sm leading-6', ROTATION_PAPER_TEXT_SECONDARY_CLASS)}>{heroSummary}</p>
        </div>
        <span className="shrink-0 rounded-md border border-[color:var(--wolfy-divider)] px-2.5 py-1 text-[11px] text-[color:var(--wolfy-text-muted)]">
          {rotationCopy(t, 'hero.directionTitle', { state: surfaceState })}
        </span>
      </div>

      <div data-testid="rotation-radar-summary-band" data-terminal-primitive="panel" className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-3">
        {heroCards.map((card) => (
          <div key={card.key} className={cn('p-3', ROTATION_PAPER_SOFT_PANEL_CLASS)}>
            <p className={cn('text-[11px] font-medium', ROTATION_PAPER_TEXT_MUTED_CLASS)}>{card.label}</p>
            <p className={cn('mt-2 break-words text-sm font-semibold leading-5', ROTATION_PAPER_TEXT_PRIMARY_CLASS)}>{card.value}</p>
            <p className={cn('mt-2 text-[11px] leading-5', ROTATION_PAPER_TEXT_SECONDARY_CLASS)}>{card.detail}</p>
          </div>
        ))}
      </div>

      <RotationEvidenceBoundaryStrip payload={payload} />

      <div
        data-testid="rotation-alpaca-quote-readiness"
        className={cn('mt-3 px-3 py-2.5', ROTATION_PAPER_SOFT_PANEL_CLASS)}
      >
        <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className={cn('text-[11px] font-medium', ROTATION_PAPER_TEXT_MUTED_CLASS)}>{rotationCopy(t, 'labels.etfReferenceStatus')}</p>
            <p className={cn('mt-1 text-sm font-semibold', ROTATION_PAPER_TEXT_PRIMARY_CLASS)}>{alpacaReadiness.label}</p>
            <p className={cn('mt-1 text-[11px] leading-5', ROTATION_PAPER_TEXT_MUTED_CLASS)}>{alpacaReadiness.detail}</p>
          </div>
          <div className="flex min-w-0 flex-wrap gap-1.5 md:justify-end">
            {alpacaReadiness.chips.map((chip) => (
              <TerminalChip key={chip.key} variant={chip.variant}>{chip.label}</TerminalChip>
            ))}
          </div>
        </div>
        {alpacaReadiness.summaryItems.length ? (
          <div className={cn('mt-3 flex min-w-0 flex-wrap gap-1.5 text-[11px] leading-5', ROTATION_PAPER_TEXT_MUTED_CLASS)}>
            {alpacaReadiness.summaryItems.map((item) => (
              <span key={item} className="rounded-md border border-[color:var(--wolfy-divider)] bg-[color:color-mix(in_srgb,var(--wolfy-surface-console)_78%,transparent)] px-2 py-0.5">
                {item}
              </span>
            ))}
          </div>
        ) : null}
        {alpacaReadiness.familyRows.length ? (
          <div className="mt-3 grid gap-2 lg:grid-cols-3">
            {alpacaReadiness.familyRows.map((family) => (
              <div key={family.key} className={cn('min-w-0 p-2', ROTATION_PAPER_PANEL_CLASS)}>
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <p className={cn('text-[11px] font-medium', ROTATION_PAPER_TEXT_SECONDARY_CLASS)}>{family.label}</p>
                  <TerminalChip variant={family.variant}>{family.statusLabel}</TerminalChip>
                </div>
                <p className={cn('mt-1 text-[11px] leading-5', ROTATION_PAPER_TEXT_MUTED_CLASS)}>{family.countsLabel}</p>
                <p className={cn('text-[11px] leading-5', ROTATION_PAPER_TEXT_MUTED_CLASS)}>{family.scoringLabel}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {familyViews.length ? (
        <div
          data-testid="rotation-family-flow-rollup"
          className={cn('mt-4 px-3 py-3', ROTATION_PAPER_PANEL_CLASS)}
        >
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={cn('text-[11px] font-medium', ROTATION_PAPER_TEXT_MUTED_CLASS)}>{rotationCopy(t, 'family.flowObservation')}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <span className="rounded-md border border-[color:var(--wolfy-divider)] px-2.5 py-1 text-[11px] text-[color:var(--wolfy-text-muted)]">{rotationCopy(t, 'family.summaryFirst')}</span>
              <span className="rounded-md border border-[color:var(--wolfy-divider)] px-2.5 py-1 text-[11px] text-[color:var(--wolfy-text-muted)]">
                {rotationCopy(t, 'family.priorityCount', { count: spotlightFamilies.length })}
              </span>
              {collapsedFamilies.length ? (
                <span className="rounded-md border border-[color:var(--wolfy-divider)] px-2.5 py-1 text-[11px] text-[color:var(--wolfy-text-muted)]">
                  {rotationCopy(t, 'family.collapsedCount', { count: collapsedFamilies.length })}
                </span>
              ) : null}
            </div>
          </div>
          {spotlightFamilies.length ? (
            <div className="mt-3 max-h-72 overflow-y-auto no-scrollbar">
              <DenseRows>
                {spotlightFamilies.map((view) => (
                  <RotationFamilyRow key={view.familyKey} view={view} />
                ))}
              </DenseRows>
            </div>
          ) : (
            <div className={cn('mt-3 rounded-lg border border-dashed border-[color:var(--wolfy-divider)] px-3 py-3 text-[11px] leading-5', ROTATION_PAPER_TEXT_MUTED_CLASS)}>
              {rotationCopy(t, 'family.noPriority')}
            </div>
          )}
          {collapsedFamilies.length ? (
            <ConsumerDisclosure
              testId="rotation-family-rollup-collapsed"
              title={rotationCopy(t, 'family.viewLowSignal')}
              summary={rotationCopy(t, 'family.collapsedCount', { count: collapsedFamilies.length })}
              className="mt-3 bg-[var(--wolfy-surface-input)]"
            >
              <div className="grid gap-2">
                {collapsedFamilies.map((view) => (
                  <div
                    key={view.familyKey}
                    data-testid={`rotation-family-rollup-collapsed-row-${view.familyKey}`}
                    className="rounded-lg border border-[color:var(--wolfy-border-subtle)] bg-[var(--wolfy-surface-rail)] px-3 py-2.5"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <p className="min-w-0 text-sm font-semibold text-[color:var(--wolfy-text-primary)]">{view.familyName}</p>
                      <TerminalChip variant="neutral">{formatThemeFlowState(t, view.item.themeFlowSignal?.themeFlowState)}</TerminalChip>
                      <span className="text-[10px] text-[color:var(--wolfy-text-muted)]">{rotationCopy(t, 'family.signalThemeCount', { count: Math.max(0, view.signalThemeCount), total: Math.max(view.themeCount, 0) })}</span>
                    </div>
                    <p className="mt-1 text-[11px] leading-5 text-[color:var(--wolfy-text-muted)]">{view.preview}</p>
                  </div>
                ))}
              </div>
            </ConsumerDisclosure>
          ) : null}
        </div>
      ) : null}

      <ConsumerDisclosure
        testId="rotation-radar-mechanics-details"
        title={rotationCopy(t, 'disclosures.rotationExplanation')}
        summary={rotationCopy(t, 'disclosures.collapsedByDefault')}
        className="mt-4 bg-[var(--wolfy-surface-input)]"
      >
        <div className="grid gap-3 text-[11px] leading-5 text-[color:var(--wolfy-text-muted)]">
          <div>
            <p className="font-semibold text-[color:var(--wolfy-text-secondary)]">{rotationCopy(t, 'disclosures.directionExplanation')}</p>
            <p className="mt-1">{conclusion.whyNotConclusion}</p>
          </div>
          <div>
            <p className="font-semibold text-[color:var(--wolfy-text-secondary)]">{rotationCopy(t, 'disclosures.visibleScope')}</p>
            <p className="mt-1">{capitalSummary.cards.map((card) => `${card.label}: ${card.value}`).join(' · ')}</p>
          </div>
          <div>
            <p className="font-semibold text-[color:var(--wolfy-text-secondary)]">{rotationCopy(t, 'labels.continueObserving')}</p>
            <p className="mt-1">{conclusion.missingEvidence.join('、')}</p>
          </div>
        </div>
      </ConsumerDisclosure>
    </TerminalPanel>
  );
};

const CommandBar: React.FC<{
  selectedMarket: string;
  supportedMarkets: string[];
  searchQuery: string;
  onMarketChange: (market: string) => void;
  onSearchChange: (value: string) => void;
  loading: boolean;
  freshness?: MarketRotationRadarResponse['freshness'];
  onRefresh: () => void;
}> = ({ selectedMarket, supportedMarkets, searchQuery, onMarketChange, onSearchChange, loading, freshness, onRefresh }) => (
  <CommandBarContent
    selectedMarket={selectedMarket}
    supportedMarkets={supportedMarkets}
    searchQuery={searchQuery}
    onMarketChange={onMarketChange}
    onSearchChange={onSearchChange}
    loading={loading}
    freshness={freshness}
    onRefresh={onRefresh}
  />
);

const CommandBarContent: React.FC<{
  selectedMarket: string;
  supportedMarkets: string[];
  searchQuery: string;
  onMarketChange: (market: string) => void;
  onSearchChange: (value: string) => void;
  loading: boolean;
  freshness?: MarketRotationRadarResponse['freshness'];
  onRefresh: () => void;
}> = ({ selectedMarket, supportedMarkets, searchQuery, onMarketChange, onSearchChange, loading, freshness, onRefresh }) => {
  const { t } = useI18n();
  return <WolfyCommandBar
    data-testid="rotation-radar-mode-controls"
    className="min-h-[104px] gap-y-2 sm:min-h-[88px] lg:min-h-11"
    leading={(
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase text-[color:var(--wolfy-text-muted)]">
          <SlidersHorizontal className="size-3.5 text-[color:var(--wolfy-text-muted)]" aria-hidden="true" />
          {rotationCopy(t, 'labels.market')}
        </div>
        <div className="flex min-w-0 gap-2 overflow-x-auto no-scrollbar">
          {MARKET_OPTIONS.reduce<React.ReactNode[]>((acc, market) => {
            if (!supportedMarkets.length || supportedMarkets.includes(market.id)) {
              acc.push(
                <TerminalButton
                  key={market.id}
                  type="button"
                  variant="compact"
                  data-testid={`rotation-market-tab-${market.id}`}
                  aria-pressed={selectedMarket === market.id}
                  className={cn(
                    'shrink-0',
                    selectedMarket === market.id
                      ? 'border-[color:var(--wolfy-border-subtle)] bg-[var(--wolfy-surface-rail)] text-[color:var(--wolfy-text-primary)] hover:bg-[var(--overlay-hover)] hover:text-[color:var(--wolfy-text-primary)]'
                      : 'text-[color:var(--wolfy-text-muted)] hover:border-[color:var(--wolfy-border-subtle)] hover:bg-[var(--wolfy-surface-rail)] hover:text-[color:var(--wolfy-text-secondary)]',
                  )}
                  onClick={() => onMarketChange(market.id)}
                >
                  {rotationCopy(t, market.labelKey)}
                </TerminalButton>,
              );
            }
            return acc;
          }, [])}
        </div>
      </div>
    )}
    trailing={(
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <TerminalNestedBlock data-testid="rotation-radar-freshness" className="inline-flex items-center gap-2 px-3 py-2">
          <span className="text-[10px] font-bold uppercase text-[color:var(--wolfy-text-muted)]">{rotationCopy(t, 'labels.lastUpdated')}</span>
          <DataFreshnessBadge freshness={freshness || 'fallback'} />
        </TerminalNestedBlock>
        <TerminalButton
          variant="compact"
          className="size-10 rounded-xl p-0 text-[color:var(--wolfy-text-muted)] disabled:cursor-wait disabled:text-[color:var(--wolfy-text-muted)]"
          onClick={onRefresh}
          disabled={loading}
          aria-label={rotationCopy(t, 'controls.refreshRadar')}
        >
          <RefreshCcw className={cn('size-4', loading ? 'animate-spin' : '')} aria-hidden="true" />
        </TerminalButton>
      </div>
    )}
  >
    <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:gap-2">
      <label className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[color:var(--wolfy-text-muted)]" aria-hidden="true" />
        <input
          className="h-10 w-full rounded-lg border border-[color:var(--wolfy-border-subtle)] bg-[var(--wolfy-surface-input)] py-2 pl-9 pr-3 text-sm text-[color:var(--wolfy-text-secondary)] outline-none transition-all placeholder:text-[color:var(--wolfy-text-muted)] focus:border-[color:var(--sage)] focus:bg-[var(--wolfy-surface-rail)]"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={rotationCopy(t, 'controls.searchPlaceholder')}
          aria-label={rotationCopy(t, 'controls.searchPlaceholder')}
        />
      </label>
      <div
        data-testid="rotation-taxonomy-mode-note"
        className="inline-flex min-h-8 shrink-0 items-center gap-2 rounded-md border border-[color:var(--wolfy-border-subtle)] bg-[var(--wolfy-surface-rail)] px-2.5 text-[11px] text-[color:var(--wolfy-text-muted)]"
      >
        <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase text-[color:var(--wolfy-text-muted)]">
          <Gauge className="size-3.5 text-[color:var(--wolfy-text-muted)]" aria-hidden="true" />
          {rotationCopy(t, 'labels.taxonomy')}
        </div>
        <span>{rotationCopy(t, 'controls.taxonomyNote')}</span>
      </div>
    </div>
  </WolfyCommandBar>;
};

function themeConsumerStateLabel(t: RotationTranslate, theme: MarketRotationTheme): string {
  if (isTaxonomyOnlyTheme(theme)) {
    return rotationCopy(t, 'labels.taxonomyReference');
  }
  if (
    resolveSignalType(theme) === 'insufficient_evidence'
    || resolveEvidenceQuality(theme) === 'insufficient'
  ) {
    return rotationCopy(t, 'status.insufficientObservation');
  }
  return formatThemeStage(t, theme.stage);
}

const LeaderRow: React.FC<{
  theme: MarketRotationTheme;
  marketLabelText: string;
  selected: boolean;
  onSelect: () => void;
}> = ({ theme, marketLabelText, selected, onSelect }) => {
  const { language, t } = useI18n();
  const listSummary = observationThemeSummary(t, theme) || consumerThemeSubtitle(t, theme);
  return (
    <button
      type="button"
      data-testid={`rotation-radar-leader-row-${theme.id}`}
      onClick={onSelect}
      className={cn(
        'grid w-full min-w-0 grid-cols-[minmax(0,1fr)_5.5rem_6.25rem] items-center gap-2 p-3 text-left transition-colors',
        selected ? 'bg-[var(--wolfy-surface-rail)]' : 'hover:bg-[var(--wolfy-surface-rail)]',
      )}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-[color:var(--wolfy-text-primary)]">{themePresentationName(language, theme)}</span>
        <span className="mt-1 block truncate text-[11px] text-[color:var(--wolfy-text-muted)]">{listSummary}</span>
      </span>
      <span className="truncate text-right text-[11px] font-semibold text-[color:var(--wolfy-text-secondary)]">{themeConsumerStateLabel(t, theme)}</span>
      <span className="text-right">
        <span className="block truncate text-[11px] font-semibold text-[color:var(--wolfy-text-secondary)]">{themeConfidenceSummary(t, theme)}</span>
        <span className="block truncate text-[10px] text-[color:var(--wolfy-text-muted)]">{marketLabelText} · {mapDataStateLabel(t, theme)}</span>
      </span>
    </button>
  );
};

const CompactThemeRow: React.FC<{
  theme: MarketRotationTheme;
  marketLabelText: string;
  selected: boolean;
  onSelect: () => void;
}> = ({ theme, marketLabelText, selected, onSelect }) => {
  const { language, t } = useI18n();
  const listSummary = observationThemeSummary(t, theme) || consumerThemeSubtitle(t, theme);
  return (
    <button
      type="button"
      data-testid={`rotation-radar-universe-row-${theme.id}`}
      onClick={onSelect}
      className={cn(
        'grid w-full min-w-0 grid-cols-[minmax(0,1fr)_5.5rem_6.25rem] items-center gap-2 px-3 py-2.5 text-left text-xs transition-colors',
        selected ? 'bg-[var(--wolfy-surface-rail)]' : 'hover:bg-[var(--wolfy-surface-rail)]',
      )}
    >
      <span className="min-w-0">
        <span className="block truncate font-semibold text-[color:var(--wolfy-text-secondary)]">{themePresentationName(language, theme)}</span>
        <span className="block truncate text-[10px] text-[color:var(--wolfy-text-muted)]">{listSummary}</span>
      </span>
      <span className="truncate text-right text-[11px] text-[color:var(--wolfy-text-muted)]">{themeConsumerStateLabel(t, theme)}</span>
      <span className="text-right">
        <span className="block truncate text-[10px] font-semibold text-[color:var(--wolfy-text-secondary)]">{themeConfidenceSummary(t, theme)}</span>
        <span className="block truncate text-[10px] text-[color:var(--wolfy-text-muted)]">{marketLabelText} · {mapDataStateLabel(t, theme)}</span>
      </span>
    </button>
  );
};

const ThemeDetailPanel: React.FC<{
  theme?: MarketRotationTheme;
  marketLabelText: string;
  libraryMode: boolean;
}> = ({ theme, marketLabelText, libraryMode }) => {
  const { language, t } = useI18n();
  if (!theme) {
    return null;
  }

  const taxonomyOnly = isTaxonomyOnlyTheme(theme) || libraryMode;
  const dataWarning = Boolean(theme.isFallback || theme.freshness === 'fallback' || isThemeStale(theme));
  const observationState = observationStateLabel(t, theme);
  const directionCue = observationDirectionCue(t, theme);
  const evidenceNotes = sanitizeRotationNotes(theme.evidence);
  const riskExplanationNotes = sanitizeRotationNotes(theme.riskExplanations);
  const weaknessNotes = uniqueReadinessItems(
    [
      ...riskExplanationNotes,
      ...themeDataGaps(theme).map((gap) => formatGapLabel(t, gap)),
      taxonomyOnly ? rotationCopy(t, 'detail.taxonomyWeakness') : '',
      dataWarning ? rotationCopy(t, 'detail.delayedWeakness') : '',
    ],
    3,
    taxonomyOnly ? rotationCopy(t, 'detail.taxonomyWeakness') : rotationCopy(t, 'detail.defaultWeakness'),
  );
  const supportNotes = uniqueReadinessItems(
    [
      ...evidenceNotes,
      sanitizeRotationText(theme.stageExplanation, ''),
      theme.persistenceEvidence?.label ? rotationCopy(t, 'detail.persistenceIncluded', { label: theme.persistenceEvidence.label }) : '',
    ],
    3,
    taxonomyOnly ? rotationCopy(t, 'detail.taxonomySupport') : rotationCopy(t, 'detail.defaultSupport'),
  );
  const representativeItems = (theme.themeDetail?.representativeLabels || theme.representativeLabels || theme.membersConfigured || []).slice(0, 4);
  const nextWatch = theme.alertCandidates?.[0];
  const shortReason = sanitizeRotationText(
    theme.stageExplanation,
    taxonomyOnly
      ? rotationCopy(t, 'detail.taxonomyReason', { theme: themePresentationName(language, theme) })
      : observationState && directionCue
        ? rotationCopy(t, 'detail.observationReason', { state: observationState, direction: directionCue.label, detail: directionCue.changeText })
      : dataWarning
        ? rotationCopy(t, 'detail.fallbackReason', { theme: themePresentationName(language, theme) })
        : rotationCopy(t, 'detail.defaultReason', { theme: themePresentationName(language, theme) }),
  );
  const nextStep = nextWatch?.symbol
    ? rotationCopy(t, 'detail.alertNextStep', { symbol: nextWatch.symbol, theme: themePresentationName(language, theme) })
    : taxonomyOnly
      ? rotationCopy(t, 'detail.taxonomyNextStep')
      : rotationCopy(t, 'detail.defaultNextStep');

  return (
    <ConsoleContextRail data-testid="rotation-theme-detail-panel" className="xl:sticky xl:top-4">
      <div className="min-w-0 px-1 py-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={cn('text-[10px] font-bold uppercase', ROTATION_PAPER_TEXT_MUTED_CLASS)}>{rotationCopy(t, 'labels.currentTheme')}</p>
            <h2 className={cn('mt-1 truncate text-lg font-semibold', ROTATION_PAPER_TEXT_PRIMARY_CLASS)}>{themePresentationName(language, theme)}</h2>
            <p className={cn('mt-1 truncate text-[11px]', ROTATION_PAPER_TEXT_MUTED_CLASS)}>{consumerThemeSubtitle(t, theme)}</p>
          </div>
        </div>

        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-1.5">
          <TerminalChip variant={taxonomyOnly ? 'neutral' : dataWarning ? 'caution' : 'info'}>{themeConsumerStateLabel(t, theme)}</TerminalChip>
          {observationState ? <TerminalChip variant="neutral">{observationState}</TerminalChip> : null}
          {directionCue ? <TerminalChip variant="info">{directionCue.label}</TerminalChip> : null}
          <TerminalChip variant="neutral">{marketLabelText}</TerminalChip>
          <TerminalChip variant={dataWarning ? 'caution' : 'success'}>{mapDataStateLabel(t, theme)}</TerminalChip>
        </div>
      </div>

      <div className="min-w-0 px-1 py-3">
        <p className={cn('text-[10px] font-bold uppercase', ROTATION_PAPER_TEXT_MUTED_CLASS)}>{rotationCopy(t, 'labels.rotationDirection')}</p>
        <TerminalNotice variant={taxonomyOnly ? 'info' : dataWarning ? 'caution' : 'neutral'} className={cn('mt-2 text-[12px] leading-5', ROTATION_PAPER_TEXT_SECONDARY_CLASS)}>
          {shortReason}
        </TerminalNotice>
        {directionCue ? (
          <p className={cn('mt-2 text-[11px] leading-5', ROTATION_PAPER_TEXT_MUTED_CLASS)}>
            {rotationCopy(t, 'detail.directionCue', { detail: directionCue.changeText })}
          </p>
        ) : null}
      </div>

      <div className="min-w-0 px-1 py-3">
        <p className={cn('text-[10px] font-bold uppercase', ROTATION_PAPER_TEXT_MUTED_CLASS)}>{rotationCopy(t, 'labels.divergence')}</p>
        <div className={cn('mt-2 grid gap-1 text-[11px] leading-5', ROTATION_PAPER_TEXT_SECONDARY_CLASS)}>
          {weaknessNotes.map((item) => <p key={item}>· {item}</p>)}
        </div>
      </div>

      <div className="min-w-0 px-1 py-3">
        <p className={cn('text-[10px] font-bold uppercase', ROTATION_PAPER_TEXT_MUTED_CLASS)}>{rotationCopy(t, 'labels.observationFocus')}</p>
        <p className={cn('mt-2 text-[11px] leading-5', ROTATION_PAPER_TEXT_SECONDARY_CLASS)}>{nextStep}</p>
      </div>

      <div className="min-w-0 px-1 py-3">
        <p className={cn('text-[10px] font-bold uppercase', ROTATION_PAPER_TEXT_MUTED_CLASS)}>{rotationCopy(t, 'labels.observationInstruments')}</p>
        <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
          {representativeItems.length
            ? representativeItems.map((item) => <TerminalChip key={item}>{item}</TerminalChip>)
            : <TerminalChip>{rotationCopy(t, 'labels.pending')}</TerminalChip>}
        </div>
      </div>

      {theme.themeFlowSignal ? (
        <div className="min-w-0 px-1 py-3">
          <ConsumerDisclosure
            testId="rotation-theme-flow-signal"
            title={rotationCopy(t, 'disclosures.themeFlow')}
            summary={rotationCopy(t, 'disclosures.themeFlowSummary')}
          >
            <div className={cn('grid gap-3 text-[11px] leading-5', ROTATION_PAPER_TEXT_SECONDARY_CLASS)}>
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <TerminalChip variant={themeFlowChipVariant(theme.themeFlowSignal.themeFlowState)}>
                  {formatThemeFlowState(t, theme.themeFlowSignal.themeFlowState)}
                </TerminalChip>
                <TerminalChip variant="neutral">{rotationCopy(t, 'labels.signalValue', { value: formatThemeFlowConfidence(t, theme.themeFlowSignal) })}</TerminalChip>
              </div>
              <div>
                <p className={cn('font-semibold', ROTATION_PAPER_TEXT_PRIMARY_CLASS)}>{rotationCopy(t, 'labels.explanation')}</p>
                <p className="mt-1">
                  {sanitizeRotationText(
                    theme.themeFlowSignal.explanation,
                    rotationCopy(t, 'detail.themeFlowFallback', { theme: themePresentationName(language, theme) }),
                  )}
                </p>
              </div>
              <div>
                <p className={cn('font-semibold', ROTATION_PAPER_TEXT_PRIMARY_CLASS)}>{rotationCopy(t, 'labels.supportingEvidence')}</p>
                <div className="mt-1 grid gap-1">
                  {themeFlowEvidenceLines(t, theme.themeFlowSignal).map((line, lineIndex) => (
                    <p key={`${theme.id}-theme-flow-evidence-${lineIndex}`}>· {line}</p>
                  ))}
                </div>
              </div>
              {themeFlowReasonLabels(t, theme.themeFlowSignal).length ? (
                <div>
                  <p className="font-semibold text-[color:var(--wolfy-text-secondary)]">{rotationCopy(t, 'labels.observationItems')}</p>
                  <div className="mt-1 flex min-w-0 flex-wrap gap-1.5">
                    {themeFlowReasonLabels(t, theme.themeFlowSignal).map((label) => <TerminalChip key={`${theme.id}-${label}`}>{label}</TerminalChip>)}
                  </div>
                </div>
              ) : null}
            </div>
          </ConsumerDisclosure>
        </div>
      ) : null}

      {hasThemeCorrelationBreadthSnapshot(theme.themeCorrelationBreadthSnapshot) ? (
        <div className="min-w-0 px-1 py-3">
          <ThemeCorrelationBreadthSnapshotPanel snapshot={theme.themeCorrelationBreadthSnapshot} />
        </div>
      ) : null}

      <div className="min-w-0 px-1 py-3">
        <ConsumerDisclosure
          testId="rotation-theme-data-notes"
          title={rotationCopy(t, 'disclosures.dataNotes')}
          summary={rotationCopy(t, 'disclosures.dataNotesSummary')}
        >
          <div className={cn('grid gap-3 text-[11px] leading-5', ROTATION_PAPER_TEXT_SECONDARY_CLASS)}>
            <div>
              <p className={cn('font-semibold', ROTATION_PAPER_TEXT_PRIMARY_CLASS)}>{rotationCopy(t, 'labels.supportingEvidence')}</p>
              <div className="mt-1 grid gap-1">
                {supportNotes.map((item) => <p key={item}>· {item}</p>)}
              </div>
            </div>
            <div>
              <p className={cn('font-semibold', ROTATION_PAPER_TEXT_PRIMARY_CLASS)}>{rotationCopy(t, 'labels.methodology')}</p>
              <p className="mt-1">
                {taxonomyOnly
                  ? rotationCopy(t, 'detail.taxonomyMethodology')
                  : rotationCopy(t, 'detail.defaultMethodology')}
              </p>
            </div>
          </div>
        </ConsumerDisclosure>
      </div>
    </ConsoleContextRail>
  );
};

const LoadingPanel: React.FC<{ showFallback: boolean; onRefresh: () => void }> = ({ showFallback, onRefresh }) => {
  const { t } = useI18n();
  return <TerminalPanel as="section" role="status" aria-label={rotationCopy(t, 'loading.ariaLabel')}>
    <div className={cn('flex items-center gap-3', ROTATION_PAPER_TEXT_SECONDARY_CLASS)}>
      <RefreshCcw className="size-4 animate-spin" aria-hidden="true" />
      <span className="text-sm">{rotationCopy(t, 'loading.title')}</span>
    </div>
    <div className={cn('mt-4 grid gap-3 text-sm', ROTATION_PAPER_TEXT_SECONDARY_CLASS)}>
      <p className="leading-6">{rotationCopy(t, 'loading.preparing')}</p>
      <p className="leading-6">{rotationCopy(t, 'loading.ready')}</p>
      <TerminalNotice variant="info" className={cn('text-[12px] leading-5', ROTATION_PAPER_TEXT_SECONDARY_CLASS)}>
        {rotationCopy(t, 'loading.noTemporaryDirection')}
      </TerminalNotice>
    </div>
    {showFallback ? (
      <TerminalNestedBlock
        data-testid="rotation-radar-loading-fallback"
        className="mt-4 border-amber-300/20 bg-amber-300/[0.04] p-3 text-sm"
      >
        <div className="font-semibold text-amber-100">{rotationCopy(t, 'loading.fallbackTitle')}</div>
        <p className="mt-2 leading-5 text-[color:var(--wolfy-text-secondary)]">
          {rotationCopy(t, 'loading.fallbackBody')}
        </p>
        <TerminalButton
          variant="compact"
          className="mt-3 border-amber-200/25 text-amber-100 hover:border-amber-100/40 hover:text-amber-50"
          onClick={onRefresh}
        >
          <RefreshCcw className="size-3.5" aria-hidden="true" />
          {rotationCopy(t, 'controls.reload')}
        </TerminalButton>
      </TerminalNestedBlock>
    ) : null}
  </TerminalPanel>;
};

function createRotationRadarTimeoutError(t: RotationTranslate): ParsedApiError {
  return createParsedApiError({
    title: rotationCopy(t, 'errors.timeoutTitle'),
    message: rotationCopy(t, 'errors.timeoutMessage'),
    category: 'upstream_timeout',
  });
}

interface RadarPageState {
  payload: MarketRotationRadarResponse | null;
  loading: boolean;
  loadingRequestId: number;
  error: ParsedApiError | null;
  selectedMarket: string;
  selectedThemeId: string;
  searchQuery: string;
}

type RadarPageAction =
  | { type: 'loadStarted'; requestId: number }
  | { type: 'loadSucceeded'; payload: MarketRotationRadarResponse }
  | { type: 'loadFailed'; error: ParsedApiError }
  | { type: 'selectMarket'; market: string }
  | { type: 'selectTheme'; themeId: string }
  | { type: 'setSearchQuery'; searchQuery: string };

const initialRadarPageState: RadarPageState = {
  payload: null,
  loading: true,
  loadingRequestId: 0,
  error: null,
  selectedMarket: DEFAULT_MARKET,
  selectedThemeId: '',
  searchQuery: '',
};

function radarPageReducer(state: RadarPageState, action: RadarPageAction): RadarPageState {
  switch (action.type) {
    case 'loadStarted':
      return {
        ...state,
        payload: null,
        loading: true,
        loadingRequestId: action.requestId,
        error: null,
        selectedThemeId: '',
      };
    case 'loadSucceeded':
      return {
        ...state,
        payload: action.payload,
        loading: false,
        error: null,
        selectedThemeId: action.payload.themes[0]?.id || '',
        searchQuery: '',
      };
    case 'loadFailed':
      return {
        ...state,
        loading: false,
        error: action.error,
      };
    case 'selectMarket':
      return {
        ...state,
        selectedMarket: action.market,
      };
    case 'selectTheme':
      return {
        ...state,
        selectedThemeId: action.themeId,
      };
    case 'setSearchQuery':
      return {
        ...state,
        searchQuery: action.searchQuery,
      };
    default:
      return state;
  }
}

const MarketRotationRadarPage: React.FC = () => {
  const { t } = useI18n();
  const [state, dispatch] = useReducer(radarPageReducer, initialRadarPageState);
  const [showLoadingFallback, setShowLoadingFallback] = useState(false);
  const activeRequestIdRef = useRef(0);

  const loadRadar = async (market: string) => {
    const requestId = activeRequestIdRef.current + 1;
    activeRequestIdRef.current = requestId;
    dispatch({ type: 'loadStarted', requestId });
    let timeoutHandle: number | undefined;
    try {
      const payload = await Promise.race<MarketRotationRadarResponse>([
        marketRotationApi.getRotationRadar(market),
        new Promise<never>((_, reject) => {
          timeoutHandle = window.setTimeout(() => {
            reject(createRotationRadarTimeoutError(t));
          }, ROTATION_RADAR_ROUTE_TIMEOUT_MS);
        }),
      ]);
      if (requestId !== activeRequestIdRef.current) {
        return;
      }
      dispatch({ type: 'loadSucceeded', payload });
    } catch (nextError) {
      if (requestId !== activeRequestIdRef.current) {
        return;
      }
      const parsed = getParsedApiError(nextError);
      dispatch({
        type: 'loadFailed',
        error: parsed.title === rotationCopy(t, 'errors.timeoutTitle')
          ? parsed
          : { ...parsed, title: rotationCopy(t, 'errors.loadFailedTitle') },
      });
    } finally {
      if (timeoutHandle !== undefined) {
        window.clearTimeout(timeoutHandle);
      }
    }
  };

  useEffect(() => {
    queueMicrotask(() => {
      void loadRadar(DEFAULT_MARKET);
    });
    return () => {
      activeRequestIdRef.current += 1;
    };
  }, [t]);

  useEffect(() => {
    if (!state.loading || state.payload) {
      setShowLoadingFallback(false);
      return undefined;
    }
    setShowLoadingFallback(false);
    const fallbackHandle = window.setTimeout(() => {
      setShowLoadingFallback(true);
    }, ROTATION_RADAR_LOADING_FALLBACK_MS);
    return () => {
      window.clearTimeout(fallbackHandle);
    };
  }, [state.loading, state.loadingRequestId, state.payload]);

  const handleMarketChange = (market: string) => {
    if (market === state.selectedMarket) {
      return;
    }
    dispatch({ type: 'selectMarket', market });
    void loadRadar(market);
  };

  const handleRefresh = () => {
    void loadRadar(state.selectedMarket);
  };

  const rotationTiers = state.payload ? deriveRotationTiers(state.payload) : null;
  const displayMode = primaryDisplayMode(rotationTiers);
  const primaryThemes = state.payload && rotationTiers ? derivePrimaryDisplayThemes(state.payload, rotationTiers) : [];
  const filteredThemes = (state.payload?.themes || []).filter((theme) => matchesSearch(theme, state.searchQuery));
  const visualThemes = primaryThemes.length ? primaryThemes : filteredThemes;

  const primaryThemeById = new Map(primaryThemes.map((theme) => [theme.id, theme]));
  const selectedTheme = (state.selectedThemeId ? primaryThemeById.get(state.selectedThemeId) : undefined)
    || state.payload?.themes.find((theme) => theme.id === state.selectedThemeId)
    || primaryThemes[0]
    || state.payload?.themes[0];
  const libraryMode = rotationTiers?.libraryMode || false;
  const rotationConclusion = state.payload && rotationTiers ? deriveRotationConclusion(t, state.payload, rotationTiers) : null;
  const primaryTierLabel = primaryDisplayLabel(t, displayMode);
  const marketLabelText = marketLabel(t, state.payload?.market || state.selectedMarket);
  const visualUnavailableReason = rotationConclusion?.title || rotationCopy(t, 'visual.matrixUnavailable');
  const visualUnavailableDetail = libraryMode
    ? rotationCopy(t, 'visual.taxonomyUnavailableDetail')
    : rotationConclusion?.whyNotConclusion || rotationCopy(t, 'primary.unavailableDetail');

  return (
    <div
      data-testid="market-rotation-radar-page"
      data-bento-surface="true"
      className="bento-surface-root flex min-h-0 w-full min-w-0 flex-1 flex-col gap-6 overflow-y-auto no-scrollbar text-[color:var(--wolfy-text-primary)]"
      aria-busy={state.loading}
    >
      <ConsumerWorkspaceScope className="min-h-0 flex-1">
      <ConsumerWorkspacePageShell className="flex min-h-0 flex-1 flex-col gap-4 md:gap-6">
        <TerminalPanel as="section" dense className="relative shrink-0 overflow-hidden">
          <TerminalPageHeading
            eyebrow={rotationCopy(t, 'header.eyebrow')}
            title={rotationCopy(t, 'header.title')}
          />
        </TerminalPanel>

        {state.error ? (
          <TerminalPanel as="section">
            <ApiErrorAlert
              error={state.error}
              actionLabel={rotationCopy(t, 'controls.reload')}
              onAction={handleRefresh}
            />
          </TerminalPanel>
        ) : null}

        {state.loading && !state.payload ? (
          <LoadingPanel showFallback={showLoadingFallback} onRefresh={handleRefresh} />
        ) : null}

        {state.payload ? (
          <>
            <CommandBar
              selectedMarket={state.selectedMarket}
              supportedMarkets={state.payload.supportedMarkets || ['US', 'CN', 'HK', 'CRYPTO']}
              searchQuery={state.searchQuery}
              onMarketChange={handleMarketChange}
              onSearchChange={(searchQuery) => dispatch({ type: 'setSearchQuery', searchQuery })}
              loading={state.loading}
              freshness={state.payload.freshness}
              onRefresh={handleRefresh}
            />

            <RotationVisualPanel
              themes={visualThemes}
              selectedThemeId={selectedTheme?.id}
              marketLabelText={marketLabelText}
              displayMode={displayMode}
              unavailableReason={visualUnavailableReason}
              unavailableDetail={visualUnavailableDetail}
              onSelectTheme={(themeId) => dispatch({ type: 'selectTheme', themeId })}
            />

            <TerminalGrid className="gap-4" data-workbench-split="8:4">
              <section className="min-w-0 xl:col-span-8" aria-label={libraryMode ? rotationCopy(t, 'labels.taxonomyAndClues') : primaryTierLabel}>
                <DataWorkbenchFrame data-testid="rotation-radar-leader-list">
                  <div className="border-b border-[color:var(--wolfy-divider)] p-3">
                    <TerminalSectionHeader
                      eyebrow={primaryTierLabel}
                      title={primaryThemes.length
                        ? (libraryMode
                          ? rotationCopy(t, 'list.taxonomyFocusCount', { count: primaryThemes.length })
                          : rotationTiers?.confirmedLeaders.length
                            ? rotationCopy(t, 'list.confirmedCount', { count: primaryThemes.length })
                            : rotationCopy(t, 'list.observationCount', { count: primaryThemes.length }))
                        : (rotationConclusion?.title || (libraryMode ? rotationCopy(t, 'list.noVisibleThemes') : rotationCopy(t, 'list.noHeadlineRanking')))}
                    />
                  </div>
                  {primaryThemes.length ? (
                    <DenseRows>
                      {primaryThemes.map((theme) => (
                        <LeaderRow
                          key={theme.id}
                          theme={theme}
                          marketLabelText={marketLabelText}
                          selected={selectedTheme?.id === theme.id}
                          onSelect={() => dispatch({ type: 'selectTheme', themeId: theme.id })}
                        />
                      ))}
                    </DenseRows>
                  ) : (
                    <div className="p-3">
                      <TerminalEmptyState
                        data-testid="rotation-radar-insufficient-empty"
                        className="min-h-[104px] items-start justify-start p-3 text-left text-sm text-[color:var(--wolfy-text-muted)]"
                      >
                        <span className="block font-semibold text-[color:var(--wolfy-text-primary)]">
                          {rotationConclusion?.title || rotationCopy(t, 'status.directionPending')}
                        </span>
                        <span className="mt-2 block leading-5">
                          {rotationConclusion?.detail || rotationCopy(t, 'confidence.unavailable')}
                        </span>
                        <span className="mt-3 block leading-5 text-[color:var(--wolfy-text-secondary)]">
                          {rotationConclusion?.nextStep || rotationCopy(t, 'conclusion.unavailableNextStep')}
                        </span>
                      </TerminalEmptyState>
                    </div>
                  )}
                </DataWorkbenchFrame>
              </section>

              <div className="min-w-0 xl:col-span-4">
                <ThemeDetailPanel
                  theme={selectedTheme}
                  marketLabelText={marketLabelText}
                  libraryMode={libraryMode}
                />
              </div>
            </TerminalGrid>

            <DataWorkbenchFrame data-testid="rotation-radar-universe-list">
              <div className="border-b border-[color:var(--wolfy-divider)] p-3">
                <TerminalSectionHeader
                  eyebrow={rotationCopy(t, 'labels.themeAndTaxonomy')}
                  title={libraryMode
                    ? rotationCopy(t, 'list.taxonomyItemsCount', { count: filteredThemes.length, total: state.payload.themes.length })
                    : rotationCopy(t, 'list.itemsCount', { count: filteredThemes.length, total: state.payload.themes.length })}
                />
              </div>
              <div className="max-h-80 overflow-y-auto no-scrollbar">
                {filteredThemes.length ? (
                  <DenseRows>
                    {filteredThemes.map((theme) => (
                      <CompactThemeRow
                        key={theme.id}
                        theme={theme}
                        marketLabelText={marketLabelText}
                        selected={selectedTheme?.id === theme.id}
                        onSelect={() => dispatch({ type: 'selectTheme', themeId: theme.id })}
                      />
                    ))}
                  </DenseRows>
                ) : (
                  <div className="p-3">
                    <TerminalEmptyState className="min-h-[72px] justify-start text-sm text-[color:var(--wolfy-text-muted)]">{rotationCopy(t, 'list.noMatchingThemes')}</TerminalEmptyState>
                  </div>
                )}
              </div>
            </DataWorkbenchFrame>

            <RotationGuidancePanel payload={state.payload} />
          </>
        ) : null}
      </ConsumerWorkspacePageShell>
      </ConsumerWorkspaceScope>
    </div>
  );
};

export default MarketRotationRadarPage;
