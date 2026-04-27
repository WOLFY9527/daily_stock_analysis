import type React from 'react';
import { useState } from 'react';
import DeterministicBacktestFlow, {
  type FlowProps,
  type RuleWizardStep,
} from './DeterministicBacktestFlow';

type BacktestLanguage = 'zh' | 'en';

type NavItem = {
  id: string;
  label: string;
  testId: string;
  step?: RuleWizardStep;
};

type ProBacktestWorkspaceProps = Omit<FlowProps, 'panelMode'> & {
  language: BacktestLanguage;
};

const ProBacktestWorkspace: React.FC<ProBacktestWorkspaceProps> = ({
  language,
  onParse,
  onRun,
  currentStep,
  onStepChange,
  parsedStrategy,
  confirmed,
  parseStale,
  isSubmitting,
  ...flowProps
}) => {
  const [portfolioMode, setPortfolioMode] = useState<'single' | 'multi'>('single');
  const [rebalancingCadence, setRebalancingCadence] = useState('monthly');
  const [eventDriven, setEventDriven] = useState(true);
  const [enableStopLoss, setEnableStopLoss] = useState(true);
  const [enableTakeProfit, setEnableTakeProfit] = useState(true);
  const [enableTrailingStop, setEnableTrailingStop] = useState(false);
  const [enableGridSearch, setEnableGridSearch] = useState(false);
  const [enableBayesianSearch, setEnableBayesianSearch] = useState(false);
  const [enableWalkForward, setEnableWalkForward] = useState(true);
  const [enableMonteCarlo, setEnableMonteCarlo] = useState(false);

  const navItems: NavItem[] = [
    {
      id: 'pro-section-assets',
      label: language === 'en' ? 'Assets & portfolio' : '标的与组合',
      testId: 'pro-backtest-nav-assets',
      step: 'symbol',
    },
    {
      id: 'pro-section-strategy',
      label: language === 'en' ? 'Strategy engine' : '策略与引擎',
      testId: 'pro-backtest-nav-strategy',
      step: 'strategy',
    },
    {
      id: 'pro-section-orders',
      label: language === 'en' ? 'Orders & risk' : '订单与风控',
      testId: 'pro-backtest-nav-orders',
      step: 'confirm',
    },
    {
      id: 'pro-section-execution',
      label: language === 'en' ? 'Execution model' : '成本与滑点',
      testId: 'pro-backtest-nav-execution',
      step: 'confirm',
    },
    {
      id: 'pro-section-analytics',
      label: language === 'en' ? 'Advanced analytics' : '高级分析',
      testId: 'pro-backtest-nav-analytics',
      step: 'run',
    },
  ];

  const jumpToSection = (item: NavItem) => {
    const element = document.getElementById(item.id);
    if (element && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    if (item.step) onStepChange(item.step);
  };

  const handleCompileAndRun = async () => {
    if (!parsedStrategy || parseStale) {
      onStepChange('strategy');
      await onParse();
      return;
    }
    if (!confirmed) {
      onStepChange('confirm');
      return;
    }
    onStepChange('run');
    await onRun();
  };

  const compactSelectClass = 'input-surface input-focus-glow product-command-input !px-3 !py-2.5 !text-sm';
  const compactCardClass = 'rounded-[24px] border border-white/8 bg-white/[0.03] p-4';

  return (
    <section
      data-testid="pro-backtest-workspace"
      data-module="rule"
      className="overflow-hidden rounded-[32px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,9,18,0.98),rgba(4,5,12,0.94))] shadow-[0_32px_80px_rgba(0,0,0,0.42)]"
    >
      <div className="flex min-h-[900px] min-w-0">
        <aside
          data-testid="pro-backtest-sidebar"
          className="w-64 border-r border-white/5 bg-white/[0.02] px-4 py-5"
        >
          <div className="flex flex-col gap-2">
            <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-100/55">
              {language === 'en' ? 'Quant IDE' : 'Quant IDE'}
            </p>
            <h2 className="text-2xl font-semibold text-white">
              {language === 'en' ? 'Quant workbench' : '量化工作台'}
            </h2>
            <p className="text-sm leading-6 text-white/56">
              {language === 'en'
                ? 'Release the full engine surface: orchestration, execution, and analysis live in one docked console.'
                : '将策略编译、执行模型、风控与高级分析收拢到统一参数面板内。'}
            </p>
          </div>

          <div className="mt-6 flex flex-col gap-2">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                data-testid={item.testId}
                onClick={() => jumpToSection(item)}
                className={`rounded-2xl border px-4 py-3 text-left transition ${
                  currentStep === item.step
                    ? 'border-cyan-300/30 bg-cyan-400/10 text-white'
                    : 'border-white/8 bg-white/[0.02] text-white/72 hover:border-white/14 hover:bg-white/[0.05]'
                }`}
              >
                <span className="block text-sm font-medium">{item.label}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <div
            data-testid="pro-backtest-compile-bar"
            className="sticky top-0 z-10 flex flex-col gap-4 border-b border-white/5 bg-[rgba(4,7,18,0.94)] px-6 py-5 backdrop-blur-xl xl:flex-row xl:items-center xl:justify-between"
          >
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-100/50">
                {language === 'en' ? 'Compile zone' : 'Compile Zone'}
              </p>
              <p className="mt-1 text-sm text-white/60">
                {language === 'en'
                  ? 'Keep the left tree for capability routing, and use this dock to compile or launch without leaving the panel.'
                  : '左侧能力树负责切换工作区，右侧操作坞负责编译与运行。'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void onParse()}
                className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-medium text-white/86 transition hover:border-white/20 hover:bg-white/[0.08]"
              >
                {language === 'en' ? 'Compile strategy' : '编译策略'}
              </button>
              <button
                type="button"
                onClick={() => void handleCompileAndRun()}
                disabled={isSubmitting}
                className="rounded-full border border-cyan-300/30 bg-cyan-400/14 px-5 py-2 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(34,211,238,0.18)] transition hover:-translate-y-0.5 hover:border-cyan-200/40 hover:bg-cyan-300/18 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {language === 'en' ? 'Compile & Run' : '编译并运行'}
              </button>
            </div>
          </div>

          <div className="max-h-[calc(100vh-14rem)] overflow-y-auto px-6 py-6">
            <div className="grid gap-6 xl:grid-cols-2">
              <section id="pro-section-assets" className={compactCardClass}>
                <p className="text-[11px] uppercase tracking-[0.22em] text-white/42">
                  {language === 'en' ? 'Assets & portfolio' : '标的与组合'}
                </p>
                <div className="mt-4 grid gap-4">
                  <label className="product-field gap-1.5">
                    <span className="theme-field-label">{language === 'en' ? 'Scope mode' : '资产范围'}</span>
                    <select
                      value={portfolioMode}
                      onChange={(event) => setPortfolioMode(event.target.value as 'single' | 'multi')}
                      className={compactSelectClass}
                    >
                      <option value="single">{language === 'en' ? 'Single asset' : '单资产'}</option>
                      <option value="multi">{language === 'en' ? 'Portfolio + rebalance' : '组合 + 再平衡'}</option>
                    </select>
                  </label>
                  <label className="product-field gap-1.5">
                    <span className="theme-field-label">{language === 'en' ? 'Rebalancing cadence' : '再平衡频率'}</span>
                    <select
                      value={rebalancingCadence}
                      onChange={(event) => setRebalancingCadence(event.target.value)}
                      className={compactSelectClass}
                    >
                      <option value="monthly">{language === 'en' ? 'Monthly' : '每月'}</option>
                      <option value="weekly">{language === 'en' ? 'Weekly' : '每周'}</option>
                      <option value="quarterly">{language === 'en' ? 'Quarterly' : '每季度'}</option>
                    </select>
                  </label>
                </div>
              </section>

              <section id="pro-section-strategy" className={compactCardClass}>
                <p className="text-[11px] uppercase tracking-[0.22em] text-white/42">
                  {language === 'en' ? 'Strategy engine' : '策略与引擎'}
                </p>
                <div className="mt-4 flex flex-col gap-3 text-sm text-white/72">
                  <label className="inline-flex items-center gap-3">
                    <input type="checkbox" checked={eventDriven} onChange={(event) => setEventDriven(event.target.checked)} />
                    <span>{language === 'en' ? 'Enable event-driven mode' : '启用事件驱动模式'}</span>
                  </label>
                  <p>{language === 'en' ? 'Natural-language rule compile path remains live below.' : '自然语言规则编译链路仍然保持可执行，详细参数区继续在下方工作。'}</p>
                </div>
              </section>

              <section id="pro-section-orders" className={compactCardClass}>
                <p className="text-[11px] uppercase tracking-[0.22em] text-white/42">
                  {language === 'en' ? 'Orders & risk' : '订单与风控'}
                </p>
                <div className="mt-4 grid gap-3 text-sm text-white/72">
                  <label className="inline-flex items-center gap-3">
                    <input type="checkbox" checked={enableStopLoss} onChange={(event) => setEnableStopLoss(event.target.checked)} />
                    <span>{language === 'en' ? 'Stop loss routing' : '止损路由'}</span>
                  </label>
                  <label className="inline-flex items-center gap-3">
                    <input type="checkbox" checked={enableTakeProfit} onChange={(event) => setEnableTakeProfit(event.target.checked)} />
                    <span>{language === 'en' ? 'Take profit routing' : '止盈路由'}</span>
                  </label>
                  <label className="inline-flex items-center gap-3">
                    <input type="checkbox" checked={enableTrailingStop} onChange={(event) => setEnableTrailingStop(event.target.checked)} />
                    <span>{language === 'en' ? 'Trailing stop routing' : '追踪止损路由'}</span>
                  </label>
                </div>
              </section>

              <section id="pro-section-execution" className={compactCardClass}>
                <p className="text-[11px] uppercase tracking-[0.22em] text-white/42">
                  {language === 'en' ? 'Execution model' : '成本与滑点'}
                </p>
                <p className="mt-4 text-sm leading-6 text-white/68">
                  {language === 'en'
                    ? 'Execution costs still map to the deterministic engine fields below, while this dock previews where richer routing and slippage presets will land.'
                    : '当前执行成本仍映射到底层确定性回测字段，下方参数区继续负责真实提交；这里先承接更复杂的滑点与路由能力。'}
                </p>
              </section>
            </div>

            <section id="pro-section-analytics" className={`${compactCardClass} mt-6`}>
              <p className="text-[11px] uppercase tracking-[0.22em] text-white/42">
                {language === 'en' ? 'Advanced analytics' : '高级分析'}
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4 text-sm text-white/72">
                <label className="inline-flex items-center gap-3">
                  <input type="checkbox" checked={enableGridSearch} onChange={(event) => setEnableGridSearch(event.target.checked)} />
                  <span>{language === 'en' ? 'Grid search' : 'Grid Search'}</span>
                </label>
                <label className="inline-flex items-center gap-3">
                  <input type="checkbox" checked={enableBayesianSearch} onChange={(event) => setEnableBayesianSearch(event.target.checked)} />
                  <span>{language === 'en' ? 'Bayesian search' : 'Bayesian Search'}</span>
                </label>
                <label className="inline-flex items-center gap-3">
                  <input type="checkbox" checked={enableWalkForward} onChange={(event) => setEnableWalkForward(event.target.checked)} />
                  <span>{language === 'en' ? 'Walk-forward' : 'Walk-Forward'}</span>
                </label>
                <label className="inline-flex items-center gap-3">
                  <input type="checkbox" checked={enableMonteCarlo} onChange={(event) => setEnableMonteCarlo(event.target.checked)} />
                  <span>{language === 'en' ? 'Monte Carlo' : 'Monte Carlo'}</span>
                </label>
              </div>
            </section>

            <div className="mt-6">
              <DeterministicBacktestFlow
                {...flowProps}
                onParse={onParse}
                onRun={onRun}
                currentStep={currentStep}
                onStepChange={onStepChange}
                parsedStrategy={parsedStrategy}
                confirmed={confirmed}
                parseStale={parseStale}
                isSubmitting={isSubmitting}
                panelMode="professional"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ProBacktestWorkspace;
