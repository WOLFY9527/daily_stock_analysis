import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Bot, BriefcaseBusiness, FlaskConical, PanelRightOpen, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Drawer } from '../components/common';
import {
  BentoCard,
  BentoGrid,
  CARD_BUTTON_CLASS,
  CARD_KICKER_CLASS,
  DecisionCard,
  FundamentalsCard,
  StrategyCard,
  TechCard,
  type SignalTone,
  getToneBorderClass,
  getToneTextClass,
  getToneTextStyle,
} from '../components/home-bento';
import { useI18n } from '../contexts/UiLanguageContext';
import { buildLocalizedPath } from '../utils/localeRouting';

type DrawerMetric = {
  label: string;
  value: string;
  tone?: SignalTone;
};

type DrawerPayload = {
  title: string;
  summary: string;
  metrics: DrawerMetric[];
  bullets: string[];
  footnote: string;
};

type DashboardLocale = 'zh' | 'en';

const CONTENT: Record<DashboardLocale, {
  documentTitle: string;
  eyebrow: string;
  heading: string;
  description: string;
  instrument: string;
  ticker: string;
  sessionBadge: string;
  regimeBadge: string;
  topActions: {
    scanner: string;
    portfolio: string;
    backtest: string;
  };
  decision: {
    eyebrow: string;
    company: string;
    heroValue: string;
    heroUnit: string;
    heroLabel: string;
    signalLabel: string;
    signalTone: SignalTone;
    scoreLabel: string;
    scoreValue: string;
    badge: string;
    chartLabel: string;
    summary: string;
    detailLabel: string;
  };
  strategy: {
    title: string;
    subtitle: string;
    metrics: Array<{ label: string; value: string; tone?: SignalTone }>;
    positionLabel: string;
    positionBody: string;
    detailLabel: string;
  };
  tech: {
    title: string;
    signals: Array<{ label: string; value: string; tone: SignalTone }>;
    detailLabel: string;
  };
  fundamentals: {
    title: string;
    metrics: Array<{ label: string; value: string; tone?: SignalTone }>;
    detailLabel: string;
  };
  workflow: {
    eyebrow: string;
    title: string;
    body: string;
    actions: Array<{ label: string; description: string; path: string }>;
    statusEyebrow: string;
    statusBody: string;
    detailLabel: string;
  };
  drawers: {
    decision: DrawerPayload;
    strategy: DrawerPayload;
    tech: DrawerPayload;
    fundamentals: DrawerPayload;
    workflow: DrawerPayload;
  };
}> = {
  zh: {
    documentTitle: '首页 - WolfyStock',
    eyebrow: 'SYSTEM VIEW',
    heading: 'WolfyStock 决策面板',
    description: '把今日信号、执行区间、结构判断与后续流程压进一个高密度首页，先看结论，再决定下一步。',
    instrument: '英伟达',
    ticker: 'NVDA',
    sessionBadge: '美股 AI 基础设施',
    regimeBadge: '动量回升',
    topActions: {
      scanner: '扫描器',
      portfolio: '持仓',
      backtest: '回测',
    },
    decision: {
      eyebrow: 'WOLFY AI 决断',
      company: '英伟达',
      heroValue: '8.6',
      heroUnit: '/10',
      heroLabel: '置信度',
      signalLabel: '看多',
      signalTone: 'bullish',
      scoreLabel: '信号方向',
      scoreValue: '72H 继续偏强',
      badge: '动能回升 · 机构跟进',
      chartLabel: '突破准备完成',
      summary: '订单动能回升，价格重新贴近强趋势区间，适合用回踩确认来组织仓位。',
      detailLabel: '查看完整判断',
    },
    strategy: {
      title: '执行策略',
      subtitle: '先给出区间，再决定节奏。',
      metrics: [
        { label: '建仓区间', value: '118.40 - 121.00', tone: 'neutral' },
        { label: '目标位', value: '136.00', tone: 'bullish' },
        { label: '止损位', value: '111.80', tone: 'bearish' },
      ],
      positionLabel: '仓位节奏',
      positionBody: '首笔仓位控制在 6% 左右，确认站稳后再扩到 15%。若放量跌破关键支撑，优先执行收缩仓位。',
      detailLabel: '查看策略细节',
    },
    tech: {
      title: '技术形态',
      signals: [
        { label: 'MACD', value: '零轴上方金叉', tone: 'bullish' },
        { label: '均线结构', value: 'MA20 / MA60 扩张', tone: 'bullish' },
        { label: '量价配合', value: '回踩缩量，突破放量', tone: 'bullish' },
      ],
      detailLabel: '查看结构细节',
    },
    fundamentals: {
      title: '基本面',
      metrics: [
        { label: '收入增速', value: '+18.2%', tone: 'bullish' },
        { label: '自由现金流', value: '$16.4B', tone: 'bullish' },
        { label: '毛利率', value: '74.1%', tone: 'neutral' },
        { label: 'ROE', value: '31.8%', tone: 'bullish' },
      ],
      detailLabel: '查看基本面细节',
    },
    workflow: {
      eyebrow: 'FLOW AUTOMATION',
      title: '下一步流程',
      body: '把候选扫描、组合校验与策略回测放进同一条执行链，先筛选，再对照仓位，最后验证假设。',
      actions: [
        { label: '扫描器', description: '补一轮候选池', path: '/scanner' },
        { label: '持仓', description: '检查相关敞口', path: '/portfolio' },
        { label: '回测', description: '验证执行条件', path: '/backtest' },
      ],
      statusEyebrow: '当前节奏',
      statusBody: '候选筛选已优先级排序，下一步适合先做相关性检查，再决定是否进入回测。',
      detailLabel: '查看流程摘要',
    },
    drawers: {
      decision: {
        title: 'AI 决断细节',
        summary: '当前卡片只用占位数据表达首页节奏，但结构已经准备好承接后续真实信号、分数和图表。',
        metrics: [
          { label: '方向', value: '看多', tone: 'bullish' },
          { label: '置信度', value: '8.6 / 10', tone: 'neutral' },
          { label: '时间窗', value: '未来 72 小时', tone: 'neutral' },
          { label: '主线', value: 'AI 订单 + 结构回稳', tone: 'bullish' },
        ],
        bullets: [
          '优先保留结论、分数、方向和一句话理由，避免首页被长文挤满。',
          '图表区域先用占位 SVG 建立视觉层级，后续可直接换成真实序列数据。',
          '细节抽屉承接扩展信息，桌面与移动端都不需要把所有上下文铺在首页。',
        ],
        footnote: '当前为前端占位版本，未接入实时研究结果。',
      },
      strategy: {
        title: '执行策略细节',
        summary: '首页策略卡只保留入场、目标、止损和仓位节奏，抽屉再展开执行顺序与风控说明。',
        metrics: [
          { label: '初始仓位', value: '6%', tone: 'neutral' },
          { label: '上限仓位', value: '15%', tone: 'bullish' },
          { label: '失败条件', value: '跌破 111.80', tone: 'bearish' },
          { label: '复核时间', value: '下一个交易日开盘前', tone: 'neutral' },
        ],
        bullets: [
          '先用回踩确认来换取更好的盈亏比，避免追涨式入场。',
          '突破放量后才考虑第二笔加仓，缩量反弹则继续观察。',
          '一旦结构失效，优先执行减仓，不在首页里叠加更多例外规则。',
        ],
        footnote: '该抽屉仍使用占位策略值，后续再绑定真实报告输出。',
      },
      tech: {
        title: '技术结构细节',
        summary: '技术卡聚焦结构是否配合当前方向，不把全部指标平铺到首页。',
        metrics: [
          { label: 'MACD', value: '金叉', tone: 'bullish' },
          { label: 'MA20', value: '向上拐头', tone: 'bullish' },
          { label: '量能', value: '突破前回落', tone: 'neutral' },
          { label: '风险', value: '压力位尚未确认消化', tone: 'bearish' },
        ],
        bullets: [
          '首页保持三条最强信号，抽屉负责补足支撑/压力、均线斜率与量价配合。',
          '技术信息用高对比、短句、可扫描的行列表达，不回到传统表格堆叠。',
          '后续接入真实数据时，只要替换数组内容即可保留现有视觉结构。',
        ],
        footnote: '当前技术项与说明均为静态占位数据。',
      },
      fundamentals: {
        title: '基本面细节',
        summary: '基本面卡只展示四个高价值指标，抽屉用于说明为什么这些指标值得保留在首页。',
        metrics: [
          { label: '收入增速', value: '+18.2%', tone: 'bullish' },
          { label: '现金流', value: '$16.4B', tone: 'bullish' },
          { label: '毛利率', value: '74.1%', tone: 'neutral' },
          { label: 'ROE', value: '31.8%', tone: 'bullish' },
        ],
        bullets: [
          '保留能直接影响执行信心的指标，避免把整张财报摘要搬进首页。',
          '数值与标签均采用占位数据，后续可替换为标准化后的真实字段。',
          '抽屉给出筛选逻辑和补充说明，主页仍保持快速浏览节奏。',
        ],
        footnote: '当前数值仅用于前端布局与视觉校验。',
      },
      workflow: {
        title: '流程摘要',
        summary: '工作流卡把首页从“看完就走”变成“看完就能继续动作”，但先只接真实路由，不接自动执行。',
        metrics: [
          { label: '候选扫描', value: '下一轮待执行', tone: 'neutral' },
          { label: '组合检查', value: '需复核相关性', tone: 'neutral' },
          { label: '策略回测', value: '建议二次验证', tone: 'bullish' },
          { label: '自动化状态', value: '占位流程', tone: 'neutral' },
        ],
        bullets: [
          '首页保留进入扫描器、持仓、回测的快速入口，缩短从判断到行动的路径。',
          '流程说明先放在抽屉里，避免首页出现大段方法论文本。',
          '这一步只调整前端导航节奏，不触碰后端接口和既有路由契约。',
        ],
        footnote: '自动执行逻辑未接入，本次仅提供路由级流程入口。',
      },
    },
  },
  en: {
    documentTitle: 'Home - WolfyStock',
    eyebrow: 'SYSTEM VIEW',
    heading: 'WolfyStock Command Center',
    description: 'Compress the session signal, execution range, structural view, and follow-up flow into one dense homepage so the next action is obvious.',
    instrument: 'NVIDIA',
    ticker: 'NVDA',
    sessionBadge: 'US AI infrastructure',
    regimeBadge: 'Momentum rebuilding',
    topActions: {
      scanner: 'Scanner',
      portfolio: 'Portfolio',
      backtest: 'Backtest',
    },
    decision: {
      eyebrow: 'WOLFY AI DECISION',
      company: 'NVIDIA',
      heroValue: '8.6',
      heroUnit: '/10',
      heroLabel: 'Conviction',
      signalLabel: 'Bullish',
      signalTone: 'bullish',
      scoreLabel: 'Signal Direction',
      scoreValue: 'Bias stays constructive for 72H',
      badge: 'Momentum rebuild · institutional follow-through',
      chartLabel: 'Breakout setup intact',
      summary: 'Order momentum is improving and price is moving back into a strong-trend zone, so the cleaner plan is still a pullback confirmation entry.',
      detailLabel: 'Open Decision Brief',
    },
    strategy: {
      title: 'Execution Strategy',
      subtitle: 'Lock the range first, then decide the pace.',
      metrics: [
        { label: 'Entry Zone', value: '118.40 - 121.00', tone: 'neutral' },
        { label: 'Target', value: '136.00', tone: 'bullish' },
        { label: 'Stop', value: '111.80', tone: 'bearish' },
      ],
      positionLabel: 'Position Rhythm',
      positionBody: 'Keep the first clip around 6%, then expand toward 15% only after the reclaim holds. If support breaks on volume, shrink risk first.',
      detailLabel: 'Open Strategy Brief',
    },
    tech: {
      title: 'Technical Structure',
      signals: [
        { label: 'MACD', value: 'Bullish crossover above zero', tone: 'bullish' },
        { label: 'Moving Averages', value: 'MA20 / MA60 expansion', tone: 'bullish' },
        { label: 'Volume Profile', value: 'Quiet pullback, active breakout', tone: 'bullish' },
      ],
      detailLabel: 'Open Technical Brief',
    },
    fundamentals: {
      title: 'Fundamentals',
      metrics: [
        { label: 'Revenue Growth', value: '+18.2%', tone: 'bullish' },
        { label: 'Free Cash Flow', value: '$16.4B', tone: 'bullish' },
        { label: 'Gross Margin', value: '74.1%', tone: 'neutral' },
        { label: 'ROE', value: '31.8%', tone: 'bullish' },
      ],
      detailLabel: 'Open Fundamental Brief',
    },
    workflow: {
      eyebrow: 'FLOW AUTOMATION',
      title: 'Next Workflow',
      body: 'Keep scanning, portfolio review, and strategy validation in one chain: shortlist candidates, check exposure, then validate the setup.',
      actions: [
        { label: 'Scanner', description: 'Refresh the candidate queue', path: '/scanner' },
        { label: 'Portfolio', description: 'Check correlated exposure', path: '/portfolio' },
        { label: 'Backtest', description: 'Validate the trigger set', path: '/backtest' },
      ],
      statusEyebrow: 'Current Rhythm',
      statusBody: 'The candidate queue is already prioritized. The clean next move is to review overlap before running a validation pass.',
      detailLabel: 'Open Flow Brief',
    },
    drawers: {
      decision: {
        title: 'AI Decision Brief',
        summary: 'This card is still powered by placeholder data, but the shell is already shaped for real signals, scores, and chart inputs later.',
        metrics: [
          { label: 'Direction', value: 'Bullish', tone: 'bullish' },
          { label: 'Conviction', value: '8.6 / 10', tone: 'neutral' },
          { label: 'Horizon', value: 'Next 72 hours', tone: 'neutral' },
          { label: 'Primary Thread', value: 'AI orders + structure repair', tone: 'bullish' },
        ],
        bullets: [
          'The homepage keeps only the verdict, score, direction, and one-sentence rationale.',
          'The chart zone is a placeholder SVG today, but the layout is ready for a real series later.',
          'The drawer absorbs the deeper context so the homepage stays scannable on desktop and mobile.',
        ],
        footnote: 'This is a frontend-only placeholder layer for now.',
      },
      strategy: {
        title: 'Execution strategy brief',
        summary: 'The strategy card keeps entry, target, stop, and position rhythm on the homepage, then expands the sequencing and risk notes here.',
        metrics: [
          { label: 'Initial Size', value: '6%', tone: 'neutral' },
          { label: 'Max Size', value: '15%', tone: 'bullish' },
          { label: 'Failure Condition', value: 'Break below 111.80', tone: 'bearish' },
          { label: 'Review Window', value: 'Before next session open', tone: 'neutral' },
        ],
        bullets: [
          'Use a pullback confirmation to improve the payoff instead of chasing the move.',
          'Only consider the second add after the breakout confirms on volume.',
          'If structure breaks, reduce exposure first instead of stacking exception logic on the homepage.',
        ],
        footnote: 'All values remain static placeholders in this pass.',
      },
      tech: {
        title: 'Technical structure brief',
        summary: 'The technical card focuses on whether structure agrees with the bias instead of flattening every indicator into the homepage.',
        metrics: [
          { label: 'MACD', value: 'Bullish crossover', tone: 'bullish' },
          { label: 'MA20', value: 'Turning higher', tone: 'bullish' },
          { label: 'Volume', value: 'Quiet into the setup', tone: 'neutral' },
          { label: 'Risk', value: 'Overhead supply still needs clearance', tone: 'bearish' },
        ],
        bullets: [
          'The homepage keeps only the strongest three signals while the drawer adds the structural context.',
          'Short, high-contrast rows are easier to scan than a dense indicator table.',
          'Once real data lands, the existing visual shell stays intact and only the arrays change.',
        ],
        footnote: 'All signals and notes are static placeholders.',
      },
      fundamentals: {
        title: 'Fundamental brief',
        summary: 'The fundamentals card keeps four high-value metrics visible and uses the drawer to explain why they belong in the homepage layer.',
        metrics: [
          { label: 'Revenue Growth', value: '+18.2%', tone: 'bullish' },
          { label: 'Cash Flow', value: '$16.4B', tone: 'bullish' },
          { label: 'Gross Margin', value: '74.1%', tone: 'neutral' },
          { label: 'ROE', value: '31.8%', tone: 'bullish' },
        ],
        bullets: [
          'Keep only metrics that change execution confidence directly.',
          'All labels and values are placeholders for now but already mapped to a stable layout.',
          'The drawer carries the explanatory burden so the homepage remains fast to read.',
        ],
        footnote: 'Metric values are placeholders used for layout and visual QA.',
      },
      workflow: {
        title: 'Workflow brief',
        summary: 'The workflow card turns the homepage into an action hub, but this pass still links only to existing routes and does not trigger automation.',
        metrics: [
          { label: 'Candidate Scan', value: 'Queued next', tone: 'neutral' },
          { label: 'Portfolio Check', value: 'Exposure review needed', tone: 'neutral' },
          { label: 'Backtest', value: 'Suggested validation', tone: 'bullish' },
          { label: 'Automation State', value: 'Placeholder flow', tone: 'neutral' },
        ],
        bullets: [
          'The homepage keeps direct links into Scanner, Portfolio, and Backtest to shorten the path from decision to action.',
          'The process explanation lives in the drawer so the homepage avoids feature-description copy.',
          'This is a frontend-only workflow layer and leaves backend contracts untouched.',
        ],
        footnote: 'No automation logic is wired yet; the flow is route-level only.',
      },
    },
  },
};

