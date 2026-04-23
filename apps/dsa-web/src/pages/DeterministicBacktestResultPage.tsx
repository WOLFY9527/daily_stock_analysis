import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { backtestApi } from '../api/backtest';
import type { ParsedApiError } from '../api/error';
import { getParsedApiError } from '../api/error';
import { ApiErrorAlert, Button, Card } from '../components/common';
import {
  DeterministicAuditTable,
  DeterministicBacktestResultView,
  DeterministicTradeEventTable,
} from '../components/backtest/DeterministicBacktestResultView';
import {
  getDeterministicResultDensityCssVars,
  useDeterministicResultDensity,
} from '../components/backtest/deterministicResultDensity';
import { normalizeDeterministicBacktestResult } from '../components/backtest/normalizeDeterministicBacktestResult';
import {
  AssumptionList,
  Banner,
  Disclosure,
  RuleRunStatusBanner,
  RuleRunsTable,
  SummaryStrip,
  canCancelRuleRun,
  formatDateTime,
  formatNumber,
  getBenchmarkModeLabel,
  getRuleRunStatusDescription,
  getRuleRunStatusLabel,
  getStrategySpecValue,
  isCanonicalNoEntrySignalMessage,
  isRuleRunTerminal,
  pct,
  type RuleBenchmarkMode,
} from '../components/backtest/shared';
import ExecutionTracePanel from '../components/backtest/ExecutionTracePanel';
import {
  RuleRunComparisonPanel,
  type RuleComparisonItem,
} from '../components/backtest/RuleRunComparisonPanel';
import {
  buildRuleStrategySummaryRows,
  formatRuleNormalizationStateLabel,
  getRuleStrategySpecSourceLabel,
  getRuleStrategyTypeLabel,
} from '../components/backtest/strategyInspectability';
import {
  downloadExecutionTraceCsv,
  downloadExecutionTraceJson,
  hasExecutionTraceRows,
} from '../components/backtest/executionTraceUtils';
import {
  buildRuleRunReportMarkdown,
  createRuleBacktestPresetFromRun,
  getRuleScenarioPlans,
  loadRuleBacktestPresets,
  saveRuleBacktestPreset,
  type RuleBacktestPreset,
  type RuleScenarioPlan,
} from '../components/backtest/ruleBacktestP6';
import type {
  RuleBacktestCancelResponse,
  RuleBacktestHistoryItem,
  RuleBacktestRunResponse,
  RuleBacktestStatusResponse,
  StatusHistoryItem,
} from '../types/backtest';
import { useI18n } from '../contexts/UiLanguageContext';
import { translate, type UiLanguage } from '../i18n/core';

const RULE_POLL_INTERVAL_MS = 1800;
const RESULT_HISTORY_PAGE_SIZE = 10;

type ResultPageLocationState = {
  initialRun?: RuleBacktestRunResponse;
};

type ScenarioRunState = {
  variantId: string;
  label: string;
  description: string;
  runId: number | null;
  status: string;
  result: RuleBacktestRunResponse | null;
  error: string | null;
};

type ResultPageTabKey = 'overview' | 'audit' | 'trades' | 'parameters' | 'history';

const RESULT_PAGE_TAB_KEYS: ResultPageTabKey[] = ['overview', 'audit', 'trades', 'parameters', 'history'];

type CoverageTrackItem = {
  key: string;
  label: string;
  summary: string;
  detail: string;
  state: string;
  ratio: number;
};

type RiskControlVisualRow = {
  key: 'stop-loss' | 'take-profit' | 'trailing-stop';
  label: string;
  value: number;
  valueLabel: string;
};

const COVERAGE_TRACK_COLORS = ['#7dd3fc', '#86efac', '#fbbf24'];

function formatStatusHistoryLabel(item: StatusHistoryItem): string {
  return `${String(item.status || '--')} · ${item.at ? formatDateTime(item.at) : '--'}`;
}

