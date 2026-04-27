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
const FIELD_CLASS = 'w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-white outline-none transition-colors focus:border-indigo-500/50';
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
      className="relative overflow-hidden rounded-[32px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,24,0.96),rgba(6,8,18,0.92))] shadow-[0_30px_80px_rgba(0,0,0,0.35)]"
    >
      <div className="grid gap-6 p-6 xl:grid-cols-[1.12fr_0.88fr] xl:items-stretch xl:p-8">
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/72">
              {language === 'en' ? 'Point & shoot mode' : 'Point & Shoot 模式'}
            </span>
            <span className="text-xs text-white/50">
              {language === 'en' ? 'One screen. No wizard. No panel maze.' : '一屏完成，不再把普通用户丢进参数迷宫。'}
            </span>
          </div>
          <div>
            <h2 className="text-[clamp(1.9rem,2.5vw,2.8rem)] font-semibold tracking-[0.04em] text-white">
              {language === 'en' ? 'Point-and-shoot launch pad' : '极简回测发射台'}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/68">
              {language === 'en'
                ? 'Pick a template, fill in ticker, range, capital, benchmark, and fees in one pass, then launch straight into the dedicated result console.'
                : '先选模板，再在一屏内完成标的、区间、资金、基准与成本设置。提交后直接进入独立结果页。'}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="product-field gap-1.5">
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
            <label className="product-field gap-1.5">
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
            <label className="product-field gap-1.5">
              <span className={LABEL_CLASS}>{language === 'en' ? 'Range start' : '回测区间开始'}</span>
              <input
                type="date"
                value={startDate}
                onChange={(event) => onStartDateChange(event.target.value)}
                className={FIELD_CLASS}
                aria-label={language === 'en' ? 'Range start' : '回测区间开始'}
              />
            </label>
            <label className="product-field gap-1.5">
              <span className={LABEL_CLASS}>{language === 'en' ? 'Range end' : '回测区间结束'}</span>
              <input
                type="date"
                value={endDate}
                onChange={(event) => onEndDateChange(event.target.value)}
                className={FIELD_CLASS}
                aria-label={language === 'en' ? 'Range end' : '回测区间结束'}
              />
            </label>
            <label className="product-field gap-1.5">
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
            <label className="product-field gap-1.5">
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
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-[28px] border border-white/8 bg-white/[0.02] p-5 backdrop-blur-xl">
          <label className="product-field gap-1.5">
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
            <label className="product-field gap-1.5">
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

          <div className={GLASS_CARD_CLASS}>
            <p className={LABEL_CLASS}>
              {language === 'en' ? 'Selected template' : '当前模板'}
            </p>
            <h3 className="mt-2 text-xl font-semibold text-white">{templateName}</h3>
            <p className="mt-2 text-sm leading-6 text-white/60">{templateDescription}</p>
            <p className="mt-3 text-xs leading-6 text-white/46">{templateLogicSummary}</p>
          </div>

          <div className={GLASS_CARD_CLASS}>
            <p className={LABEL_CLASS}>
              {language === 'en' ? 'Launch preview' : '发射预览'}
            </p>
            <p className="mt-3 text-sm leading-7 text-white/74">
              {templatePreview}
            </p>
          </div>

          <button
            type="button"
            onClick={() => void onLaunch()}
            disabled={isLaunching}
            className={PRIMARY_CTA_CLASS}
          >
            <Play className="h-4 w-4" />
            <span>
              {isLaunching
                ? (language === 'en' ? 'Launching...' : '正在启动...')
                : (language === 'en' ? 'Launch backtest' : '一键开始回测')}
            </span>
          </button>

          {parseError ? <ApiErrorAlert error={parseError} /> : null}
          {runError ? <ApiErrorAlert error={runError} /> : null}
        </div>
      </div>
    </section>
  );
};

export default NormalBacktestWorkspace;
