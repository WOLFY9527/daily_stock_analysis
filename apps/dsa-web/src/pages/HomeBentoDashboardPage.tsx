import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import {
  BENTO_SURFACE_ROOT_CLASS,
  DecisionCard,
  DeepReportDrawer,
  FundamentalsCard,
  StrategyCard,
  TechCard,
  type SignalTone,
} from '../components/home-bento';
import { Drawer } from '../components/common';
import { useI18n } from '../contexts/UiLanguageContext';
import type { AnalysisReport, StandardReportField } from '../types/analysis';
import { useStockPoolStore } from '../stores';

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
    omnibarPlaceholder: '输入代码或公司名 (如 ORCL)...',
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
    omnibarPlaceholder: 'Enter a ticker or company name (for example ORCL)...',
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

type DashboardPayload = (typeof CONTENT)['zh'] & {
  chartPoints: DecisionChartPoint[];
  breakoutPointIndex: number;
};

const DASHBOARD_VARIANTS: Record<DashboardLocale, Record<string, DashboardPayload>> = {
  zh: {
    NVDA: {
      ...CONTENT.zh,
      chartPoints: DECISION_CHART_POINTS,
      breakoutPointIndex: 9,
    },
    ORCL: {
      ...CONTENT.zh,
      instrument: '甲骨文',
      ticker: 'ORCL',
      sessionBadge: '企业软件云',
      regimeBadge: '平台上修',
      decision: {
        ...CONTENT.zh.decision,
        company: '甲骨文',
        heroValue: '7.8',
        signalLabel: '偏多',
        signalTone: 'bullish',
        scoreValue: '财报驱动后维持上沿强势',
        badge: '云订单抬升 · 企业 IT 预算回流',
        chartLabel: '平台上破',
        summary: '云业务订单与数据库续费提供中线托底，回踩不破时更适合顺势跟进。',
        reasonBody: '财报后资金没有快速撤离，价格保持在前高之上，企业软件主线继续提供趋势支撑。',
      },
      strategy: {
        ...CONTENT.zh.strategy,
        metrics: [
          { label: '建仓区间', value: '121.80 - 124.60', tone: 'neutral' },
          { label: '目标位', value: '133.50', tone: 'bullish' },
          { label: '止损位', value: '117.40', tone: 'bearish' },
        ],
        positionBody: '先用轻仓跟随财报后的强势平台，确认回踩缩量后再补到计划仓位。',
      },
      tech: {
        ...CONTENT.zh.tech,
        signals: [
          { label: 'MACD', value: '零轴上方二次扩张', tone: 'bullish' },
          { label: '均线结构', value: 'MA20 托举 MA60', tone: 'bullish' },
          { label: '量价配合', value: '突破后量能维持', tone: 'bullish' },
          { label: 'RSI', value: '61.2', tone: 'neutral' },
          { label: '波动率', value: '1.8%', tone: 'neutral' },
        ],
      },
      fundamentals: {
        ...CONTENT.zh.fundamentals,
        metrics: [
          { label: '收入增速', value: '+9.4%', tone: 'bullish' },
          { label: '自由现金流', value: '$12.1B', tone: 'bullish' },
          { label: '毛利率', value: '71.6%', tone: 'neutral' },
          { label: 'ROE', value: '109.3%', tone: 'bullish' },
          { label: '市盈率 (PE)', value: '31.2', tone: 'neutral' },
          { label: '机构持仓', value: '44.8%', tone: 'neutral' },
        ],
      },
      chartPoints: [
        { label: '09:30', value: 121.2 },
        { label: '10:00', value: 121.8 },
        { label: '10:30', value: 122.0 },
        { label: '11:00', value: 122.6 },
        { label: '11:30', value: 122.1 },
        { label: '12:00', value: 122.8 },
        { label: '12:30', value: 123.0 },
        { label: '13:00', value: 123.4 },
        { label: '13:30', value: 123.8 },
        { label: '14:00', value: 124.3 },
        { label: '14:30', value: 124.8 },
        { label: '15:00', value: 125.2 },
      ],
      breakoutPointIndex: 9,
    },
    TSLA: {
      ...CONTENT.zh,
      instrument: '特斯拉',
      ticker: 'TSLA',
      sessionBadge: '高波动成长',
      regimeBadge: '反弹验证',
      decision: {
        ...CONTENT.zh.decision,
        company: '特斯拉',
        heroValue: '6.9',
        signalLabel: '中性偏多',
        signalTone: 'neutral',
        scoreValue: '事件驱动后仍需量能确认',
        badge: '波动放大 · 需要二次确认',
        chartLabel: '反弹测试',
        summary: '价格快速反抽后进入验证区，若量能跟不上，更适合等待第二次确认而不是追价。',
        reasonBody: '高波动资产的反弹更多依赖事件催化，当前结构尚未给出完全顺滑的趋势延续信号。',
      },
      strategy: {
        ...CONTENT.zh.strategy,
        metrics: [
          { label: '建仓区间', value: '166.00 - 171.50', tone: 'neutral' },
          { label: '目标位', value: '183.00', tone: 'bullish' },
          { label: '止损位', value: '159.20', tone: 'bearish' },
        ],
        positionBody: '只在确认量能延续时加仓，否则保留试错仓，避免在事件回落中被动扩大风险。',
      },
      tech: {
        ...CONTENT.zh.tech,
        signals: [
          { label: 'MACD', value: '零轴下方收敛', tone: 'neutral' },
          { label: '均线结构', value: 'MA20 仍在下压', tone: 'bearish' },
          { label: '量价配合', value: '反弹放量，续航待定', tone: 'neutral' },
          { label: 'RSI', value: '54.8', tone: 'neutral' },
          { label: '波动率', value: '4.9%', tone: 'bearish' },
        ],
      },
      fundamentals: {
        ...CONTENT.zh.fundamentals,
        metrics: [
          { label: '收入增速', value: '+2.7%', tone: 'neutral' },
          { label: '自由现金流', value: '$4.0B', tone: 'neutral' },
          { label: '毛利率', value: '17.4%', tone: 'bearish' },
          { label: 'ROE', value: '18.9%', tone: 'neutral' },
          { label: '市盈率 (PE)', value: '55.8', tone: 'neutral' },
          { label: '机构持仓', value: '47.6%', tone: 'neutral' },
        ],
      },
      chartPoints: [
        { label: '09:30', value: 165.4 },
        { label: '10:00', value: 166.8 },
        { label: '10:30', value: 168.1 },
        { label: '11:00', value: 169.6 },
        { label: '11:30', value: 168.7 },
        { label: '12:00', value: 170.2 },
        { label: '12:30', value: 169.1 },
        { label: '13:00', value: 170.8 },
        { label: '13:30', value: 171.2 },
        { label: '14:00', value: 170.4 },
        { label: '14:30', value: 171.0 },
        { label: '15:00', value: 170.5 },
      ],
      breakoutPointIndex: 7,
    },
  },
  en: {
    NVDA: {
      ...CONTENT.en,
      chartPoints: DECISION_CHART_POINTS,
      breakoutPointIndex: 9,
    },
    ORCL: {
      ...CONTENT.en,
      instrument: 'Oracle',
      ticker: 'ORCL',
      sessionBadge: 'Enterprise cloud software',
      regimeBadge: 'Platform bid',
      decision: {
        ...CONTENT.en.decision,
        company: 'Oracle',
        heroValue: '7.8',
        signalLabel: 'Constructive',
        signalTone: 'bullish',
        scoreValue: 'Post-earnings strength still holds the upper rail',
        badge: 'Cloud demand lift · enterprise budgets returning',
        chartLabel: 'Platform Break',
        summary: 'Cloud backlog and database renewals keep the medium-term floor intact, so pullbacks remain the cleaner way to participate.',
        reasonBody: 'Post-earnings sponsorship has not faded quickly, price is holding above the prior ceiling, and enterprise software remains a clean trend anchor.',
      },
      strategy: {
        ...CONTENT.en.strategy,
        metrics: [
          { label: 'Entry Zone', value: '121.80 - 124.60', tone: 'neutral' },
          { label: 'Target', value: '133.50', tone: 'bullish' },
          { label: 'Stop', value: '117.40', tone: 'bearish' },
        ],
        positionBody: 'Start light into the earnings-led base, then add only if the pullback stays orderly on lighter volume.',
      },
      tech: {
        ...CONTENT.en.tech,
        signals: [
          { label: 'MACD', value: 'Second expansion above zero', tone: 'bullish' },
          { label: 'Moving Averages', value: 'MA20 lifting MA60', tone: 'bullish' },
          { label: 'Volume Profile', value: 'Breakout volume still intact', tone: 'bullish' },
          { label: 'RSI', value: '61.2', tone: 'neutral' },
          { label: 'Volatility', value: '1.8%', tone: 'neutral' },
        ],
      },
      fundamentals: {
        ...CONTENT.en.fundamentals,
        metrics: [
          { label: 'Revenue Growth', value: '+9.4%', tone: 'bullish' },
          { label: 'Free Cash Flow', value: '$12.1B', tone: 'bullish' },
          { label: 'Gross Margin', value: '71.6%', tone: 'neutral' },
          { label: 'ROE', value: '109.3%', tone: 'bullish' },
          { label: 'PE', value: '31.2', tone: 'neutral' },
          { label: 'Institutional Ownership', value: '44.8%', tone: 'neutral' },
        ],
      },
      chartPoints: [
        { label: '09:30', value: 121.2 },
        { label: '10:00', value: 121.8 },
        { label: '10:30', value: 122.0 },
        { label: '11:00', value: 122.6 },
        { label: '11:30', value: 122.1 },
        { label: '12:00', value: 122.8 },
        { label: '12:30', value: 123.0 },
        { label: '13:00', value: 123.4 },
        { label: '13:30', value: 123.8 },
        { label: '14:00', value: 124.3 },
        { label: '14:30', value: 124.8 },
        { label: '15:00', value: 125.2 },
      ],
      breakoutPointIndex: 9,
    },
    TSLA: {
      ...CONTENT.en,
      instrument: 'Tesla',
      ticker: 'TSLA',
      sessionBadge: 'High-beta growth',
      regimeBadge: 'Bounce validation',
      decision: {
        ...CONTENT.en.decision,
        company: 'Tesla',
        heroValue: '6.9',
        signalLabel: 'Neutral to bullish',
        signalTone: 'neutral',
        scoreValue: 'Catalyst bounce still needs volume confirmation',
        badge: 'Volatility expansion · second confirmation needed',
        chartLabel: 'Bounce Test',
        summary: 'Price snapped back fast but is still in a proof zone, so the cleaner move is to wait for a second confirmation instead of chasing the first spike.',
        reasonBody: 'This rebound is still highly event-driven, and the structure has not yet converted into a smooth trend continuation setup.',
      },
      strategy: {
        ...CONTENT.en.strategy,
        metrics: [
          { label: 'Entry Zone', value: '166.00 - 171.50', tone: 'neutral' },
          { label: 'Target', value: '183.00', tone: 'bullish' },
          { label: 'Stop', value: '159.20', tone: 'bearish' },
        ],
        positionBody: 'Add only when follow-through volume confirms. Otherwise keep risk in probe size and avoid forcing size into a news-driven retrace.',
      },
      tech: {
        ...CONTENT.en.tech,
        signals: [
          { label: 'MACD', value: 'Compression below zero', tone: 'neutral' },
          { label: 'Moving Averages', value: 'MA20 still pressing lower', tone: 'bearish' },
          { label: 'Volume Profile', value: 'Bounce expanded, follow-through pending', tone: 'neutral' },
          { label: 'RSI', value: '54.8', tone: 'neutral' },
          { label: 'Volatility', value: '4.9%', tone: 'bearish' },
        ],
      },
      fundamentals: {
        ...CONTENT.en.fundamentals,
        metrics: [
          { label: 'Revenue Growth', value: '+2.7%', tone: 'neutral' },
          { label: 'Free Cash Flow', value: '$4.0B', tone: 'neutral' },
          { label: 'Gross Margin', value: '17.4%', tone: 'bearish' },
          { label: 'ROE', value: '18.9%', tone: 'neutral' },
          { label: 'PE', value: '55.8', tone: 'neutral' },
          { label: 'Institutional Ownership', value: '47.6%', tone: 'neutral' },
        ],
      },
      chartPoints: [
        { label: '09:30', value: 165.4 },
        { label: '10:00', value: 166.8 },
        { label: '10:30', value: 168.1 },
        { label: '11:00', value: 169.6 },
        { label: '11:30', value: 168.7 },
        { label: '12:00', value: 170.2 },
        { label: '12:30', value: 169.1 },
        { label: '13:00', value: 170.8 },
        { label: '13:30', value: 171.2 },
        { label: '14:00', value: 170.4 },
        { label: '14:30', value: 171.0 },
        { label: '15:00', value: 170.5 },
      ],
      breakoutPointIndex: 7,
    },
  },
};