const ACTION_ICONS = [Search, BriefcaseBusiness, FlaskConical] as const;

const HomeBentoDashboardPage: React.FC = () => {
  const { language } = useI18n();
  const locale: DashboardLocale = language === 'en' ? 'en' : 'zh';
  const copy = CONTENT[locale];
  const [activeDrawer, setActiveDrawer] = useState<DrawerPayload | null>(null);

  useEffect(() => {
    document.title = copy.documentTitle;
  }, [copy.documentTitle]);

  const workflowActions = useMemo(
    () => copy.workflow.actions.map((action, index) => ({
      ...action,
      icon: ACTION_ICONS[index],
      to: buildLocalizedPath(action.path, language),
    })),
    [copy.workflow.actions, language],
  );

  const topActions = useMemo(
    () => ([
      { label: copy.topActions.scanner, to: buildLocalizedPath('/scanner', language) },
      { label: copy.topActions.portfolio, to: buildLocalizedPath('/portfolio', language) },
      { label: copy.topActions.backtest, to: buildLocalizedPath('/backtest', language) },
    ]),
    [copy.topActions, language],
  );

  return (
    <div data-testid="home-bento-dashboard" className="space-y-5">
      <section className="relative overflow-hidden rounded-[40px] border border-white/[0.06] bg-[#030303] p-4 sm:p-6">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-[-5rem] top-[-4rem] h-56 w-56 rounded-full bg-white/[0.05] blur-[96px]"
        />
        <div className="relative z-10 flex flex-col gap-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <p className={CARD_KICKER_CLASS}>{copy.eyebrow}</p>
              <h1 className="mt-3 text-[2rem] font-semibold tracking-tight text-white sm:text-[2.4rem]">
                {copy.heading}
              </h1>
              <p className="mt-3 text-sm leading-6 text-white/62">{copy.description}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {topActions.map((action) => (
                <Link
                  key={action.label}
                  to={action.to}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/78 transition-colors duration-150 hover:border-white/18 hover:bg-white/[0.08] hover:text-white"
                >
                  <span>{action.label}</span>
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-full border border-white/[0.08] bg-white/[0.05] px-4 py-2 text-sm text-white/86">
              <span className="font-medium text-white">{copy.instrument}</span>
              <span className="ml-2 font-mono text-white/40">{copy.ticker}</span>
            </div>
            <div className={`rounded-full border px-4 py-2 text-sm ${getToneBorderClass('bullish')}`}>
              {copy.sessionBadge}
            </div>
            <div className={`rounded-full border px-4 py-2 text-sm ${getToneBorderClass('neutral')}`}>
              {copy.regimeBadge}
            </div>
          </div>

          <BentoGrid testId="home-bento-grid">
            <DecisionCard
              eyebrow={copy.decision.eyebrow}
              company={copy.decision.company}
              ticker={copy.ticker}
              heroValue={copy.decision.heroValue}
              heroUnit={copy.decision.heroUnit}
              heroLabel={copy.decision.heroLabel}
              signalLabel={copy.decision.signalLabel}
              signalTone={copy.decision.signalTone}
              scoreLabel={copy.decision.scoreLabel}
              scoreValue={copy.decision.scoreValue}
              badge={copy.decision.badge}
              chartLabel={copy.decision.chartLabel}
              summary={copy.decision.summary}
              detailLabel={copy.decision.detailLabel}
              onOpenDetails={() => setActiveDrawer(copy.drawers.decision)}
            />

            <StrategyCard
              title={copy.strategy.title}
              subtitle={copy.strategy.subtitle}
              metrics={copy.strategy.metrics}
              positionLabel={copy.strategy.positionLabel}
              positionBody={copy.strategy.positionBody}
              detailLabel={copy.strategy.detailLabel}
              onOpenDetails={() => setActiveDrawer(copy.drawers.strategy)}
            />

            <TechCard
              title={copy.tech.title}
              signals={copy.tech.signals}
              detailLabel={copy.tech.detailLabel}
              onOpenDetails={() => setActiveDrawer(copy.drawers.tech)}
            />

            <FundamentalsCard
              title={copy.fundamentals.title}
              metrics={copy.fundamentals.metrics}
              detailLabel={copy.fundamentals.detailLabel}
              onOpenDetails={() => setActiveDrawer(copy.drawers.fundamentals)}
            />

            <BentoCard
              eyebrow={copy.workflow.eyebrow}
              title={copy.workflow.title}
              subtitle={copy.workflow.body}
              className="xl:col-span-5"
              testId="home-bento-card-workflow"
              action={(
                <button type="button" className={CARD_BUTTON_CLASS} onClick={() => setActiveDrawer(copy.drawers.workflow)}>
                  <PanelRightOpen className="h-4 w-4" />
                  <span>{copy.workflow.detailLabel}</span>
                </button>
              )}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                {workflowActions.map((action) => {
                  const Icon = action.icon;
                  return (
                    <Link
                      key={action.label}
                      to={action.to}
                      className="rounded-[24px] border border-white/[0.08] bg-black/28 px-4 py-4 transition-colors duration-150 hover:border-white/16 hover:bg-black/40"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/82">
                          <Icon className="h-4 w-4" />
                        </div>
                        <ArrowUpRight className="h-4 w-4 text-white/46" />
                      </div>
                      <p className="mt-4 text-sm font-semibold text-white">{action.label}</p>
                      <p className="mt-2 text-sm leading-6 text-white/58">{action.description}</p>
                    </Link>
                  );
                })}
              </div>

              <div className="mt-4 rounded-[24px] border border-white/[0.08] bg-black/28 px-4 py-4">
                <p className={CARD_KICKER_CLASS}>{copy.workflow.statusEyebrow}</p>
                <div className="mt-3 flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/78">
                    <Bot className="h-4 w-4" />
                  </div>
                  <p className="text-sm leading-6 text-white/64">{copy.workflow.statusBody}</p>
                </div>
              </div>
            </BentoCard>
          </BentoGrid>
        </div>
      </section>

      <Drawer
        isOpen={Boolean(activeDrawer)}
        onClose={() => setActiveDrawer(null)}
        title={activeDrawer?.title}
        width="max-w-3xl"
      >
        {activeDrawer ? (
          <div data-testid="home-bento-drawer" className="rounded-[32px] border border-white/[0.08] bg-[#050505] p-5 text-white sm:p-6">
            <p className="text-sm leading-6 text-white/68">{activeDrawer.summary}</p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {activeDrawer.metrics.map((metric) => (
                <div key={metric.label} className="rounded-[24px] border border-white/[0.08] bg-black/28 px-4 py-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">{metric.label}</p>
                  <p
                    className={`mt-3 text-lg font-semibold ${getToneTextClass(metric.tone || 'neutral')}`}
                    style={getToneTextStyle(metric.tone || 'neutral')}
                  >
                    {metric.value}
                  </p>
                </div>
              ))}
            </div>

            <ul className="mt-5 space-y-3">
              {activeDrawer.bullets.map((bullet) => (
                <li key={bullet} className="flex gap-3 text-sm leading-6 text-white/64">
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-white/32" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>

            <p className="mt-5 text-xs uppercase tracking-[0.18em] text-white/36">{activeDrawer.footnote}</p>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
};

export default HomeBentoDashboardPage;

