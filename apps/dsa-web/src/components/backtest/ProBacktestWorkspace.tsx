import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  PanelRightOpen,
  Play,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { ApiErrorAlert, Button, Disclosure, Drawer, GlassCard } from '../../components/common';
import DeterministicBacktestFlow, {
  type FlowProps,
  type RuleWizardStep,
} from './DeterministicBacktestFlow';
import { getBenchmarkModeLabel } from './shared';
import { getStrategyCatalogGroups } from './strategyCatalog';

type BacktestLanguage = 'zh' | 'en';
type WorkspacePane = 'assets' | 'strategy' | 'orders' | 'execution' | 'analytics';

type NavItem = {
  id: WorkspacePane;
  label: string;
  testId: string;
  step?: RuleWizardStep;
};

type ProBacktestWorkspaceProps = Omit<FlowProps, 'panelMode'> & {
  language: BacktestLanguage;
};

const compactSelectClass = 'w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-white outline-none transition-colors focus:border-indigo-500/50';
const compactInputClass = 'w-full min-w-0 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-white outline-none transition-colors focus:border-indigo-500/50';
const compactFieldLabelClass = 'mb-2 text-[10px] font-bold uppercase tracking-widest text-white/40';

const ProBacktestWorkspace: React.FC<ProBacktestWorkspaceProps> = ({
  language,
  code,
  onCodeChange,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  initialCapital,
  onInitialCapitalChange,
  lookbackBars,
  onLookbackBarsChange,
  feeBps,
  onFeeBpsChange,
  slippageBps,
  onSlippageBpsChange,
  benchmarkMode,
  onBenchmarkModeChange,
  benchmarkCode,
  onBenchmarkCodeChange,
  onParse,
  onRun,
  onStrategyTextChange,
  currentStep,
  onStepChange,
  parsedStrategy,
  confirmed,
  parseStale,
  isSubmitting,
  parseError,
  runError,
  strategyText,
  historyTotal,
  ...flowProps
}) => {
  const [activePane, setActivePane] = useState<WorkspacePane>('strategy');
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
  const [isCatalogDrawerOpen, setIsCatalogDrawerOpen] = useState(false);
  const [catalogGroupId, setCatalogGroupId] = useState<string>('basic');
  const [ordersTab, setOrdersTab] = useState<'routing' | 'guards'>('routing');
  const [analyticsTab, setAnalyticsTab] = useState<'optimization' | 'robustness'>('optimization');

  const strategyCatalogGroups = getStrategyCatalogGroups();
  const activeCatalogGroup = useMemo(
    () => strategyCatalogGroups.find((group) => group.id === catalogGroupId) || strategyCatalogGroups[0],
    [catalogGroupId, strategyCatalogGroups],
  );

  const navItems: NavItem[] = [
    {
      id: 'assets',
      label: language === 'en' ? 'Assets & portfolio' : '标的与组合',
      testId: 'pro-backtest-nav-assets',
      step: 'symbol',
    },
    {
      id: 'strategy',
      label: language === 'en' ? 'Strategy engine' : '策略与引擎',
      testId: 'pro-backtest-nav-strategy',
      step: 'strategy',
    },
    {
      id: 'orders',
      label: language === 'en' ? 'Orders & risk' : '订单与风控',
      testId: 'pro-backtest-nav-orders',
      step: 'confirm',
    },
    {
      id: 'execution',
      label: language === 'en' ? 'Execution model' : '成本与滑点',
      testId: 'pro-backtest-nav-execution',
      step: 'confirm',
    },
    {
      id: 'analytics',
      label: language === 'en' ? 'Advanced analytics' : '高级分析',
      testId: 'pro-backtest-nav-analytics',
      step: 'run',
    },
  ];

  useEffect(() => {
    if (!catalogToast) return undefined;
    const timer = window.setTimeout(() => {
      setCatalogToast(null);
    }, 3200);
    return () => window.clearTimeout(timer);
  }, [catalogToast]);

  const jumpToPane = (item: NavItem) => {
    setActivePane(item.id);
    if (item.step) onStepChange(item.step);
  };

  const handleCompileAndRun = async () => {
    setActivePane('strategy');
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

  const applyCatalogTemplate = (nextStrategyText: string) => {
    onStrategyTextChange(nextStrategyText);
    onStepChange('strategy');
    setActivePane('strategy');
    setIsCatalogDrawerOpen(false);
  };

  const handleCatalogTemplateAction = (nextStrategyText: string, executable: boolean) => {
    applyCatalogTemplate(nextStrategyText);
    if (!executable) {
      setCatalogToast(
        language === 'en'
          ? 'This template is not directly runnable yet. Modify it in the editor before execution.'
          : '当前模板暂不支持直接运行，请在编辑器中修改后再执行',
      );
    }
  };

  const activePaneMeta = {
    assets: {
      eyebrow: language === 'en' ? 'Asset scope' : '标的与组合',
      title: language === 'en' ? 'Keep the launch baseline compact and visible.' : '先把基础资产与时间窗口压缩成一块高密度基座。',
    },
    strategy: {
      eyebrow: language === 'en' ? 'Strategy engine' : '策略与引擎',
      title: language === 'en' ? 'The editor stays central; the template sea moves into a drawer.' : '编辑器留在主舞台，模板海收进右侧抽屉。',
    },
    orders: {
      eyebrow: language === 'en' ? 'Orders & risk' : '订单与风控',
      title: language === 'en' ? 'Risk routing stays folded until you need it.' : '风控和路由默认收起，只在需要时展开。',
    },
    execution: {
      eyebrow: language === 'en' ? 'Execution model' : '成本与滑点',
      title: language === 'en' ? 'Execution friction and benchmark assumptions live on one compact board.' : '执行摩擦、回看窗口和基准假设集中到一块执行板。'},
    analytics: {
      eyebrow: language === 'en' ? 'Advanced analytics' : '高级分析',
      title: language === 'en' ? 'Heavy optimization controls stay hidden behind tabs and accordions.' : '重型优化参数藏到二级标签和折叠面板里。'},
  }[activePane];

  const currentStrategyLabel = parsedStrategy?.parsedStrategy.summary?.strategy
    || parsedStrategy?.coreIntentSummary
    || strategyText.trim().split('\n')[0]
    || (language === 'en' ? 'No strategy draft yet' : '当前还没有策略草稿');

  const currentStrategyState = parsedStrategy
    ? (parsedStrategy.executable || parsedStrategy.parsedStrategy.executable
      ? (language === 'en' ? 'Runnable' : '可执行')
      : (language === 'en' ? 'Needs review' : '需要复查'))
    : (language === 'en' ? 'Draft only' : '草稿');

  const renderAssetsPane = () => (
    <div data-testid="pro-panel-assets" className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <GlassCard className="p-6">
        <p className={compactFieldLabelClass}>{language === 'en' ? 'Launch baseline' : '基础发射参数'}</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="product-field gap-1.5">
            <span className={compactFieldLabelClass}>{language === 'en' ? 'Ticker' : '标的代码'}</span>
            <input
              value={code}
              onChange={(event) => onCodeChange(event.target.value.toUpperCase())}
              className={compactInputClass}
              aria-label={language === 'en' ? 'Ticker' : '标的代码'}
            />
          </label>
          <label className="product-field gap-1.5">
            <span className={compactFieldLabelClass}>{language === 'en' ? 'Benchmark' : '对比基准'}</span>
            <select
              value={benchmarkMode}
              onChange={(event) => onBenchmarkModeChange(event.target.value as typeof benchmarkMode)}
              className={compactSelectClass}
              aria-label={language === 'en' ? 'Benchmark' : '对比基准'}
            >
              <option value={benchmarkMode}>{getBenchmarkModeLabel(benchmarkMode, code, benchmarkCode, language)}</option>
            </select>
          </label>
          <label className="product-field gap-1.5">
            <span className={compactFieldLabelClass}>{language === 'en' ? 'Start date' : '开始日期'}</span>
            <input type="date" value={startDate} onChange={(event) => onStartDateChange(event.target.value)} className={compactInputClass} aria-label={language === 'en' ? 'Start date' : '开始日期'} />
          </label>
          <label className="product-field gap-1.5">
            <span className={compactFieldLabelClass}>{language === 'en' ? 'End date' : '结束日期'}</span>
            <input type="date" value={endDate} onChange={(event) => onEndDateChange(event.target.value)} className={compactInputClass} aria-label={language === 'en' ? 'End date' : '结束日期'} />
          </label>
          <label className="product-field gap-1.5 md:col-span-2">
            <span className={compactFieldLabelClass}>{language === 'en' ? 'Initial capital' : '初始资金'}</span>
            <input type="number" min={1} value={initialCapital} onChange={(event) => onInitialCapitalChange(event.target.value)} className={compactInputClass} aria-label={language === 'en' ? 'Initial capital' : '初始资金'} />
          </label>
        </div>
      </GlassCard>

      <GlassCard className="p-6">
        <p className={compactFieldLabelClass}>{language === 'en' ? 'Portfolio shell' : '组合壳层'}</p>
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
            <select value={rebalancingCadence} onChange={(event) => setRebalancingCadence(event.target.value)} className={compactSelectClass}>
              <option value="monthly">{language === 'en' ? 'Monthly' : '每月'}</option>
              <option value="weekly">{language === 'en' ? 'Weekly' : '每周'}</option>
              <option value="quarterly">{language === 'en' ? 'Quarterly' : '每季度'}</option>
            </select>
          </label>
          <div className="rounded-[20px] border border-white/5 bg-black/20 p-4 text-sm leading-6 text-white/58">
            {language === 'en'
              ? 'Professional mode still executes through the current single-instrument deterministic engine. Portfolio shells stay here as structured placeholders instead of flooding the main board.'
              : '专业模式当前仍通过单标的 deterministic 引擎执行。组合壳层先收敛成结构化占位，不再把整页主区挤满。'}
          </div>
        </div>
      </GlassCard>
    </div>
  );

  const renderStrategyPane = () => (
    <div data-testid="pro-panel-strategy" className="flex min-w-0 flex-col gap-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <GlassCard className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className={compactFieldLabelClass}>{language === 'en' ? 'Current strategy' : '当前策略'}</p>
              <h3 className="mt-2 text-lg font-semibold text-white">{currentStrategyLabel}</h3>
              <p className="mt-2 text-sm leading-6 text-white/58">
                {language === 'en'
                  ? 'Keep only the active draft and parse status in the main workspace. Bulk template browsing moves into the drawer.'
                  : '主工作区只保留当前草稿和解析状态，海量模板全部移入右侧抽屉。'}
              </p>
            </div>
            <span className={`rounded-full border px-3 py-1 text-xs ${
              parsedStrategy && (parsedStrategy.executable || parsedStrategy.parsedStrategy.executable)
                ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100'
                : 'border-white/10 bg-white/[0.03] text-white/55'
            }`}
            >
              {currentStrategyState}
            </span>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              className="bg-white text-black hover:bg-white/90 hover:text-black"
              onClick={() => setIsCatalogDrawerOpen(true)}
              data-testid="pro-open-template-drawer"
            >
              <PanelRightOpen className="h-4 w-4" />
              {language === 'en' ? 'Import from template library...' : '从模板库导入...'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void onParse()}
            >
              <Sparkles className="h-4 w-4" />
              {language === 'en' ? 'Parse strategy' : '解析策略'}
            </Button>
          </div>
          {catalogToast ? (
            <p
              data-testid="pro-strategy-catalog-toast"
              role="status"
              aria-live="polite"
              className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-100"
            >
              {catalogToast}
            </p>
          ) : null}
          {parseError ? <ApiErrorAlert error={parseError} className="mt-4" /> : null}
          {runError ? <ApiErrorAlert error={runError} className="mt-4" /> : null}
        </GlassCard>

        <GlassCard className="p-6">
          <p className={compactFieldLabelClass}>{language === 'en' ? 'Control summary' : '控制摘要'}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[20px] border border-white/5 bg-black/20 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">{language === 'en' ? 'Parse' : '解析'}</p>
              <p className="mt-2 text-sm font-medium text-white">{parseStale ? (language === 'en' ? 'Needs refresh' : '需要刷新') : (language === 'en' ? 'In sync' : '已同步')}</p>
            </div>
            <div className="rounded-[20px] border border-white/5 bg-black/20 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">{language === 'en' ? 'Confirm' : '确认'}</p>
              <p className="mt-2 text-sm font-medium text-white">{confirmed ? (language === 'en' ? 'Locked in' : '已确认') : (language === 'en' ? 'Pending' : '待确认')}</p>
            </div>
            <div className="rounded-[20px] border border-white/5 bg-black/20 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">{language === 'en' ? 'History' : '历史'}</p>
              <p className="mt-2 text-sm font-medium text-white">{historyTotal}</p>
            </div>
          </div>
        </GlassCard>
      </div>

      <DeterministicBacktestFlow
        {...flowProps}
        code={code}
        onCodeChange={onCodeChange}
        startDate={startDate}
        onStartDateChange={onStartDateChange}
        endDate={endDate}
        onEndDateChange={onEndDateChange}
        initialCapital={initialCapital}
        onInitialCapitalChange={onInitialCapitalChange}
        lookbackBars={lookbackBars}
        onLookbackBarsChange={onLookbackBarsChange}
        feeBps={feeBps}
        onFeeBpsChange={onFeeBpsChange}
        slippageBps={slippageBps}
        onSlippageBpsChange={onSlippageBpsChange}
        benchmarkMode={benchmarkMode}
        onBenchmarkModeChange={onBenchmarkModeChange}
        benchmarkCode={benchmarkCode}
        onBenchmarkCodeChange={onBenchmarkCodeChange}
        parsedStrategy={parsedStrategy}
        confirmed={confirmed}
        parseStale={parseStale}
        isSubmitting={isSubmitting}
        parseError={parseError}
        runError={runError}
        strategyText={strategyText}
        onParse={onParse}
        onRun={onRun}
        onStrategyTextChange={onStrategyTextChange}
        historyTotal={historyTotal}
        currentStep={currentStep}
        onStepChange={onStepChange}
        panelMode="professional"
      />
    </div>
  );

  const renderOrdersPane = () => (
    <div data-testid="pro-panel-orders" className="grid gap-6 xl:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
      <GlassCard className="p-6">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`rounded-2xl border px-4 py-2 text-sm transition ${ordersTab === 'routing' ? 'border-white/12 bg-white/[0.08] text-white' : 'border-white/6 bg-white/[0.02] text-white/58'}`}
            onClick={() => setOrdersTab('routing')}
          >
            {language === 'en' ? 'Routing' : '执行路由'}
          </button>
          <button
            type="button"
            className={`rounded-2xl border px-4 py-2 text-sm transition ${ordersTab === 'guards' ? 'border-white/12 bg-white/[0.08] text-white' : 'border-white/6 bg-white/[0.02] text-white/58'}`}
            onClick={() => setOrdersTab('guards')}
          >
            {language === 'en' ? 'Risk guards' : '风险护栏'}
          </button>
        </div>

        {ordersTab === 'routing' ? (
          <div className="mt-5 grid gap-4">
            <Disclosure
              defaultOpen
              summary={<span className="inline-flex items-center gap-2 text-sm font-medium text-white"><ChevronRight className="h-4 w-4" />{language === 'en' ? 'Core routing toggles' : '核心路由开关'}</span>}
              bodyClassName="pt-4"
            >
              <div className="grid gap-3 text-sm text-white/72">
                <label className="inline-flex items-center gap-3">
                  <input type="checkbox" checked={eventDriven} onChange={(event) => setEventDriven(event.target.checked)} />
                  <span>{language === 'en' ? 'Enable event-driven execution lane' : '启用事件驱动执行通道'}</span>
                </label>
                <label className="inline-flex items-center gap-3">
                  <input type="checkbox" checked={enableStopLoss} onChange={(event) => setEnableStopLoss(event.target.checked)} />
                  <span>{language === 'en' ? 'Stop loss routing' : '止损路由'}</span>
                </label>
                <label className="inline-flex items-center gap-3">
                  <input type="checkbox" checked={enableTakeProfit} onChange={(event) => setEnableTakeProfit(event.target.checked)} />
                  <span>{language === 'en' ? 'Take profit routing' : '止盈路由'}</span>
                </label>
              </div>
            </Disclosure>

            <Disclosure
              summary={<span className="inline-flex items-center gap-2 text-sm font-medium text-white"><ChevronRight className="h-4 w-4" />{language === 'en' ? 'Advanced route overlays' : '高级路由扩展'}</span>}
              bodyClassName="pt-4"
            >
              <div className="grid gap-3 text-sm text-white/62">
                <label className="inline-flex items-center gap-3">
                  <input type="checkbox" checked={enableTrailingStop} onChange={(event) => setEnableTrailingStop(event.target.checked)} />
                  <span>{language === 'en' ? 'Trailing stop routing' : '追踪止损路由'}</span>
                </label>
                <p>{language === 'en' ? 'These toggles stay folded until the backend execution contract expands.' : '这些高级路由默认折叠，等待后端执行合同扩展后再下沉为真实参数。'}</p>
              </div>
            </Disclosure>
          </div>
        ) : (
          <div className="mt-5 grid gap-4">
            <Disclosure
              defaultOpen
              summary={<span className="inline-flex items-center gap-2 text-sm font-medium text-white"><ChevronRight className="h-4 w-4" />{language === 'en' ? 'Guard rail summary' : '护栏总览'}</span>}
              bodyClassName="pt-4"
            >
              <div className="rounded-[20px] border border-white/5 bg-black/20 p-4 text-sm leading-6 text-white/62">
                {language === 'en'
                  ? 'Risk controls are visible as concise switches here and remain fully auditable in the parsed strategy confirmation board.'
                  : '风控在这里先呈现为简洁开关，详细可审计信息仍由解析确认面板承接。'}
              </div>
            </Disclosure>
          </div>
        )}
      </GlassCard>

      <GlassCard className="p-6">
        <p className={compactFieldLabelClass}>{language === 'en' ? 'Why this is folded' : '为什么改成折叠'}</p>
        <p className="mt-4 text-sm leading-7 text-white/58">
          {language === 'en'
            ? 'The old page dumped every placeholder control into one uninterrupted stack. This board keeps only the current decision visible and hides second-order options until they are explicitly requested.'
            : '旧页面把所有占位参数无差别堆成一条长柱。现在这块只保留当前决策，把二级选项全部收进折叠层。'}
        </p>
      </GlassCard>
    </div>
  );

  const renderExecutionPane = () => (
    <div data-testid="pro-panel-execution" className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <GlassCard className="p-6">
        <p className={compactFieldLabelClass}>{language === 'en' ? 'Execution baseline' : '执行基线'}</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="product-field gap-1.5">
            <span className={compactFieldLabelClass}>{language === 'en' ? 'Lookback window' : '回看范围'}</span>
            <input type="number" min={10} max={5000} value={lookbackBars} onChange={(event) => onLookbackBarsChange(event.target.value)} className={compactInputClass} />
          </label>
          <label className="product-field gap-1.5">
            <span className={compactFieldLabelClass}>{language === 'en' ? 'Fees (bp)' : '手续费 (bp)'}</span>
            <input type="number" min={0} max={500} value={feeBps} onChange={(event) => onFeeBpsChange(event.target.value)} className={compactInputClass} />
          </label>
          <label className="product-field gap-1.5">
            <span className={compactFieldLabelClass}>{language === 'en' ? 'Slippage (bp)' : '滑点 (bp)'}</span>
            <input type="number" min={0} max={500} value={slippageBps} onChange={(event) => onSlippageBpsChange(event.target.value)} className={compactInputClass} />
          </label>
          <label className="product-field gap-1.5">
            <span className={compactFieldLabelClass}>{language === 'en' ? 'Benchmark override' : '基准覆盖'}</span>
            <input value={benchmarkCode} onChange={(event) => onBenchmarkCodeChange(event.target.value.toUpperCase())} placeholder={language === 'en' ? 'Optional custom code' : '可选自定义代码'} className={compactInputClass} />
          </label>
        </div>
      </GlassCard>

      <GlassCard className="p-6">
        <p className={compactFieldLabelClass}>{language === 'en' ? 'Execution lane note' : '执行通道说明'}</p>
        <div className="mt-4 rounded-[20px] border border-white/5 bg-black/20 p-4 text-sm leading-7 text-white/62">
          {language === 'en'
            ? 'This board controls the deterministic engine friction assumptions without forcing you to scroll past strategy catalogs, history, and optimization controls.'
            : '这块专门承接 deterministic 引擎的摩擦成本假设，不再要求你穿过模板目录、历史记录和优化参数才能改动它。'}
        </div>
      </GlassCard>
    </div>
  );

  const renderAnalyticsPane = () => (
    <div data-testid="pro-panel-analytics" className="grid gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
      <GlassCard className="p-6">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`rounded-2xl border px-4 py-2 text-sm transition ${analyticsTab === 'optimization' ? 'border-white/12 bg-white/[0.08] text-white' : 'border-white/6 bg-white/[0.02] text-white/58'}`}
            onClick={() => setAnalyticsTab('optimization')}
          >
            {language === 'en' ? 'Optimization' : '优化'}
          </button>
          <button
            type="button"
            className={`rounded-2xl border px-4 py-2 text-sm transition ${analyticsTab === 'robustness' ? 'border-white/12 bg-white/[0.08] text-white' : 'border-white/6 bg-white/[0.02] text-white/58'}`}
            onClick={() => setAnalyticsTab('robustness')}
          >
            {language === 'en' ? 'Robustness' : '稳健性'}
          </button>
        </div>

        {analyticsTab === 'optimization' ? (
          <div className="mt-5 grid gap-4">
            <Disclosure
              defaultOpen
              summary={<span className="inline-flex items-center gap-2 text-sm font-medium text-white"><ChevronRight className="h-4 w-4" />Grid Search</span>}
              bodyClassName="pt-4"
            >
              <label className="inline-flex items-center gap-3 text-sm text-white/72">
                <input type="checkbox" checked={enableGridSearch} onChange={(event) => setEnableGridSearch(event.target.checked)} />
                <span>{language === 'en' ? 'Enable compact optimization overlay' : '启用紧凑优化覆盖层'}</span>
              </label>
            </Disclosure>
            <Disclosure
              summary={<span className="inline-flex items-center gap-2 text-sm font-medium text-white"><ChevronRight className="h-4 w-4" />Bayesian Search</span>}
              bodyClassName="pt-4"
            >
              <label className="inline-flex items-center gap-3 text-sm text-white/72">
                <input type="checkbox" checked={enableBayesianSearch} onChange={(event) => setEnableBayesianSearch(event.target.checked)} />
                <span>{language === 'en' ? 'Keep Bayesian search parked until requested' : 'Bayesian Search 先停放在折叠层'}</span>
              </label>
            </Disclosure>
          </div>
        ) : (
          <div className="mt-5 grid gap-4">
            <Disclosure
              defaultOpen
              summary={<span className="inline-flex items-center gap-2 text-sm font-medium text-white"><ChevronRight className="h-4 w-4" />Walk-Forward</span>}
              bodyClassName="pt-4"
            >
              <label className="inline-flex items-center gap-3 text-sm text-white/72">
                <input type="checkbox" checked={enableWalkForward} onChange={(event) => setEnableWalkForward(event.target.checked)} />
                <span>{language === 'en' ? 'Enable walk-forward validation rail' : '启用 Walk-Forward 验证通道'}</span>
              </label>
            </Disclosure>
            <Disclosure
              summary={<span className="inline-flex items-center gap-2 text-sm font-medium text-white"><ChevronRight className="h-4 w-4" />Monte Carlo</span>}
              bodyClassName="pt-4"
            >
              <label className="inline-flex items-center gap-3 text-sm text-white/72">
                <input type="checkbox" checked={enableMonteCarlo} onChange={(event) => setEnableMonteCarlo(event.target.checked)} />
                <span>{language === 'en' ? 'Keep Monte Carlo hidden by default' : 'Monte Carlo 默认折叠隐藏'}</span>
              </label>
            </Disclosure>
          </div>
        )}
      </GlassCard>

      <GlassCard className="p-6">
        <p className={compactFieldLabelClass}>{language === 'en' ? 'Control posture' : '控制策略'}</p>
        <p className="mt-4 text-sm leading-7 text-white/58">
          {language === 'en'
            ? 'Optimization and robustness controls no longer hijack the whole page height. They stay contained to one board and expose only the currently relevant tier.'
            : '优化与稳健性参数不再劫持整页高度。它们被收束到一块面板里，并且只暴露当前相关层级。'}
        </p>
      </GlassCard>
    </div>
  );

  const renderActivePane = () => {
    switch (activePane) {
      case 'assets':
        return renderAssetsPane();
      case 'orders':
        return renderOrdersPane();
      case 'execution':
        return renderExecutionPane();
      case 'analytics':
        return renderAnalyticsPane();
      case 'strategy':
      default:
        return renderStrategyPane();
    }
  };

  return (
    <>
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
            <GlassCard className="p-5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                {language === 'en' ? 'Professional lane' : '专业模式'}
              </p>
              <div className="mt-4 flex flex-col gap-2 rounded-[20px] border border-white/5 bg-black/20 p-3">
                {navItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-testid={item.testId}
                    onClick={() => jumpToPane(item)}
                    className={`min-w-0 rounded-2xl border px-4 py-3 text-left transition ${
                      activePane === item.id
                        ? 'border-indigo-400/40 bg-indigo-500/10 text-white'
                        : 'border-white/5 bg-white/[0.02] text-white/72 hover:border-white/12 hover:bg-white/[0.05]'
                    }`}
                  >
                    <span className="block truncate text-sm font-medium">{item.label}</span>
                  </button>
                ))}
              </div>
            </GlassCard>
          </aside>

          <div className="flex min-w-0 flex-col gap-6 xl:col-span-4">
            <div
              data-testid="pro-backtest-compile-bar"
              className="flex min-w-0 flex-col gap-4 rounded-[24px] border border-white/5 bg-white/[0.02] px-6 py-5 backdrop-blur-sm xl:flex-row xl:items-center xl:justify-between"
            >
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                  {activePaneMeta.eyebrow}
                </p>
                <p className="mt-2 text-sm text-white/60">
                  {activePaneMeta.title}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/48">
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">{language === 'en' ? 'Parse' : '解析'} · {parseStale ? (language === 'en' ? 'Refresh needed' : '需要刷新') : (language === 'en' ? 'In sync' : '已同步')}</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">{language === 'en' ? 'History' : '历史'} · {historyTotal}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setActivePane('strategy');
                    void onParse();
                  }}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  {language === 'en' ? 'Compile strategy' : '编译策略'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setActivePane('orders')}
                >
                  <ShieldCheck className="h-4 w-4" />
                  {language === 'en' ? 'Review guards' : '查看风控'}
                </Button>
                <Button
                  type="button"
                  className="bg-white text-black hover:bg-white/90 hover:text-black"
                  onClick={() => void handleCompileAndRun()}
                  disabled={isSubmitting}
                >
                  <Play className="h-4 w-4" />
                  {language === 'en' ? 'Execute backtest task' : '执行回测任务'}
                </Button>
              </div>
            </div>

            {renderActivePane()}
          </div>
        </div>
      </section>

      <Drawer
        isOpen={isCatalogDrawerOpen}
        onClose={() => setIsCatalogDrawerOpen(false)}
        title={language === 'en' ? 'Template library' : '模板库'}
        width="w-full max-w-[40rem]"
      >
        <div data-testid="pro-strategy-catalog-drawer" className="flex min-h-0 flex-col gap-6">
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-white">{language === 'en' ? 'Built-in template catalog' : '内置模板目录'}</h3>
            <p className="text-sm leading-6 text-white/58">
              {language === 'en'
                ? 'Browse one category at a time, then inject a template back into the strategy editor.'
                : '一次只浏览一个类别，确认后再把模板注入回策略编辑器。'}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {strategyCatalogGroups.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => setCatalogGroupId(group.id)}
                className={`rounded-2xl border px-4 py-2 text-sm transition ${
                  activeCatalogGroup?.id === group.id
                    ? 'border-white/12 bg-white/[0.08] text-white'
                    : 'border-white/6 bg-white/[0.02] text-white/58'
                }`}
              >
                {group.title[language]}
              </button>
            ))}
          </div>

          {activeCatalogGroup ? (
            <div data-testid="pro-strategy-catalog" className="flex flex-col gap-4">
              <div>
                <h4 className="text-base font-semibold text-white">{activeCatalogGroup.title[language]}</h4>
                <p className="mt-1 text-sm text-white/52">{activeCatalogGroup.description[language]}</p>
              </div>
              <div className="grid gap-4">
                {activeCatalogGroup.templates.map((template) => (
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
          ) : null}
        </div>
      </Drawer>
    </>
  );
};

export default ProBacktestWorkspace;