const TICKER_ALIASES: Record<string, string> = {
  NVIDIA: 'NVDA',
  '英伟达': 'NVDA',
  ORACLE: 'ORCL',
  '甲骨文': 'ORCL',
  TESLA: 'TSLA',
  '特斯拉': 'TSLA',
};

function normalizeTickerQuery(rawValue?: string): string {
  const trimmed = String(rawValue || '').trim();
  if (!trimmed) {
    return '';
  }

  return TICKER_ALIASES[trimmed.toUpperCase()] || TICKER_ALIASES[trimmed] || trimmed.toUpperCase();
}

function resolveDashboardPayload(locale: DashboardLocale, ticker: string): DashboardPayload {
  const normalizedTicker = normalizeTickerQuery(ticker) || 'NVDA';
  const variant = DASHBOARD_VARIANTS[locale][normalizedTicker];
  if (variant) {
    return variant;
  }

  const base = DASHBOARD_VARIANTS[locale].NVDA;
  return {
    ...base,
    instrument: normalizedTicker,
    ticker: normalizedTicker,
    decision: {
      ...base.decision,
      company: normalizedTicker,
      badge: locale === 'en' ? 'Awaiting refreshed analysis' : '等待最新分析刷新',
      summary: locale === 'en'
        ? 'This ticker does not have a dedicated local preset yet, so the dashboard is using a generic live shell while analysis refreshes.'
        : '当前股票尚未配置专属本地预设，仪表盘先以通用动态骨架承接，等待分析结果回填。',
      reasonBody: locale === 'en'
        ? 'Search submission updated the dashboard state immediately. Historical analysis, if available, will overwrite these placeholders next.'
        : '搜索提交已立即刷新首页状态，若历史分析存在，将优先用历史结果回填当前占位数据。',
    },
  };
}

