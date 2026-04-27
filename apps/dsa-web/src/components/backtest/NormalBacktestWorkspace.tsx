import type React from 'react';
import { ApiErrorAlert } from '../../components/common';
import type { ParsedApiError } from '../../api/error';
import {
  RULE_BENCHMARK_OPTIONS,
  getBenchmarkModeLabel,
  type RuleBenchmarkMode,
} from './shared';

export type NormalStrategyTemplate = 'macd_crossover' | 'moving_average_trend' | 'periodic_accumulation' | 'custom_code';

type BacktestLanguage = 'zh' | 'en';

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
  customStrategyText: string;
  onCustomStrategyTextChange: (value: string) => void;
  templatePreview: string;
  onLaunch: () => Promise<void>;
  isLaunching: boolean;
  parseError: ParsedApiError | null;
  runError: ParsedApiError | null;
};

const TEMPLATE_COPY: Record<BacktestLanguage, Record<NormalStrategyTemplate, { label: string; description: string }>> = {
  zh: {
    macd_crossover: {
      label: 'MACD 金叉',
      description: '经典趋势跟随模板，适合快速验证单标的信号方向。',
    },
    moving_average_trend: {
      label: '均线多头',
      description: '使用短中期均线趋势关系做一键回测，适合普通用户直接上手。',
    },
    periodic_accumulation: {
      label: '定投策略',
      description: '按固定节奏持续买入，适合验证区间累计收益与基准差异。',
    },
    custom_code: {
      label: '自定义代码',
      description: '需要额外表达策略时，可在这里补充自然语言规则。',
    },
  },
  en: {
    macd_crossover: {
      label: 'MACD crossover',
      description: 'A classic trend-following preset for fast single-asset validation.',
    },
    moving_average_trend: {
      label: 'Moving average trend',
      description: 'A simple momentum preset for point-and-shoot users.',
    },
    periodic_accumulation: {
      label: 'Periodic accumulation',
      description: 'A scheduled accumulation template for capital deployment checks.',
    },
    custom_code: {
      label: 'Custom code',
      description: 'Drop in your own natural-language rule when presets are not enough.',
    },
  },
};

