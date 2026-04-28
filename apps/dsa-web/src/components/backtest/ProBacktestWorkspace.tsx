import type React from 'react';
import { useEffect, useState } from 'react';
import DeterministicBacktestFlow, {
  type FlowProps,
  type RuleWizardStep,
} from './DeterministicBacktestFlow';
import { getStrategyCatalogGroups } from './strategyCatalog';

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
  onStrategyTextChange,
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
  const [catalogToast, setCatalogToast] = useState<string | null>(null);

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

  const compactSelectClass = 'w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-white outline-none transition-colors focus:border-indigo-500/50';
  const compactCardClass = 'rounded-[24px] border border-white/5 bg-white/[0.02] p-6';
  const compactFieldLabelClass = 'mb-2 text-[10px] font-bold uppercase tracking-widest text-white/40';
  const strategyCatalogGroups = getStrategyCatalogGroups();

  useEffect(() => {
    if (!catalogToast) {
      return;
    }
    const timer = window.setTimeout(() => {
      setCatalogToast(null);
    }, 3200);
    return () => window.clearTimeout(timer);
  }, [catalogToast]);

  const applyCatalogTemplate = (strategyText: string) => {
    onStrategyTextChange(strategyText);
    onStepChange('strategy');
  };

  const handleCatalogTemplateAction = (strategyText: string, executable: boolean) => {
    applyCatalogTemplate(strategyText);
    if (!executable) {
      setCatalogToast(
        language === 'en'
          ? 'This template is not directly runnable yet. Modify it in the editor before execution.'
          : '当前模板暂不支持直接运行，请在编辑器中修改后再执行',
      );
    }
  };

  return (
    <section
      data-testid="pro-backtest-workspace"
      data-module="rule"
      className="w-full min-w-0 rounded-[32px] border border-white/5 bg-white/[0.02] p-6 shadow-[0_32px_80px_rgba(0,0,0,0.32)] backdrop-blur-sm"
    >
      <div className="grid min-w-0 gap-6 xl:grid-cols-5 xl:items-start">
        <aside
          data-testid="pro-backtest-sidebar"
          className="flex min-w-0 flex-col gap-4 xl:col-span-1 xl:sticky xl:top-6"
        >
          <div className="rounded-[24px] border border-white/5 bg-white/[0.02] p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">
              {language === 'en' ? 'Professional lane' : '专业模式'}
            </p>
            <div className="mt-4 flex flex-col gap-2 rounded-[20px] border border-white/5 bg-black/20 p-3">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-testid={item.testId}
                  onClick={() => jumpToSection(item)}
                  className={`min-w-0 rounded-2xl border px-4 py-3 text-left transition ${
                    currentStep === item.step
                      ? 'border-indigo-400/40 bg-indigo-500/10 text-white'
                      : 'border-white/5 bg-white/[0.02] text-white/72 hover:border-white/12 hover:bg-white/[0.05]'
                  }`}
                >
                  <span className="block truncate text-sm font-medium">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col gap-6 xl:col-span-4">
          <div
            data-testid="pro-backtest-compile-bar"
            className="flex min-w-0 flex-col gap-4 rounded-[24px] border border-white/5 bg-white/[0.02] px-6 py-5 backdrop-blur-sm xl:flex-row xl:items-center xl:justify-between"
          >
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                {language === 'en' ? 'Compile zone' : 'Compile Zone'}
              </p>
              <p className="mt-2 text-sm text-white/60">
                {language === 'en'
                  ? 'Compile, inspect, and route the deterministic run from one board.'
                  : '在同一块工作台里完成编译、检查和提交。'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void onParse()}
                className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-medium text-white/86 transition hover:border-white/20 hover:bg-white/[0.08]"
              >
                {language === 'en' ? 'Compile strategy' : '编译策略'}
              </button>
              <button
                type="button"
                onClick={() => void handleCompileAndRun()}
                disabled={isSubmitting}
                className="rounded-2xl bg-white px-5 py-2 text-sm font-semibold text-black transition-transform hover:bg-white/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {language === 'en' ? 'Execute backtest task' : '执行回测任务'}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="grid gap-6 xl:grid-cols-5 xl:items-stretch">
              <section id="pro-section-assets" className={`${compactCardClass} flex h-full min-w-0 flex-col`}>
                <p className={compactFieldLabelClass}>
                  {language === 'en' ? 'Assets & portfolio' : '标的与组合'}
                </p>
                <div className="mt-4 grid gap-4">
                  <label className="product-field gap-1.5">
                    <span className={compactFieldLabelClass}>{language === 'en' ? 'Scope mode' : '资产范围'}</span>
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
                    <span className={compactFieldLabelClass}>{language === 'en' ? 'Rebalancing cadence' : '再平衡频率'}</span>
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

              <section id="pro-section-strategy" className={`${compactCardClass} flex h-full min-w-0 flex-col`}>
                <p className={compactFieldLabelClass}>
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

              <section id="pro-section-orders" className={`${compactCardClass} flex h-full min-w-0 flex-col`}>
                <p className={compactFieldLabelClass}>
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

              <section id="pro-section-execution" className={`${compactCardClass} flex h-full min-w-0 flex-col`}>
                <p className={compactFieldLabelClass}>
                  {language === 'en' ? 'Execution model' : '成本与滑点'}
                </p>
                <p className="mt-4 text-sm leading-6 text-white/68">
                  {language === 'en'
                    ? 'Execution costs still map to the deterministic engine fields below, while this dock previews where richer routing and slippage presets will land.'
                    : '当前执行成本仍映射到底层确定性回测字段，下方参数区继续负责真实提交；这里先承接更复杂的滑点与路由能力。'}
                </p>
              </section>
            </div>

            <section id="pro-section-analytics" className={`${compactCardClass} flex min-w-0 flex-col`}>
              <p className={compactFieldLabelClass}>
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

            <section
              id="pro-section-strategy-catalog"
              data-testid="pro-strategy-catalog"
              className={`${compactCardClass} mt-6`}
            >
              <div className="flex flex-col gap-2">
                <p className={compactFieldLabelClass}>
                  {language === 'en' ? 'Built-in strategy catalog' : '内置策略目录'}
                </p>
                <h3 className="text-2xl font-semibold text-white">
                  {language === 'en' ? 'Full template catalog' : '完整模板目录'}
                </h3>
                <p className="text-sm leading-6 text-white/60">
                  {language === 'en'
                    ? 'Point-and-shoot keeps only the deterministic-ready presets. This catalog keeps every built-in basic, advanced, and professional template available as runtime-loaded references.'
                    : '普通模式只保留 deterministic 可执行模板。这里保留全部基础、进阶、专业内置模板，作为运行时可加载目录与专业模式参考面板。'}
                </p>
                {catalogToast ? (
                  <p
                    data-testid="pro-strategy-catalog-toast"
                    role="status"
                    aria-live="polite"
                    className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-100"
                  >
                    {catalogToast}
                  </p>
                ) : null}
              </div>

              <div className="mt-6 flex flex-col gap-6">
                {strategyCatalogGroups.map((group) => (
                  <div key={group.id} className="flex flex-col gap-4">
                    <div>
                      <h4 className="text-lg font-semibold text-white">{group.title[language]}</h4>
                      <p className="mt-1 text-sm text-white/52">{group.description[language]}</p>
                    </div>
                    <div className="grid gap-4 xl:grid-cols-2">
                      {group.templates.map((template) => (
                        <article
                          key={template.id}
                          className="rounded-[22px] border border-white/6 bg-black/20 p-5"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h5 className="text-base font-semibold text-white">{template.name[language]}</h5>
                              <p className="mt-1 text-sm leading-6 text-white/60">{template.description[language]}</p>
                            </div>
                              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                                template.executable
                                ? 'border-indigo-400/30 bg-indigo-400/10 text-indigo-200'
                                : 'border-amber-500/30 bg-amber-500/10 text-amber-100'
                            }`}
                            >
                              {template.executable
                                ? (language === 'en' ? 'Executable' : '可执行')
                                : (language === 'en' ? 'Not supported yet' : '当前不支持')}
                            </span>
                          </div>

                          <p className="mt-3 text-sm leading-6 text-white/70">{template.logicSummary[language]}</p>

                          <div className="mt-4 flex flex-wrap gap-2">
                            {template.defaultParameters.map((parameter) => (
                              <span
                                key={`${template.id}-${parameter.key}`}
                                className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] text-white/58"
                              >
                                {parameter.label[language]}: {parameter.value}
                              </span>
                            ))}
                          </div>

                          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/6 pt-4">
                            <p className="text-xs leading-5 text-white/45">
                              {template.executable
                                ? (language === 'en'
                                  ? 'This template maps cleanly to the current deterministic engine.'
                                  : '该模板可直接映射到当前 deterministic 引擎。')
                                : (language === 'en'
                                  ? 'Reference template only. Filling it into the editor may still parse as unsupported.'
                                  : '仅作参考模板。填入编辑器后，当前仍可能被解析为不支持。')}
                            </p>
                            <button
                              type="button"
                              onClick={() => handleCatalogTemplateAction(template.editorText[language], template.executable)}
                              title={template.executable
                                ? (language === 'en' ? 'Load this template into the editor' : '将该模板填入编辑器')
                                : (language === 'en' ? 'Reference only. Edit before running.' : '仅供参考，执行前请先在编辑器中修改')}
                              className={`rounded-2xl border px-4 py-2 text-sm font-medium transition ${
                                template.executable
                                  ? 'border-white/10 bg-white/[0.05] text-white/86 hover:border-white/20 hover:bg-white/[0.08]'
                                  : 'border-amber-500/25 bg-amber-500/10 text-amber-100 hover:border-amber-400/35 hover:bg-amber-500/14'
                              }`}
                            >
                              {template.executable
                                ? (language === 'en' ? 'Load into editor' : '填入编辑器')
                                : (language === 'en' ? 'Load as reference' : '载入参考模板')}
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <div className="min-w-0">
              <DeterministicBacktestFlow
                {...flowProps}
                onParse={onParse}
                onRun={onRun}
                onStrategyTextChange={onStrategyTextChange}
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
