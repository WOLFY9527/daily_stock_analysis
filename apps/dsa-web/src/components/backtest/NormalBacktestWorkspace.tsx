import type React from 'react';
import { Play } from 'lucide-react';
import { ApiErrorAlert } from '../../components/common';
import type { ParsedApiError } from '../../api/error';
import {
  RULE_BENCHMARK_OPTIONS,
  getBenchmarkModeLabel,
  type RuleBenchmarkMode,
} from './shared';
import {
  POINT_AND_SHOOT_TEMPLATES,
  getStrategyCatalogEntry,
  type BacktestLanguage,
  type NormalStrategyTemplate,
} from './strategyCatalog';

type NormalBacktestWorkspaceProps = {
  language: BacktestLanguage;
  code: string;
  onCodeChange: (value: string) => void;
  startDate: string;
  onStartDateChange: (value: string) => void;
  endDate: string;
  onEndDateChange: (value: string) => void;
  initialCapital: string;
  onInitialCapitalChange: (value: string) => void;
  feeBps: string;
  onFeeBpsChange: (value: string) => void;
  benchmarkMode: RuleBenchmarkMode;
  onBenchmarkModeChange: (value: RuleBenchmarkMode) => void;
  benchmarkCode: string;
  onBenchmarkCodeChange: (value: string) => void;
  strategyTemplate: NormalStrategyTemplate;
  onStrategyTemplateChange: (value: NormalStrategyTemplate) => void;
  templatePreview: string;
  onLaunch: () => Promise<void>;
  isLaunching: boolean;
  parseError: ParsedApiError | null;
  runError: ParsedApiError | null;
};

const GLASS_CARD_CLASS = 'rounded-[24px] border border-white/5 bg-white/[0.02] p-6';
const FIELD_CLASS = 'w-full min-w-0 truncate rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 pr-10 text-sm text-white outline-none transition-colors focus:border-indigo-500/50';
const LABEL_CLASS = 'mb-2 text-[10px] font-bold uppercase tracking-widest text-white/40';
const PRIMARY_CTA_CLASS = 'flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-base font-bold text-black transition-transform hover:bg-white/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-70';

