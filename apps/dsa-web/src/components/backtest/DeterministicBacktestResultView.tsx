import type React from 'react';
import { useMemo } from 'react';
import { Button, Card } from '../../components/common';
import type { RuleBacktestRunResponse } from '../../types/backtest';
import { DeterministicBacktestChartWorkspace } from './DeterministicBacktestChartWorkspace';
import {
  getDeterministicResultDensityCssVars,
  type DeterministicResultDensityConfig,
  useDeterministicResultDensity,
} from './deterministicResultDensity';
import {
  MetricCard,
  SummaryStrip,
  formatNumber,
  pct,
} from './shared';
import {
  formatDeterministicActionLabel,
  normalizeDeterministicBacktestResult,
  type DeterministicBacktestNormalizedResult,
  type DeterministicBacktestNormalizedRow,
  type DeterministicBacktestTradeEvent,
} from './normalizeDeterministicBacktestResult';
import {
  downloadExecutionTraceCsv,
  downloadExecutionTraceJson,
  hasExecutionTraceRows,
} from './executionTraceUtils';
import {
  describeRuleRunNarrative,
  getRuleRunExecutionNotes,
} from './ruleBacktestP6';
import { useI18n } from '../../contexts/UiLanguageContext';
import { translate } from '../../i18n/core';

type BacktestLanguage = 'zh' | 'en';

function bt(language: BacktestLanguage, key: string, vars?: Record<string, string | number | undefined>): string {
  return translate(language, `backtest.${key}`, vars);
}