function toneFromScore(score?: number): SignalTone {
  if (typeof score !== 'number') {
    return 'neutral';
  }

  if (score >= 70) {
    return 'bullish';
  }

  if (score <= 40) {
    return 'bearish';
  }

  return 'neutral';
}

function toneFromFieldValue(value?: string): SignalTone {
  const normalized = String(value || '').toLowerCase();
  if (/(bull|up|break|expand|strong|乐观|偏多|看多|金叉|上行|突破)/.test(normalized)) {
    return 'bullish';
  }
  if (/(bear|down|weak|risk|fall|悲观|看空|下压|回落|破位)/.test(normalized)) {
    return 'bearish';
  }
  return 'neutral';
}

function mapStandardFields(
  fields: StandardReportField[] | undefined,
  fallback: Array<{ label: string; value: string; tone?: SignalTone }>,
  count: number,
): Array<{ label: string; value: string; tone?: SignalTone }> {
  if (!fields || fields.length === 0) {
    return fallback;
  }

  return fields
    .filter((field) => field.label && field.value)
    .slice(0, count)
    .map((field) => ({
      label: field.label,
      value: field.value,
      tone: toneFromFieldValue(field.value),
    }));
}

function buildDashboardFromReport(locale: DashboardLocale, report: AnalysisReport): DashboardPayload {
  const stockCode = normalizeTickerQuery(report.meta.stockCode || 'NVDA');
  const seed = resolveDashboardPayload(locale, stockCode);
  const standardReport = report.details?.standardReport;
  const summaryPanel = standardReport?.summaryPanel;
  const decisionPanel = standardReport?.decisionPanel;
  const decisionContext = standardReport?.decisionContext;
  const reasonLayer = standardReport?.reasonLayer;
  const technicalFields = standardReport?.technicalFields || standardReport?.tableSections?.technical?.fields;
  const fundamentalFields = standardReport?.fundamentalFields || standardReport?.tableSections?.fundamental?.fields;
  const sentimentTone = toneFromScore(report.summary.sentimentScore);
  const scoreText = typeof report.summary.sentimentScore === 'number'
    ? (report.summary.sentimentScore / 10).toFixed(1)
    : seed.decision.heroValue;
  const reasonBody = reasonLayer?.coreReasons?.[0]
    || reasonLayer?.topCatalyst
    || reasonLayer?.latestKeyUpdate
    || report.summary.analysisSummary
    || seed.decision.reasonBody;
  const badge = [
    summaryPanel?.operationAdvice,
    reasonLayer?.topCatalyst,
    reasonLayer?.newsValueTier,
  ].filter(Boolean).slice(0, 2).join(' · ') || seed.decision.badge;

  return {
    ...seed,
    ticker: stockCode,
    decision: {
      ...seed.decision,
      company: report.meta.stockName || summaryPanel?.stock || stockCode,
      heroValue: scoreText,
      signalLabel: report.summary.sentimentLabel || seed.decision.signalLabel,
      signalTone: sentimentTone,
      scoreValue: decisionContext?.shortTermView || report.summary.trendPrediction || report.summary.operationAdvice || seed.decision.scoreValue,
      badge,
      summary: summaryPanel?.oneSentence || report.summary.analysisSummary || seed.decision.summary,
      reasonTitle: locale === 'en' ? 'Latest Report Context' : '最近报告归因',
      reasonBody,
    },
    strategy: {
      ...seed.strategy,
      metrics: [
        {
          label: locale === 'en' ? 'Entry Zone' : '建仓区间',
          value: decisionPanel?.idealEntry || decisionPanel?.support || report.strategy?.idealBuy || seed.strategy.metrics[0]?.value || '--',
          tone: 'neutral',
        },
        {
          label: locale === 'en' ? 'Target' : '目标位',
          value: decisionPanel?.target || decisionPanel?.targetZone || report.strategy?.takeProfit || seed.strategy.metrics[1]?.value || '--',
          tone: 'bullish',
        },
        {
          label: locale === 'en' ? 'Stop' : '止损位',
          value: decisionPanel?.stopLoss || report.strategy?.stopLoss || seed.strategy.metrics[2]?.value || '--',
          tone: 'bearish',
        },
      ],
      positionBody: decisionPanel?.buildStrategy
        || decisionPanel?.holderAdvice
        || decisionPanel?.noPositionAdvice
        || report.summary.operationAdvice
        || seed.strategy.positionBody,
    },
    tech: {
      ...seed.tech,
      signals: mapStandardFields(technicalFields, seed.tech.signals, 5).map((item) => ({ ...item, tone: item.tone || 'neutral' })),
    },
    fundamentals: {
      ...seed.fundamentals,
      metrics: mapStandardFields(fundamentalFields, seed.fundamentals.metrics, 6),
    },
  };
}

