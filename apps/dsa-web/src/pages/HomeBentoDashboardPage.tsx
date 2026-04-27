import type React from 'react';
import { useEffect, useState } from 'react';
import {
  BENTO_SURFACE_ROOT_CLASS,
  BentoGrid,
  DecisionCard,
  DeepReportDrawer,
  FundamentalsCard,
  StrategyCard,
  TechCard,
  type SignalTone,
} from '../components/home-bento';
import { useI18n } from '../contexts/UiLanguageContext';

type DrawerMetric = {
  label: string;
  value: string;
  tone?: SignalTone;
  glow?: boolean;
};

type DrawerModule = {
  id: string;
  eyebrow: string;
  title: string;
  summary?: string;
  metrics: DrawerMetric[];
  footnote?: string;
};

type DrawerPayload = {
  title: string;
  modules: DrawerModule[];
};

type DecisionChartPoint = {
  label: string;
  value: number;
};

type DashboardLocale = 'zh' | 'en';

const DECISION_CHART_POINTS: DecisionChartPoint[] = [
  { label: '09:30', value: 116.2 },
  { label: '10:00', value: 117.4 },
  { label: '10:30', value: 116.8 },
  { label: '11:00', value: 117.9 },
  { label: '11:30', value: 116.5 },
  { label: '12:00', value: 117.2 },
  { label: '12:30', value: 116.1 },
  { label: '13:00', value: 117.6 },
  { label: '13:30', value: 118.1 },
  { label: '14:00', value: 120.4 },
  { label: '14:30', value: 123.1 },
  { label: '15:00', value: 125.0 },
];

