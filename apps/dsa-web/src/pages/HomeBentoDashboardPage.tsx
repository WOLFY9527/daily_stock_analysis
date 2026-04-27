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
  details?: string;
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
type DetailDrawerKey = 'decision' | 'strategy' | 'tech' | 'fundamentals';

type DashboardField = {
  label: string;
  value: string;
  tone?: SignalTone;
  details?: string;
};

type DashboardSignal = DashboardField & {
  tone: SignalTone;
};

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
    metrics: DashboardField[];
    positionLabel: string;
    positionBody: string;
    detailLabel: string;
  };
  tech: {
    title: string;
    signals: DashboardSignal[];
    detailLabel: string;
  };
  fundamentals: {
    title: string;
    metrics: DashboardField[];
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
    omnibarPlaceholder: '输入代码唤醒 AI (如 ORCL)...',
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
      decision: { title: '', modules: [] },
      strategy: { title: '', modules: [] },
      tech: { title: '', modules: [] },
      fundamentals: { title: '', modules: [] },
    },
  },
  en: {
    documentTitle: 'Home - WolfyStock',
    eyebrow: 'SYSTEM VIEW',
    heading: 'WolfyStock Command Center',
    description: '',
    omnibarPlaceholder: 'Enter a ticker to wake the AI (for example ORCL)...',
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
      decision: { title: '', modules: [] },
      strategy: { title: '', modules: [] },
      tech: { title: '', modules: [] },
      fundamentals: { title: '', modules: [] },
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
    return enrichDashboardPayload(locale, variant);
  }

  const base = DASHBOARD_VARIANTS[locale].NVDA;
  return enrichDashboardPayload(locale, {
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
  });
}

function resolveDemoFallbackTicker(ticker: string): string {
  const normalizedTicker = normalizeTickerQuery(ticker);
  if (normalizedTicker && DASHBOARD_VARIANTS.zh[normalizedTicker]) {
    return normalizedTicker;
  }
  return 'ORCL';
}

