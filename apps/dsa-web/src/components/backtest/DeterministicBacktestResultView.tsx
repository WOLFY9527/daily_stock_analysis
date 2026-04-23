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
      title={language === 'en' ? 'Daily audit ledger' : '日级审计 / 对账'}
      subtitle={language === 'en' ? 'The table reads from the persisted audit ledger and reuses execution-trace exports first.' : '表格读取已持久化审计账本；导出优先复用执行轨迹'}
      className="product-section-card product-section-card--backtest-standard"
    >
      <div className="backtest-audit-table__header">
        <p className="product-section-copy">{language === 'en' ? 'Once the run persists its audit ledger, the result page reuses execution traces and audit rows instead of recalculating them on the fly.' : '当运行结果已持久化审计账本后，结果页会优先复用执行轨迹和 auditRows，不再临时重算。'}</p>
        <div className="product-action-row">
          <Button variant="secondary" onClick={() => downloadExecutionTraceCsv(run)} disabled={!hasExecutionTraceRows(run)}>{language === 'en' ? 'Export CSV' : '导出 CSV'}</Button>
          <Button variant="ghost" onClick={() => downloadExecutionTraceJson(run)} disabled={!hasExecutionTraceRows(run)}>{language === 'en' ? 'Export JSON' : '导出 JSON'}</Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="product-empty-state product-empty-state--compact">{language === 'en' ? 'No exportable daily audit data is available yet.' : '暂无可导出的日级审计数据。'}</div>
      ) : (
        <div className="product-table-shell">
          <table className="product-table product-table--audit">
            <thead>
              <tr>
                <th>{language === 'en' ? 'Date' : '日期'}</th>
                <th>{language === 'en' ? 'Action' : '动作'}</th>
                <th className="product-table__align-right">{language === 'en' ? 'Close' : '标的收盘'}</th>
                <th className="product-table__align-right">{language === 'en' ? 'Benchmark close' : '基准收盘'}</th>
                <th className="product-table__align-right">{language === 'en' ? 'Fill price' : '成交价'}</th>
                <th className="product-table__align-right">{language === 'en' ? 'Shares' : '持股数'}</th>
                <th className="product-table__align-right">{language === 'en' ? 'Cash' : '现金'}</th>
                <th className="product-table__align-right">{language === 'en' ? 'Total equity' : '总资产'}</th>
                <th className="product-table__align-right">{language === 'en' ? 'Daily PnL' : '当日盈亏'}</th>
                <th className="product-table__align-right">{language === 'en' ? 'Daily return' : '当日收益'}</th>
                <th className="product-table__align-right">{language === 'en' ? 'Strategy cumulative' : '策略累计'}</th>
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
    <Card title={language === 'en' ? 'Trades and events' : '交易 / 事件日志'} subtitle={language === 'en' ? 'This table also stays read-only against normalized trade events.' : '交易表同样只读 normalized tradeEvents'} className="product-section-card product-section-card--backtest-standard">
      {events.length === 0 ? (
        <div className="product-empty-state product-empty-state--compact">{language === 'en' ? 'No trade or execution events are available yet.' : '暂无交易或执行事件。'}</div>
      ) : (
        <div className="product-table-shell">
          <table className="product-table product-table--audit">
            <thead>
              <tr>
                <th>{language === 'en' ? 'Date' : '日期'}</th>
                <th>{language === 'en' ? 'Action' : '动作'}</th>
                <th className="product-table__align-right">{language === 'en' ? 'Fill price' : '成交价'}</th>
                <th className="product-table__align-right">{language === 'en' ? 'Shares' : '持股数'}</th>
                <th className="product-table__align-right">{language === 'en' ? 'Cash' : '现金'}</th>
                <th className="product-table__align-right">{language === 'en' ? 'Total equity' : '总资产'}</th>
                <th>{language === 'en' ? 'Signal / trigger' : '信号 / 触发'}</th>
                <th className="product-table__align-right">{language === 'en' ? 'Return' : '收益'}</th>
                <th>{language === 'en' ? 'Source' : '来源'}</th>
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
                  <td>{event.source === 'row' ? (language === 'en' ? 'Audit row' : '审计行') : (language === 'en' ? 'Trade log' : '交易日志')}</td>
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
    ? (language === 'en' ? `Vs ${benchmarkMeta.benchmarkLabel}` : `相对 ${benchmarkMeta.benchmarkLabel}`)
    : benchmarkMeta.showBuyHold
      ? (language === 'en' ? `Vs ${benchmarkMeta.buyHoldLabel}` : `相对 ${benchmarkMeta.buyHoldLabel}`)
      : (language === 'en' ? 'Relative comparison' : '相对比较');
  const comparisonValue = benchmarkMeta.showBenchmark
    ? metrics.excessReturnVsBenchmarkPct
    : benchmarkMeta.showBuyHold
      ? metrics.excessReturnVsBuyAndHoldPct
      : null;
  const comparisonNote = benchmarkMeta.showBenchmark
    ? (language === 'en' ? `Benchmark return ${pct(metrics.benchmarkReturnPct)}` : `基准收益 ${pct(metrics.benchmarkReturnPct)}`)
    : benchmarkMeta.showBuyHold
      ? `${benchmarkMeta.buyHoldLabel} ${pct(metrics.buyAndHoldReturnPct)}`
      : (language === 'en' ? 'No comparable benchmark return is available.' : '当前没有可比较的基准收益');
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
                  <span className="product-kicker">{language === 'en' ? 'Summary' : '结果摘要'}</span>
                  <h2 className="backtest-result-viewer__metric-stage-title">{language === 'en' ? 'Key metrics' : '关键指标'}</h2>
                </div>
                <div className="product-chip-list product-chip-list--tight">
                  <span className="product-chip">{language === 'en' ? `Sample ${viewerMeta.rowCount} days` : `样本 ${viewerMeta.rowCount} 天`}</span>
                  <span className="product-chip">{language === 'en' ? `Trades ${metrics.tradeCount}` : `交易 ${metrics.tradeCount}`}</span>
                  <span className="product-chip">{language === 'en' ? `Equity ${formatNumber(metrics.finalEquity)}` : `权益 ${formatNumber(metrics.finalEquity)}`}</span>
                </div>
              </div>
              <SummaryStrip
                items={[
                  {
                    label: language === 'en' ? 'Verdict' : '决策判断',
                    value: narrative.verdict,
                    note: benchmarkMeta.showBenchmark ? benchmarkMeta.benchmarkLabel : benchmarkMeta.buyHoldLabel,
                  },
                  {
                    label: language === 'en' ? 'Drawdown feel' : '回撤体感',
                    value: narrative.drawdownLabel,
                    note: pct(metrics.maxDrawdownPct),
                  },
                  {
                    label: language === 'en' ? 'Trading activity' : '交易活跃度',
                    value: narrative.activityLabel,
                    note: language === 'en' ? `${metrics.tradeCount} trades` : `${metrics.tradeCount} 次交易`,
                  },
                  {
                    label: language === 'en' ? 'Signal quality' : '信号质量',
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
                  label={language === 'en' ? 'Total return' : '总收益'}
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
                    ? (language === 'en' ? `Buy and hold ${pct(metrics.buyAndHoldReturnPct)}` : `买入持有 ${pct(metrics.buyAndHoldReturnPct)}`)
                    : comparisonNote}
                />
                <MetricCard
                  label={language === 'en' ? 'Max drawdown' : '最大回撤'}
                  value={pct(metrics.maxDrawdownPct)}
                  tone="negative"
                  note={language === 'en' ? `Annualized return ${annualizedReturn}` : `年化收益 ${annualizedReturn}`}
                />
                <MetricCard
                  label={language === 'en' ? 'Trades' : '交易次数'}
                  value={String(metrics.tradeCount)}
                  note={metrics.tradeCount > 0 ? (language === 'en' ? `${metrics.winCount} wins / ${metrics.lossCount} losses` : `${metrics.winCount} 胜 / ${metrics.lossCount} 负`) : (language === 'en' ? 'No filled trades yet' : '暂无成交交易')}
                />
                <MetricCard
                  label={language === 'en' ? 'Win rate' : '胜率'}
                  value={pct(metrics.winRatePct)}
                  note={metrics.avgTradeReturnPct != null ? (language === 'en' ? `Average trade ${pct(metrics.avgTradeReturnPct)}` : `平均每笔 ${pct(metrics.avgTradeReturnPct)}`) : (language === 'en' ? 'Based on filled trades' : '按已成交交易统计')}
                />
                <MetricCard
                  label={language === 'en' ? 'Ending equity' : '期末权益'}
                  value={formatNumber(metrics.finalEquity)}
                  note={language === 'en' ? `Initial capital ${formatNumber(run.initialCapital)}` : `初始资金 ${formatNumber(run.initialCapital)}`}
                />
              </div>
              <SummaryStrip
                items={[
                  {
                    label: benchmarkMeta.benchmarkLabel,
                    value: benchmarkMeta.showBenchmark ? pct(metrics.benchmarkReturnPct) : '--',
                    note: language === 'en' ? 'Uses the same backtest window as the strategy.' : '与策略使用同一回测窗口',
                  },
                  {
                    label: benchmarkMeta.buyHoldLabel,
                    value: pct(metrics.buyAndHoldReturnPct),
                    note: language === 'en' ? 'Current instrument buy and hold.' : '当前标的买入并持有',
                  },
                  {
                    label: language === 'en' ? 'Sharpe' : '夏普',
                    value: sharpeRatio,
                    note: language === 'en' ? `Annualized ${annualizedReturn}` : `年化 ${annualizedReturn}`,
                  },
                  {
                    label: language === 'en' ? 'Average holding' : '平均持有',
                    value: metrics.avgHoldingBars == null ? '--' : (language === 'en' ? `${formatNumber(metrics.avgHoldingBars, 1)} bars` : `${formatNumber(metrics.avgHoldingBars, 1)} 根K线`),
                    note: metrics.avgHoldingCalendarDays == null ? (language === 'en' ? 'Measured in trading days' : '按交易日统计') : (language === 'en' ? `${formatNumber(metrics.avgHoldingCalendarDays, 1)} days` : `${formatNumber(metrics.avgHoldingCalendarDays, 1)} 天`),
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