const HomeBentoDashboardPage: React.FC = () => {
  const { language } = useI18n();
  const locale: DashboardLocale = language === 'en' ? 'en' : 'zh';
  const [activeDrawer, setActiveDrawer] = useState<DrawerPayload | null>(null);
  const [manualTicker, setManualTicker] = useState('');
  const [isQueryDirty, setIsQueryDirty] = useState(false);
  const query = useStockPoolStore((state) => state.query);
  const isAnalyzing = useStockPoolStore((state) => state.isAnalyzing);
  const historyItems = useStockPoolStore((state) => state.historyItems);
  const selectedReport = useStockPoolStore((state) => state.selectedReport);
  const [isHistoryDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const setQuery = useStockPoolStore((state) => state.setQuery);
  const refreshHistory = useStockPoolStore((state) => state.refreshHistory);
  const focusLatestHistoryForStock = useStockPoolStore((state) => state.focusLatestHistoryForStock);
  const submitAnalysis = useStockPoolStore((state) => state.submitAnalysis);
  const recentHistory = useMemo(
    () => Array.from(new Set(historyItems.map((item) => normalizeTickerQuery(item.stockCode)).filter(Boolean))).slice(0, 8),
    [historyItems],
  );
  const activeTicker = manualTicker || recentHistory[0] || normalizeTickerQuery(selectedReport?.meta.stockCode) || 'NVDA';
  const displayedQuery = isQueryDirty ? query : (query || activeTicker);
  const dashboardData = useMemo<DashboardPayload>(() => {
    if (selectedReport && normalizeTickerQuery(selectedReport.meta.stockCode) === activeTicker) {
      return buildDashboardFromReport(locale, selectedReport);
    }

    return resolveDashboardPayload(locale, activeTicker);
  }, [activeTicker, locale, selectedReport]);
  const copy = dashboardData;

  useEffect(() => {
    document.title = copy.documentTitle;
  }, [copy.documentTitle]);

  useEffect(() => {
    void refreshHistory(true);
  }, [refreshHistory]);

  const syncDashboardTicker = (tickerValue: string) => {
    const normalizedTicker = normalizeTickerQuery(tickerValue);
    if (!normalizedTicker) {
      return '';
    }

    setManualTicker(normalizedTicker);
    setIsQueryDirty(false);
    setQuery(normalizedTicker);
    return normalizedTicker;
  };

  const loadStockData = async (tickerValue: string) => {
    const normalizedTicker = syncDashboardTicker(tickerValue);
    if (!normalizedTicker) {
      return;
    }

    await focusLatestHistoryForStock(normalizedTicker);
  };

  const handleAnalyze = async () => {
    const normalizedTicker = normalizeTickerQuery(query);
    if (normalizedTicker) {
      syncDashboardTicker(normalizedTicker);
    }

    await submitAnalysis({
      stockCode: normalizedTicker || query,
      originalQuery: query,
      selectionSource: 'manual',
    });

    if (normalizedTicker) {
      setQuery(normalizedTicker);
      await refreshHistory(true);
      await focusLatestHistoryForStock(normalizedTicker);
    }
  };

  return (
    <div
      data-testid="home-bento-dashboard"
      data-bento-surface="true"
      className={`${BENTO_SURFACE_ROOT_CLASS} workspace-width-wide w-full min-h-[calc(100vh-80px)] flex-1 flex flex-col overflow-x-hidden bg-transparent`}
    >
      <main className="w-full flex-1 flex flex-col py-6 px-6 md:px-8 xl:px-12 min-w-0" data-testid="home-bento-main">
        <div
          data-testid="home-bento-grid"
          data-bento-grid="true"
          className="w-full grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-5 gap-6 items-stretch"
        >
          <form
            className="lg:col-span-3 xl:col-span-2 flex gap-3 h-12"
            data-testid="home-bento-omnibar"
            onSubmit={(event) => {
              event.preventDefault();
              void handleAnalyze();
            }}
          >
            <div className="relative flex-1 group">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                <Search className="h-5 w-5 text-white/40" />
              </div>
              <input
                data-testid="home-bento-omnibar-input"
                type="text"
                value={displayedQuery}
                onChange={(event) => {
                  setIsQueryDirty(true);
                  setQuery(event.target.value);
                }}
                autoComplete="off"
                disabled={isAnalyzing}
                className="w-full h-full bg-white/[0.03] border border-white/10 focus:border-indigo-500/50 focus:bg-white/[0.05] text-white text-sm rounded-xl pl-10 pr-4 outline-none transition-all placeholder:text-white/30"
                placeholder={copy.omnibarPlaceholder}
              />
            </div>
            <button
              type="submit"
              disabled={isAnalyzing}
              className="h-full px-6 bg-white text-black font-bold text-sm rounded-xl hover:bg-white/90 active:scale-95 transition-all shrink-0 disabled:cursor-wait disabled:bg-white/70"
              data-testid="home-bento-analyze-button"
            >
              {isAnalyzing ? (locale === 'en' ? 'Analyzing…' : '分析中…') : copy.analyzeButton}
            </button>
          </form>
          <div
            className="hidden xl:flex xl:col-span-3 items-center justify-end pl-2"
            data-testid="home-bento-recent-history"
          >
            <button
              type="button"
              onClick={() => setHistoryDrawerOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] text-xs font-medium text-white/70 transition-colors"
              data-testid="home-bento-history-drawer-trigger"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l2.5 2.5M21 12a9 9 0 1 1-3.2-6.9M21 4v5h-5" />
              </svg>
              <span>{locale === 'en' ? 'History' : '历史记录'}</span>
            </button>
          </div>
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
            chartPoints={copy.chartPoints}
            breakoutPointIndex={copy.breakoutPointIndex}
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
        </div>
      </main>

      <DeepReportDrawer
        isOpen={Boolean(activeDrawer)}
        onClose={() => setActiveDrawer(null)}
        title={activeDrawer?.title || ''}
        modules={activeDrawer?.modules || []}
        testId="home-bento-drawer"
      />

      <Drawer
        isOpen={isHistoryDrawerOpen}
        onClose={() => setHistoryDrawerOpen(false)}
        title={locale === 'en' ? 'Analysis History' : '历史记录'}
        width="max-w-lg"
      >
        <div className="flex flex-col gap-3" data-testid="home-bento-history-drawer">
          {recentHistory.length > 0 ? recentHistory.map((ticker) => (
            <button
              key={ticker}
              type="button"
              onClick={() => {
                setHistoryDrawerOpen(false);
                void loadStockData(ticker);
              }}
              className={`flex min-w-0 items-center justify-between gap-4 rounded-2xl border px-4 py-3 text-left transition-colors ${
                activeTicker === ticker
                  ? 'border-white/15 bg-white/[0.08] text-white'
                  : 'border-white/5 bg-white/[0.02] text-white/72 hover:bg-white/[0.05]'
              }`}
              data-testid={`home-bento-history-item-${ticker}`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{ticker}</p>
                <p className="mt-1 truncate text-[11px] uppercase tracking-[0.16em] text-white/40">
                  {locale === 'en' ? 'Recent analysis' : '最近分析'}
                </p>
              </div>
              <span className="shrink-0 text-[10px] uppercase tracking-[0.16em] text-white/35">
                {activeTicker === ticker ? (locale === 'en' ? 'Loaded' : '当前') : (locale === 'en' ? 'Open' : '打开')}
              </span>
            </button>
          )) : (
            <div className="rounded-2xl border border-white/5 bg-white/[0.02] px-4 py-5 text-sm text-white/48">
              {locale === 'en' ? 'No synced analysis history yet.' : '历史分析尚未同步。'}
            </div>
          )}
        </div>
      </Drawer>
    </div>
  );
};

export default HomeBentoDashboardPage;
