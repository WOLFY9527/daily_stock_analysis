import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { backtestApi } from '../api/backtest';
import type { ParsedApiError } from '../api/error';
import { getParsedApiError } from '../api/error';
import { ApiErrorAlert, Button, Card, WorkspacePageHeader } from '../components/common';
import {
  Banner,
  SummaryStrip,
  formatDateTime,
  formatNumber,
  pct,
} from '../components/backtest/shared';
import type {
  RuleBacktestCompareHighlightItem,
  RuleBacktestCompareMetricDelta,
  RuleBacktestCompareResponse,
  RuleBacktestCompareRobustnessDimension,
  RuleBacktestCompareRunItem,
} from '../types/backtest';

const COMPARE_METRIC_LABELS: Record<string, string> = {
  totalReturnPct: '总收益',
  annualizedReturnPct: '年化收益',
  maxDrawdownPct: '最大回撤',
  benchmarkReturnPct: '基准收益',
  excessReturnVsBenchmarkPct: '相对基准',
};

const COMPARE_SECTION_LINKS = [
  { id: 'compare-summary', label: '比较摘要' },
  { id: 'compare-chart-strip', label: 'metric strip' },
  { id: 'compare-highlights', label: 'comparison_highlights' },
  { id: 'compare-metric-matrix', label: 'compact metric matrix' },
  { id: 'compare-robustness', label: 'robustness + profile' },
  { id: 'compare-market-period', label: 'market / period context' },
  { id: 'compare-parameter-metrics', label: 'parameter + metrics' },
  { id: 'compare-items', label: '参与运行' },
] as const;

const COMPARE_CHART_STRIP_KEYS = [
  'totalReturnPct',
  'annualizedReturnPct',
  'excessReturnVsBenchmarkPct',
] as const;

function parseRunIdsParam(value: string | null): number[] {
  if (!value) return [];
  const orderedIds: number[] = [];
  value.split(',').forEach((part) => {
    const parsed = Number.parseInt(part.trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || orderedIds.includes(parsed)) return;
    orderedIds.push(parsed);
  });
  return orderedIds;
}

function renderBooleanLabel(value: boolean | undefined): string {
  return value ? 'yes' : 'no';
}

function DiagnosticChipList({ diagnostics }: { diagnostics?: string[] }) {
  if (!diagnostics?.length) {
    return <p className="product-footnote">无额外诊断。</p>;
  }

  return (
    <div className="product-chip-list">
      {diagnostics.map((diagnostic) => (
        <span key={diagnostic} className="product-chip">{diagnostic}</span>
      ))}
    </div>
  );
}

function HighlightCards({ highlights }: { highlights: Record<string, RuleBacktestCompareHighlightItem> }) {
  const entries = Object.entries(highlights || {});
  if (entries.length === 0) {
    return <div className="product-empty-state product-empty-state--compact">当前比较没有可展示的 highlight。</div>;
  }

  return (
    <div className="preview-grid">
      {entries.map(([metricKey, item]) => (
        <div key={metricKey} className="preview-card">
          <p className="metric-card__label">{item.metric || metricKey}</p>
          <p className="preview-card__text">{item.state}</p>
          <p className="product-footnote">winner_run_ids: {item.winnerRunIds.length ? item.winnerRunIds.join(', ') : '--'}</p>
          <p className="product-footnote">winner_value: {item.winnerValue == null ? '--' : formatNumber(item.winnerValue)}</p>
          <p className="product-footnote">candidate_count: {item.candidateCount}</p>
          <DiagnosticChipList diagnostics={item.diagnostics} />
        </div>
      ))}
    </div>
  );
}

function RobustnessDimensionCards({ dimensions }: { dimensions: Record<string, RuleBacktestCompareRobustnessDimension> }) {
  const entries = Object.entries(dimensions || {});
  if (entries.length === 0) return null;

  return (
    <div className="preview-grid">
      {entries.map(([dimensionKey, dimension]) => (
        <div key={dimensionKey} className="preview-card">
          <p className="metric-card__label">{dimensionKey}</p>
          <p className="preview-card__text">{dimension.state}</p>
          <p className="product-footnote">relationship: {dimension.relationship || '--'}</p>
          <p className="product-footnote">source_state: {dimension.sourceState || '--'}</p>
          <p className="product-footnote">directly_comparable: {dimension.directlyComparable == null ? '--' : renderBooleanLabel(dimension.directlyComparable)}</p>
          <DiagnosticChipList diagnostics={dimension.diagnostics} />
        </div>
      ))}
    </div>
  );
}