function DashboardSkeletonCard({
  testId,
  className,
  rows = 4,
}: {
  testId: string;
  className?: string;
  rows?: number;
}) {
  return (
    <div
      data-testid={testId}
      className={`h-full w-full rounded-[24px] border border-white/5 bg-white/[0.02] p-6 backdrop-blur-2xl ${className || ''}`}
    >
      <div className="flex h-full animate-pulse flex-col gap-4">
        <div className="h-3 w-24 rounded-full bg-white/8" />
        <div className="h-10 w-32 rounded-2xl bg-white/10" />
        <div className="grid flex-1 gap-3">
          {Array.from({ length: rows }).map((_, index) => (
            <div
              key={`${testId}-${index + 1}`}
              className={`rounded-2xl ${index % 2 === 0 ? 'bg-white/[0.06]' : 'bg-white/[0.04]'} ${index === 0 ? 'h-16' : 'h-12'}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
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

function normalizeDetailKey(value?: string): string {
  return String(value || '').toLowerCase().replace(/[\s/()%+.\-_:]+/g, '');
}

function mapStandardFields(
  fields: StandardReportField[] | undefined,
  fallback: DashboardField[],
  count: number,
) : DashboardField[] {
  if (!fields || fields.length === 0) {
    return fallback.slice(0, count);
  }

  return fields
    .filter((field) => field.label && field.value)
    .slice(0, count)
    .map((field, index) => {
      const fallbackField = fallback.find((item) => normalizeDetailKey(item.label) === normalizeDetailKey(field.label)) || fallback[index];
      return {
        label: field.label,
        value: field.value,
        tone: toneFromFieldValue(field.value),
        details: fallbackField?.details,
      };
    });
}

function buildTechSignalDetails(locale: DashboardLocale, ticker: string, label: string, value: string): string {
  const key = normalizeDetailKey(label);
  const isEnglish = locale === 'en';

  if (key === 'macd') {
    if (ticker === 'TSLA') {
      return isEnglish
        ? 'Fast and slow lines are still below zero, the downside histogram is shrinking, and the next confirmation is whether a bullish cross can convert the rebound into a tradable trend leg.'
        : '快慢线仍在零轴下方运行，绿柱缩短，说明空头动能在衰减；下一步要看能否形成金叉，把反弹转成可交易的趋势段。';
    }
    if (ticker === 'ORCL') {
      return isEnglish
        ? 'The indicator is already above zero and re-accelerating, which usually means the post-earnings trend is being confirmed by a second impulse rather than a one-day squeeze.'
        : '指标已经站上零轴并再次扩张，通常意味着财报后的趋势不是单日脉冲，而是在走二次确认。';
    }
    return isEnglish
      ? 'The crossover is still above zero, so momentum and trend direction remain aligned. The key watchpoint is whether the slope can stay positive during the next pullback.'
      : '金叉保持在零轴上方，动能和趋势方向仍同向；关键观察点是下次回踩时快线斜率能否继续维持正向。';
  }

  if (key === '均线结构' || key === 'movingaverages' || key === 'ma20ma60') {
    if (ticker === 'TSLA') {
      return isEnglish
        ? 'MA20 is still acting as a downward lid, so this move is still a counter-trend bounce until price can reclaim and stabilize above the short-term average.'
        : 'MA20 仍在压制价格，这一波更像逆势反抽；只有重新站稳短期均线，结构才会从修复转成趋势延续。';
    }
    return isEnglish
      ? 'The short-term average is leading the medium-term line higher, which keeps the trend stack constructive as long as pullbacks continue to hold the moving-average band.'
      : '短期均线继续牵引中期均线上行，只要回踩仍能守住均线带，趋势结构就没有被破坏。';
  }

  if (key === '量价配合' || key === 'volumeprofile') {
    if (ticker === 'TSLA') {
      return isEnglish
        ? 'The first rebound printed volume, but follow-through is not clean yet. Without a second expansion on lower volatility, the move still carries headline-driven whipsaw risk.'
        : '首轮反弹已经放量，但续航并不干净；如果没有第二次低波动放量确认，这个结构仍有事件驱动的来回扫损风险。';
    }
    return isEnglish
      ? 'Volume stayed orderly during the pullback and expanded into the breakout, which is the healthier sequence for trend continuation instead of distribution.'
      : '回踩阶段量能收敛、突破阶段量能放大，这是更健康的趋势延续序列，而不是高位派发。';
  }

  if (key === 'rsi') {
    return isEnglish
      ? `RSI is at ${value}, which is firm but not yet an exhaustion print. It supports continuation as long as price does not diverge against new highs.`
      : `RSI 处在 ${value}，强势但还没到典型透支区；只要价格创新高时不出现背离，趋势延续概率仍占优。`;
  }

  if (key === '波动率' || key === 'volatility') {
    return isEnglish
      ? `Realized volatility is ${value}; position sizing should stay tied to wider risk bands instead of headline-driven chasing.`
      : `实现波动率约为 ${value}，仓位和止损都要按更宽的风险带来做，不能用追涨方式处理。`;
  }

  return isEnglish
    ? `${label} is currently reading ${value}, and the drill-down should stay anchored to that live signal instead of a separate narrative block.`
    : `${label} 当前读数为 ${value}，下钻说明应继续围绕这个实时信号展开，而不是脱离主卡片另写一套叙事。`;
}

function buildFundamentalMetricDetails(locale: DashboardLocale, ticker: string, label: string, value: string): string {
  const key = normalizeDetailKey(label);
  const isEnglish = locale === 'en';

  if (key === '收入增速' || key === 'revenuegrowth') {
    if (ticker === 'TSLA') {
      return isEnglish
        ? 'Auto delivery growth is slowing and that is capping the top-line pace, while the higher-margin energy storage line is carrying a larger share of the earnings support.'
        : '汽车交付量放缓拖累整体营收增速，但储能业务的高毛利贡献正在抬升，对冲了汽车主业的增速压力。';
    }
    return isEnglish
      ? `Revenue growth is running at ${value}, which still supports the current thesis as long as demand conversion remains ahead of cost pressure.`
      : `收入增速为 ${value}，只要需求兑现继续快于成本压力，这个读数就仍然支撑当前主线判断。`;
  }

  if (key === '自由现金流' || key === 'freecashflow') {
    return isEnglish
      ? `Free cash flow at ${value} keeps financing pressure contained and gives the company room to absorb volatility without breaking the medium-term thesis.`
      : `自由现金流达到 ${value}，说明公司仍有能力承受阶段波动，不至于因为融资压力打断中期逻辑。`;
  }

  if (key === '毛利率' || key === 'grossmargin') {
    return isEnglish
      ? `Gross margin at ${value} is the cleanest read on pricing power versus cost pressure, so this line is critical for validating whether the earnings base is expanding or compressing.`
      : `毛利率为 ${value}，这是检验定价权和成本压力最直接的指标，决定利润底盘是在扩张还是收缩。`;
  }

  if (key === 'roe') {
    return isEnglish
      ? `ROE at ${value} measures how efficiently equity is being converted into earnings, which matters for judging whether the current valuation premium has operating support.`
      : `ROE 为 ${value}，反映股东权益转化为利润的效率，用来判断当前估值溢价是否有经营效率支撑。`;
  }

  if (key === '市盈率pe' || key === 'pe') {
    return isEnglish
      ? `A PE of ${value} means the market is still paying for forward growth; unless growth durability improves, the rerating room stays bounded.`
      : `市盈率约为 ${value}，说明市场仍在为未来成长付费；如果增长持续性没有继续抬升，估值扩张空间会受到约束。`;
  }

  if (key === '机构持仓' || key === 'institutionalownership') {
    return isEnglish
      ? `Institutional ownership at ${value} helps gauge sponsorship stability; higher stickiness usually lowers the probability of purely retail-driven air pockets.`
      : `机构持仓约为 ${value}，用来判断筹码稳定性；机构黏性越高，纯情绪性踩踏的概率通常越低。`;
  }

  return isEnglish
    ? `${label} is currently ${value}, and the supporting note should remain attached to that same fundamental observation.`
    : `${label} 当前为 ${value}，支撑说明需要继续绑定在这条基本面观测本身。`;
}

function buildStrategyMetricDetails(locale: DashboardLocale, label: string, value: string): string {
  const key = normalizeDetailKey(label);
  const isEnglish = locale === 'en';

  if (key === '建仓区间' || key === 'entryzone') {
    return isEnglish
      ? `Use ${value} as the preferred accumulation band. Only step in when intraday structure remains orderly instead of expanding on disorderly volume.`
      : `以 ${value} 作为优先吸纳带，只有当日内结构维持有序、没有失控放量时，才考虑执行首笔仓位。`;
  }

  if (key === '目标位' || key === 'target') {
    return isEnglish
      ? `The ${value} objective maps to the next supply zone or rerating band, so profit-taking efficiency should be reassessed as price approaches that area.`
      : `${value} 对应下一层压力带或估值修复上沿，价格接近该区间时要重新评估兑现效率。`;
  }

  if (key === '止损位' || key === 'stop') {
    return isEnglish
      ? `The ${value} stop is the structure invalidation line. A decisive break there means the thesis should be re-underwritten rather than averaged down.`
      : `${value} 是结构失效位；一旦有效跌破，应该重做交易假设，而不是机械摊低成本。`;
  }

  return isEnglish
    ? `${label} is currently set to ${value}, and execution should continue to respect that same operating constraint.`
    : `${label} 当前设定为 ${value}，执行层必须继续遵守这一条约束。`;
}

function enrichDashboardPayload(locale: DashboardLocale, payload: DashboardPayload): DashboardPayload {
  return {
    ...payload,
    strategy: {
      ...payload.strategy,
      metrics: payload.strategy.metrics.map((metric) => ({
        ...metric,
        details: metric.details || buildStrategyMetricDetails(locale, metric.label, metric.value),
      })),
    },
    tech: {
      ...payload.tech,
      signals: payload.tech.signals.map((signal) => ({
        ...signal,
        details: signal.details || buildTechSignalDetails(locale, payload.ticker, signal.label, signal.value),
      })),
    },
    fundamentals: {
      ...payload.fundamentals,
      metrics: payload.fundamentals.metrics.map((metric) => ({
        ...metric,
        details: metric.details || buildFundamentalMetricDetails(locale, payload.ticker, metric.label, metric.value),
      })),
    },
  };
}

function buildDrawerPayload(locale: DashboardLocale, dashboard: DashboardPayload, drawerKey: DetailDrawerKey): DrawerPayload {
  const isEnglish = locale === 'en';
  const titleMap: Record<DetailDrawerKey, string> = {
    decision: isEnglish ? `${dashboard.ticker} Decision Drill-down` : `${dashboard.ticker} 决策下钻`,
    strategy: isEnglish ? `${dashboard.ticker} Execution Drill-down` : `${dashboard.ticker} 执行下钻`,
    tech: isEnglish ? `${dashboard.ticker} Technical Drill-down` : `${dashboard.ticker} 技术下钻`,
    fundamentals: isEnglish ? `${dashboard.ticker} Fundamental Drill-down` : `${dashboard.ticker} 基本面下钻`,
  };

  if (drawerKey === 'decision') {
    return {
      title: titleMap.decision,
      modules: [
        {
          id: 'decision',
          eyebrow: dashboard.decision.eyebrow,
          title: isEnglish ? 'Supporting Evidence' : '支撑证据',
          metrics: [
            {
              label: isEnglish ? 'Signal Bias' : '信号方向',
              value: dashboard.decision.signalLabel,
              details: dashboard.decision.scoreValue,
              tone: dashboard.decision.signalTone,
              glow: true,
            },
            {
              label: isEnglish ? 'Trade Thesis' : '交易主线',
              value: dashboard.decision.summary,
              details: dashboard.decision.reasonBody,
              tone: 'neutral',
            },
            {
              label: isEnglish ? 'Catalyst Tag' : '催化标签',
              value: dashboard.decision.badge,
              details: dashboard.decision.chartLabel,
              tone: dashboard.decision.signalTone,
            },
          ],
        },
      ],
    };
  }

  if (drawerKey === 'strategy') {
    return {
      title: titleMap.strategy,
      modules: [
        {
          id: 'strategy',
          eyebrow: dashboard.strategy.title,
          title: isEnglish ? 'Execution Constraints' : '执行约束',
          metrics: [
            ...dashboard.strategy.metrics.map((metric) => ({
              label: metric.label,
              value: metric.value,
              details: metric.details,
              tone: metric.tone || 'neutral',
            })),
            {
              label: dashboard.strategy.positionLabel,
              value: isEnglish ? 'Staggered Sizing' : '分批仓位',
              details: dashboard.strategy.positionBody,
              tone: 'neutral',
            },
          ],
        },
      ],
    };
  }

  if (drawerKey === 'tech') {
    return {
      title: titleMap.tech,
      modules: [
        {
          id: 'tech',
          eyebrow: dashboard.tech.title,
          title: isEnglish ? 'Signal Stack' : '信号栈',
          metrics: dashboard.tech.signals.map((signal, index) => ({
            label: signal.label,
            value: signal.value,
            details: signal.details,
            tone: signal.tone,
            glow: index === 0,
          })),
        },
      ],
    };
  }

  return {
    title: titleMap.fundamentals,
    modules: [
      {
        id: 'fundamentals',
        eyebrow: dashboard.fundamentals.title,
        title: isEnglish ? 'Fundamental Support' : '基本面支撑',
        metrics: dashboard.fundamentals.metrics.map((metric, index) => ({
          label: metric.label,
          value: metric.value,
          details: metric.details,
          tone: metric.tone || 'neutral',
          glow: index === 0 && metric.tone === 'bullish',
        })),
      },
    ],
  };
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

  return enrichDashboardPayload(locale, {
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
  });
}

const HomeBentoDashboardPage: React.FC = () => {
  const { language } = useI18n();
  const locale: DashboardLocale = language === 'en' ? 'en' : 'zh';
  const [activeDrawer, setActiveDrawer] = useState<DetailDrawerKey | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTicker, setActiveTicker] = useState('NVDA');
  const [hasHydratedInitialTicker, setHasHydratedInitialTicker] = useState(false);
  const [isDashboardLoading, setDashboardLoading] = useState(false);
  const [fallbackToast, setFallbackToast] = useState<string | null>(null);
  const isAnalyzing = useStockPoolStore((state) => state.isAnalyzing);
  const historyItems = useStockPoolStore((state) => state.historyItems);
  const selectedReport = useStockPoolStore((state) => state.selectedReport);
  const [isHistoryDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const refreshHistory = useStockPoolStore((state) => state.refreshHistory);
  const focusLatestHistoryForStock = useStockPoolStore((state) => state.focusLatestHistoryForStock);
  const submitAnalysis = useStockPoolStore((state) => state.submitAnalysis);
  const recentHistory = useMemo(
    () => Array.from(new Set(historyItems.map((item) => normalizeTickerQuery(item.stockCode)).filter(Boolean))).slice(0, 8),
    [historyItems],
  );
  const isBusy = isAnalyzing || isDashboardLoading;
  const dashboardData = useMemo<DashboardPayload>(() => {
    if (selectedReport && normalizeTickerQuery(selectedReport.meta.stockCode) === activeTicker) {
      return buildDashboardFromReport(locale, selectedReport);
    }

    return resolveDashboardPayload(locale, activeTicker);
  }, [activeTicker, locale, selectedReport]);
  const copy = dashboardData;
  const activeDrawerPayload = activeDrawer ? buildDrawerPayload(locale, copy, activeDrawer) : null;

  useEffect(() => {
    document.title = copy.documentTitle;
  }, [copy.documentTitle]);

  useEffect(() => {
    void refreshHistory(true);
  }, [refreshHistory]);

  useEffect(() => {
    if (hasHydratedInitialTicker) {
      return;
    }

    const nextTicker = normalizeTickerQuery(selectedReport?.meta.stockCode) || recentHistory[0];
    if (!nextTicker) {
      return;
    }

    setActiveTicker(nextTicker);
    setHasHydratedInitialTicker(true);
  }, [hasHydratedInitialTicker, recentHistory, selectedReport?.meta.stockCode]);

  useEffect(() => {
    if (!fallbackToast) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setFallbackToast(null);
    }, 3200);

    return () => window.clearTimeout(timer);
  }, [fallbackToast]);

  const loadStockData = async (tickerValue: string) => {
    const normalizedTicker = normalizeTickerQuery(tickerValue);
    if (!normalizedTicker) {
      return;
    }

    setFallbackToast(null);
    setDashboardLoading(true);
    try {
      await focusLatestHistoryForStock(normalizedTicker);
      setActiveTicker(normalizedTicker);
    } finally {
      setDashboardLoading(false);
    }
  };

  const handleAnalyze = async () => {
    const rawQuery = searchQuery.trim();
    const normalizedTicker = normalizeTickerQuery(rawQuery);
    if (!rawQuery) {
      await submitAnalysis({
        stockCode: '',
        originalQuery: '',
        selectionSource: 'manual',
      });
      return;
    }

    setFallbackToast(null);
    setDashboardLoading(true);
    setSearchQuery('');

    const result = await submitAnalysis({
      stockCode: normalizedTicker || rawQuery,
      originalQuery: rawQuery,
      selectionSource: 'manual',
    });

    if (result.ok) {
      await refreshHistory(true);
      await focusLatestHistoryForStock(result.stockCode);
      setActiveTicker(result.stockCode);
    } else if (!result.duplicate) {
      setActiveTicker(resolveDemoFallbackTicker(normalizedTicker || rawQuery));
      setFallbackToast(locale === 'en' ? 'API request failed. Switched to demo data.' : 'API调用失败，已切换为演示数据');
    }

    setDashboardLoading(false);
  };

  return (
    <div
      data-testid="home-bento-dashboard"
      data-bento-surface="true"
      className={`${BENTO_SURFACE_ROOT_CLASS} workspace-width-wide w-full min-h-[calc(100vh-80px)] flex-1 flex flex-col overflow-x-hidden bg-transparent`}
    >
      {fallbackToast ? (
        <div className="pointer-events-none fixed right-6 top-24 z-50" data-testid="home-bento-fallback-toast">
          <div className="rounded-2xl border border-white/10 bg-black/75 px-4 py-3 text-sm font-medium text-white shadow-[0_18px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl">
            {fallbackToast}
          </div>
        </div>
      ) : null}
      <main className="w-full flex-1 flex flex-col py-6 px-6 md:px-8 xl:px-12 min-w-0" data-testid="home-bento-main">
        <div
          data-testid="home-bento-grid"
          data-bento-grid="true"
          className="mt-6 w-full grid grid-cols-1 gap-6 items-stretch xl:grid-cols-5"
        >
          <div
            className="xl:col-span-2 flex h-full min-h-0 flex-col gap-6"
            data-testid="home-bento-primary-stack"
          >
            <form
              className="flex h-12 gap-3"
              data-testid="home-bento-omnibar"
              onSubmit={(event) => {
                event.preventDefault();
                void handleAnalyze();
              }}
            >
              <div className="relative flex-1 group">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                  <Search className="h-4 w-4 text-white/40" />
                </div>
                <input
                  data-testid="home-bento-omnibar-input"
                  type="text"
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                  }}
                  autoComplete="off"
                  disabled={isBusy}
                  className="w-full h-full rounded-2xl border border-white/5 bg-white/[0.02] pl-11 pr-4 text-sm text-white outline-none transition-all shadow-lg placeholder:text-white/30 focus:border-white/20 focus:bg-white/[0.04]"
                  placeholder={copy.omnibarPlaceholder}
                />
              </div>
              <button
                type="submit"
                disabled={isBusy}
                className="h-full shrink-0 rounded-2xl border border-white/10 bg-white/[0.05] px-6 text-sm font-bold text-white backdrop-blur-md transition-all hover:border-white/20 hover:bg-white/[0.1] disabled:cursor-wait disabled:border-white/10 disabled:bg-white/[0.05] disabled:text-white/60"
                data-testid="home-bento-analyze-button"
              >
                {isAnalyzing ? (locale === 'en' ? 'Analyzing…' : '分析中…') : copy.analyzeButton}
              </button>
              <button
                type="button"
                aria-label={locale === 'en' ? 'History' : '历史记录'}
                onClick={() => setHistoryDrawerOpen(true)}
                disabled={isBusy}
                className="flex h-full shrink-0 items-center justify-center rounded-2xl border border-white/5 bg-white/[0.02] px-4 text-white/70 transition-all hover:bg-white/[0.08] hover:text-white disabled:cursor-wait disabled:text-white/40"
                data-testid="home-bento-history-drawer-trigger"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l2.5 2.5M21 12a9 9 0 1 1-3.2-6.9M21 4v5h-5" />
                </svg>
              </button>
            </form>
            <div className="min-h-0 flex-1">
              {isDashboardLoading ? (
                <DashboardSkeletonCard
                  testId="home-bento-loading-decision-card"
                  className="min-h-[32rem]"
                  rows={5}
                />
              ) : (
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
                  onOpenDetails={() => setActiveDrawer('decision')}
                />
              )}
            </div>
          </div>
          <div
            className="min-w-0 xl:col-span-3 flex flex-col gap-6"
            data-testid="home-bento-secondary-stack"
          >
            {isDashboardLoading ? (
              <>
                <DashboardSkeletonCard testId="home-bento-loading-strategy-card" rows={3} />
                <div
                  className="grid flex-1 grid-cols-1 items-stretch gap-6 md:grid-cols-2"
                  data-testid="home-bento-secondary-grid"
                >
                  <DashboardSkeletonCard testId="home-bento-loading-tech-card" rows={4} />
                  <DashboardSkeletonCard testId="home-bento-loading-fundamentals-card" rows={4} />
                </div>
              </>
            ) : (
              <>
                <StrategyCard
                  title={copy.strategy.title}
                  subtitle={copy.strategy.subtitle}
                  metrics={copy.strategy.metrics}
                  positionLabel={copy.strategy.positionLabel}
                  positionBody={copy.strategy.positionBody}
                  detailLabel={copy.strategy.detailLabel}
                  onOpenDetails={() => setActiveDrawer('strategy')}
                />
                <div
                  className="grid flex-1 grid-cols-1 items-stretch gap-6 md:grid-cols-2"
                  data-testid="home-bento-secondary-grid"
                >
                  <TechCard
                    title={copy.tech.title}
                    signals={copy.tech.signals}
                    detailLabel={copy.tech.detailLabel}
                    onOpenDetails={() => setActiveDrawer('tech')}
                  />
                  <FundamentalsCard
                    title={copy.fundamentals.title}
                    metrics={copy.fundamentals.metrics}
                    detailLabel={copy.fundamentals.detailLabel}
                    onOpenDetails={() => setActiveDrawer('fundamentals')}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </main>

      <DeepReportDrawer
        isOpen={Boolean(activeDrawerPayload)}
        onClose={() => setActiveDrawer(null)}
        title={activeDrawerPayload?.title || ''}
        modules={activeDrawerPayload?.modules || []}
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