const CONTENT: Record<DashboardLocale, {
  documentTitle: string;
  eyebrow: string;
  heading: string;
  description: string;
  omnibarPlaceholder: string;
  analyzeButton: string;
  instrument: string;
  ticker: string;
  sessionBadge: string;
  regimeBadge: string;
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
    reasonTitle: string;
    reasonBody: string;
    detailLabel: string;
  };
  strategy: {
    title: string;
    subtitle?: string;
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
  drawers: {
    decision: DrawerPayload;
    strategy: DrawerPayload;
    tech: DrawerPayload;
    fundamentals: DrawerPayload;
  };
}> = {
  zh: {
    documentTitle: '首页 - WolfyStock',
    eyebrow: 'SYSTEM VIEW',
    heading: 'WolfyStock 决策面板',
    description: '',
    omnibarPlaceholder: '输入股票代码或公司名称，唤醒 AI 深度分析...',
    analyzeButton: '分析',
    instrument: '英伟达',
    ticker: 'NVDA',
    sessionBadge: '美股 AI 基础设施',
    regimeBadge: '动量回升',
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
      chartLabel: '突破完成',
      summary: '订单动能回升，价格重新贴近强趋势区间，适合用回踩确认来组织仓位。',
      reasonTitle: 'AI 突破归因',
      reasonBody: '盘中监测到大级别资金吸筹，价格成功站稳 MA60 关键支撑位，并伴随 MACD 零轴上方金叉，确认箱体突破有效。',
      detailLabel: '查看完整判断',
    },
    strategy: {
      title: '执行策略',
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
        { label: 'RSI', value: '65.4', tone: 'neutral' },
        { label: '波动率', value: '2.4%', tone: 'neutral' },
      ],
      detailLabel: '查看结构细节',
    },
    fundamentals: {
      title: '基本面画像',
      metrics: [
        { label: '收入增速', value: '+18.2%', tone: 'bullish' },
        { label: '自由现金流', value: '$16.4B', tone: 'bullish' },
        { label: '毛利率', value: '74.1%', tone: 'neutral' },
        { label: 'ROE', value: '31.8%', tone: 'bullish' },
        { label: '市盈率 (PE)', value: '74.5', tone: 'neutral' },
        { label: '机构持仓', value: '68.2%', tone: 'neutral' },
      ],
      detailLabel: '查看基本面细节',
    },
    drawers: {
      decision: {
        title: '深度报告',
        modules: [
          {
            id: 'technical',
            eyebrow: '技术形态',
            title: '技术形态深看',
            summary: '只保留能解释当前偏向的核心信号，用更大的留白承接后续真实图表。',
            metrics: [
              { label: 'MACD', value: '零轴上方金叉延续', tone: 'bullish', glow: true },
              { label: 'MA20 / MA60', value: '双均线继续扩张上行', tone: 'bullish' },
              { label: '主力资金', value: '近三日净流入持续放大', tone: 'bullish' },
            ],
            footnote: '技术模块当前仍是前端占位数据。',
          },
          {
            id: 'fundamental',
            eyebrow: '基本面画像',
            title: '基本面画像深看',
            summary: '这里先用描述卡占位，后续接入更深层的盈利质量、订单结构和资本效率。',
            metrics: [
              { label: '业务描述', value: 'AI 基础设施主线仍是最强盈利锚点。', tone: 'neutral' },
              { label: '现金流画像', value: '自由现金流充足，允许估值波动期保持耐心。', tone: 'neutral' },
              { label: '质量占位', value: '后续补充订单、毛利率与资本效率深层信号。', tone: 'neutral' },
            ],
            footnote: '基本面深层字段将在后续数据接入阶段替换。',
          },
        ],
      },
      strategy: {
        title: '执行策略细节',
        modules: [
          {
            id: 'technical',
            eyebrow: '技术形态',
            title: '执行前结构确认',
            summary: '策略仍然依赖技术确认来控制节奏。',
            metrics: [
              { label: 'MACD', value: '零轴上方金叉延续', tone: 'bullish', glow: true },
              { label: 'MA20 / MA60', value: '趋势未破坏前继续顺势', tone: 'bullish' },
              { label: '主力资金', value: '资金没有出现明显背离', tone: 'bullish' },
            ],
          },
          {
            id: 'fundamental',
            eyebrow: '基本面画像',
            title: '执行耐心的基本面锚',
            summary: '基本面模块只用来解释为何值得等待更好的入场质量。',
            metrics: [
              { label: '盈利质量', value: '增长质量仍支持中期偏强预期', tone: 'neutral' },
              { label: '现金流', value: '现金流强度为回撤期提供安全垫', tone: 'neutral' },
              { label: '后续占位', value: '未来在这里挂载更深层财务描述卡', tone: 'neutral' },
            ],
          },
        ],
      },
      tech: {
        title: '技术结构细节',
        modules: [
          {
            id: 'technical',
            eyebrow: '技术形态',
            title: '技术形态深看',
            summary: '聚焦 MACD、均线和主力资金，避免非核心信号占用注意力。',
            metrics: [
              { label: 'MACD', value: '金叉延续，快慢线继续抬升', tone: 'bullish', glow: true },
              { label: 'MA20 / MA60', value: '均线发散健康，趋势仍完整', tone: 'bullish' },
              { label: '主力资金', value: '净流入延续，回踩承接仍在', tone: 'bullish' },
            ],
            footnote: '仅核心信号保留辉光。',
          },
          {
            id: 'fundamental',
            eyebrow: '基本面画像',
            title: '基本面占位卡',
            summary: '为后续深层信息预留固定容器，而不是让技术抽屉单线扩张。',
            metrics: [
              { label: '行业叙事', value: 'AI 基础设施需求仍提供中期支撑。', tone: 'neutral' },
              { label: '盈利韧性', value: '高利润率框架仍然成立。', tone: 'neutral' },
              { label: '未来字段', value: '将接入盈利质量与估值弹性描述卡。', tone: 'neutral' },
            ],
          },
        ],
      },
      fundamentals: {
        title: '基本面细节',
        modules: [
          {
            id: 'technical',
            eyebrow: '技术形态',
            title: '技术确认辅助',
            summary: '即使打开基本面抽屉，也保留技术确认模块保持双核结构一致。',
            metrics: [
              { label: 'MACD', value: '趋势与基本面叙事同向', tone: 'bullish', glow: true },
              { label: 'MA20 / MA60', value: '均线支撑尚未失真', tone: 'bullish' },
              { label: '主力资金', value: '核心资金没有明显撤退', tone: 'bullish' },
            ],
          },
          {
            id: 'fundamental',
            eyebrow: '基本面画像',
            title: '基本面画像深看',
            summary: '把收入、现金流与质量描述收束到一组更沉静的说明卡中。',
            metrics: [
              { label: '收入增速', value: '+18.2%', tone: 'bullish' },
              { label: '自由现金流', value: '$16.4B', tone: 'bullish' },
              { label: '质量描述', value: '毛利率与资本效率仍是后续深度卡的核心锚点。', tone: 'neutral' },
            ],
            footnote: '当前为基本面占位卡结构。',
          },
        ],
      },
    },
  },
  en: {
    documentTitle: 'Home - WolfyStock',
    eyebrow: 'SYSTEM VIEW',
    heading: 'WolfyStock Command Center',
    description: '',
    omnibarPlaceholder: 'Enter a ticker or company name to wake AI deep analysis...',
    analyzeButton: 'Analyze',
    instrument: 'NVIDIA',
    ticker: 'NVDA',
    sessionBadge: 'US AI infrastructure',
    regimeBadge: 'Momentum rebuilding',
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
      chartLabel: 'Breakout Confirmed',
      summary: 'Order momentum is improving and price is moving back into a strong-trend zone, so the cleaner plan is still a pullback confirmation entry.',
      reasonTitle: 'AI Breakout Why',
      reasonBody: 'Intraday flow points to institutional accumulation, price reclaimed MA60 support, and the MACD bullish cross stayed above zero to validate the range escape.',
      detailLabel: 'Open Decision Brief',
    },
    strategy: {
      title: 'Execution Strategy',
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
        { label: 'RSI', value: '65.4', tone: 'neutral' },
        { label: 'Volatility', value: '2.4%', tone: 'neutral' },
      ],
      detailLabel: 'Open Technical Brief',
    },
    fundamentals: {
      title: 'Fundamental Profile',
      metrics: [
        { label: 'Revenue Growth', value: '+18.2%', tone: 'bullish' },
        { label: 'Free Cash Flow', value: '$16.4B', tone: 'bullish' },
        { label: 'Gross Margin', value: '74.1%', tone: 'neutral' },
        { label: 'ROE', value: '31.8%', tone: 'bullish' },
        { label: 'PE', value: '74.5', tone: 'neutral' },
        { label: 'Institutional Ownership', value: '68.2%', tone: 'neutral' },
      ],
      detailLabel: 'Open Fundamental Brief',
    },
    drawers: {
      decision: {
        title: 'Deep report',
        modules: [
          {
            id: 'technical',
            eyebrow: 'Technical Analysis',
            title: 'Technical analysis deep read',
            summary: 'Keep only the core signals that explain the current bias, with more negative space for future live charts.',
            metrics: [
              { label: 'MACD', value: 'Bullish crossover continues above zero', tone: 'bullish', glow: true },
              { label: 'MA20 / MA60', value: 'Both moving averages keep expanding higher', tone: 'bullish' },
              { label: 'Main Fund Inflows', value: 'Three-session inflow trend remains intact', tone: 'bullish' },
            ],
            footnote: 'Technical data remains placeholder-only in this pass.',
          },
          {
            id: 'fundamental',
            eyebrow: 'Fundamental Profile',
            title: 'Fundamental profile deep read',
            summary: 'Use description cards as placeholders until deeper profitability and capital-efficiency data arrive.',
            metrics: [
              { label: 'Business Thread', value: 'AI infrastructure remains the clearest earnings anchor.', tone: 'neutral' },
              { label: 'Cash Flow Profile', value: 'Free cash flow strength supports patience through pullbacks.', tone: 'neutral' },
              { label: 'Future Slot', value: 'Deeper quality and efficiency signals land here later.', tone: 'neutral' },
            ],
            footnote: 'The fundamental module is intentionally placeholder-driven for now.',
          },
        ],
      },
      strategy: {
        title: 'Execution strategy brief',
        modules: [
          {
            id: 'technical',
            eyebrow: 'Technical Analysis',
            title: 'Pre-entry structure confirmation',
            summary: 'Execution still depends on technical confirmation before sizing up.',
            metrics: [
              { label: 'MACD', value: 'Crossover remains constructive above zero', tone: 'bullish', glow: true },
              { label: 'MA20 / MA60', value: 'Trend stays intact while averages expand', tone: 'bullish' },
              { label: 'Main Fund Inflows', value: 'No meaningful sponsorship fade yet', tone: 'bullish' },
            ],
          },
          {
            id: 'fundamental',
            eyebrow: 'Fundamental Profile',
            title: 'Patience anchor',
            summary: 'The fundamental module explains why a cleaner entry is still worth waiting for.',
            metrics: [
              { label: 'Earnings Quality', value: 'Growth quality still supports a constructive medium-term bias.', tone: 'neutral' },
              { label: 'Cash Flow', value: 'Cash generation adds a cushion during pullbacks.', tone: 'neutral' },
              { label: 'Future Slot', value: 'Deeper financial description cards land here later.', tone: 'neutral' },
            ],
          },
        ],
      },
      tech: {
        title: 'Technical structure brief',
        modules: [
          {
            id: 'technical',
            eyebrow: 'Technical Analysis',
            title: 'Technical analysis deep read',
            summary: 'Focus on MACD, moving averages, and main fund inflows only.',
            metrics: [
              { label: 'MACD', value: 'Bullish crossover continues with rising slope', tone: 'bullish', glow: true },
              { label: 'MA20 / MA60', value: 'Average expansion stays healthy and trend intact', tone: 'bullish' },
              { label: 'Main Fund Inflows', value: 'Net inflows remain supportive through pullbacks', tone: 'bullish' },
            ],
            footnote: 'Glow remains reserved for the core signal only.',
          },
          {
            id: 'fundamental',
            eyebrow: 'Fundamental Profile',
            title: 'Fundamental placeholder cards',
            summary: 'Reserve a stable second module so the drawer keeps a balanced two-core structure.',
            metrics: [
              { label: 'Industry Thread', value: 'AI infrastructure demand still supports the broader story.', tone: 'neutral' },
              { label: 'Profitability', value: 'High-margin structure remains intact.', tone: 'neutral' },
              { label: 'Future Slot', value: 'Quality and valuation elasticity cards arrive later.', tone: 'neutral' },
            ],
          },
        ],
      },
      fundamentals: {
        title: 'Fundamental brief',
        modules: [
          {
            id: 'technical',
            eyebrow: 'Technical Analysis',
            title: 'Technical confirmation layer',
            summary: 'Even on the fundamental view, the technical module remains visible to preserve the dual-core rhythm.',
            metrics: [
              { label: 'MACD', value: 'Trend confirmation still aligns with the story', tone: 'bullish', glow: true },
              { label: 'MA20 / MA60', value: 'Average support has not broken down', tone: 'bullish' },
              { label: 'Main Fund Inflows', value: 'Core sponsorship remains constructive', tone: 'bullish' },
            ],
          },
          {
            id: 'fundamental',
            eyebrow: 'Fundamental Profile',
            title: 'Fundamental profile deep read',
            summary: 'Pull revenue, cash flow, and quality description into quieter high-context cards.',
            metrics: [
              { label: 'Revenue Growth', value: '+18.2%', tone: 'bullish' },
              { label: 'Free Cash Flow', value: '$16.4B', tone: 'bullish' },
              { label: 'Quality Note', value: 'Margin and capital-efficiency remain the next deep-data anchors.', tone: 'neutral' },
            ],
            footnote: 'The module keeps placeholder content intentionally for now.',
          },
        ],
      },
    },
  },
};