function formatSummaryLabel(key: string): string {
  return key
    .replaceAll(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .trim();
}

function formatWarningText(warning: Record<string, unknown>, index: number): string {
  const preferred = warning.message
    || warning.text
    || warning.detail
    || warning.reason
    || warning.code;
  if (typeof preferred === 'string' && preferred.trim()) return preferred;

  const serialized = JSON.stringify(warning);
  return serialized && serialized !== '{}' ? serialized : `warning #${index + 1}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function getObjectField(record: Record<string, unknown> | null, key: string): unknown {
  return record ? record[key] : undefined;
}

function hasObjectFields(record: Record<string, unknown> | null): boolean {
  return Boolean(record && Object.keys(record).length > 0);
}

function getFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clampRatio(value: number | null): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function btr(language: UiLanguage, key: string, vars?: Record<string, string | number | undefined>): string {
  return translate(language, `backtest.resultPage.${key}`, vars);
}

function getRobustnessStateLabel(value: unknown, language: UiLanguage): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'available') return btr(language, 'robustnessState.available');
  if (normalized === 'partial') return btr(language, 'robustnessState.partial');
  if (normalized === 'unavailable') return btr(language, 'robustnessState.unavailable');
  return normalized ? String(value) : '--';
}

function getRiskControlVisualRows(
  parsedStrategy: RuleBacktestRunResponse['parsedStrategy'] | null | undefined,
  language: UiLanguage,
): RiskControlVisualRow[] {
  const directSpec = parsedStrategy?.strategySpec;
  const strategySpec = directSpec && typeof directSpec === 'object'
    ? directSpec as Record<string, unknown>
    : undefined;
  if (!strategySpec) return [];

  const controls = [
    {
      key: 'stop-loss' as const,
      label: btr(language, 'riskControls.stopLoss'),
      value: getStrategySpecValue(strategySpec, ['risk_controls', 'stop_loss_pct']),
    },
    {
      key: 'take-profit' as const,
      label: btr(language, 'riskControls.takeProfit'),
      value: getStrategySpecValue(strategySpec, ['risk_controls', 'take_profit_pct']),
    },
    {
      key: 'trailing-stop' as const,
      label: btr(language, 'riskControls.trailingStop'),
      value: getStrategySpecValue(strategySpec, ['risk_controls', 'trailing_stop_pct']),
    },
  ];

  return controls
    .filter((item) => typeof item.value === 'number' && Number.isFinite(item.value))
    .map((item) => ({
      key: item.key,
      label: item.label,
      value: Number(item.value),
      valueLabel: `${Number(item.value).toFixed(2)}%`,
    }));
}

function RobustnessCoverageTrack({
  rows,
}: {
  rows: CoverageTrackItem[];
}) {
  const { language } = useI18n();
  if (!rows.length) return null;

  const averageCoverage = rows.reduce((total, row) => total + row.ratio, 0) / rows.length;

  return (
    <div className="summary-block mt-4" data-testid="robustness-coverage-overview">
      <div className="summary-block__header">
        <div>
          <h3 className="summary-block__title">{btr(language, 'riskControls.coverageTrack')}</h3>
        </div>
        <div className="product-chip-list product-chip-list--tight">
          <span className="product-chip">{btr(language, 'riskControls.averageCoverage', { value: pct(averageCoverage * 100) })}</span>
        </div>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
        {rows.map((row, index) => (
          <div
            key={`coverage-${row.key}`}
            className="h-full"
            style={{
              width: `${row.ratio * 100}%`,
              backgroundColor: COVERAGE_TRACK_COLORS[index % COVERAGE_TRACK_COLORS.length],
            }}
          />
        ))}
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {rows.map((row, index) => (
          <div
            key={`coverage-card-${row.key}`}
            className="rounded-[1rem] border border-[var(--border-muted)] bg-[rgba(15,23,42,0.18)] px-3 py-2.5"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="metric-card__label">{row.label}</p>
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: COVERAGE_TRACK_COLORS[index % COVERAGE_TRACK_COLORS.length] }}
              />
            </div>
            <p className="mt-1 preview-card__text">{row.summary}</p>
            <p className="mt-1 text-[11px] text-secondary">{row.detail}</p>
            <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-secondary">
              <span>{btr(language, 'riskControls.coverage', { value: pct(row.ratio * 100) })}</span>
              <span className="product-chip">{row.state}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RiskControlsLadder({
  rows,
  activeRiskControlKey,
}: {
  rows: RiskControlVisualRow[];
  activeRiskControlKey: RiskControlVisualRow['key'] | null;
}) {
  const { language } = useI18n();
  if (!rows.length) return null;

  const strongestRiskControl = rows.reduce((currentMax, row) => Math.max(currentMax, row.value), 0);

  return (
    <div className="summary-block mt-4" data-testid="result-risk-controls-visualization">
      <div className="summary-block__header">
        <div>
          <h3 className="summary-block__title">{btr(language, 'riskControls.protectionLadder')}</h3>
        </div>
        <div className="product-chip-list product-chip-list--tight">
          <span className="product-chip">{btr(language, 'riskControls.enabledCount', { count: rows.length })}</span>
          <span className="product-chip">{btr(language, 'riskControls.highestThreshold', { value: strongestRiskControl.toFixed(2) })}</span>
        </div>
      </div>
      <div className="space-y-3">
        {rows.map((row) => {
          const width = strongestRiskControl > 0 ? Math.max(16, (row.value / strongestRiskControl) * 100) : 0;
          return (
            <div
              key={`risk-control-${row.key}`}
              className={`space-y-1.5 rounded-[0.85rem] px-2 py-1.5 transition-colors ${
                activeRiskControlKey === row.key ? 'bg-[rgba(125,211,252,0.1)]' : ''
              }`}
              data-linked-highlight={activeRiskControlKey === row.key ? 'true' : undefined}
              data-testid={`result-risk-controls-row-${row.key}`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="metric-card__label">{row.label}</span>
                <span className="preview-card__text">{row.valueLabel}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
                <div
                  className="h-full rounded-full bg-[var(--backtest-accent,#7dd3fc)]"
                  style={{ width: `${width}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AdditiveDashboardPanels({
  hasRobustnessAnalysis,
  robustnessLensRows,
  riskControlRows,
  activeRobustnessKey,
  activeRiskControlKey,
  onActiveRobustnessChange,
  onActiveRiskControlChange,
}: {
  hasRobustnessAnalysis: boolean;
  robustnessLensRows: CoverageTrackItem[];
  riskControlRows: RiskControlVisualRow[];
  activeRobustnessKey: string | null;
  activeRiskControlKey: RiskControlVisualRow['key'] | null;
  onActiveRobustnessChange: (key: string | null) => void;
  onActiveRiskControlChange: (key: RiskControlVisualRow['key'] | null) => void;
}) {
  const { language } = useI18n();
  const [hoveredRobustnessRow, setHoveredRobustnessRow] = useState<CoverageTrackItem | null>(null);
  const [hoveredRiskControlRow, setHoveredRiskControlRow] = useState<RiskControlVisualRow | null>(null);
  if (!hasRobustnessAnalysis && riskControlRows.length === 0) return null;

  const averageCoverage = robustnessLensRows.length
    ? robustnessLensRows.reduce((total, row) => total + row.ratio, 0) / robustnessLensRows.length
    : 0;
  const strongestRiskControl = riskControlRows.reduce((currentMax, row) => Math.max(currentMax, row.value), 0);
  const activateRobustnessRow = (row: CoverageTrackItem) => {
    setHoveredRobustnessRow(row);
    onActiveRobustnessChange(row.key);
  };
  const clearRobustnessRow = () => {
    setHoveredRobustnessRow(null);
    onActiveRobustnessChange(null);
  };
  const activateRiskControlRow = (row: RiskControlVisualRow) => {
    setHoveredRiskControlRow(row);
    onActiveRiskControlChange(row.key);
  };
  const clearRiskControlRow = () => {
    setHoveredRiskControlRow(null);
    onActiveRiskControlChange(null);
  };

  return (
    <div className="backtest-display-section mt-3" data-testid="result-additive-dashboard">
      <div className="preview-grid">
        {hasRobustnessAnalysis ? (
          <div
            className="summary-block"
            data-testid="dashboard-robustness-panel"
            title={btr(language, 'riskControls.robustnessPanelTitle')}
          >
            <div className="summary-block__header">
              <div>
                <h3 className="summary-block__title">{btr(language, 'riskControls.robustnessCard')}</h3>
              </div>
              <div className="product-chip-list product-chip-list--tight">
                <span
                  className="product-chip"
                  data-linked-highlight={activeRobustnessKey ? 'true' : undefined}
                >
                  {btr(language, 'riskControls.averageCoverage', { value: pct(averageCoverage * 100) })}
                </span>
              </div>
            </div>
            <div className="space-y-2.5">
              {robustnessLensRows.map((row) => (
                <div
                  key={`dashboard-${row.key}`}
                  className={`rounded-[1rem] px-3 py-2.5 transition-colors ${
                    activeRobustnessKey === row.key ? 'bg-[rgba(125,211,252,0.18)]' : 'bg-[rgba(15,23,42,0.18)]'
                  } focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(125,211,252,0.45)]`}
                  data-linked-highlight={activeRobustnessKey === row.key ? 'true' : undefined}
                  data-testid={`dashboard-robustness-row-${row.key}`}
                  tabIndex={0}
                  aria-label={`${row.label} ${row.summary} ${row.detail}`}
                  aria-describedby={hoveredRobustnessRow?.key === row.key ? 'dashboard-robustness-hover-tooltip' : undefined}
                  onMouseEnter={() => activateRobustnessRow(row)}
                  onMouseLeave={clearRobustnessRow}
                  onFocus={() => activateRobustnessRow(row)}
                  onBlur={clearRobustnessRow}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="metric-card__label">{row.label}</p>
                    <span className="product-chip">{row.state}</span>
                  </div>
                  <p className="mt-1 preview-card__text">{row.summary}</p>
                  <p className="text-[11px] text-secondary">{row.detail}</p>
                </div>
              ))}
            </div>
            {hoveredRobustnessRow ? (
              <div
                className="relative z-10 mt-3 rounded-[0.9rem] border border-[rgba(125,211,252,0.28)] bg-[rgba(15,23,42,0.42)] px-3 py-2 text-[11px] text-secondary shadow-[0_12px_32px_rgba(15,23,42,0.18)] transition-all duration-150 ease-out motion-reduce:transition-none"
                data-testid="dashboard-robustness-hover-tooltip"
                id="dashboard-robustness-hover-tooltip"
                role="tooltip"
              >
                <span className="text-foreground">{hoveredRobustnessRow.label}</span>
                <span className="ml-1">{hoveredRobustnessRow.summary}</span>
                <span className="ml-1">{hoveredRobustnessRow.detail}</span>
              </div>
            ) : null}
          </div>
        ) : null}
        {riskControlRows.length ? (
          <div
            className="summary-block"
            data-testid="dashboard-risk-controls-panel"
            title={btr(language, 'riskControls.riskControlPanelTitle')}
          >
            <div className="summary-block__header">
              <div>
                <h3 className="summary-block__title">{btr(language, 'riskControls.riskControlCard')}</h3>
              </div>
              <div className="product-chip-list product-chip-list--tight">
                <span className="product-chip">{btr(language, 'riskControls.enabledCount', { count: riskControlRows.length })}</span>
                <span
                  className="product-chip"
                  data-linked-highlight={activeRiskControlKey ? 'true' : undefined}
                  data-testid="dashboard-risk-controls-threshold-summary"
                >
                  {btr(language, 'riskControls.highestThreshold', { value: strongestRiskControl.toFixed(2) })}
                </span>
              </div>
            </div>
            <div className="space-y-2.5">
              {riskControlRows.map((row) => (
                <div
                  key={`dashboard-risk-${row.key}`}
                  className={`rounded-[1rem] px-3 py-2.5 transition-colors ${
                    activeRiskControlKey === row.key ? 'bg-[rgba(125,211,252,0.18)]' : 'bg-[rgba(15,23,42,0.18)]'
                  } focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(125,211,252,0.45)]`}
                  data-linked-highlight={activeRiskControlKey === row.key ? 'true' : undefined}
                  data-testid={`dashboard-risk-controls-row-${row.key}`}
                  tabIndex={0}
                  aria-label={`${row.label} ${row.valueLabel}`}
                  aria-describedby={hoveredRiskControlRow?.key === row.key ? 'dashboard-risk-controls-hover-tooltip' : undefined}
                  onMouseEnter={() => activateRiskControlRow(row)}
                  onMouseLeave={clearRiskControlRow}
                  onFocus={() => activateRiskControlRow(row)}
                  onBlur={clearRiskControlRow}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="metric-card__label">{row.label}</p>
                    <span className="preview-card__text">{row.valueLabel}</span>
                  </div>
                </div>
              ))}
            </div>
            {hoveredRiskControlRow ? (
              <div
                className="relative z-10 mt-3 rounded-[0.9rem] border border-[rgba(125,211,252,0.28)] bg-[rgba(15,23,42,0.42)] px-3 py-2 text-[11px] text-secondary shadow-[0_12px_32px_rgba(15,23,42,0.18)] transition-all duration-150 ease-out motion-reduce:transition-none"
                data-testid="dashboard-risk-controls-hover-tooltip"
                id="dashboard-risk-controls-hover-tooltip"
                role="tooltip"
              >
                <span className="text-foreground">{btr(language, 'riskControls.threshold', { label: hoveredRiskControlRow.label })}</span>
                <span className="ml-1 font-mono text-foreground">{hoveredRiskControlRow.valueLabel}</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const DeterministicBacktestResultPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { language, t } = useI18n();
  const backtestCopy = useCallback(
    (key: string, vars?: Record<string, string | number | undefined>) => t(`backtest.${key}`, vars),
    [t],
  );
  const resultPage = useCallback(
    (key: string, vars?: Record<string, string | number | undefined>) => t(`backtest.resultPage.${key}`, vars),
    [t],
  );
  const { runId } = useParams<{ runId: string }>();
  const locationState = location.state as ResultPageLocationState | null;
  const initialRun = locationState?.initialRun || null;
  const parsedRunId = useMemo(() => Number.parseInt(runId || '', 10), [runId]);
  const hasValidRunId = Number.isFinite(parsedRunId) && parsedRunId > 0;

  const [run, setRun] = useState<RuleBacktestRunResponse | null>(
    initialRun && initialRun.id === parsedRunId ? initialRun : null,
  );
  const [isLoadingRun, setIsLoadingRun] = useState(!initialRun || initialRun.id !== parsedRunId);
  const [runError, setRunError] = useState<ParsedApiError | null>(null);
  const [historyItems, setHistoryItems] = useState<RuleBacktestHistoryItem[]>([]);
  const [historyError, setHistoryError] = useState<ParsedApiError | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [activeTab, setActiveTab] = useState<ResultPageTabKey>('overview');
  const [isPollingStatus, setIsPollingStatus] = useState(false);
  const [lastStatusRefreshAt, setLastStatusRefreshAt] = useState<string | null>(null);
  const [isCancellingRun, setIsCancellingRun] = useState(false);
  const [cancelError, setCancelError] = useState<ParsedApiError | null>(null);
  const [compareRunIds, setCompareRunIds] = useState<number[]>([]);
  const [compareRunMap, setCompareRunMap] = useState<Record<number, RuleBacktestRunResponse>>({});
  const [isLoadingCompareRuns, setIsLoadingCompareRuns] = useState(false);
  const [compareError, setCompareError] = useState<ParsedApiError | null>(null);
  const [selectedScenarioPlanId, setSelectedScenarioPlanId] = useState<string | null>(null);
  const [scenarioRuns, setScenarioRuns] = useState<ScenarioRunState[]>([]);
  const [isSubmittingScenarioRuns, setIsSubmittingScenarioRuns] = useState(false);
  const [scenarioError, setScenarioError] = useState<ParsedApiError | null>(null);
  const [presetNotice, setPresetNotice] = useState<string | null>(null);
  const [availablePresets, setAvailablePresets] = useState<RuleBacktestPreset[]>([]);
  const [activeRobustnessKey, setActiveRobustnessKey] = useState<string | null>(null);
  const [activeRiskControlKey, setActiveRiskControlKey] = useState<RiskControlVisualRow['key'] | null>(null);
  const density = useDeterministicResultDensity();
  const robustnessAnalysis = useMemo(() => asObjectRecord(run?.robustnessAnalysis), [run?.robustnessAnalysis]);
  const robustnessConfiguration = useMemo(() => asObjectRecord(getObjectField(robustnessAnalysis, 'configuration')), [robustnessAnalysis]);
  const walkForward = useMemo(() => asObjectRecord(getObjectField(robustnessAnalysis, 'walkForward')), [robustnessAnalysis]);
  const walkForwardConfig = useMemo(() => asObjectRecord(getObjectField(robustnessConfiguration, 'walkForward')), [robustnessConfiguration]);
  const walkForwardAggregate = useMemo(() => asObjectRecord(getObjectField(walkForward, 'aggregateMetrics')), [walkForward]);
  const monteCarlo = useMemo(() => asObjectRecord(getObjectField(robustnessAnalysis, 'monteCarlo')), [robustnessAnalysis]);
  const monteCarloConfig = useMemo(() => asObjectRecord(getObjectField(robustnessConfiguration, 'monteCarlo')), [robustnessConfiguration]);
  const monteCarloAggregate = useMemo(() => asObjectRecord(getObjectField(monteCarlo, 'aggregateMetrics')), [monteCarlo]);
  const stressTests = useMemo(() => asObjectRecord(getObjectField(robustnessAnalysis, 'stressTests')), [robustnessAnalysis]);
  const stressTestsConfig = useMemo(() => asObjectRecord(getObjectField(robustnessConfiguration, 'stressTests')), [robustnessConfiguration]);
  const worstScenario = useMemo(() => asObjectRecord(getObjectField(stressTests, 'worstScenario')), [stressTests]);
  const hasRobustnessAnalysis = useMemo(
    () => Boolean(
      getObjectField(robustnessAnalysis, 'state')
      || hasObjectFields(walkForward)
      || hasObjectFields(monteCarlo)
      || hasObjectFields(stressTests)
    ),
    [monteCarlo, robustnessAnalysis, stressTests, walkForward],
  );
  const robustnessLensRows = useMemo<CoverageTrackItem[]>(() => {
    const walkForwardCount = getFiniteNumber(getObjectField(walkForward, 'windowCount'));
    const walkForwardMax = getFiniteNumber(getObjectField(walkForwardConfig, 'maxWindows'));
    const monteCarloCount = getFiniteNumber(getObjectField(monteCarlo, 'simulationCount'));
    const monteCarloMax = getFiniteNumber(getObjectField(monteCarloConfig, 'simulationCount'));
    const stressScenarioCount = getFiniteNumber(getObjectField(stressTests, 'scenarioCount'));
    const stressScenarioKeys = getObjectField(stressTestsConfig, 'scenarioKeys');
    const stressScenarioMax = Array.isArray(stressScenarioKeys) ? stressScenarioKeys.length : null;

    return [
      {
        key: 'walk-forward',
        label: btr(language, 'riskControls.walkForwardLabel'),
        summary: walkForwardCount == null ? '--' : btr(language, 'riskControls.walkForwardWindows', { count: formatNumber(walkForwardCount, 0) }),
        detail: btr(language, 'riskControls.mean', { value: pct(getFiniteNumber(getObjectField(walkForwardAggregate, 'meanTotalReturnPct'))) }),
        state: getRobustnessStateLabel(getObjectField(walkForward, 'state') ?? getObjectField(robustnessAnalysis, 'state'), language),
        ratio: clampRatio(walkForwardCount != null && walkForwardMax ? walkForwardCount / walkForwardMax : (hasObjectFields(walkForward) ? 1 : 0)),
      },
      {
        key: 'monte-carlo',
        label: btr(language, 'riskControls.monteCarloLabel'),
        summary: monteCarloCount == null ? '--' : btr(language, 'riskControls.monteCarloPaths', { count: formatNumber(monteCarloCount, 0) }),
        detail: btr(language, 'riskControls.median', { value: pct(getFiniteNumber(getObjectField(monteCarloAggregate, 'medianTotalReturnPct'))) }),
        state: getRobustnessStateLabel(getObjectField(monteCarlo, 'state') ?? getObjectField(robustnessAnalysis, 'state'), language),
        ratio: clampRatio(monteCarloCount != null && monteCarloMax ? monteCarloCount / monteCarloMax : (hasObjectFields(monteCarlo) ? 1 : 0)),
      },
      {
        key: 'stress-tests',
        label: btr(language, 'riskControls.stressTestsLabel'),
        summary: stressScenarioCount == null ? '--' : btr(language, 'riskControls.stressScenarios', { count: formatNumber(stressScenarioCount, 0) }),
        detail: btr(language, 'riskControls.worst', { value: String(getObjectField(worstScenario, 'scenarioKey') || '--') }),
        state: getRobustnessStateLabel(getObjectField(stressTests, 'state') ?? getObjectField(robustnessAnalysis, 'state'), language),
        ratio: clampRatio(stressScenarioCount != null && stressScenarioMax ? stressScenarioCount / stressScenarioMax : (hasObjectFields(stressTests) ? 1 : 0)),
      },
    ];
  }, [
    monteCarlo,
    monteCarloAggregate,
    monteCarloConfig,
    language,
    robustnessAnalysis,
    stressTests,
    stressTestsConfig,
    walkForward,
    walkForwardAggregate,
    walkForwardConfig,
    worstScenario,
  ]);
  const tabs = RESULT_PAGE_TAB_KEYS.map((key) => ({
    key,
    label: backtestCopy(`resultPage.tabs.${key}`),
  }));

  const fetchRun = useCallback(async (options: { suppressLoading?: boolean } = {}) => {
    if (!hasValidRunId) return;
    const { suppressLoading = false } = options;
    if (!suppressLoading) setIsLoadingRun(true);
    try {
      const response = await backtestApi.getRuleBacktestRun(parsedRunId);
      setRun(response);
      setRunError(null);
      setCancelError(null);
      setLastStatusRefreshAt(new Date().toISOString());
    } catch (error) {
      setRunError(getParsedApiError(error));
    } finally {
      if (!suppressLoading) setIsLoadingRun(false);
    }
  }, [hasValidRunId, parsedRunId]);

  const fetchHistory = useCallback(async (code?: string) => {
    if (!code) {
      setHistoryItems([]);
      setHistoryError(null);
      return;
    }
    setIsLoadingHistory(true);
    try {
      const response = await backtestApi.getRuleBacktestRuns({
        code,
        page: 1,
        limit: RESULT_HISTORY_PAGE_SIZE,
      });
      setHistoryItems(response.items);
      setHistoryError(null);
    } catch (error) {
      setHistoryError(getParsedApiError(error));
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (!hasValidRunId) {
      setRun(null);
      setIsLoadingRun(false);
      return;
    }

    const seededRun = initialRun && initialRun.id === parsedRunId ? initialRun : null;
    setRun(seededRun);
    setRunError(null);
    setCancelError(null);
    setIsLoadingRun(!seededRun);
    setLastStatusRefreshAt(seededRun ? new Date().toISOString() : null);
    void fetchRun({ suppressLoading: Boolean(seededRun) });
  }, [fetchRun, hasValidRunId, initialRun, parsedRunId]);

  useEffect(() => {
    if (!run?.id || isRuleRunTerminal(run.status)) return undefined;

    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      if (!cancelled) setIsPollingStatus(true);
      try {
        const status = await backtestApi.getRuleBacktestRunStatus(run.id);
        if (cancelled) return;
        setRun((current) => (current ? { ...current, ...(status as RuleBacktestStatusResponse) } : current));
        setRunError(null);
        setLastStatusRefreshAt(new Date().toISOString());
        if (isRuleRunTerminal(status.status)) {
          await Promise.all([
            fetchRun({ suppressLoading: true }),
            fetchHistory(status.code),
          ]);
          return;
        }
      } catch (error) {
        if (!cancelled) setRunError(getParsedApiError(error));
      } finally {
        if (!cancelled) setIsPollingStatus(false);
      }

      if (!cancelled) timer = window.setTimeout(() => void poll(), RULE_POLL_INTERVAL_MS);
    };

    timer = window.setTimeout(() => void poll(), RULE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [fetchHistory, fetchRun, run?.id, run?.status]);

  useEffect(() => {
    if (!run?.code) {
      setHistoryItems([]);
      return;
    }
    void fetchHistory(run.code);
  }, [fetchHistory, run?.code]);

  useEffect(() => {
    setCompareRunIds([]);
    setScenarioRuns([]);
    setScenarioError(null);
  }, [run?.id]);

  useEffect(() => {
    document.title = hasValidRunId
      ? `${backtestCopy('resultPage.documentTitle')} #${parsedRunId} - WolfyStock`
      : `${backtestCopy('resultPage.documentTitle')} - WolfyStock`;
  }, [backtestCopy, hasValidRunId, parsedRunId]);

  useEffect(() => {
    setAvailablePresets(loadRuleBacktestPresets());
  }, []);

  useEffect(() => {
    if (!run || run.status !== 'completed') return;
    const next = saveRuleBacktestPreset(createRuleBacktestPresetFromRun(run, { kind: 'recent' }));
    setAvailablePresets(next);
  }, [run]);

  useEffect(() => {
    if (compareRunIds.length === 0) {
      setCompareError(null);
      return;
    }
    let cancelled = false;
    const missingIds = compareRunIds.filter((id) => !compareRunMap[id]);
    if (missingIds.length === 0) return;

    const loadRuns = async () => {
      setIsLoadingCompareRuns(true);
      try {
        const items = await Promise.all(missingIds.map((id) => backtestApi.getRuleBacktestRun(id)));
        if (cancelled) return;
        setCompareRunMap((current) => ({
          ...current,
          ...Object.fromEntries(items.map((item) => [item.id, item])),
        }));
        setCompareError(null);
      } catch (error) {
        if (!cancelled) setCompareError(getParsedApiError(error));
      } finally {
        if (!cancelled) setIsLoadingCompareRuns(false);
      }
    };

    void loadRuns();
    return () => {
      cancelled = true;
    };
  }, [compareRunIds, compareRunMap]);

  useEffect(() => {
    const pendingRuns = scenarioRuns.filter((item) => item.runId && !isRuleRunTerminal(item.status));
    if (pendingRuns.length === 0) return undefined;

    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const updates = await Promise.all(
            pendingRuns.map(async (item) => {
              const status = await backtestApi.getRuleBacktestRunStatus(item.runId as number);
              if (status.status === 'completed') {
                const detail = await backtestApi.getRuleBacktestRun(item.runId as number);
                return { runId: item.runId, status: detail.status, detail, error: null };
              }
              return { runId: item.runId, status: status.status, detail: null, error: null };
            }),
          );
          if (cancelled) return;
          setScenarioRuns((current) => current.map((item) => {
            const matched = updates.find((update) => update.runId === item.runId);
            if (!matched) return item;
            return {
              ...item,
              status: matched.status,
              result: matched.detail ?? item.result,
              error: matched.error,
            };
          }));
        } catch (error) {
          if (!cancelled) setScenarioError(getParsedApiError(error));
        }
      })();
    }, RULE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [scenarioRuns]);

  const handleOpenHistoryRun = useCallback((item: RuleBacktestHistoryItem) => {
    navigate(`/backtest/results/${item.id}`);
  }, [navigate]);

  const benchmarkSummary = run?.benchmarkSummary;
  const buyAndHoldSummary = run?.buyAndHoldSummary;
  const buyAndHoldLabel = (
    String(buyAndHoldSummary?.label || '').trim() === translate('zh', 'backtest.resultPage.buyAndHoldDefault')
    || String(buyAndHoldSummary?.label || '').trim() === translate('en', 'backtest.resultPage.buyAndHoldDefault')
  )
    ? resultPage('buyAndHoldDefault')
    : (buyAndHoldSummary?.label || resultPage('buyAndHoldDefault'));
  const selectedBenchmarkLabel = benchmarkSummary
    ? String(
      benchmarkSummary.label
      || getBenchmarkModeLabel(
        (run?.benchmarkMode as RuleBenchmarkMode | undefined) || 'auto',
        run?.code,
        run?.benchmarkCode || undefined,
        language,
      ),
    )
    : '--';
  const benchmarkStatusNote = benchmarkSummary
    ? (
      benchmarkSummary.unavailableReason
      || (benchmarkSummary.resolvedMode === 'none'
        ? resultPage('benchmarkNotes.none')
        : benchmarkSummary.autoResolved
          ? resultPage('benchmarkNotes.autoResolved', { label: selectedBenchmarkLabel })
          : resultPage('benchmarkNotes.sameWindow'))
    )
    : resultPage('benchmarkNotes.pending');
  const normalized = useMemo(
    () => (run?.status === 'completed' ? normalizeDeterministicBacktestResult(run, language) : null),
    [run, language],
  );
  const scenarioPlans = useMemo<RuleScenarioPlan[]>(
    () => (run?.status === 'completed' ? getRuleScenarioPlans(run) : []),
    [run],
  );
  const selectedScenarioPlan = useMemo(
    () => scenarioPlans.find((plan) => plan.id === selectedScenarioPlanId) || scenarioPlans[0] || null,
    [scenarioPlans, selectedScenarioPlanId],
  );
  useEffect(() => {
    if (!selectedScenarioPlanId && scenarioPlans[0]) {
      setSelectedScenarioPlanId(scenarioPlans[0].id);
    }
  }, [scenarioPlans, selectedScenarioPlanId]);
  const comparisonItems = useMemo<RuleComparisonItem[]>(() => {
    if (!run || !normalized) return [];
    const items: RuleComparisonItem[] = [{
      run,
      normalized,
      label: resultPage('comparison.currentRunLabel', { id: run.id }),
      badge: resultPage('comparison.currentBadge'),
    }];
    compareRunIds.forEach((id) => {
      const detail = compareRunMap[id];
      if (!detail || detail.status !== 'completed') return;
      items.push({
        run: detail,
        normalized: normalizeDeterministicBacktestResult(detail, language),
        label: resultPage('comparison.comparedRunLabel', { id: detail.id }),
      });
    });
    return items;
  }, [compareRunIds, compareRunMap, language, normalized, resultPage, run]);
  const scenarioComparisonItems = useMemo<RuleComparisonItem[]>(() => {
    if (!run || !normalized) return [];
    const completedScenarioRuns = scenarioRuns.filter((item) => item.result?.status === 'completed' && item.result);
    return [
      {
        run,
        normalized,
        label: resultPage('comparison.currentRunLabel', { id: run.id }),
        badge: resultPage('comparison.baselineBadge'),
      },
      ...completedScenarioRuns.map((item) => ({
        run: item.result as RuleBacktestRunResponse,
        normalized: normalizeDeterministicBacktestResult(item.result as RuleBacktestRunResponse, language),
        label: item.label,
      })),
    ];
  }, [language, normalized, resultPage, run, scenarioRuns]);
  const decisionReportMarkdown = useMemo(
    () => (run && normalized
      ? buildRuleRunReportMarkdown({
        run,
        normalized,
        comparedRuns: comparisonItems.slice(1).map((item) => item.run),
        language,
      })
      : ''),
    [comparisonItems, normalized, run, language],
  );
  const headerDescription = run
    ? resultPage('headerDescriptionLoaded', {
      code: run.code,
      startDate: run.startDate || '--',
      endDate: run.endDate || '--',
      benchmarkLabel: selectedBenchmarkLabel,
    })
    : resultPage('headerDescriptionEmpty');
  const parsedSummaryEntries = Object.entries(run?.parsedStrategy?.summary || {})
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([key, value]) => ({ label: formatSummaryLabel(key), value: String(value) }));
  const strategySummaryRows = useMemo(
    () => (run
      ? buildRuleStrategySummaryRows(run.parsedStrategy, run.code, run.startDate || '', run.endDate || '', undefined, language)
      : []),
    [run, language],
  );
  const riskControlRows = useMemo(
    () => getRiskControlVisualRows(run?.parsedStrategy, language),
    [language, run?.parsedStrategy],
  );
  const strategyWarningEntries = Array.from(
    new Set([
      ...(run?.parsedStrategy?.parseWarnings || []).map((warning, index) => formatWarningText(warning, index)),
      ...(run?.warnings || []).map((warning, index) => formatWarningText(warning, index)),
    ].filter(Boolean)),
  );
  const canCancelCurrentRun = Boolean(run && canCancelRuleRun(run.status));
  const canExportTrace = Boolean(run && hasExecutionTraceRows(run));
  const compareWorkbenchRunIds = useMemo(
    () => (run ? [run.id, ...compareRunIds] : []),
    [compareRunIds, run],
  );
  const localizedNoResultMessage = isCanonicalNoEntrySignalMessage(run?.noResultMessage)
    ? resultPage('noEntrySignal')
    : (run?.noResultMessage || null);
  const statusSummaryItems = run ? [
    {
      label: resultPage('statusSummary.currentStageLabel'),
      value: getRuleRunStatusLabel(run.status, language),
      note: language === 'en'
        ? (localizedNoResultMessage || getRuleRunStatusDescription(run.status, language))
        : (run.statusMessage || localizedNoResultMessage || getRuleRunStatusDescription(run.status, language)),
    },
    {
      label: resultPage('statusSummary.autoRefreshLabel'),
      value: isRuleRunTerminal(run.status) ? resultPage('statusSummary.autoRefreshStopped') : resultPage('statusSummary.autoRefreshEvery'),
      note: isPollingStatus ? resultPage('statusSummary.autoRefreshSyncing') : resultPage('statusSummary.autoRefreshActive'),
    },
    {
      label: resultPage('statusSummary.lastRefreshLabel'),
      value: lastStatusRefreshAt ? formatDateTime(lastStatusRefreshAt) : '--',
      note: isLoadingRun ? resultPage('statusSummary.lastRefreshLoading') : resultPage('statusSummary.lastRefreshManual'),
    },
    {
      label: resultPage('statusSummary.nextStepLabel'),
      value: canCancelCurrentRun
        ? resultPage('statusSummary.nextStepCancelable')
        : canExportTrace
          ? resultPage('statusSummary.nextStepExportReady')
          : isRuleRunTerminal(run.status)
            ? resultPage('statusSummary.nextStepReviewResult')
            : resultPage('statusSummary.nextStepWaiting'),
      note: canExportTrace
        ? resultPage('statusSummary.nextStepExportReadyNote')
        : resultPage('statusSummary.nextStepExportPendingNote'),
    },
  ] : [];

  const handleToggleCompareRun = useCallback((item: RuleBacktestHistoryItem) => {
    setCompareRunIds((current) => {
      if (current.includes(item.id)) return current.filter((id) => id !== item.id);
      return [...current, item.id].slice(0, 3);
    });
  }, []);

  const handleOpenCompareWorkbench = useCallback(() => {
    if (!run || compareRunIds.length === 0) return;
    const params = new URLSearchParams({
      runIds: compareWorkbenchRunIds.join(','),
    });
    navigate(`/backtest/compare?${params.toString()}`);
  }, [compareRunIds.length, compareWorkbenchRunIds, navigate, run]);

  const handleSavePreset = useCallback(() => {
    if (!run) return;
    const suggestedName = `${run.code} · ${getRuleStrategyTypeLabel(run.parsedStrategy, undefined, language)}`;
    const name = window.prompt(resultPage('promptSavePreset'), suggestedName);
    if (!name || !name.trim()) return;
    const next = saveRuleBacktestPreset(createRuleBacktestPresetFromRun(run, {
      kind: 'saved',
      name,
    }));
    setAvailablePresets(next);
    setPresetNotice(resultPage('presetSaved', { name: name.trim() }));
  }, [language, resultPage, run]);

  const handleExportDecisionReport = useCallback((format: 'md' | 'html') => {
    if (!run || !normalized || !decisionReportMarkdown) return;
    if (format === 'md') {
      downloadTextFile(`backtest-run-${run.id}-summary.md`, decisionReportMarkdown, 'text/markdown;charset=utf-8');
      return;
    }
    const html = [
      '<!doctype html>',
      '<html lang="zh-CN"><head><meta charset="utf-8" />',
      `<title>${escapeHtml(resultPage('exportHtmlTitle', { id: run.id }))}</title>`,
      '<style>body{font-family:ui-sans-serif,system-ui,sans-serif;padding:24px;line-height:1.6;color:#111827}pre{white-space:pre-wrap;word-break:break-word;background:#f3f4f6;border:1px solid #d1d5db;border-radius:12px;padding:18px}</style>',
      '</head><body>',
      `<h1>${escapeHtml(resultPage('exportHtmlHeading', { id: run.id }))}</h1>`,
      `<pre>${escapeHtml(decisionReportMarkdown)}</pre>`,
      '</body></html>',
    ].join('');
    downloadTextFile(`backtest-run-${run.id}-summary.html`, html, 'text/html;charset=utf-8');
  }, [decisionReportMarkdown, normalized, resultPage, run]);

  const handleRunScenarioPlan = useCallback(async () => {
    if (!run || !selectedScenarioPlan) return;
    setIsSubmittingScenarioRuns(true);
    setScenarioError(null);
    setScenarioRuns(selectedScenarioPlan.variants.map((variant) => ({
      variantId: variant.id,
      label: variant.label,
      description: variant.description,
      runId: null,
      status: 'submitting',
      result: null,
      error: null,
    })));

    try {
      const nextStates: ScenarioRunState[] = [];
      for (const variant of selectedScenarioPlan.variants) {
        const response = await backtestApi.runRuleBacktest(variant.request);
        nextStates.push({
          variantId: variant.id,
          label: variant.label,
          description: variant.description,
          runId: response.id,
          status: response.status,
          result: response.status === 'completed' ? response : null,
          error: null,
        });
      }
      setScenarioRuns(nextStates);
    } catch (error) {
      setScenarioError(getParsedApiError(error));
    } finally {
      setIsSubmittingScenarioRuns(false);
    }
  }, [run, selectedScenarioPlan]);

  const handleCancelRun = useCallback(async () => {
    if (!run || !canCancelRuleRun(run.status) || isCancellingRun) return;
    const confirmed = window.confirm(resultPage('cancelConfirm'));
    if (!confirmed) return;

    setIsCancellingRun(true);
    setCancelError(null);

    try {
      const response = await backtestApi.cancelRuleBacktestRun(run.id);
      setRun((current) => (current ? { ...current, ...(response as RuleBacktestCancelResponse) } : current));
      setRunError(null);
      setLastStatusRefreshAt(new Date().toISOString());
      await Promise.all([
        fetchRun({ suppressLoading: true }),
        fetchHistory(response.code),
      ]);
    } catch (error) {
      setCancelError(getParsedApiError(error));
    } finally {
      setIsCancellingRun(false);
    }
  }, [fetchHistory, fetchRun, isCancellingRun, resultPage, run]);

  const renderRunStatusSection = () => {
    if (!run && isLoadingRun) {
      return (
        <section className="backtest-display-section" data-testid="deterministic-result-page-status">
          <Card title={resultPage('statusCard.title')} subtitle={resultPage('statusCard.loadingSubtitle')} className="product-section-card product-section-card--backtest-result">
            <div className="product-empty-state product-empty-state--compact">{resultPage('statusCard.loadingBody')}</div>
          </Card>
        </section>
      );
    }

    if (!run) {
      return (
        <section className="backtest-display-section" data-testid="deterministic-result-page-status">
          <Card title={resultPage('statusCard.title')} subtitle={resultPage('statusCard.unavailableSubtitle')} className="product-section-card product-section-card--backtest-result">
            {runError ? <ApiErrorAlert error={runError} /> : <div className="product-empty-state product-empty-state--compact">{resultPage('statusCard.unavailableBody')}</div>}
          </Card>
        </section>
      );
    }

    return (
      <section className="backtest-display-section" data-testid="deterministic-result-page-status">
        <Card title={resultPage('statusCard.title')} subtitle={resultPage('statusCard.controlsSubtitle')} className="product-section-card product-section-card--backtest-result">
          <RuleRunStatusBanner run={run} />
          <SummaryStrip items={statusSummaryItems} />
          {!isRuleRunTerminal(run.status) ? (
            <div className="mt-4">
              <Banner
                tone="info"
                title={resultPage('statusCard.autoTrackingTitle')}
                body={resultPage('statusCard.autoTrackingBody')}
              />
            </div>
          ) : null}
          {run.status === 'completed' ? (
            <div className="mt-4">
              <Banner
                tone="success"
                title={resultPage('statusCard.completedTitle')}
                body={resultPage('statusCard.completedBody')}
              />
            </div>
          ) : null}
          {run.status === 'cancelled' ? (
            <div className="mt-4">
              <Banner
                tone="warning"
                title={resultPage('statusCard.cancelledTitle')}
                body={resultPage('statusCard.cancelledBody')}
              />
            </div>
          ) : null}
          {run.status === 'failed' ? (
            <div className="mt-4">
              <Banner
                tone="danger"
                title={resultPage('statusCard.failedTitle')}
                body={resultPage('statusCard.failedBody')}
              />
            </div>
          ) : null}
          <div className="product-action-row mt-4">
            <Button variant="ghost" onClick={() => void fetchRun()} disabled={isCancellingRun}>
              {isPollingStatus || isLoadingRun ? resultPage('statusCard.refreshing') : resultPage('statusCard.refreshStatus')}
            </Button>
            {canCancelCurrentRun ? (
              <Button
                variant="danger-subtle"
                onClick={() => void handleCancelRun()}
                isLoading={isCancellingRun}
                loadingText={resultPage('statusCard.cancelling')}
              >
                {resultPage('statusCard.cancelRun')}
              </Button>
            ) : null}
            {isRuleRunTerminal(run.status) && canExportTrace ? (
              <>
                <Button variant="secondary" onClick={() => downloadExecutionTraceCsv(run)}>
                  {resultPage('statusCard.exportCsv')}
                </Button>
                <Button variant="ghost" onClick={() => downloadExecutionTraceJson(run)}>
                  {resultPage('statusCard.exportJson')}
                </Button>
                <Button variant="ghost" onClick={() => handleExportDecisionReport('md')}>
                  {resultPage('statusCard.exportSummaryMd')}
                </Button>
              </>
            ) : null}
          </div>
          {run.statusHistory?.length ? (
            <Disclosure summary={resultPage('statusCard.viewStatusTimeline', { count: run.statusHistory.length })}>
              <div className="product-chip-list">
                {run.statusHistory.map((item, index) => (
                  <span key={`${item.status}-${item.at || index}`} className="product-chip">
                    {index + 1}. {formatStatusHistoryLabel(item)}
                  </span>
                ))}
              </div>
            </Disclosure>
          ) : null}
          {runError ? <ApiErrorAlert error={runError} className="mt-4" /> : null}
          {cancelError ? <ApiErrorAlert error={cancelError} className="mt-4" /> : null}
          {presetNotice ? (
            <div className="mt-4">
              <Banner tone="success" title={presetNotice} body={resultPage('statusCard.reusableBanner', { count: availablePresets.length })} />
            </div>
          ) : null}
        </Card>
      </section>
    );
  };

  const renderCompletedTabPanel = () => {
    if (!run || !normalized) return null;

    switch (activeTab) {
      case 'overview':
        return (
          <section
            className="backtest-display-section"
            id="deterministic-result-tab-panel-overview"
            data-testid="deterministic-result-tab-panel-overview"
            role="tabpanel"
            aria-labelledby="deterministic-result-tab-overview"
          >
            <Card title={resultPage('overview.title')} subtitle={resultPage('overview.subtitle')} className="product-section-card product-section-card--backtest-secondary">
              <p className="product-section-copy">{resultPage('overview.intro')}</p>
              <SummaryStrip
                items={[
                  { label: resultPage('overview.metricAuditRows'), value: String(normalized.viewerMeta.rowCount) },
                  { label: resultPage('overview.metricTradeEvents'), value: String(normalized.tradeEvents.length) },
                  { label: resultPage('overview.metricBenchmarkReturn'), value: pct(run.benchmarkReturnPct) },
                  { label: resultPage('overview.metricBuyAndHold'), value: pct(run.buyAndHoldReturnPct) },
                ]}
              />
              <Disclosure summary={resultPage('overview.benchmarkDisclosure')}>
                <div className="backtest-result-page__tab-stack">
                  <div className="preview-grid">
                    <div className="preview-card">
                      <p className="metric-card__label">{resultPage('overview.selectedBenchmark')}</p>
                      <p className="preview-card__text">{selectedBenchmarkLabel}</p>
                    </div>
                    <div className="preview-card">
                      <p className="metric-card__label">{resultPage('overview.vsBenchmark')}</p>
                      <p className="preview-card__text">{pct(run.excessReturnVsBenchmarkPct)}</p>
                    </div>
                    <div className="preview-card">
                      <p className="metric-card__label">{resultPage('overview.buyAndHold')}</p>
                      <p className="preview-card__text">{buyAndHoldLabel} · {pct(run.buyAndHoldReturnPct)}</p>
                    </div>
                    <div className="preview-card">
                      <p className="metric-card__label">{resultPage('overview.statusTimeline')}</p>
                      <p className="preview-card__text">{resultPage('overview.checkpoints', { count: run.statusHistory.length })}</p>
                    </div>
                  </div>
                  <p className="product-footnote">{benchmarkStatusNote}</p>
                  <AssumptionList assumptions={run.executionAssumptions} emptyText={resultPage('overview.emptyExecutionAssumptions')} />
                </div>
              </Disclosure>
              <Disclosure summary={resultPage('overview.exportSummaryDisclosure')}>
                <div className="backtest-result-page__tab-stack">
                  <div className="summary-block">
                    <div className="summary-block__header">
                      <div>
                        <h3 className="summary-block__title">{resultPage('overview.resultSummaryTitle')}</h3>
                        <p className="product-section-copy">{resultPage('overview.resultSummaryBody')}</p>
                      </div>
                      <div className="product-action-row">
                        <Button variant="secondary" onClick={() => handleExportDecisionReport('md')}>{resultPage('overview.exportMarkdown')}</Button>
                        <Button variant="ghost" onClick={() => handleExportDecisionReport('html')}>{resultPage('overview.exportHtml')}</Button>
                      </div>
                    </div>
                    <pre className="comparison-report-preview">{decisionReportMarkdown}</pre>
                  </div>
                </div>
              </Disclosure>
            </Card>
          </section>
        );
      case 'audit':
        return (
          <section
            className="backtest-display-section"
            id="deterministic-result-tab-panel-audit"
            data-testid="deterministic-result-tab-panel-audit"
            role="tabpanel"
            aria-labelledby="deterministic-result-tab-audit"
          >
            <ExecutionTracePanel run={run} />
            <DeterministicAuditTable run={run} rows={normalized.rows} />
          </section>
        );
      case 'trades':
        return (
          <section
            className="backtest-display-section"
            id="deterministic-result-tab-panel-trades"
            data-testid="deterministic-result-tab-panel-trades"
            role="tabpanel"
            aria-labelledby="deterministic-result-tab-trades"
          >
            <DeterministicTradeEventTable events={normalized.tradeEvents} />
          </section>
        );
      case 'parameters':
        return (
          <section
            className="backtest-display-section"
            id="deterministic-result-tab-panel-parameters"
            data-testid="deterministic-result-tab-panel-parameters"
            role="tabpanel"
            aria-labelledby="deterministic-result-tab-parameters"
          >
            <Card title={resultPage('parameters.title')} subtitle={resultPage('parameters.subtitle')} className="product-section-card product-section-card--backtest-secondary">
              <SummaryStrip
                items={[
                  { label: resultPage('parameters.metricInitialCapital'), value: formatNumber(run.initialCapital) },
                  { label: resultPage('parameters.metricLookback'), value: String(run.lookbackBars) },
                  { label: resultPage('parameters.metricFeesSlippage'), value: `${formatNumber(run.feeBps, 1)}bp / ${formatNumber(run.slippageBps, 1)}bp` },
                  { label: resultPage('parameters.metricParseConfidence'), value: run.parsedConfidence == null ? '--' : pct(run.parsedConfidence * 100) },
                ]}
              />
              <div className="backtest-result-page__tab-stack">
                <Disclosure summary={resultPage('parameters.snapshotDisclosure')}>
                  <div className="preview-grid">
                    <div className="preview-card">
                      <p className="metric-card__label">{resultPage('parameters.instrument')}</p>
                      <p className="preview-card__text">{run.code}</p>
                    </div>
                    <div className="preview-card">
                      <p className="metric-card__label">{resultPage('parameters.backtestWindow')}</p>
                      <p className="preview-card__text">{run.startDate || '--'} {'->'} {run.endDate || '--'}</p>
                    </div>
                    <div className="preview-card">
                      <p className="metric-card__label">{resultPage('parameters.submittedAt')}</p>
                      <p className="preview-card__text">{formatDateTime(run.runAt)}</p>
                    </div>
                    <div className="preview-card">
                      <p className="metric-card__label">{resultPage('parameters.completedAt')}</p>
                      <p className="preview-card__text">{formatDateTime(run.completedAt)}</p>
                    </div>
                  </div>
                </Disclosure>

                <Disclosure summary={resultPage('parameters.benchmarkDisclosure')}>
                  <div className="preview-grid">
                    <div className="preview-card">
                      <p className="metric-card__label">{resultPage('overview.selectedBenchmark')}</p>
                      <p className="preview-card__text">{selectedBenchmarkLabel}</p>
                    </div>
                    <div className="preview-card">
                      <p className="metric-card__label">{resultPage('parameters.benchmarkReturn')}</p>
                      <p className="preview-card__text">{pct(run.benchmarkReturnPct)}</p>
                    </div>
                    <div className="preview-card">
                      <p className="metric-card__label">{resultPage('overview.buyAndHold')}</p>
                      <p className="preview-card__text">{buyAndHoldLabel} · {pct(run.buyAndHoldReturnPct)}</p>
                    </div>
                    <div className="preview-card">
                      <p className="metric-card__label">{resultPage('overview.vsBenchmark')}</p>
                      <p className="preview-card__text">{pct(run.excessReturnVsBenchmarkPct)}</p>
                    </div>
                  </div>
                  <p className="product-footnote mt-4">{benchmarkStatusNote}</p>
                </Disclosure>

                <Disclosure summary={resultPage('parameters.executionAssumptionsDisclosure')}>
                  <AssumptionList assumptions={run.executionAssumptions} emptyText={resultPage('overview.emptyExecutionAssumptions')} />
                </Disclosure>

                {hasRobustnessAnalysis ? (
                  <Disclosure summary={backtestCopy('resultPage.riskControls.robustnessDisclosure')}>
                    <div className="backtest-result-page__tab-stack">
                      <SummaryStrip
                        items={[
                          { label: backtestCopy('resultPage.riskControls.status'), value: getRobustnessStateLabel(getObjectField(robustnessAnalysis, 'state'), language) },
                          { label: backtestCopy('resultPage.riskControls.walkForwardWindow'), value: formatNumber(getObjectField(walkForward, 'windowCount') as number | null | undefined, 0) },
                          { label: backtestCopy('resultPage.riskControls.monteCarloSimulation'), value: formatNumber(getObjectField(monteCarlo, 'simulationCount') as number | null | undefined, 0) },
                          { label: backtestCopy('resultPage.riskControls.stressScenario'), value: formatNumber(getObjectField(stressTests, 'scenarioCount') as number | null | undefined, 0) },
                        ]}
                      />
                      <div className="preview-grid">
                        <div className="preview-card">
                          <p className="metric-card__label">{backtestCopy('resultPage.riskControls.walkForwardMeanReturn')}</p>
                          <p className="preview-card__text">{pct(getObjectField(walkForwardAggregate, 'meanTotalReturnPct') as number | null | undefined)}</p>
                        </div>
                        <div className="preview-card">
                          <p className="metric-card__label">{backtestCopy('resultPage.riskControls.monteCarloMedianReturn')}</p>
                          <p className="preview-card__text">{pct(getObjectField(monteCarloAggregate, 'medianTotalReturnPct') as number | null | undefined)}</p>
                        </div>
                        <div className="preview-card">
                          <p className="metric-card__label">{backtestCopy('resultPage.riskControls.worstScenario')}</p>
                          <p className="preview-card__text">{String(getObjectField(worstScenario, 'scenarioKey') || '--')}</p>
                        </div>
                      </div>
                      <div className="summary-block mt-4" data-testid="robustness-lens">
                        <div className="summary-block__header">
                          <div>
                            <h3 className="summary-block__title">{backtestCopy('resultPage.riskControls.robustnessLens')}</h3>
                          </div>
                        </div>
                        <div className="space-y-3">
                          {robustnessLensRows.map((row) => {
                            const width = row.ratio > 0 ? Math.max(14, row.ratio * 100) : 0;
                            return (
                              <div
                                key={row.key}
                                className={`space-y-1.5 rounded-[0.85rem] px-2 py-1.5 transition-colors ${
                                  activeRobustnessKey === row.key ? 'bg-[rgba(125,211,252,0.1)]' : ''
                                }`}
                                data-linked-highlight={activeRobustnessKey === row.key ? 'true' : undefined}
                                data-testid={`robustness-lens-row-${row.key}`}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div>
                                    <p className="metric-card__label">{row.label}</p>
                                    <p className="preview-card__text">{row.summary} · {row.detail}</p>
                                  </div>
                                  <span className="product-chip">{row.state}</span>
                                </div>
                                <div className="h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
                                  <div
                                    className="h-full rounded-full bg-[var(--backtest-accent,#7dd3fc)]"
                                    style={{ width: `${width}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <RobustnessCoverageTrack rows={robustnessLensRows} />
                    </div>
                  </Disclosure>
                ) : null}

                <Disclosure summary={resultPage('parameters.executedSetupDisclosure')}>
                  <div className="backtest-result-page__tab-stack">
                    <div className="summary-block">
                      <div className="summary-block__header">
                        <div>
                          <h3 className="summary-block__title">{resultPage('parameters.executedSetupTitle')}</h3>
                        </div>
                      </div>
                      <p className="product-section-copy">{resultPage('parameters.executedSetupBody')}</p>
                      <div className="product-chip-list mt-4">
                        <span className="product-chip">{resultPage('parameters.chipStrategyFamily')} · {getRuleStrategyTypeLabel(run.parsedStrategy, undefined, language)}</span>
                        <span className="product-chip">{resultPage('parameters.chipSpecSource')} · {getRuleStrategySpecSourceLabel(run.parsedStrategy, language)}</span>
                        <span className="product-chip">{resultPage('parameters.chipNormalization')} · {formatRuleNormalizationStateLabel(run.parsedStrategy.normalizationState, language)}</span>
                        <span className="product-chip">{resultPage('parameters.chipNeedsConfirmation')} · {run.needsConfirmation ? backtestCopy('common.yes') : backtestCopy('common.no')}</span>
                        <span className="product-chip">{resultPage('parameters.chipExecutable')} · {run.parsedStrategy.executable ? backtestCopy('common.yes') : backtestCopy('common.no')}</span>
                      </div>
                    </div>
                    <div className="preview-grid">
                      {strategySummaryRows.map((row) => (
                        <div key={`${row.label}-${row.value}`} className="preview-card">
                          <p className="metric-card__label">{row.label}</p>
                          <p className="preview-card__text">{row.value}</p>
                        </div>
                      ))}
                    </div>
                    <RiskControlsLadder rows={riskControlRows} activeRiskControlKey={activeRiskControlKey} />
                  </div>
                </Disclosure>

                <Disclosure summary={resultPage('parameters.originalInputDisclosure')}>
                  <div className="backtest-result-page__tab-stack">
                    <div className="summary-block">
                      <div className="summary-block__header">
                        <div>
                          <h3 className="summary-block__title">{resultPage('parameters.originalInputTitle')}</h3>
                        </div>
                      </div>
                      <p className="product-section-copy">{run.strategyText || '--'}</p>
                      {run.aiSummary ? <p className="product-footnote mt-3">{run.aiSummary}</p> : null}
                    </div>
                    <div className="preview-grid">
                      <div className="preview-card">
                        <p className="metric-card__label">{resultPage('parameters.timeframe')}</p>
                        <p className="preview-card__text">{run.timeframe || '--'}</p>
                      </div>
                      <div className="preview-card">
                        <p className="metric-card__label">{resultPage('parameters.chipSpecSource')}</p>
                        <p className="preview-card__text">{getRuleStrategySpecSourceLabel(run.parsedStrategy, language)}</p>
                      </div>
                      <div className="preview-card">
                        <p className="metric-card__label">{resultPage('parameters.chipStrategyFamily')}</p>
                        <p className="preview-card__text">{getRuleStrategyTypeLabel(run.parsedStrategy, undefined, language)}</p>
                      </div>
                      <div className="preview-card">
                        <p className="metric-card__label">{resultPage('parameters.normalizationState')}</p>
                        <p className="preview-card__text">{formatRuleNormalizationStateLabel(run.parsedStrategy.normalizationState, language)}</p>
                      </div>
                    </div>
                    {parsedSummaryEntries.length ? (
                      <dl className="audit-grid">
                        {parsedSummaryEntries.map((entry) => (
                          <div key={entry.label} className="audit-grid__row">
                            <dt className="audit-grid__label">{entry.label}</dt>
                            <dd className="audit-grid__value">{entry.value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="product-empty-note">{resultPage('parameters.interpretationSummaryEmpty')}</p>
                    )}
                  </div>
                </Disclosure>

                <Disclosure summary={resultPage('parameters.technicalNotesDisclosure')}>
                  <div className="backtest-result-page__tab-stack">
                    {strategyWarningEntries.length ? (
                      <div className="summary-block">
                        <div className="summary-block__header">
                          <div>
                            <h3 className="summary-block__title">{resultPage('parameters.defaultFillsTitle')}</h3>
                          </div>
                        </div>
                        <ul className="backtest-result-page__list">
                          {strategyWarningEntries.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {run.noResultMessage ? <p className="product-footnote">{run.noResultMessage}</p> : null}
                    {run.parsedStrategy.unsupportedReason ? <p className="product-footnote">{run.parsedStrategy.unsupportedReason}</p> : null}
                  </div>
                </Disclosure>

                <Disclosure summary={resultPage('parameters.scenarioComparisonDisclosure')}>
                  <div className="backtest-result-page__tab-stack">
                    <div className="summary-block">
                      <div className="summary-block__header">
                        <div>
                          <h3 className="summary-block__title">{resultPage('parameters.scenarioComparisonTitle')}</h3>
                          <p className="product-section-copy">{resultPage('parameters.scenarioComparisonBody')}</p>
                        </div>
                        <Button
                          variant="secondary"
                          onClick={() => void handleRunScenarioPlan()}
                          isLoading={isSubmittingScenarioRuns}
                          loadingText={resultPage('parameters.submittingScenarios')}
                          disabled={!selectedScenarioPlan}
                        >
                          {resultPage('parameters.runCurrentScenarioSet')}
                        </Button>
                      </div>
                      <div className="comparison-card-grid">
                        {scenarioPlans.map((plan) => (
                          <button
                            key={plan.id}
                            type="button"
                            className={`comparison-card comparison-card--selectable${selectedScenarioPlan?.id === plan.id ? ' is-active' : ''}`}
                            onClick={() => setSelectedScenarioPlanId(plan.id)}
                          >
                            <div className="comparison-card__header">
                              <div>
                                <p className="metric-card__label">{resultPage('parameters.scenarioPlan')}</p>
                                <h3 className="comparison-card__title">{plan.label}</h3>
                              </div>
                              <span className="product-chip">{resultPage('parameters.variants', { count: plan.variants.length })}</span>
                            </div>
                            <p className="comparison-card__narrative">{plan.description}</p>
                            <div className="product-chip-list product-chip-list--tight">
                              {plan.variants.map((variant) => (
                                <span key={`${plan.id}-${variant.id}`} className="product-chip">{variant.label}</span>
                              ))}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                    {scenarioError ? <ApiErrorAlert error={scenarioError} /> : null}
                    {scenarioRuns.length > 0 ? (
                      <div className="product-table-shell">
                        <table className="product-table">
                          <thead>
                            <tr>
                              <th>{resultPage('parameters.scenario')}</th>
                              <th>{backtestCopy('common.status')}</th>
                              <th>Run ID</th>
                              <th className="product-table__align-right">{backtestCopy('common.action')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {scenarioRuns.map((item) => (
                              <tr key={item.variantId}>
                                <td>
                                  <div className="product-table__stack">
                                    <span>{item.label}</span>
                                    <span>{item.description}</span>
                                  </div>
                                </td>
                                <td>{getRuleRunStatusLabel(item.status, language)}</td>
                                <td className="product-table__mono">{item.runId || '--'}</td>
                                <td className="product-table__align-right">
                                  {item.runId ? (
                                    <Button size="sm" variant="ghost" onClick={() => navigate(`/backtest/results/${item.runId}`)}>
                                      {backtestCopy('common.open')}
                                    </Button>
                                  ) : (
                                    '--'
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                    <RuleRunComparisonPanel
                      title={resultPage('parameters.scenarioResultComparisonTitle')}
                      subtitle={resultPage('parameters.scenarioResultComparisonSubtitle')}
                      items={scenarioComparisonItems}
                      emptyText={resultPage('parameters.scenarioResultComparisonEmpty')}
                    />
                  </div>
                </Disclosure>

                <Disclosure summary={resultPage('parameters.reusableSetupDisclosure')}>
                  <div className="backtest-result-page__tab-stack">
                    <div className="summary-block__header">
                      <div>
                        <h3 className="summary-block__title">{resultPage('parameters.reusableSetupTitle')}</h3>
                        <p className="product-section-copy">{resultPage('parameters.reusableSetupBody')}</p>
                      </div>
                      <Button variant="secondary" onClick={handleSavePreset}>{resultPage('parameters.saveAsPreset')}</Button>
                    </div>
                    <div className="product-chip-list">
                      {availablePresets.map((preset) => (
                        <span key={preset.id} className="product-chip">
                          {preset.kind === 'saved' ? resultPage('parameters.presetKindSaved') : resultPage('parameters.presetKindRecent')} · {preset.name}
                        </span>
                      ))}
                    </div>
                  </div>
                </Disclosure>
              </div>
            </Card>
          </section>
        );
      case 'history':
        return (
          <section
            className="backtest-display-section"
            id="deterministic-result-tab-panel-history"
            data-testid="deterministic-result-tab-panel-history"
            role="tabpanel"
            aria-labelledby="deterministic-result-tab-history"
          >
            <Card title={resultPage('history.title')} subtitle={resultPage('history.subtitle')} className="product-section-card product-section-card--backtest-secondary">
              <div className="summary-block__header">
                <div>
                  <h3 className="summary-block__title">{resultPage('history.runsTitle')}</h3>
                  <p className="product-section-copy">{resultPage('history.runsBody')}</p>
                </div>
                <Button variant="ghost" onClick={() => void fetchHistory(run.code)} disabled={isLoadingHistory}>
                  {isLoadingHistory ? resultPage('history.refreshing') : resultPage('history.refresh')}
                </Button>
              </div>
              {historyError ? <ApiErrorAlert error={historyError} className="mb-4" /> : null}
              {compareError ? <ApiErrorAlert error={compareError} className="mb-4" /> : null}
              {isLoadingCompareRuns ? <p className="product-footnote">{resultPage('history.loadingComparedRuns')}</p> : null}
              <RuleRunComparisonPanel
                title={resultPage('history.runComparisonTitle')}
                subtitle={resultPage('history.runComparisonSubtitle')}
                items={comparisonItems}
                emptyText={resultPage('history.runComparisonEmpty')}
              />
              <div className="product-action-row mt-4">
                <Button variant="secondary" onClick={handleOpenCompareWorkbench} disabled={compareRunIds.length === 0}>
                  {resultPage('history.openCompareWorkbench')}
                </Button>
                <Button variant="ghost" onClick={() => setCompareRunIds([])} disabled={compareRunIds.length === 0}>{resultPage('history.clearComparison')}</Button>
              </div>
              <RuleRunsTable
                rows={historyItems}
                selectedRunId={run.id}
                onOpen={handleOpenHistoryRun}
                compareSelection={{
                  selectedIds: compareRunIds,
                  onToggle: handleToggleCompareRun,
                  maxSelections: 3,
                }}
              />
            </Card>
          </section>
        );
      default:
        return null;
    }
  };

  return (
    <div
      className="theme-page-transition backtest-v1-page workspace-page--backtest backtest-result-page"
      data-testid="deterministic-backtest-result-page"
      data-density={density.mode}
      style={getDeterministicResultDensityCssVars(density)}
    >
      <section className="backtest-result-page__hero" data-testid="deterministic-result-page-hero">
        <div className="backtest-result-page__hero-copy">
          <p className="backtest-result-page__hero-eyebrow">WolfyStock</p>
          <h1 className="backtest-result-page__hero-title">
            {hasValidRunId
              ? `${backtestCopy('resultPage.documentTitle')} #${parsedRunId}`
              : backtestCopy('resultPage.documentTitle')}
          </h1>
          <p className="backtest-result-page__hero-meta">{headerDescription}</p>
        </div>
        <div className="backtest-result-page__hero-actions">
          <Button variant="ghost" size={density.buttonSize} onClick={() => navigate('/backtest')}>
            {resultPage('hero.backToConfig')}
          </Button>
          {run ? (
            <Button
              variant="secondary"
              size={density.buttonSize}
              onClick={() => navigate('/backtest', { state: { draftRun: run } })}
            >
              {resultPage('hero.rerunSameParameters')}
            </Button>
          ) : null}
          {run ? (
            <Button variant="ghost" size={density.buttonSize} onClick={handleSavePreset}>
              {resultPage('hero.savePreset')}
            </Button>
          ) : null}
          <Button variant="ghost" size={density.buttonSize} onClick={() => void fetchRun()}>
            {resultPage('hero.refreshResult')}
          </Button>
        </div>
      </section>

      {!hasValidRunId ? (
        <section className="backtest-display-section">
          <Card title={resultPage('invalidRun.title')} subtitle={resultPage('invalidRun.subtitle')} className="product-section-card product-section-card--backtest-result">
            <div className="product-empty-state product-empty-state--compact">{resultPage('invalidRun.body')}</div>
          </Card>
        </section>
      ) : null}

      {renderRunStatusSection()}

      {run?.status === 'completed' && normalized ? (
        <>
          <section className="backtest-display-section backtest-result-page__dashboard-stage" data-testid="deterministic-result-page-dashboard-stage">
            <DeterministicBacktestResultView run={run} normalized={normalized} densityConfig={density} />
            <AdditiveDashboardPanels
              hasRobustnessAnalysis={hasRobustnessAnalysis}
              robustnessLensRows={robustnessLensRows}
              riskControlRows={riskControlRows}
              activeRobustnessKey={activeRobustnessKey}
              activeRiskControlKey={activeRiskControlKey}
              onActiveRobustnessChange={setActiveRobustnessKey}
              onActiveRiskControlChange={setActiveRiskControlKey}
            />
          </section>

          <section className="backtest-display-section backtest-result-page__tabs-stage" data-testid="deterministic-result-page-tabs">
            <div className="backtest-mode-toggle backtest-result-page__tabs" role="tablist" aria-label={backtestCopy('resultPage.tabsAria')}>
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  id={`deterministic-result-tab-${tab.key}`}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.key}
                  aria-controls={`deterministic-result-tab-panel-${tab.key}`}
                  className={`backtest-mode-toggle__button${activeTab === tab.key ? ' is-active' : ''}`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </section>

          {renderCompletedTabPanel()}
        </>
      ) : null}
    </div>
  );
};

export default DeterministicBacktestResultPage;