function MetricDeltaTable({ metricDeltas }: { metricDeltas: Record<string, RuleBacktestCompareMetricDelta> }) {
  const entries = Object.entries(metricDeltas || {});
  if (entries.length === 0) {
    return <div className="product-empty-state product-empty-state--compact">当前比较没有可展示的 metric delta。</div>;
  }

  return (
    <div className="product-table-shell">
      <table className="product-table">
        <thead>
          <tr>
            <th>指标</th>
            <th>state</th>
            <th className="product-table__align-right">baseline</th>
            <th>available</th>
            <th>deltas</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([metricKey, metric]) => (
            <tr key={metricKey}>
              <td>{metricKey}</td>
              <td>{metric.state}</td>
              <td className="product-table__align-right">{pct(metric.baselineValue)}</td>
              <td>{metric.availableRunIds.join(', ') || '--'}</td>
              <td>
                <div className="product-table__stack">
                  {metric.deltas.map((item) => (
                    <span key={`${metricKey}-${item.runId}`}>
                      #{item.runId}: {pct(item.value)} ({pct(item.deltaVsBaseline)})
                    </span>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatMetricLabel(metricKey: string, fallback?: string): string {
  return COMPARE_METRIC_LABELS[metricKey]
    || fallback
    || metricKey.replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function formatSignedPct(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function getMetricSummaryTone(state?: string): string {
  const normalized = String(state || '').toLowerCase();
  if (normalized.includes('unavailable')) return 'unavailable';
  if (normalized.includes('limited') || normalized.includes('partial')) return 'limited';
  if (normalized.includes('winner')) return 'best';
  return 'neutral';
}

function getMetricStateTone({
  state,
  highlightApplies,
  isUnavailable,
}: {
  state?: string;
  highlightApplies: boolean;
  isUnavailable: boolean;
}): string {
  if (isUnavailable) return 'unavailable';
  if (highlightApplies) return 'best';
  const normalized = String(state || '').toLowerCase();
  if (normalized.includes('limited') || normalized.includes('partial')) return 'limited';
  return 'neutral';
}

function getMetricDeltaTone(value?: number | null, isBaseline?: boolean): string {
  if (isBaseline) return 'baseline';
  if (value == null || Number.isNaN(value) || value === 0) return 'neutral';
  return value > 0 ? 'positive' : 'negative';
}

function orderCompareItems(items: RuleBacktestCompareRunItem[], runIds: number[]): RuleBacktestCompareRunItem[] {
  const orderMap = new Map(runIds.map((runId, index) => [runId, index]));
  return [...items].sort((left, right) => {
    const leftOrder = orderMap.get(left.metadata.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = orderMap.get(right.metadata.id) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });
}

function CompareMetricMatrix({
  items,
  baselineRunId,
  metricDeltas,
  highlights,
  overallState,
  primaryProfile,
}: {
  items: RuleBacktestCompareRunItem[];
  baselineRunId?: number | null;
  metricDeltas: Record<string, RuleBacktestCompareMetricDelta>;
  highlights: Record<string, RuleBacktestCompareHighlightItem>;
  overallState?: string;
  primaryProfile?: string;
}) {
  const metricEntries = Object.entries(metricDeltas || {});
  if (!items.length || !metricEntries.length) {
    return <div className="product-empty-state product-empty-state--compact">当前比较没有足够的指标数据来生成紧凑矩阵。</div>;
  }

  return (
    <div className="product-table-shell compare-metric-matrix" data-testid="compare-metric-matrix">
      <table className="product-table comparison-table">
        <thead>
          <tr>
            <th>指标</th>
            <th>摘要</th>
            {items.map((item) => {
              const runId = item.metadata.id;
              const roleLabel = runId === baselineRunId ? 'baseline' : 'candidate';
              return (
                <th key={runId} scope="col">
                  <div className="product-table__stack">
                    <span>{`#${runId} ${roleLabel}`}</span>
                    <span>{item.metadata.code || '--'}</span>
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {metricEntries.map(([metricKey, metric]) => {
            const highlight = highlights[metricKey];
            return (
              <tr key={metricKey}>
                <td>
                  <div className="product-table__stack">
                    <span>{formatMetricLabel(metricKey, metric.label)}</span>
                    <span className="compare-metric-badge" data-tone={getMetricSummaryTone(metric.state)}>{metric.state}</span>
                  </div>
                </td>
                <td>
                  <div className="product-table__stack">
                    <span
                      className="compare-metric-badge"
                      data-testid={`compare-metric-summary-${metricKey}`}
                      data-tone={getMetricSummaryTone(highlight?.state || metric.state)}
                    >
                      {highlight?.state || metric.state}
                    </span>
                    <span className="product-footnote">{`context ${overallState || '--'} · profile ${primaryProfile || '--'}`}</span>
                  </div>
                </td>
                {items.map((item) => {
                  const runId = item.metadata.id;
                  const deltaItem = metric.deltas.find((entry) => entry.runId === runId);
                  const highlightApplies = Boolean(highlight?.winnerRunIds.includes(runId));
                  const isUnavailable = !deltaItem;
                  const cellTone = highlightApplies ? 'best' : 'default';
                  return (
                    <td key={`${metricKey}-${runId}`} data-tone={cellTone}>
                      {isUnavailable ? (
                        <div className="product-table__stack">
                          <span
                            className="compare-metric-badge"
                            data-testid={`compare-metric-state-${metricKey}-${runId}`}
                            data-tone="unavailable"
                          >
                            unavailable
                          </span>
                          <span className="product-footnote">{highlight?.state || metric.state}</span>
                        </div>
                      ) : (
                        <div className="product-table__stack">
                          <span>{pct(deltaItem.value)}</span>
                          {runId === baselineRunId ? (
                            <span
                              className="compare-metric-badge"
                              data-testid={`compare-metric-delta-${metricKey}-${runId}`}
                              data-tone={getMetricDeltaTone(deltaItem.deltaVsBaseline, true)}
                            >
                              baseline
                            </span>
                          ) : (
                            <span
                              className="compare-metric-badge"
                              data-testid={`compare-metric-delta-${metricKey}-${runId}`}
                              data-tone={getMetricDeltaTone(deltaItem.deltaVsBaseline)}
                            >
                              {`delta ${formatSignedPct(deltaItem.deltaVsBaseline)}`}
                            </span>
                          )}
                          <span
                            className="compare-metric-badge"
                            data-testid={`compare-metric-state-${metricKey}-${runId}`}
                            data-tone={getMetricStateTone({
                              state: highlight?.state || metric.state,
                              highlightApplies,
                              isUnavailable: false,
                            })}
                          >
                            {highlightApplies ? (highlight?.state || 'winner') : (highlight?.state || metric.state)}
                          </span>
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CompareMetricChartStrip({
  items,
  baselineRunId,
  metricDeltas,
  highlights,
}: {
  items: RuleBacktestCompareRunItem[];
  baselineRunId?: number | null;
  metricDeltas: Record<string, RuleBacktestCompareMetricDelta>;
  highlights: Record<string, RuleBacktestCompareHighlightItem>;
}) {
  const metricEntries = COMPARE_CHART_STRIP_KEYS.reduce<Array<[string, RuleBacktestCompareMetricDelta]>>((entries, metricKey) => {
    const metric = metricDeltas[metricKey];
    if (metric) entries.push([metricKey, metric]);
    return entries;
  }, []);

  if (!metricEntries.length || !items.length) {
    return <div className="product-empty-state product-empty-state--compact">当前比较没有足够的 trusted metrics 来生成可视化条带。</div>;
  }

  return (
    <div className="comparison-chart compare-chart-strip" data-testid="compare-chart-strip">
      {metricEntries.map(([metricKey, metric]) => {
        const highlight = highlights[metricKey];
        const availableValues = metric.deltas.map((entry) => Math.abs(entry.value ?? 0)).filter((value) => value > 0);
        const maxValue = availableValues.length ? Math.max(...availableValues) : 1;

        return (
          <div key={metricKey} className="compare-chart-strip__row" data-testid={`compare-chart-strip-row-${metricKey}`}>
            <div className="compare-chart-strip__label">
              <span>{formatMetricLabel(metricKey, metric.label)}</span>
              <span className="compare-metric-badge" data-tone={getMetricSummaryTone(highlight?.state || metric.state)}>
                {highlight?.state || metric.state}
              </span>
            </div>
            <div className="compare-chart-strip__lanes">
              {items.map((item) => {
                const runId = item.metadata.id;
                const deltaItem = metric.deltas.find((entry) => entry.runId === runId);
                const isBaseline = runId === baselineRunId;
                const state = deltaItem ? 'available' : 'unavailable';
                const widthPct = deltaItem ? Math.max(12, (Math.abs(deltaItem.value ?? 0) / maxValue) * 100) : 0;
                const tone = deltaItem
                  ? (highlight?.winnerRunIds.includes(runId) ? 'best' : getMetricDeltaTone(deltaItem.value))
                  : 'unavailable';

                return (
                  <div
                    key={`${metricKey}-${runId}`}
                    className="compare-chart-strip__lane"
                    data-testid={`compare-chart-strip-${metricKey}-${runId}`}
                    data-role={isBaseline ? 'baseline' : 'candidate'}
                    data-state={state}
                  >
                    <div className="compare-chart-strip__meta">
                      <span>{`#${runId} ${isBaseline ? 'baseline' : 'candidate'}`}</span>
                      <span>{item.metadata.code || '--'}</span>
                    </div>
                    {deltaItem ? (
                      <>
                        <div className="compare-chart-strip__bar-shell">
                          <div className="compare-chart-strip__bar" data-tone={tone} style={{ width: `${widthPct}%` }} />
                        </div>
                        <div className="compare-chart-strip__value">
                          <span>{pct(deltaItem.value)}</span>
                          {!isBaseline ? <span className="product-footnote">{`vs baseline ${formatSignedPct(deltaItem.deltaVsBaseline)}`}</span> : null}
                        </div>
                      </>
                    ) : (
                      <span className="compare-metric-badge" data-tone="unavailable">unavailable</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CompareItemsTable({
  items,
  baselineRunId,
  onOpenRun,
  onMakeBaseline,
  onRemoveRun,
}: {
  items: RuleBacktestCompareRunItem[];
  baselineRunId?: number | null;
  onOpenRun: (runId: number) => void;
  onMakeBaseline: (runId: number) => void;
  onRemoveRun: (runId: number) => void;
}) {
  if (!items.length) {
    return <div className="product-empty-state product-empty-state--compact">当前比较没有可展示的运行详情。</div>;
  }

  return (
    <div className="product-table-shell">
      <table className="product-table">
        <thead>
          <tr>
            <th>run</th>
            <th>代码 / 状态</th>
            <th>区间</th>
            <th className="product-table__align-right">总收益</th>
            <th className="product-table__align-right">超额</th>
            <th className="product-table__align-right">回撤</th>
            <th className="product-table__align-right">交易</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const metadata = item.metadata || { id: 0 };
            const metrics = item.metrics || {};
            const isBaseline = baselineRunId === metadata.id;
            return (
              <tr key={metadata.id} data-active={isBaseline ? 'true' : 'false'}>
                <td>
                  <div className="product-table__stack">
                    <span>#{metadata.id}</span>
                    <span>{isBaseline ? 'baseline' : 'candidate'}</span>
                  </div>
                </td>
                <td>
                  <div className="product-table__stack">
                    <span>{metadata.code || '--'}</span>
                    <span>{metadata.status || '--'}</span>
                  </div>
                </td>
                <td>
                  <div className="product-table__stack">
                    <span>{metadata.startDate || '--'} {'->'} {metadata.endDate || '--'}</span>
                    <span>{formatDateTime(metadata.completedAt)}</span>
                  </div>
                </td>
                <td className="product-table__align-right">{pct(metrics.totalReturnPct)}</td>
                <td className="product-table__align-right">{pct(metrics.excessReturnVsBenchmarkPct)}</td>
                <td className="product-table__align-right">{pct(metrics.maxDrawdownPct)}</td>
                <td className="product-table__align-right">{metrics.tradeCount ?? '--'}</td>
                <td>
                  <div className="product-table__stack compare-run-actions">
                    <Button size="sm" variant="ghost" aria-label={`打开结果页 ${metadata.id}`} onClick={() => onOpenRun(metadata.id)}>
                      打开结果页
                    </Button>
                    {isBaseline ? (
                      <span className="product-footnote">当前 baseline</span>
                    ) : (
                      <>
                        <Button size="sm" variant="ghost" aria-label={`设为 baseline ${metadata.id}`} onClick={() => onMakeBaseline(metadata.id)}>
                          设为 baseline
                        </Button>
                        <Button size="sm" variant="ghost" aria-label={`移除运行 ${metadata.id}`} onClick={() => onRemoveRun(metadata.id)}>
                          移除运行
                        </Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const RuleBacktestComparePage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const runIds = useMemo(() => parseRunIdsParam(searchParams.get('runIds')), [searchParams]);
  const [response, setResponse] = useState<RuleBacktestCompareResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ParsedApiError | null>(null);

  const fetchCompare = useCallback(async () => {
    if (runIds.length < 2) {
      setResponse(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const payload = await backtestApi.compareRuleBacktestRuns({ runIds });
      setResponse(payload);
      setError(null);
    } catch (nextError) {
      setError(getParsedApiError(nextError));
    } finally {
      setIsLoading(false);
    }
  }, [runIds]);

  useEffect(() => {
    document.title = '规则回测比较工作台 - WolfyStock';
  }, []);

  useEffect(() => {
    void fetchCompare();
  }, [fetchCompare]);

  const orderedItems = useMemo(() => orderCompareItems(response?.items || [], runIds), [response?.items, runIds]);
  const baselineRunId = response?.comparisonSummary?.baseline.runId
    ?? response?.robustnessSummary?.baselineRunId
    ?? response?.comparisonProfile?.baselineRunId
    ?? runIds[0]
    ?? null;
  const baselineItem = orderedItems.find((item) => item.metadata.id === baselineRunId) || null;
  const comparisonSummary = response?.comparisonSummary || null;
  const robustnessSummary = response?.robustnessSummary || null;
  const comparisonProfile = response?.comparisonProfile || null;
  const comparisonHighlights = response?.comparisonHighlights || null;
  const parameterComparison = response?.parameterComparison || null;
  const marketCodeComparison = response?.marketCodeComparison || null;
  const periodComparison = response?.periodComparison || null;

  const handleOpenRun = useCallback((runId: number) => {
    navigate(`/backtest/results/${runId}`);
  }, [navigate]);

  const handleRemoveRun = useCallback((runId: number) => {
    const nextRunIds = runIds.filter((id) => id !== runId);
    const nextParams = new URLSearchParams(searchParams);
    setResponse(null);
    if (nextRunIds.length) {
      nextParams.set('runIds', nextRunIds.join(','));
    } else {
      nextParams.delete('runIds');
    }
    setSearchParams(nextParams);
  }, [runIds, searchParams, setSearchParams]);

  const handleMakeBaseline = useCallback((runId: number) => {
    if (runIds[0] === runId) return;
    const nextRunIds = [runId, ...runIds.filter((id) => id !== runId)];
    const nextParams = new URLSearchParams(searchParams);
    setResponse(null);
    nextParams.set('runIds', nextRunIds.join(','));
    setSearchParams(nextParams);
  }, [runIds, searchParams, setSearchParams]);

  return (
    <div className="theme-page-transition backtest-v1-page workspace-page--backtest" data-testid="rule-backtest-compare-page">
      <WorkspacePageHeader
        eyebrow="WolfyStock"
        title="规则回测比较工作台"
        description={`按请求顺序对比已完成规则回测运行。当前 runIds: ${runIds.length ? runIds.join(', ') : '--'}`}
        className="backtest-v1-header"
        contentClassName="backtest-v1-header__layout"
        descriptionClassName="backtest-v1-header__description"
        actions={(
          <div className="product-action-row">
            <Button variant="ghost" onClick={() => navigate('/backtest')}>
              返回回测工作区
            </Button>
            <Button variant="secondary" onClick={() => void fetchCompare()} disabled={runIds.length < 2}>
              {isLoading ? '刷新中…' : '刷新比较'}
            </Button>
          </div>
        )}
      />

      {runIds.length < 2 ? (
        <section className="backtest-display-section">
          <Card title="比较工作台未就绪" subtitle="需要至少两条运行记录" className="product-section-card product-section-card--backtest-result">
            <div className="product-empty-state product-empty-state--compact">至少需要 2 条已完成运行才能打开比较工作台。</div>
          </Card>
        </section>
      ) : null}

      {runIds.length >= 2 && isLoading && !response ? (
        <section className="backtest-display-section">
          <Card title="加载比较结果" subtitle="正在调用 stored-first compare API" className="product-section-card product-section-card--backtest-result">
            <div className="product-empty-state product-empty-state--compact">正在拉取比较结果…</div>
          </Card>
        </section>
      ) : null}

      {runIds.length >= 2 && error ? (
        <section className="backtest-display-section">
          <Card title="比较加载失败" subtitle="compare API 返回了错误" className="product-section-card product-section-card--backtest-result">
            <ApiErrorAlert error={error} />
          </Card>
        </section>
      ) : null}

      {runIds.length >= 2 && response ? (
        <>
          <div className="compare-section-nav-shell">
            <nav className="compare-section-nav" aria-label="比较区块导航">
              {COMPARE_SECTION_LINKS.map((item) => (
                <a key={item.id} className="product-chip product-chip--interactive compare-section-nav__link" href={`#${item.id}`}>
                  {item.label}
                </a>
              ))}
            </nav>
          </div>

          <section id="compare-summary" className="backtest-display-section">
            <Card title="比较摘要" subtitle="先看整体上下文，再决定是否相信单项领先" className="product-section-card product-section-card--backtest-result">
              <SummaryStrip
                items={[
                  {
                    label: 'baseline_run_id',
                    value: baselineRunId == null ? '--' : `#${baselineRunId}`,
                    note: baselineItem?.metadata.code || comparisonSummary?.baseline.code || '--',
                  },
                  {
                    label: 'overall_state',
                    value: robustnessSummary?.overallState || '--',
                    note: `requested ${response.requestedRunIds.length} / comparable ${response.comparableRunIds.length}`,
                  },
                  {
                    label: 'primary_profile',
                    value: comparisonProfile?.primaryProfile || '--',
                    note: comparisonProfile?.drivingDimensions.join(', ') || 'no driving dimensions',
                  },
                  {
                    label: 'comparison_source',
                    value: response.comparisonSource,
                    note: response.readMode,
                  },
                ]}
              />
              <div className="preview-grid">
                <div className="preview-card">
                  <p className="metric-card__label">baseline</p>
                  <p className="preview-card__text">#{baselineRunId ?? '--'} · {comparisonSummary?.baseline.strategyType || '--'}</p>
                </div>
                <div className="preview-card">
                  <p className="metric-card__label">timeframe / code</p>
                  <p className="preview-card__text">{comparisonSummary?.baseline.timeframe || '--'} · {comparisonSummary?.baseline.code || '--'}</p>
                </div>
                <div className="preview-card">
                  <p className="metric-card__label">missing_run_ids</p>
                  <p className="preview-card__text">{response.missingRunIds.length ? response.missingRunIds.join(', ') : '--'}</p>
                </div>
                <div className="preview-card">
                  <p className="metric-card__label">field_groups</p>
                  <p className="preview-card__text">{response.fieldGroups.join(', ') || '--'}</p>
                </div>
              </div>
              {response.unavailableRuns.length ? (
                <div className="mt-4">
                  <Banner
                    tone="warning"
                    title="存在 unavailable runs"
                    body={response.unavailableRuns.map((item) => `#${item.runId}: ${item.reason}`).join(' | ')}
                  />
                </div>
              ) : null}
            </Card>
          </section>

          <section id="compare-chart-strip" className="backtest-display-section">
            <Card title="metric strip" subtitle="只取最小 trusted metric 子集，先用轻量条带看 baseline 与 candidate 的相对位置" className="product-section-card product-section-card--backtest-secondary">
              <CompareMetricChartStrip
                items={orderedItems}
                baselineRunId={baselineRunId}
                metricDeltas={comparisonSummary?.metricDeltas || {}}
                highlights={comparisonHighlights?.highlights || {}}
              />
            </Card>
          </section>

          <section id="compare-highlights" className="backtest-display-section">
            <Card title="comparison_highlights" subtitle="只展示 backend 已信任的 highlights" className="product-section-card product-section-card--backtest-secondary">
              <SummaryStrip
                items={[
                  {
                    label: 'primary_profile',
                    value: comparisonHighlights?.primaryProfile || '--',
                    note: comparisonHighlights?.selectionRule || '--',
                  },
                  {
                    label: 'overall_context_state',
                    value: comparisonHighlights?.overallContextState || '--',
                    note: `baseline #${comparisonHighlights?.baselineRunId ?? '--'}`,
                  },
                ]}
              />
              <HighlightCards highlights={comparisonHighlights?.highlights || {}} />
              <div className="mt-4">
                <DiagnosticChipList diagnostics={comparisonHighlights?.diagnostics} />
              </div>
            </Card>
          </section>

          <section id="compare-metric-matrix" className="backtest-display-section">
            <Card title="compact metric matrix" subtitle="把 baseline、delta、winner 与 unavailable 压到一张易扫读的比较表" className="product-section-card product-section-card--backtest-secondary">
              <SummaryStrip
                items={[
                  {
                    label: 'baseline',
                    value: baselineRunId == null ? '--' : `#${baselineRunId}`,
                    note: baselineItem?.metadata.code || '--',
                  },
                  {
                    label: 'overall_state',
                    value: robustnessSummary?.overallState || '--',
                    note: comparisonProfile?.primaryProfile || '--',
                  },
                  {
                    label: 'metrics',
                    value: String(Object.keys(comparisonSummary?.metricDeltas || {}).length),
                    note: response.comparableRunIds.map((id) => `#${id}`).join(', ') || '--',
                  },
                ]}
              />
              <div className="mt-4">
                <CompareMetricMatrix
                  items={orderedItems}
                  baselineRunId={baselineRunId}
                  metricDeltas={comparisonSummary?.metricDeltas || {}}
                  highlights={comparisonHighlights?.highlights || {}}
                  overallState={robustnessSummary?.overallState}
                  primaryProfile={comparisonProfile?.primaryProfile}
                />
              </div>
            </Card>
          </section>

          <section id="compare-robustness" className="backtest-display-section">
            <Card title="robustness + profile" subtitle="明确显示 partial / limited / unavailable，而不是静默吞掉" className="product-section-card product-section-card--backtest-secondary">
              <SummaryStrip
                items={[
                  {
                    label: 'robustness',
                    value: robustnessSummary?.overallState || '--',
                    note: `directly_comparable ${robustnessSummary?.directlyComparable == null ? '--' : renderBooleanLabel(robustnessSummary.directlyComparable)}`,
                  },
                  {
                    label: 'aligned_dimensions',
                    value: String(robustnessSummary?.alignedDimensions.length ?? 0),
                    note: robustnessSummary?.alignedDimensions.join(', ') || '--',
                  },
                  {
                    label: 'partial_dimensions',
                    value: String(robustnessSummary?.partialDimensions.length ?? 0),
                    note: robustnessSummary?.partialDimensions.join(', ') || '--',
                  },
                  {
                    label: 'primary_profile',
                    value: comparisonProfile?.primaryProfile || '--',
                    note: comparisonProfile?.diagnostics.join(', ') || '--',
                  },
                ]}
              />
              <div className="preview-grid">
                <div className="preview-card">
                  <p className="metric-card__label">sameCode</p>
                  <p className="preview-card__text">{renderBooleanLabel(comparisonProfile?.dimensionFlags.sameCode)}</p>
                </div>
                <div className="preview-card">
                  <p className="metric-card__label">sameMarket</p>
                  <p className="preview-card__text">{renderBooleanLabel(comparisonProfile?.dimensionFlags.sameMarket)}</p>
                </div>
                <div className="preview-card">
                  <p className="metric-card__label">parameterDifferencesPresent</p>
                  <p className="preview-card__text">{renderBooleanLabel(comparisonProfile?.dimensionFlags.parameterDifferencesPresent)}</p>
                </div>
                <div className="preview-card">
                  <p className="metric-card__label">periodDifferencesPresent</p>
                  <p className="preview-card__text">{renderBooleanLabel(comparisonProfile?.dimensionFlags.periodDifferencesPresent)}</p>
                </div>
              </div>
              <div className="mt-4">
                <RobustnessDimensionCards dimensions={robustnessSummary?.dimensions || {}} />
              </div>
            </Card>
          </section>

          <section id="compare-market-period" className="backtest-display-section">
            <Card title="market / period context" subtitle="比较边界直接展示 backend state，不二次推断" className="product-section-card product-section-card--backtest-secondary">
              <div className="preview-grid">
                <div className="preview-card">
                  <p className="metric-card__label">market_code_comparison</p>
                  <p className="preview-card__text">{marketCodeComparison?.state || '--'}</p>
                  <p className="product-footnote">relationship: {marketCodeComparison?.relationship || '--'}</p>
                  <p className="product-footnote">directly_comparable: {marketCodeComparison?.directlyComparable == null ? '--' : renderBooleanLabel(marketCodeComparison.directlyComparable)}</p>
                  <DiagnosticChipList diagnostics={marketCodeComparison?.diagnostics} />
                </div>
                <div className="preview-card">
                  <p className="metric-card__label">period_comparison</p>
                  <p className="preview-card__text">{periodComparison?.state || '--'}</p>
                  <p className="product-footnote">relationship: {periodComparison?.relationship || '--'}</p>
                  <p className="product-footnote">meaningfully_comparable: {periodComparison?.meaningfullyComparable == null ? '--' : renderBooleanLabel(periodComparison.meaningfullyComparable)}</p>
                  <DiagnosticChipList diagnostics={periodComparison?.diagnostics} />
                </div>
              </div>
            </Card>
          </section>

          <section id="compare-parameter-metrics" className="backtest-display-section">
            <Card title="parameter + metrics" subtitle="参数差异与 trusted metric delta 放在同一工作台里读" className="product-section-card product-section-card--backtest-secondary">
              <div className="preview-grid">
                <div className="preview-card">
                  <p className="metric-card__label">parameter_comparison</p>
                  <p className="preview-card__text">{parameterComparison?.state || '--'}</p>
                  <p className="product-footnote">shared: {parameterComparison?.sharedParameterKeys.length ?? 0}</p>
                  <p className="product-footnote">differing: {parameterComparison?.differingParameterKeys.length ?? 0}</p>
                  <p className="product-footnote">missing: {parameterComparison?.missingParameterKeys.length ?? 0}</p>
                </div>
                <div className="preview-card">
                  <p className="metric-card__label">summary context</p>
                  <p className="preview-card__text">all_same_code: {renderBooleanLabel(comparisonSummary?.context.allSameCode)}</p>
                  <p className="product-footnote">all_same_timeframe: {renderBooleanLabel(comparisonSummary?.context.allSameTimeframe)}</p>
                  <p className="product-footnote">all_same_date_range: {renderBooleanLabel(comparisonSummary?.context.allSameDateRange)}</p>
                </div>
              </div>
              <div className="mt-4">
                <MetricDeltaTable metricDeltas={comparisonSummary?.metricDeltas || {}} />
              </div>
            </Card>
          </section>

          <section id="compare-items" className="backtest-display-section">
            <Card title="参与运行" subtitle="保留 compact run table，方便 AI / 人快速对照 baseline 与候选" className="product-section-card product-section-card--backtest-secondary">
              <CompareItemsTable
                items={orderedItems}
                baselineRunId={baselineRunId}
                onOpenRun={handleOpenRun}
                onMakeBaseline={handleMakeBaseline}
                onRemoveRun={handleRemoveRun}
              />
            </Card>
          </section>
        </>
      ) : null}
    </div>
  );
};

export default RuleBacktestComparePage;
