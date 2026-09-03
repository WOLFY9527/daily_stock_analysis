import type React from 'react';
import { useState } from 'react';
import { AnimatePresence, domAnimation, LazyMotion, m } from 'motion/react';
import { ApiErrorAlert } from '../common/ApiErrorAlert';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { Pagination } from '../common/Pagination';
import type { ParsedApiError } from '../../api/error';
import type {
  AssumptionMap,
  BacktestResultItem,
  BacktestRunHistoryItem,
  BacktestRunResponse,
  BacktestSampleStatusResponse,
  PerformanceMetrics,
  PrepareBacktestSamplesResponse,
} from '../../types/backtest';
import BacktestExecutionReadinessPanel from './BacktestExecutionReadinessPanel';
import {
  AssumptionList,
  Banner,
  Disclosure,
  HistoricalResultsTable,
  HistoricalRunSummary,
  HistoricalRunsTable,
  SectionEyebrow,
  SummaryStrip,
  describeHistoricalDataSource,
  getHistoricalFallbackLabel,
  getHistoricalRequestedModeLabel,
  getHistoricalResolvedSourceLabel,
} from './shared';

type Props = {
  language: 'zh' | 'en';
  normalizedCode: string;
  codeFilter: string;
  onCodeChange: (value: string) => void;
  onCodeEnter: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  evaluationBars: string;
  onEvaluationBarsChange: (value: string) => void;
  maturityDays: string;
  onMaturityDaysChange: (value: string) => void;
  samplePreset: string;
  onSamplePresetChange: (value: string) => void;
  customSampleCount: string;
  onCustomSampleCountChange: (value: string) => void;
  resolvedSampleCount: number;
  forceReplaceResults: boolean;
  onForceReplaceResultsChange: (value: boolean) => void;
  onFilter: () => void;
  onPrepareSamples: () => Promise<void>;
  onRebuildSamples: () => Promise<void>;
  onClearSamples: () => Promise<void>;
  onRunEvaluation: () => Promise<void>;
  onClearResults: () => Promise<void>;
  isPreparingSamples: boolean;
  isRunningHistoricalEval: boolean;
  runResult: BacktestRunResponse | null;
  runError: ParsedApiError | null;
  prepareResult: PrepareBacktestSamplesResponse | null;
  prepareError: ParsedApiError | null;
  sampleStatus: BacktestSampleStatusResponse | null;
  sampleStatusError: ParsedApiError | null;
  historicalAssumptions: AssumptionMap | null;
  historicalPerformance: PerformanceMetrics | null;
  historicalSourceMetadata: {
    requestedMode: string | null;
    resolvedSource: string | null;
    fallbackUsed: boolean | null;
  };
  historicalSampleTransparency: string;
  isLoadingSampleStatus: boolean;
  isLoadingPerf: boolean;
  historicalSummaryItems: Array<{ label: string; value: string; note?: string }>;
  performanceNotice: { tone: 'warning' | 'danger'; message: string } | null;
  results: BacktestResultItem[];
  totalResults: number;
  currentPage: number;
  pageSize: number;
  onChangeResultsPage: (page: number) => void;
  pageError: ParsedApiError | null;
  isLoadingResults: boolean;
  historyItems: BacktestRunHistoryItem[];
  historyTotal: number;
  historyPage: number;
  historyPageSize: number;
  onChangeHistoryPage: (page: number) => void;
  onOpenHistoricalRun: (run: BacktestRunHistoryItem) => Promise<void>;
  selectedRunId: number | null;
  historyError: ParsedApiError | null;
  isLoadingHistory: boolean;
  panelMode: 'normal' | 'professional';
};

type HistoricalWizardStep = 'scope' | 'params' | 'execute' | 'results';
const GHOST_FIELD_CLASS = 'w-full min-w-0 min-h-[44px] rounded-lg border border-[color:var(--wolfy-border-subtle)] bg-[var(--wolfy-surface-input)] px-3 py-2.5 text-sm leading-6 text-[color:var(--wolfy-text-primary)] outline-none transition-all focus:border-[color:var(--wolfy-accent-focus)] focus:bg-[var(--surface)]';
const GHOST_CHECKBOX_CLASS = 'h-4 w-4 shrink-0 rounded border border-[color:var(--wolfy-border-subtle)] bg-[var(--wolfy-surface-input)] text-[color:var(--wolfy-accent)] accent-[var(--wolfy-accent)]';