const FIELD_CLASS = 'input-surface input-focus-glow product-command-input !px-3 !py-2.5 !text-sm';

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
  customStrategyText,
  onCustomStrategyTextChange,
  templatePreview,
  onLaunch,
  isLaunching,
  parseError,
  runError,
}) => {
  const copy = TEMPLATE_COPY[language];
  const currentTemplate = copy[strategyTemplate];

  return (
    <section
      data-testid="normal-backtest-workspace"
      className="relative overflow-hidden rounded-[32px] border border-indigo-400/20 bg-[radial-gradient(circle_at_top_left,rgba(129,140,248,0.24),transparent_32%),linear-gradient(180deg,rgba(8,12,24,0.96),rgba(6,8,18,0.92))] shadow-[0_30px_80px_rgba(49,46,129,0.35)]"
    >
      <div className="grid gap-6 p-6 xl:grid-cols-[1.12fr_0.88fr] xl:items-stretch xl:p-8">
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-indigo-300/20 bg-indigo-400/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-indigo-100/80">
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
              <span className="theme-field-label">{language === 'en' ? 'Ticker' : '标的代码'}</span>
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
              <span className="theme-field-label">{language === 'en' ? 'Strategy template' : '策略模板'}</span>
              <select
                value={strategyTemplate}
                onChange={(event) => onStrategyTemplateChange(event.target.value as NormalStrategyTemplate)}
                className={FIELD_CLASS}
                aria-label={language === 'en' ? 'Strategy template' : '策略模板'}
              >
                {Object.entries(copy).map(([value, item]) => (
                  <option key={value} value={value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="product-field gap-1.5">
              <span className="theme-field-label">{language === 'en' ? 'Range start' : '回测区间开始'}</span>
              <input
                type="date"
                value={startDate}
                onChange={(event) => onStartDateChange(event.target.value)}
                className={FIELD_CLASS}
                aria-label={language === 'en' ? 'Range start' : '回测区间开始'}
              />
            </label>
            <label className="product-field gap-1.5">
              <span className="theme-field-label">{language === 'en' ? 'Range end' : '回测区间结束'}</span>
              <input
                type="date"
                value={endDate}
                onChange={(event) => onEndDateChange(event.target.value)}
                className={FIELD_CLASS}
                aria-label={language === 'en' ? 'Range end' : '回测区间结束'}
              />
            </label>
            <label className="product-field gap-1.5">
              <span className="theme-field-label">{language === 'en' ? 'Capital' : '初始资金'}</span>
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
              <span className="theme-field-label">{language === 'en' ? 'Fees (bp)' : '手续费 (bp)'}</span>
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

        <div className="flex flex-col gap-4 rounded-[28px] border border-white/10 bg-black/20 p-5 backdrop-blur-xl">
          <label className="product-field gap-1.5">
            <span className="theme-field-label">{language === 'en' ? 'Benchmark' : '对比基准'}</span>
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
              <span className="theme-field-label">{language === 'en' ? 'Custom benchmark code' : '自定义基准代码'}</span>
              <input
                type="text"
                value={benchmarkCode}
                onChange={(event) => onBenchmarkCodeChange(event.target.value.toUpperCase())}
                placeholder={language === 'en' ? 'QQQ / SPY / ^NDX / 000300' : 'QQQ / SPY / ^NDX / 000300'}
                className={FIELD_CLASS}
              />
            </label>
          ) : null}

          <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
            <p className="text-[11px] uppercase tracking-[0.22em] text-white/40">
              {language === 'en' ? 'Selected template' : '当前模板'}
            </p>
            <h3 className="mt-2 text-xl font-semibold text-white">{currentTemplate.label}</h3>
            <p className="mt-2 text-sm leading-6 text-white/60">{currentTemplate.description}</p>
          </div>

          <div className="rounded-[24px] border border-indigo-300/10 bg-indigo-400/8 p-4">
            <p className="text-[11px] uppercase tracking-[0.22em] text-indigo-100/60">
              {language === 'en' ? 'Launch preview' : '发射预览'}
            </p>
            <p className="mt-3 text-sm leading-7 text-white/74">
              {templatePreview}
            </p>
          </div>

          {strategyTemplate === 'custom_code' ? (
            <label className="product-field gap-1.5">
              <span className="theme-field-label">{language === 'en' ? 'Custom strategy text' : '自定义策略文本'}</span>
              <textarea
                value={customStrategyText}
                onChange={(event) => onCustomStrategyTextChange(event.target.value)}
                className="input-surface input-focus-glow product-command-input min-h-[120px] resize-none !px-3 !py-3 !text-sm"
                aria-label={language === 'en' ? 'Custom strategy text' : '自定义策略文本'}
              />
            </label>
          ) : null}

          <button
            type="button"
            onClick={() => void onLaunch()}
            disabled={isLaunching}
            className="group relative mt-auto inline-flex min-h-[82px] w-full items-center justify-center overflow-hidden rounded-[26px] border border-indigo-200/30 bg-[linear-gradient(135deg,rgba(129,140,248,0.88),rgba(79,70,229,0.86))] px-6 py-5 text-lg font-semibold tracking-[0.08em] text-white shadow-[0_28px_80px_rgba(99,102,241,0.45)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_34px_90px_rgba(99,102,241,0.52)] disabled:cursor-not-allowed disabled:opacity-70"
          >
            <span className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.3),transparent_42%)] opacity-80" />
            <span className="relative">
              {isLaunching
                ? (language === 'en' ? 'Launching...' : '正在启动...')
                : (language === 'en' ? '🚀 Launch backtest' : '🚀 一键开始回测')}
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