const HomeBentoDashboardPage: React.FC = () => {
  const { language } = useI18n();
  const locale: DashboardLocale = language === 'en' ? 'en' : 'zh';
  const copy = CONTENT[locale];
  const [activeDrawer, setActiveDrawer] = useState<DrawerPayload | null>(null);

  useEffect(() => {
    document.title = copy.documentTitle;
  }, [copy.documentTitle]);

  return (
    <div
      data-testid="home-bento-dashboard"
      data-bento-surface="true"
      className={`${BENTO_SURFACE_ROOT_CLASS} workspace-width-wide w-full min-h-[calc(100vh-80px)] flex-1 flex flex-col pt-4 pb-2 px-6 md:px-8 xl:px-12 overflow-x-hidden bg-transparent`}
    >
      <main className="w-full flex-1 min-h-0 flex flex-col" data-testid="home-bento-main">
        <BentoGrid testId="home-bento-grid" className="w-full flex-1 min-h-0 grid grid-cols-1 items-start gap-4 lg:grid-cols-3 xl:grid-cols-5">
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
            chartPoints={DECISION_CHART_POINTS}
            breakoutPointIndex={9}
            reason={{ title: copy.decision.reasonTitle, body: copy.decision.reasonBody }}
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
        </BentoGrid>
      </main>

      <DeepReportDrawer
        isOpen={Boolean(activeDrawer)}
        onClose={() => setActiveDrawer(null)}
        title={activeDrawer?.title || ''}
        modules={activeDrawer?.modules || []}
        testId="home-bento-drawer"
      />
    </div>
  );
};

export default HomeBentoDashboardPage;