const HistoricalEvaluationPanel: React.FC<Props> = ({
  language,
  normalizedCode,
  codeFilter,
  onCodeChange,
  onCodeEnter,
  evaluationBars,
  onEvaluationBarsChange,
  maturityDays,
  onMaturityDaysChange,
  samplePreset,
  onSamplePresetChange,
  customSampleCount,
  onCustomSampleCountChange,
  resolvedSampleCount,
  forceReplaceResults,
  onForceReplaceResultsChange,
  onFilter,
  onPrepareSamples,
  onRebuildSamples,
  onClearSamples,
  onRunEvaluation,
  onClearResults,
  isPreparingSamples,
  isRunningHistoricalEval,
  runResult,
  runError,
  prepareResult,
  prepareError,
  sampleStatus,
  sampleStatusError,
  historicalAssumptions,
  historicalPerformance,
  historicalSourceMetadata,
  historicalSampleTransparency,
  isLoadingSampleStatus,
  isLoadingPerf,
  historicalSummaryItems,
  performanceNotice,
  results,
  totalResults,
  currentPage,
  pageSize,
  onChangeResultsPage,
  pageError,
  isLoadingResults,
  historyItems,
  historyTotal,
  historyPage,
  historyPageSize,
  onChangeHistoryPage,
  onOpenHistoricalRun,
  selectedRunId,
  historyError,
  isLoadingHistory,
  panelMode,
}) => {
  const [currentStep, setCurrentStep] = useState<HistoricalWizardStep>('scope');
  const copy = (zh: string, en: string) => (language === 'en' ? en : zh);
  const sourceSummary = describeHistoricalDataSource(historicalSourceMetadata, language);
  const modeSummaryItems = [
    {
      label: copy('评估范围', 'Evaluation scope'),
      value: normalizedCode || copy('全部标的', 'All instruments'),
      note: normalizedCode ? copy('当前按单一标的过滤', 'Filtered to one instrument') : copy('当前查看整体汇总', 'Viewing the overall aggregate'),
    },
    {
      label: copy('样本状态', 'Sample status'),
      value: isLoadingSampleStatus
        ? copy('同步中', 'Syncing')
        : sampleStatus?.preparedCount != null
          ? String(sampleStatus.preparedCount)
          : prepareResult
            ? `+${prepareResult.prepared}`
            : '--',
      note: sampleStatus?.preparedStartDate && sampleStatus?.preparedEndDate
        ? `${sampleStatus.preparedStartDate} -> ${sampleStatus.preparedEndDate}`
        : copy('样本准备状态', 'Sample preparation status'),
    },
    {
      label: copy('评估执行', 'Evaluation run'),
      value: isRunningHistoricalEval ? copy('运行中', 'Running') : runResult ? copy('已有最新结果', 'Latest result available') : copy('等待执行', 'Waiting to run'),
      note: runResult?.runId ? copy(`运行 #${runResult.runId}`, `Run #${runResult.runId}`) : copy('等待执行', 'Waiting to run'),
    },
    {
      label: copy('结果视图', 'Results view'),
      value: isLoadingResults ? copy('刷新中', 'Refreshing') : String(totalResults),
      note: selectedRunId ? copy(`锁定运行 #${selectedRunId}`, `Locked to run #${selectedRunId}`) : copy('当前过滤结果', 'Current filtered results'),
    },
  ];
  const isProfessionalMode = panelMode === 'professional';
  const historicalExecutionReadiness = historicalPerformance?.executionReadiness
    || runResult?.executionReadiness
    || sampleStatus?.executionReadiness
    || prepareResult?.executionReadiness
    || null;
  const historicalNoAdviceDisclosure = historicalPerformance?.noAdviceDisclosure || runResult?.noAdviceDisclosure || null;
  const performanceFallbackNotice = historicalPerformance?.dataStatus === 'fallback'
    ? {
        title: language === 'en' ? 'Performance uses a non-primary fallback aggregate' : '表现指标使用非主来源回退汇总',
        body: language === 'en'
          ? 'Completed calculations do not establish primary-source authority. Review the fallback source before comparing results.'
          : '计算已完成不代表主来源权威性成立；比较结果前请先核对回退来源。',
      }
    : null;

  const handleRunEvaluationClick = async () => {
    if (!isProfessionalMode) {
      setCurrentStep('results');
    }
    await onRunEvaluation();
  };

  const handleOpenHistoricalRun = async (run: BacktestRunHistoryItem) => {
    if (!isProfessionalMode) {
      setCurrentStep('results');
    }
    await onOpenHistoricalRun(run);
  };

  const scopeSamplesSection = (
    <section className="backtest-control-section" data-testid="historical-control-section-scope-samples" data-active={currentStep === 'scope' ? 'true' : 'false'}>
      <Card title={copy('范围与样本', 'Scope and samples')} subtitle={copy('步骤 1', 'Step 1')} className="product-section-card product-section-card--backtest-standard">
        {!isProfessionalMode ? (
          <p className="backtest-guided-step-helper">{copy('先确定标的范围和样本规模，再准备或重建历史评估样本。', 'Set the instrument scope and sample size before preparing or rebuilding historical evaluation samples.')}</p>
        ) : null}
        <label className="product-field">
          <span className="theme-field-label">{copy('股票代码', 'Stock code')}</span>
          <input
            type="text"
            className={GHOST_FIELD_CLASS}
            value={codeFilter}
            onChange={(event) => onCodeChange(event.target.value.toUpperCase())}
            onKeyDown={onCodeEnter}
            placeholder={copy('输入股票代码，如 AAPL 或 600519', 'Enter a stock code, such as AAPL or 600519')}
            aria-label={copy('股票代码', 'Stock code')}
          />
          <span className="product-field-help">{copy('留空时查看整体汇总；准备样本、清理样本时建议指定单一股票。', 'Leave blank to view the overall aggregate; select one instrument when preparing or clearing samples.')}</span>
        </label>
        <label className="product-field">
          <span className="theme-field-label">{copy('分析样本数', 'Analysis samples')}</span>
          <div className="product-inline-fields">
            <select
              className={`${GHOST_FIELD_CLASS} appearance-none pr-10 truncate`}
              value={samplePreset}
              onChange={(event) => onSamplePresetChange(event.target.value)}
              aria-label={copy('分析样本数', 'Analysis samples')}
            >
              <option value="20">20</option>
              <option value="60">60</option>
              <option value="120">120</option>
              <option value="252">252</option>
              <option value="custom">{copy('自定义', 'Custom')}</option>
            </select>
            {samplePreset === 'custom' ? (
              <input
                type="number"
                className={GHOST_FIELD_CLASS}
                min={1}
                max={365}
                value={customSampleCount}
                onChange={(event) => onCustomSampleCountChange(event.target.value)}
                aria-label={copy('自定义样本数', 'Custom sample count')}
              />
            ) : null}
          </div>
          <span className="product-field-help">{copy('表示要准备多少条分析样本，而不是天数。', 'Number of analysis samples to prepare, not the number of days.')}</span>
        </label>
        <div className="product-chip-list">
          <span className="product-chip">{copy(`目标样本数: ${resolvedSampleCount} 条`, `Target sample count: ${resolvedSampleCount}`)}</span>
        </div>
        <div className="product-action-row backtest-control-actions">
          <Button variant="secondary" onClick={onFilter}>{copy('应用筛选', 'Apply filter')}</Button>
          <Button variant="secondary" onClick={() => void onPrepareSamples()} isLoading={isPreparingSamples} disabled={!normalizedCode} loadingText={copy('准备中…', 'Preparing...')}>
            {copy('准备分析样本', 'Prepare analysis samples')}
          </Button>
          <Button variant="outline" onClick={() => void onRebuildSamples()} disabled={isPreparingSamples || !normalizedCode}>
            {copy('重建样本', 'Rebuild samples')}
          </Button>
          <Button variant="ghost" onClick={() => void onClearSamples()} disabled={isPreparingSamples || !normalizedCode}>
            {copy('清理样本', 'Clear samples')}
          </Button>
        </div>
        {prepareResult ? (
          <Banner
            tone="success"
            title={copy('样本准备完成', 'Sample preparation complete')}
            body={(
              <>
                {copy(`新增 ${prepareResult.prepared} 条样本，跳过 ${prepareResult.skippedExisting} 条已有样本。`, `Prepared ${prepareResult.prepared} new samples and skipped ${prepareResult.skippedExisting} existing samples.`)}
                {prepareResult.noResultMessage ? <span className="product-banner__meta">{prepareResult.noResultMessage}</span> : null}
              </>
            )}
            className="mt-4"
          />
        ) : null}
        {prepareError ? <ApiErrorAlert error={prepareError} className="mt-4" /> : null}
        <div className="product-action-row backtest-control-actions backtest-control-actions--footer">
          <Button onClick={() => setCurrentStep('params')}>{copy('继续', 'Continue')}</Button>
        </div>
      </Card>
    </section>
  );

  const paramsSection = (
    <section className="backtest-control-section" data-testid="historical-control-section-params" data-active={currentStep === 'params' ? 'true' : 'false'}>
      <Card title={copy('评估参数', 'Evaluation parameters')} subtitle={copy('步骤 2', 'Step 2')} className="product-section-card product-section-card--backtest-standard">
        {!isProfessionalMode ? (
          <p className="backtest-guided-step-helper">{copy('设置评估窗口、成熟期和覆盖策略，确保结果口径一致。', 'Set the evaluation window, maturity period, and overwrite policy to keep results comparable.')}</p>
        ) : null}
        <SummaryStrip items={modeSummaryItems} />
        <Banner
          tone={sourceSummary.tone}
          className="mt-4"
          title={sourceSummary.title}
          body={(
            <>
              {sourceSummary.body}
              <span className="product-banner__meta">{sourceSummary.detail}</span>
            </>
          )}
        />
        {performanceFallbackNotice ? (
          <div data-testid="historical-performance-fallback-notice">
            <Banner
              tone="warning"
              className="mt-4"
              title={performanceFallbackNotice.title}
              body={performanceFallbackNotice.body}
            />
          </div>
        ) : null}
        <Disclosure summary={copy('查看数据可用性说明', 'View data availability')}>
          <div className="preview-grid">
            <div className="preview-card">
              <p className="metric-card__label">{copy('请求方式', 'Requested mode')}</p>
              <p className="preview-card__text">{getHistoricalRequestedModeLabel(historicalSourceMetadata.requestedMode, language)}</p>
            </div>
            <div className="preview-card">
              <p className="metric-card__label">{copy('实际数据来源', 'Resolved data source')}</p>
              <p className="preview-card__text">{getHistoricalResolvedSourceLabel(historicalSourceMetadata.resolvedSource, language)}</p>
            </div>
            <div className="preview-card">
              <p className="metric-card__label">{copy('备用数据状态', 'Fallback status')}</p>
              <p className="preview-card__text">{getHistoricalFallbackLabel(historicalSourceMetadata.fallbackUsed, language)}</p>
            </div>
          </div>
          <p className="product-footnote mt-4">{historicalSampleTransparency}</p>
        </Disclosure>
        <div className="product-field-grid backtest-control-grid">
          <label className="product-field">
            <span className="theme-field-label">{copy('评估窗口', 'Evaluation window')}</span>
            <input
              type="number"
              className={GHOST_FIELD_CLASS}
              min={1}
              max={120}
              value={evaluationBars}
              onChange={(event) => onEvaluationBarsChange(event.target.value)}
              aria-label={copy('评估窗口', 'Evaluation window')}
            />
            <span className="product-field-help">{copy('单位是交易窗口，例如 10 = 从分析日往后评估 10 根日线。', 'Measured in trading bars; for example, 10 evaluates the 10 daily bars after the analysis date.')}</span>
          </label>
          <label className="product-field">
            <span className="theme-field-label">{copy('成熟期', 'Maturity period')}</span>
            <input
              type="number"
              className={GHOST_FIELD_CLASS}
              min={0}
              max={365}
              value={maturityDays}
              onChange={(event) => onMaturityDaysChange(event.target.value)}
              aria-label={copy('成熟期', 'Maturity period')}
            />
            <span className="product-field-help">{copy('单位是自然日，例如 14 = 仅评估 14 天前的分析记录。', 'Measured in calendar days; for example, 14 evaluates only analyses created at least 14 days ago.')}</span>
          </label>
        </div>
        <label className="product-checkbox-row">
          <input
            type="checkbox"
            className={GHOST_CHECKBOX_CLASS}
            checked={forceReplaceResults}
            onChange={(event) => onForceReplaceResultsChange(event.target.checked)}
            aria-label={copy('覆盖已有同窗口结果', 'Overwrite existing results for this window')}
          />
          <span>{copy('覆盖已有同窗口结果。这个开关只影响是否重算，不会改变窗口或成熟期定义。', 'Overwrite existing results for this window. This only controls recalculation; it does not change the window or maturity definition.')}</span>
        </label>
        <div className="product-action-row backtest-control-actions backtest-control-actions--footer">
          <Button variant="ghost" onClick={() => setCurrentStep('scope')}>{copy('返回', 'Back')}</Button>
          <Button onClick={() => setCurrentStep('execute')}>{copy('继续', 'Continue')}</Button>
        </div>
      </Card>
    </section>
  );

  const executeSection = (
    <section className="backtest-control-section" data-testid="historical-control-section-execute" data-active={currentStep === 'execute' ? 'true' : 'false'}>
      <Card title={copy('执行评估', 'Run evaluation')} subtitle={copy('步骤 3', 'Step 3')} className="product-section-card product-section-card--backtest-flow">
        {!isProfessionalMode ? (
          <p className="backtest-guided-step-helper">{copy('确认样本和参数后从这里执行历史评估，右侧显示板只负责展示结果。', 'Confirm samples and parameters, then run the historical evaluation here. The right display board shows results only.')}</p>
        ) : null}
        <p className="product-section-copy">{copy('用历史 AI 分析信号去验证后续价格窗口的表现，只做样本级评估，不做账户净值回测。', 'Uses historical analysis signals to evaluate subsequent price windows at sample level only; it is not an account-equity backtest.')}</p>
        <Banner
          tone="warning"
          className="mt-4"
          title={copy('这是历史信号验证，不是组合/账户回测。', 'This validates historical signals, not a portfolio or account backtest.')}
          body={copy('只检查单条历史分析样本在未来窗口中的方向与收益表现，不生成资金曲线、持仓路径或净值回放。', 'It checks direction and returns for individual historical analysis samples over future windows. It does not create an equity curve, position path, or net-asset replay.')}
        />
        <div className="product-action-row backtest-control-actions backtest-control-actions--footer mt-4">
          <Button variant="ghost" onClick={() => setCurrentStep('params')}>{copy('返回', 'Back')}</Button>
          <Button onClick={() => void handleRunEvaluationClick()} isLoading={isRunningHistoricalEval} loadingText={copy('运行中…', 'Running...')}>
            {copy('运行历史评估', 'Run historical evaluation')}
          </Button>
          <Button variant="ghost" onClick={() => void onClearResults()} disabled={isRunningHistoricalEval || !normalizedCode}>
            {copy('清理评估结果', 'Clear evaluation results')}
          </Button>
        </div>
        {runError ? <ApiErrorAlert error={runError} className="mt-4" /> : null}
      </Card>
    </section>
  );

  const resultsSection = (
    <section className="backtest-control-section" data-testid="historical-control-section-results" data-active={currentStep === 'results' ? 'true' : 'false'}>
      <Card title={copy('结果复查', 'Review results')} subtitle={copy('步骤 4', 'Step 4')} className="product-section-card product-section-card--backtest-standard">
        {!isProfessionalMode ? (
          <p className="backtest-guided-step-helper">{copy('这里保留结果复查和重跑入口，详细汇总、结果表和历史记录仍在右侧显示板。', 'Review and rerun entry points stay here; detailed aggregates, results, and history remain on the right display board.')}</p>
        ) : null}
        <div className="product-chip-list">
          <span className="product-chip">{copy(`当前结果: ${runResult?.runId ? `运行 #${runResult.runId}` : selectedRunId ? `历史 #${selectedRunId}` : '暂无'}`, `Current result: ${runResult?.runId ? `Run #${runResult.runId}` : selectedRunId ? `History #${selectedRunId}` : 'None'}`)}</span>
          <span className="product-chip">{copy(`结果数: ${totalResults}`, `Result count: ${totalResults}`)}</span>
          <span className="product-chip">{copy(`历史运行: ${historyTotal}`, `Historical runs: ${historyTotal}`)}</span>
        </div>
        <p className="product-footnote">{copy('右侧显示板会展示评估概览、结果表和历史记录。这个步骤只保留复查和重跑入口。', 'The right display board contains the evaluation summary, result table, and history. This step keeps only review and rerun entry points.')}</p>
        <div className="product-action-row backtest-control-actions backtest-control-actions--footer">
          <Button variant="ghost" onClick={() => setCurrentStep('execute')}>{copy('返回', 'Back')}</Button>
          <Button onClick={() => void handleRunEvaluationClick()} isLoading={isRunningHistoricalEval} loadingText={copy('运行中…', 'Running...')}>
            {copy('重新运行评估', 'Run evaluation again')}
          </Button>
        </div>
      </Card>
    </section>
  );

  const historicalSections: Record<HistoricalWizardStep, React.ReactNode> = {
    scope: scopeSamplesSection,
    params: paramsSection,
    execute: executeSection,
    results: resultsSection,
  };
  const inspectionTone = performanceNotice?.tone || sourceSummary.tone;
  const inspectionTitle = performanceNotice
    ? (performanceNotice.tone === 'danger' ? copy('当前结果存在阻断', 'Current result is blocked') : copy('当前结果需要复核', 'Current result needs review'))
    : sourceSummary.title;
  const inspectionBody = performanceNotice?.message || sourceSummary.body;
  const inspectionDetail = performanceNotice ? copy('请先处理数据完整性或执行状态，再继续判断样本表现。', 'Resolve data integrity or execution status before interpreting sample performance.') : sourceSummary.detail;

  return (
    <div
      className="w-full min-w-0 flex flex-col gap-5"
      data-testid="backtest-unified-shell"
      data-module="historical"
      data-panel-mode={panelMode}
    >
      <div className="grid gap-3 min-w-0">
        <SectionEyebrow>Historical Evaluation</SectionEyebrow>
        <div className="grid gap-2 min-w-0">
          <h1 className="m-0 text-[clamp(1.5rem,1.1vw+1.2rem,2.2rem)] leading-tight text-[var(--text-primary)]">{copy('历史评估工作台', 'Historical Evaluation Workbench')}</h1>
          <p className="m-0 text-sm leading-7 text-[var(--text-secondary)]">
            {copy('全宽工作台现在把样本控制、诊断说明和结果区彻底拆开。左侧专注操作，中间专注说明，右侧专注汇总与结果，不再把整块历史评估内容塞进 400px 的外层控制栏里。', 'The full-width workbench separates sample controls, diagnostic guidance, and results. The left is for actions, the middle for context, and the right for aggregates and results.')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:gap-5 lg:grid-cols-12 items-start w-full min-w-0">
        <section
          className={`col-span-1 w-full min-w-0 flex flex-col gap-4 ${isProfessionalMode ? 'lg:col-span-12' : 'lg:col-span-3'}`}
          data-testid="backtest-control-panel"
          data-panel-mode={panelMode}
        >
          <div className="backtest-control-panel__header shrink-0">
            <SectionEyebrow>{copy('控制面板', 'Control panel')}</SectionEyebrow>
            <h2 className="backtest-control-panel__title">{copy('历史评估', 'Historical evaluation')}</h2>
            <p className="backtest-control-panel__description">
              {isProfessionalMode
                ? copy('专业模式会展开全部历史评估控制区。', 'Professional mode expands all historical evaluation controls.')
                : copy('普通模式按步骤收口历史评估流程，先控制样本与参数，再执行并查看结果。', 'Standard mode guides the evaluation by step: configure samples and parameters, then run and review results.')}
            </p>
          </div>

          {!isProfessionalMode ? (
            <nav className="backtest-control-stepper" aria-label={copy('历史评估步骤', 'Historical evaluation steps')}>
              {[
                { key: 'scope', title: copy('范围与样本', 'Scope and samples'), short: copy('范围', 'Scope') },
                { key: 'params', title: copy('评估参数', 'Evaluation parameters'), short: copy('参数', 'Parameters') },
                { key: 'execute', title: copy('执行评估', 'Run evaluation'), short: copy('执行', 'Run') },
                { key: 'results', title: copy('结果复查', 'Review results'), short: copy('结果', 'Results') },
              ].map((step, index) => {
                const stepKey = step.key as HistoricalWizardStep;
                const stepOrder: HistoricalWizardStep[] = ['scope', 'params', 'execute', 'results'];
                const isDone = stepOrder.indexOf(stepKey) < stepOrder.indexOf(currentStep);
                return (
                  <button
                    key={step.key}
                    type="button"
                    className={`backtest-control-step${currentStep === stepKey ? ' is-active' : ''}${isDone ? ' is-done' : ''}`}
                    onClick={() => setCurrentStep(stepKey)}
                  >
                    <span className="backtest-control-step__index">{index + 1}</span>
                    <span className="backtest-control-step__copy">
                      <strong>{step.title}</strong>
                      <small>{step.short}</small>
                    </span>
                  </button>
                );
              })}
            </nav>
          ) : null}

          {isProfessionalMode ? (
            <div className="backtest-control-panel__stack backtest-control-panel__stack--professional" data-testid="backtest-control-panel-expanded">
              {scopeSamplesSection}
              {paramsSection}
              {executeSection}
              {resultsSection}
            </div>
          ) : (
            <div className="backtest-control-window" data-testid="backtest-control-window">
              <LazyMotion features={domAnimation}>
                <AnimatePresence mode="wait" initial={false}>
                  <m.div
                    key={currentStep}
                    className="backtest-control-window__frame"
                    initial={{ opacity: 0, x: 18 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -14 }}
                    transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {historicalSections[currentStep]}
                  </m.div>
                </AnimatePresence>
              </LazyMotion>
            </div>
          )}
        </section>

        <section
          className={`col-span-1 w-full min-w-0 flex flex-col gap-4 rounded-[24px] border border-[color:var(--wolfy-border-subtle)] bg-[var(--wolfy-surface-input)] p-5 ${isProfessionalMode ? 'lg:col-span-5' : 'lg:col-span-4'}`}
          data-testid="historical-inspection-panel"
        >
          <div className="grid gap-3 min-w-0">
            <SectionEyebrow>Inspection</SectionEyebrow>
            <h2 className="m-0 text-[1.2rem] leading-tight text-[var(--text-primary)]">{copy('历史评估显示面板', 'Historical evaluation inspection')}</h2>
            <p className="m-0 text-sm leading-7 text-[var(--text-secondary)]">
              {copy('这个中间栏只放说明、口径和假设，固定宽度后不再被右侧结果表和左侧控制区共同挤压。', 'This middle column contains guidance, definitions, and assumptions without competing with the controls or results table.')}
            </p>
          </div>

          <Banner
            tone={inspectionTone}
            title={inspectionTitle}
            body={(
              <>
                {inspectionBody}
                <span className="product-banner__meta">{inspectionDetail}</span>
              </>
            )}
          />

          <SummaryStrip items={modeSummaryItems} />
          <BacktestExecutionReadinessPanel
            language={language}
            readiness={historicalExecutionReadiness}
            productReadModel={sampleStatus?.productReadModel || null}
            historicalOhlcvReadiness={sampleStatus?.historicalOhlcvReadiness || null}
            noAdviceDisclosure={historicalNoAdviceDisclosure}
            attempted={Boolean(runResult)}
            isLoading={isLoadingSampleStatus || isRunningHistoricalEval}
            testId="historical-backtest-execution-readiness"
            className="mt-4"
          />

          <Disclosure summary={copy('查看数据可用性说明', 'View data availability')}>
            <div className="preview-grid">
              <div className="preview-card">
                <p className="metric-card__label">{copy('请求方式', 'Requested mode')}</p>
                <p className="preview-card__text">{getHistoricalRequestedModeLabel(historicalSourceMetadata.requestedMode, language)}</p>
              </div>
              <div className="preview-card">
                <p className="metric-card__label">{copy('实际数据来源', 'Resolved data source')}</p>
                <p className="preview-card__text">{getHistoricalResolvedSourceLabel(historicalSourceMetadata.resolvedSource, language)}</p>
              </div>
              <div className="preview-card">
                <p className="metric-card__label">{copy('备用数据状态', 'Fallback status')}</p>
                <p className="preview-card__text">{getHistoricalFallbackLabel(historicalSourceMetadata.fallbackUsed, language)}</p>
              </div>
            </div>
            <p className="product-footnote mt-4">{historicalSampleTransparency}</p>
          </Disclosure>

          <Disclosure summary={copy('查看执行假设', 'View execution assumptions')}>
            <AssumptionList assumptions={historicalAssumptions || undefined} emptyText={copy('暂无执行假设', 'No execution assumptions')} />
          </Disclosure>
        </section>

        <section className={`col-span-1 w-full min-w-0 flex flex-col gap-4 ${isProfessionalMode ? 'lg:col-span-7' : 'lg:col-span-5'}`} data-testid="backtest-display-board">
          <div className="backtest-display-board__header shrink-0">
            <SectionEyebrow>{copy('显示面板', 'Display board')}</SectionEyebrow>
            <h2 className="backtest-display-board__title">{copy('结果与记录', 'Results and history')}</h2>
            <p className="backtest-display-board__description">
              {copy('右侧吸收所有剩余宽度，承载汇总、结果表和历史记录，图表或大表格都只在这里伸展。', 'The right board uses the remaining width for aggregates, result tables, and history.')}
            </p>
          </div>

          <div className="backtest-display-board__stack flex flex-col min-w-0">
            <section className="backtest-display-section min-w-0" data-testid="historical-display-section-summary">
              <Card title={copy('评估概览', 'Evaluation overview')} subtitle={copy('关键指标', 'Key metrics')} className="product-section-card product-section-card--backtest-result">
                <p className="product-section-copy">{copy('这里只做历史信号验证，不展示账户权益曲线，也不表示完整策略盈亏回放。', 'This validates historical signals only. It does not show an account equity curve or a full strategy P&L replay.')}</p>
                {(isLoadingSampleStatus || isLoadingPerf)
                  ? <div className="product-empty-state product-empty-state--compact">{copy('正在汇总历史分析评估概览…', 'Summarizing historical analysis evaluation...')}</div>
                  : <SummaryStrip items={historicalSummaryItems} />}
                {sampleStatusError ? <ApiErrorAlert error={sampleStatusError} className="mt-4" /> : null}
                {runResult ? <HistoricalRunSummary data={runResult} /> : null}
              </Card>
            </section>

            <section className="backtest-display-section min-w-0" data-testid="historical-display-section-results">
              <Card
                title={copy('评估结果', 'Evaluation results')}
                subtitle={selectedRunId ? copy(`评估结果 #${selectedRunId}`, `Evaluation result #${selectedRunId}`) : copy('结果表', 'Results table')}
                className="product-section-card product-section-card--backtest-result"
              >
                {pageError ? <ApiErrorAlert error={pageError} className="mb-4" /> : null}
                {isLoadingResults ? <div className="product-empty-state">{copy('正在加载历史分析评估结果…', 'Loading historical analysis evaluation results...')}</div> : <HistoricalResultsTable rows={results} />}
                <Pagination
                  className="mt-5"
                  currentPage={currentPage}
                  totalPages={Math.max(1, Math.ceil(totalResults / pageSize))}
                  onPageChange={onChangeResultsPage}
                />
                <p className="product-footnote">{copy(`共 ${totalResults} 条历史分析评估结果。`, `${totalResults} historical analysis evaluation results.`)}</p>
              </Card>
            </section>

            <section className="backtest-display-section min-w-0" data-testid="historical-display-section-history">
              <Card title={copy('历史记录', 'History')} subtitle={copy('次级区域', 'Secondary')} className="product-section-card product-section-card--backtest-secondary">
                {historyError ? <ApiErrorAlert error={historyError} className="mb-4" /> : null}
                {isLoadingHistory ? (
                  <div className="product-empty-state">{copy('正在加载历史分析评估运行记录…', 'Loading historical analysis evaluation history...')}</div>
                ) : (
                  <HistoricalRunsTable rows={historyItems} selectedRunId={selectedRunId} onOpen={(run) => void handleOpenHistoricalRun(run)} />
                )}
                <Pagination
                  className="mt-5"
                  currentPage={historyPage}
                  totalPages={Math.max(1, Math.ceil(historyTotal / historyPageSize))}
                  onPageChange={onChangeHistoryPage}
                />
                <p className="product-footnote">{copy(`共 ${historyTotal} 条历史分析评估运行记录。`, `${historyTotal} historical analysis evaluation runs.`)}</p>
              </Card>
            </section>
          </div>
        </section>
      </div>
    </div>
  );
};

export default HistoricalEvaluationPanel;