export function DeterministicAuditTable({
  run,
  rows,
}: {
  run: RuleBacktestRunResponse;
  rows: DeterministicBacktestNormalizedRow[];
}) {
  const { language } = useI18n();
  return (
    <Card
      title={bt(language, 'resultPage.auditTable.title')}
      subtitle={bt(language, 'resultPage.auditTable.subtitle')}
      className="product-section-card product-section-card--backtest-standard"
    >
      <div className="backtest-audit-table__header">
        <p className="product-section-copy">{bt(language, 'resultPage.auditTable.description')}</p>
        <div className="product-action-row">
          <Button variant="secondary" onClick={() => downloadExecutionTraceCsv(run)} disabled={!hasExecutionTraceRows(run)}>{bt(language, 'resultPage.statusCard.exportCsv')}</Button>
          <Button variant="ghost" onClick={() => downloadExecutionTraceJson(run)} disabled={!hasExecutionTraceRows(run)}>{bt(language, 'resultPage.auditTable.exportJson')}</Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="product-empty-state product-empty-state--compact">{bt(language, 'resultPage.auditTable.exportEmpty')}</div>
      ) : (
        <div className="product-table-shell">
          <table className="product-table product-table--audit">
            <thead>
              <tr>
                <th>{bt(language, 'tables.date')}</th>
                <th>{bt(language, 'common.action')}</th>
                <th className="product-table__align-right">{bt(language, 'resultPage.auditTable.close')}</th>
                <th className="product-table__align-right">{bt(language, 'resultPage.auditTable.benchmarkClose')}</th>
                <th className="product-table__align-right">{bt(language, 'resultPage.auditTable.fillPrice')}</th>
                <th className="product-table__align-right">{bt(language, 'resultPage.auditTable.shares')}</th>
                <th className="product-table__align-right">{bt(language, 'resultPage.auditTable.cash')}</th>
                <th className="product-table__align-right">{bt(language, 'resultPage.auditTable.totalEquity')}</th>
                <th className="product-table__align-right">{bt(language, 'resultPage.auditTable.dailyPnl')}</th>
                <th className="product-table__align-right">{bt(language, 'resultPage.auditTable.dailyReturn')}</th>
                <th className="product-table__align-right">{bt(language, 'resultPage.auditTable.strategyCumulative')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`audit-${row.date}`}>
                  <td>{row.date}</td>
                  <td>{formatDeterministicActionLabel(row.action, language)}</td>
                  <td className="product-table__align-right">{formatNumber(row.symbolClose)}</td>
                  <td className="product-table__align-right">{formatNumber(row.benchmarkClose)}</td>
                  <td className="product-table__align-right">{formatNumber(row.fillPrice)}</td>
                  <td className="product-table__align-right">{formatNumber(row.shares, 4)}</td>
                  <td className="product-table__align-right">{formatNumber(row.cash)}</td>
                  <td className="product-table__align-right">{formatNumber(row.totalValue)}</td>
                  <td className="product-table__align-right">{formatNumber(row.dailyPnl)}</td>
                  <td className="product-table__align-right">{pct(row.dailyReturn)}</td>
                  <td className="product-table__align-right">{pct(row.strategyCumReturn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function DeterministicTradeEventTable({ events }: { events: DeterministicBacktestTradeEvent[] }) {
  const { language } = useI18n();
  return (
    <Card title={bt(language, 'resultPage.tradeEventTable.title')} subtitle={bt(language, 'resultPage.tradeEventTable.subtitle')} className="product-section-card product-section-card--backtest-standard">
      {events.length === 0 ? (
        <div className="product-empty-state product-empty-state--compact">{bt(language, 'resultPage.tradeEventTable.empty')}</div>
      ) : (
        <div className="product-table-shell">
          <table className="product-table product-table--audit">
            <thead>
              <tr>
                <th>{bt(language, 'tables.date')}</th>
                <th>{bt(language, 'common.action')}</th>
                <th className="product-table__align-right">{bt(language, 'resultPage.tradeEventTable.fillPrice')}</th>
                <th className="product-table__align-right">{bt(language, 'resultPage.tradeEventTable.shares')}</th>
                <th className="product-table__align-right">{bt(language, 'resultPage.tradeEventTable.cash')}</th>
                <th className="product-table__align-right">{bt(language, 'resultPage.tradeEventTable.totalEquity')}</th>
                <th>{bt(language, 'resultPage.tradeEventTable.signalOrTrigger')}</th>
                <th className="product-table__align-right">{bt(language, 'tables.return')}</th>
                <th>{bt(language, 'resultPage.tradeEventTable.source')}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.key}>
                  <td>{event.date}</td>
                  <td>{formatDeterministicActionLabel(event.action, language)}</td>
                  <td className="product-table__align-right">{formatNumber(event.fillPrice)}</td>
                  <td className="product-table__align-right">{formatNumber(event.shares, 4)}</td>
                  <td className="product-table__align-right">{formatNumber(event.cash)}</td>
                  <td className="product-table__align-right">{formatNumber(event.totalValue)}</td>
                  <td>{event.signalSummary || event.trigger || '--'}</td>
                  <td className="product-table__align-right">{pct(event.returnPct)}</td>
                  <td>{event.source === 'row' ? bt(language, 'resultPage.tradeEventTable.auditRow') : bt(language, 'resultPage.tradeEventTable.tradeLog')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export const DeterministicBacktestResultView: React.FC<{
  run: RuleBacktestRunResponse;
  normalized?: DeterministicBacktestNormalizedResult;
  densityConfig?: DeterministicResultDensityConfig;
}> = ({ run, normalized: providedNormalized, densityConfig }) => {
  const { language } = useI18n();
  const fallbackDensityConfig = useDeterministicResultDensity();
  const resolvedDensity = densityConfig ?? fallbackDensityConfig;
  const normalized = useMemo(
    () => providedNormalized ?? normalizeDeterministicBacktestResult(run, language),
    [providedNormalized, run, language],
  );
  const { metrics, benchmarkMeta, viewerMeta } = normalized;
  const annualizedReturn = metrics.annualizedReturnPct != null ? pct(metrics.annualizedReturnPct) : '--';
  const sharpeRatio = metrics.sharpeRatio != null ? formatNumber(metrics.sharpeRatio, 2) : '--';
  const comparisonLabel = benchmarkMeta.showBenchmark
    ? bt(language, 'resultPage.resultView.comparisonAgainst', { label: benchmarkMeta.benchmarkLabel })
    : benchmarkMeta.showBuyHold
      ? bt(language, 'resultPage.resultView.comparisonAgainst', { label: benchmarkMeta.buyHoldLabel })
      : bt(language, 'resultPage.resultView.relativeComparisonFallback');
  const comparisonValue = benchmarkMeta.showBenchmark
    ? metrics.excessReturnVsBenchmarkPct
    : benchmarkMeta.showBuyHold
      ? metrics.excessReturnVsBuyAndHoldPct
      : null;
  const comparisonNote = benchmarkMeta.showBenchmark
    ? bt(language, 'resultPage.resultView.benchmarkReturn', { value: pct(metrics.benchmarkReturnPct) })
    : benchmarkMeta.showBuyHold
      ? bt(language, 'resultPage.resultView.buyAndHoldReturn', { value: pct(metrics.buyAndHoldReturnPct) })
      : bt(language, 'resultPage.resultView.noComparableBenchmarkReturn');
  const workspaceKey = `${viewerMeta.runId}:${viewerMeta.rowCount}:${viewerMeta.firstDate ?? 'empty'}:${viewerMeta.lastDate ?? 'empty'}`;
  const narrative = describeRuleRunNarrative(run, language);
  const executionNotes = getRuleRunExecutionNotes(run, language);

  return (
    <div
      className="backtest-result-viewer"
      data-testid="deterministic-backtest-result-view"
      data-run-id={run.id}
      data-row-count={viewerMeta.rowCount}
      data-main-series-length={viewerMeta.strategySeriesLength}
      data-daily-pnl-series-length={viewerMeta.dailyPnlSeriesLength}
      data-position-series-length={viewerMeta.positionSeriesLength}
      data-kpi-count={6}
      data-density={resolvedDensity.mode}
      style={getDeterministicResultDensityCssVars(resolvedDensity)}
    >
      <section className="backtest-display-section" data-testid="backtest-display-section-dashboard">
        <div data-testid="deterministic-result-dashboard">
          <Card
            className="product-section-card product-section-card--backtest-result backtest-result-viewer__dashboard"
            padding="none"
          >
            <div className="backtest-result-viewer__metric-stage" data-testid="deterministic-result-kpi-row">
              <div className="backtest-result-viewer__metric-stage-header">
                <div>
                  <span className="product-kicker">{bt(language, 'resultPage.resultView.summary')}</span>
                  <h2 className="backtest-result-viewer__metric-stage-title">{bt(language, 'resultPage.resultView.keyMetrics')}</h2>
                </div>
                <div className="product-chip-list product-chip-list--tight">
                  <span className="product-chip">{bt(language, 'resultPage.resultView.sampleDays', { count: viewerMeta.rowCount })}</span>
                  <span className="product-chip">{bt(language, 'resultPage.resultView.tradesChip', { count: metrics.tradeCount })}</span>
                  <span className="product-chip">{bt(language, 'resultPage.resultView.equityChip', { value: formatNumber(metrics.finalEquity) })}</span>
                </div>
              </div>
              <SummaryStrip
                items={[
                  {
                    label: bt(language, 'resultPage.resultView.verdict'),
                    value: narrative.verdict,
                    note: benchmarkMeta.showBenchmark ? benchmarkMeta.benchmarkLabel : benchmarkMeta.buyHoldLabel,
                  },
                  {
                    label: bt(language, 'resultPage.resultView.drawdownFeel'),
                    value: narrative.drawdownLabel,
                    note: pct(metrics.maxDrawdownPct),
                  },
                  {
                    label: bt(language, 'resultPage.resultView.tradingActivity'),
                    value: narrative.activityLabel,
                    note: bt(language, 'resultPage.resultView.tradeActivityNote', { count: metrics.tradeCount }),
                  },
                  {
                    label: bt(language, 'resultPage.resultView.signalQuality'),
                    value: narrative.qualityLabel,
                    note: pct(metrics.winRatePct),
                  },
                ]}
              />
              {executionNotes.length > 0 ? (
                <p className="product-footnote">{executionNotes[0]}</p>
              ) : null}
              <div className="metric-grid backtest-result-viewer__metric-grid">
                <MetricCard
                  label={bt(language, 'resultPage.resultView.totalReturn')}
                  value={pct(metrics.totalReturnPct)}
                  tone="accent"
                  note={comparisonNote}
                />
                <MetricCard
                  label={comparisonLabel}
                  value={pct(comparisonValue)}
                  tone={comparisonValue != null
                    ? (comparisonValue >= 0 ? 'positive' : 'negative')
                    : 'default'}
                  note={benchmarkMeta.showBenchmark
                    ? bt(language, 'resultPage.resultView.buyAndHoldReturn', { value: pct(metrics.buyAndHoldReturnPct) })
                    : comparisonNote}
                />
                <MetricCard
                  label={bt(language, 'resultPage.resultView.maxDrawdown')}
                  value={pct(metrics.maxDrawdownPct)}
                  tone="negative"
                  note={bt(language, 'resultPage.resultView.annualizedReturn', { value: annualizedReturn })}
                />
                <MetricCard
                  label={bt(language, 'resultPage.resultView.trades')}
                  value={String(metrics.tradeCount)}
                  note={metrics.tradeCount > 0
                    ? bt(language, 'resultPage.resultView.tradeRecord', { wins: metrics.winCount, losses: metrics.lossCount })
                    : bt(language, 'resultPage.resultView.noFilledTrades')}
                />
                <MetricCard
                  label={bt(language, 'resultPage.resultView.winRate')}
                  value={pct(metrics.winRatePct)}
                  note={metrics.avgTradeReturnPct != null
                    ? bt(language, 'resultPage.resultView.averageTrade', { value: pct(metrics.avgTradeReturnPct) })
                    : bt(language, 'resultPage.resultView.basedOnFilledTrades')}
                />
                <MetricCard
                  label={bt(language, 'resultPage.resultView.endingEquity')}
                  value={formatNumber(metrics.finalEquity)}
                  note={bt(language, 'resultPage.resultView.initialCapital', { value: formatNumber(run.initialCapital) })}
                />
              </div>
              <SummaryStrip
                items={[
                  {
                    label: benchmarkMeta.benchmarkLabel,
                    value: benchmarkMeta.showBenchmark ? pct(metrics.benchmarkReturnPct) : '--',
                    note: bt(language, 'resultPage.resultView.sameBacktestWindow'),
                  },
                  {
                    label: benchmarkMeta.buyHoldLabel,
                    value: pct(metrics.buyAndHoldReturnPct),
                    note: bt(language, 'resultPage.resultView.currentInstrumentBuyAndHold'),
                  },
                  {
                    label: bt(language, 'resultPage.resultView.sharpe'),
                    value: sharpeRatio,
                    note: bt(language, 'resultPage.resultView.annualized', { value: annualizedReturn }),
                  },
                  {
                    label: bt(language, 'resultPage.resultView.averageHolding'),
                    value: metrics.avgHoldingBars == null ? '--' : bt(language, 'resultPage.resultView.holdingBars', { value: formatNumber(metrics.avgHoldingBars, 1) }),
                    note: metrics.avgHoldingCalendarDays == null
                      ? bt(language, 'resultPage.resultView.measuredInTradingDays')
                      : bt(language, 'resultPage.resultView.holdingDays', { value: formatNumber(metrics.avgHoldingCalendarDays, 1) }),
                  },
                ]}
              />
            </div>
            <div className="backtest-result-viewer__chart-stage">
              <DeterministicBacktestChartWorkspace key={workspaceKey} normalized={normalized} densityConfig={resolvedDensity} />
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
};
