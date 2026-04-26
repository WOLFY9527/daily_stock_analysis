import type React from 'react';
import { Button, Card } from '../common';
import { Disclosure, SummaryStrip, AssumptionList, pct } from './shared';
import type { DeterministicBacktestNormalizedResult } from './normalizeDeterministicBacktestResult';
import type { RuleBacktestRunResponse } from '../../types/backtest';

type TranslateFn = (key: string, vars?: Record<string, string | number | undefined>) => string;

type BacktestOverviewSummaryProps = {
  resultPage: TranslateFn;
  run: RuleBacktestRunResponse;
  normalized: DeterministicBacktestNormalizedResult;
  selectedBenchmarkLabel: string;
  buyAndHoldLabel: string;
  benchmarkStatusNote: string;
  decisionReportMarkdown: string;
  onExportDecisionReport: (format: 'md' | 'html') => void;
};

const BacktestOverviewSummary: React.FC<BacktestOverviewSummaryProps> = ({
  resultPage,
  run,
  normalized,
  selectedBenchmarkLabel,
  buyAndHoldLabel,
  benchmarkStatusNote,
  decisionReportMarkdown,
  onExportDecisionReport,
}) => (
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
                <Button variant="secondary" onClick={() => onExportDecisionReport('md')}>{resultPage('overview.exportMarkdown')}</Button>
                <Button variant="ghost" onClick={() => onExportDecisionReport('html')}>{resultPage('overview.exportHtml')}</Button>
              </div>
            </div>
            <pre className="comparison-report-preview">{decisionReportMarkdown}</pre>
          </div>
        </div>
      </Disclosure>
    </Card>
  </section>
);

export default BacktestOverviewSummary;