const NormalBacktestWorkspace: React.FC<NormalBacktestWorkspaceProps> = ({
  language,
  code,
  onCodeChange,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  initialCapital,
  onInitialCapitalChange,
  feeBps,
  onFeeBpsChange,
  benchmarkMode,
  onBenchmarkModeChange,
  benchmarkCode,
  onBenchmarkCodeChange,
  strategyTemplate,
  onStrategyTemplateChange,
  templatePreview,
  onLaunch,
  isLaunching,
  parseError,
  runError,
}) => {
  const currentTemplate = getStrategyCatalogEntry(strategyTemplate);
  const templateName = currentTemplate?.name[language] || '';
  const templateDescription = currentTemplate?.description[language] || '';
  const templateLogicSummary = currentTemplate?.logicSummary[language] || '';

  return (
    <section
      data-testid="normal-backtest-workspace"
      className="w-full min-w-0 rounded-[32px] border border-white/5 bg-white/[0.02] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.28)] backdrop-blur-sm xl:p-8"
    >
      <div className="flex min-w-0 flex-col gap-6">
        <div className="grid min-w-0 gap-6 xl:grid-cols-4" data-testid="normal-backtest-primary-grid">
          <div className={`${GLASS_CARD_CLASS} flex h-full min-w-0 flex-col`}>
            <label className="product-field min-w-0 gap-1.5">
              <span className={LABEL_CLASS}>{language === 'en' ? 'Ticker' : '标的代码'}</span>
              <input
                type="text"
                value={code}
                onChange={(event) => onCodeChange(event.target.value.toUpperCase())}
                placeholder={language === 'en' ? 'AAPL / TSLA / 600519' : 'AAPL / TSLA / 600519'}
                className={FIELD_CLASS}
                aria-label={language === 'en' ? 'Ticker' : '标的代码'}
              />
            </label>
          </div>

          <div className={`${GLASS_CARD_CLASS} flex h-full min-w-0 flex-col gap-4`}>
            <label className="product-field min-w-0 gap-1.5">
              <span className={LABEL_CLASS}>{language === 'en' ? 'Benchmark' : '对比基准'}</span>
              <select
                value={benchmarkMode}
                onChange={(event) => onBenchmarkModeChange(event.target.value as RuleBenchmarkMode)}
                className={FIELD_CLASS}
                aria-label={language === 'en' ? 'Benchmark' : '对比基准'}
              >
                {RULE_BENCHMARK_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {getBenchmarkModeLabel(option.value, code, benchmarkCode, language)}
                  </option>
                ))}
              </select>
            </label>
            {benchmarkMode === 'custom_code' ? (
              <label className="product-field min-w-0 gap-1.5">
                <span className={LABEL_CLASS}>{language === 'en' ? 'Custom benchmark code' : '自定义基准代码'}</span>
                <input
                  type="text"
                  value={benchmarkCode}
                  onChange={(event) => onBenchmarkCodeChange(event.target.value.toUpperCase())}
                  placeholder={language === 'en' ? 'QQQ / SPY / ^NDX / 000300' : 'QQQ / SPY / ^NDX / 000300'}
                  className={FIELD_CLASS}
                />
              </label>
            ) : null}
          </div>

          <div className={`${GLASS_CARD_CLASS} flex h-full min-w-0 flex-col`}>
            <span className={LABEL_CLASS}>{language === 'en' ? 'Date range' : '回测区间'}</span>
            <div className="grid min-w-0 gap-4">
              <label className="product-field min-w-0 gap-1.5">
                <span className="sr-only">{language === 'en' ? 'Range start' : '回测区间开始'}</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => onStartDateChange(event.target.value)}
                  className={FIELD_CLASS}
                  aria-label={language === 'en' ? 'Range start' : '回测区间开始'}
                />
              </label>
              <label className="product-field min-w-0 gap-1.5">
                <span className="sr-only">{language === 'en' ? 'Range end' : '回测区间结束'}</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(event) => onEndDateChange(event.target.value)}
                  className={FIELD_CLASS}
                  aria-label={language === 'en' ? 'Range end' : '回测区间结束'}
                />
              </label>
            </div>
          </div>

          <div className={`${GLASS_CARD_CLASS} flex h-full min-w-0 flex-col`}>
            <label className="product-field min-w-0 gap-1.5">
              <span className={LABEL_CLASS}>{language === 'en' ? 'Capital' : '初始资金'}</span>
              <input
                type="number"
                min={1}
                value={initialCapital}
                onChange={(event) => onInitialCapitalChange(event.target.value)}
                className={FIELD_CLASS}
                aria-label={language === 'en' ? 'Capital' : '初始资金'}
              />
            </label>
          </div>
        </div>

        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)] xl:items-stretch">
          <div className={`${GLASS_CARD_CLASS} flex h-full min-w-0 flex-col gap-5`}>
            <label className="product-field min-w-0 gap-1.5">
              <span className={LABEL_CLASS}>{language === 'en' ? 'Strategy template' : '策略模板'}</span>
              <select
                value={strategyTemplate}
                onChange={(event) => onStrategyTemplateChange(event.target.value as NormalStrategyTemplate)}
                className={FIELD_CLASS}
                aria-label={language === 'en' ? 'Strategy template' : '策略模板'}
              >
                {POINT_AND_SHOOT_TEMPLATES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name[language]}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid min-w-0 gap-6 md:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
              <div className="min-w-0 rounded-[20px] border border-white/5 bg-white/[0.02] p-5">
                <p className={LABEL_CLASS}>
                  {language === 'en' ? 'Selected template' : '当前模板'}
                </p>
                <h3 className="mt-2 text-base font-semibold text-white">{templateName}</h3>
                <p className="mt-2 text-sm leading-6 text-white/60">{templateDescription}</p>
              </div>
              <div className="min-w-0 rounded-[20px] border border-white/5 bg-white/[0.02] p-5">
                <p className={LABEL_CLASS}>
                  {language === 'en' ? 'Execution logic' : '执行逻辑'}
                </p>
                <p className="mt-2 text-sm leading-6 text-white/68">{templateLogicSummary}</p>
              </div>
            </div>
            <div className="min-w-0 rounded-[20px] border border-white/5 bg-white/[0.02] p-5">
              <p className={LABEL_CLASS}>
                {language === 'en' ? 'Compile preview' : '编译预览'}
              </p>
              <p className="mt-2 text-sm leading-7 text-white/74">
                {templatePreview}
              </p>
            </div>
          </div>

          <div className={`${GLASS_CARD_CLASS} flex h-full min-w-0 flex-col gap-5`}>
            <label className="product-field min-w-0 gap-1.5">
              <span className={LABEL_CLASS}>{language === 'en' ? 'Fees (bp)' : '手续费 (bp)'}</span>
              <input
                type="number"
                min={0}
                max={500}
                value={feeBps}
                onChange={(event) => onFeeBpsChange(event.target.value)}
                className={FIELD_CLASS}
                aria-label={language === 'en' ? 'Fees (bp)' : '手续费 (bp)'}
              />
            </label>
            <div className="min-w-0 rounded-[20px] border border-white/5 bg-white/[0.02] p-5">
              <p className={LABEL_CLASS}>
                {language === 'en' ? 'Route' : '执行路径'}
              </p>
              <p className="mt-2 text-sm leading-6 text-white/68">
                {language === 'en'
                  ? 'Template compile -> deterministic submission -> dedicated result route'
                  : '模板编译 -> 确定性提交 -> 独立结果页'}
              </p>
            </div>
            <div className="flex min-w-0 flex-1 items-end">
              <button
                type="button"
                onClick={() => void onLaunch()}
                disabled={isLaunching}
                className={PRIMARY_CTA_CLASS}
              >
                <Play className="h-4 w-4" />
                <span>
                  {isLaunching
                    ? (language === 'en' ? 'Submitting...' : '提交中...')
                    : (language === 'en' ? 'Execute backtest task' : '执行回测任务')}
                </span>
              </button>
            </div>
            {parseError ? <ApiErrorAlert error={parseError} /> : null}
            {runError ? <ApiErrorAlert error={runError} /> : null}
          </div>
        </div>
      </div>
    </section>
  );
};

export default NormalBacktestWorkspace;
