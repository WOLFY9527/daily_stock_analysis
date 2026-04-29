import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import {
  BentoCard,
  BENTO_SURFACE_ROOT_CLASS,
  DecisionCard,
  DeepReportDrawer,
  FundamentalsCard,
  StrategyCard,
  TechCard,
  type SignalTone,
} from '../components/home-bento';
import { Button, ConfirmDialog, Drawer } from '../components/common';
import { useI18n } from '../contexts/UiLanguageContext';
import {
  getSafariReadySurfaceClassName,
  shouldApplySafariA11yGuard,
  useSafariRenderReady,
  useSafariWarmActivation,
} from '../hooks/useSafariInteractionReady';
import { useDashboardLifecycle } from '../hooks/useDashboardLifecycle';
import type { AnalysisReport, HistoryItem, StandardReportField } from '../types/analysis';
import { purgeZombieDashboardStorage, useStockPoolStore } from '../stores';

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

type DashboardLocale = 'zh' | 'en';
type DetailDrawerKey = 'decision' | 'strategy' | 'tech' | 'fundamentals';
type PendingHistoryDelete =
  | { mode: 'single'; recordIds: number[] }
  | { mode: 'visible'; recordIds: number[] };

type DashboardField = {
  label: string;
  value: string;
  rawValue?: string;
  tone?: SignalTone;
  details?: string;
};

type DashboardSignal = DashboardField & {
  tone: SignalTone;
};

const CJK_TEXT_RE = /[\u3400-\u9FFF]/;
const TICKER_FORMAT_RE = /^[A-Z]{1,5}$|^\d{6}$/;
const EMPTY_FIELD_VALUE = '-';

function normalizeDetailKey(value?: string): string {
  return String(value || '').toLowerCase().replace(/[\s/()%+.\-_:]+/g, '');
}

function containsCjk(value?: string): boolean {
  return CJK_TEXT_RE.test(String(value || ''));
}

function isPendingMetricValue(value?: string): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === ''
    || normalized === '--'
    || normalized === '-'
    || /^(na|n\/a)[（(]?(字段待接入|field pending)?[）)]?$/i.test(normalized)
    || /字段待接入|field pending/i.test(normalized);
}

function sanitizeMetricValue(value?: string): string {
  return isPendingMetricValue(value) ? '-' : String(value || '').trim();
}

function isPeLikeMetric(label: string): boolean {
  const key = normalizeDetailKey(label);
  return key === 'pe' || key.includes('市盈率') || key.includes('peratio') || key.includes('pettm') || key.includes('forwardpe');
}

function isZombieStockLabel(value: unknown): boolean {
  const text = String(value || '').trim();
  const normalized = text.toLowerCase();
  return normalized === '待确认股票' || normalized === 'unknown' || normalized === 'unnamed stock' || /^股票[A-Z0-9.]+$/i.test(text);
}

function hasFailedAnalysisText(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  return /all llm models failed|serviceunavailable|rate limit|ratelimiterror|timeout|timed out|分析过程出错|llm.*failed/i.test(value);
}

function hasUntrustedReportMarker(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  for (const [key, value] of Object.entries(payload)) {
    if (/stock(name)?$/i.test(key) && isZombieStockLabel(value)) {
      return true;
    }
    if (hasFailedAnalysisText(value)) {
      return true;
    }
    if (typeof value === 'object' && value !== null && hasUntrustedReportMarker(value)) {
      return true;
    }
  }

  return false;
}

function neutralFieldValue(label: string): string {
  return isPeLikeMetric(label) ? 'N/A' : EMPTY_FIELD_VALUE;
}

function neutralizeDashboardFields(fields: DashboardField[]): DashboardField[] {
  return fields.map((field) => {
    const value = neutralFieldValue(field.label);
    return {
      ...field,
      value,
      rawValue: value,
      tone: 'neutral',
      details: value,
    };
  });
}

function neutralizeDashboardSignals(signals: DashboardSignal[]): DashboardSignal[] {
  return signals.map((signal) => ({
    ...signal,
    value: EMPTY_FIELD_VALUE,
    rawValue: EMPTY_FIELD_VALUE,
    tone: 'neutral',
    details: EMPTY_FIELD_VALUE,
  }));
}

const COMPANY_PROFILES: Record<string, { company: string; sector: string }> = {
  AAPL: { company: 'Apple Inc.', sector: 'Technology' },
  AMD: { company: 'Advanced Micro Devices, Inc.', sector: 'Technology' },
  APP: { company: 'AppLovin Corporation', sector: 'Technology' },
  MSFT: { company: 'Microsoft Corporation', sector: 'Technology' },
  NFLX: { company: 'Netflix Inc.', sector: 'Communication Services' },
  NVDA: { company: 'NVIDIA Corporation', sector: 'Technology' },
  ORCL: { company: 'Oracle Corporation', sector: 'Technology' },
  TSLA: { company: 'Tesla, Inc.', sector: 'Consumer Cyclical' },
};

function resolveCompanyProfile(ticker: string, rawCompany?: string): { company: string; sector: string } {
  const normalizedTicker = normalizeTickerQuery(ticker);
  const knownProfile = COMPANY_PROFILES[normalizedTicker];
  const cleanedCompany = String(rawCompany || '')
    .replace(new RegExp(`\\s*[（(]${normalizedTicker}[）)]\\s*$`, 'i'), '')
    .trim();

  if (knownProfile) {
    return knownProfile;
  }

  return {
    company: cleanedCompany && cleanedCompany.toUpperCase() !== normalizedTicker ? cleanedCompany : normalizedTicker || EMPTY_FIELD_VALUE,
    sector: 'Unclassified',
  };
}

function isGenericInsightText(value?: string): boolean {
  return /综合建议|结合技术|基本面与情绪|继续跟踪|多维数据|综合评估|建议关注/i.test(String(value || ''));
}

function buildTechnicalInsightFallback(
  locale: DashboardLocale,
  tone: SignalTone,
  technicalFields?: StandardReportField[],
): string {
  const fieldText = (technicalFields || [])
    .map((field) => `${field.label} ${field.value}`)
    .join(' ');
  const hasOverbought = /rsi\s*:?\s*(6[8-9]|[7-9]\d)|RSI[^\d]*(6[8-9]|[7-9]\d)|超买/i.test(fieldText);
  const hasBullishMa = /多头|MA5|MA10|MA20|MA60|above|lifting|bull/i.test(fieldText);
  const hasBearishMa = /下压|跌破|below|bear|weak/i.test(fieldText);

  if (locale === 'en') {
    if (tone === 'bearish' || hasBearishMa) {
      return 'Trend tape is losing sponsorship: moving-average pressure remains overhead, downside confirmation is not fully priced, and risk should be cut before adding exposure.';
    }
    if (tone === 'bullish' || hasBullishMa) {
      return hasOverbought
        ? 'The tape remains in bullish moving-average alignment with acceptable volume confirmation, but RSI is stretched into an overbought band, so near-term strength should be trimmed rather than chased.'
        : 'The tape is holding bullish moving-average alignment with improving momentum confirmation; pullbacks into the short-term support cluster remain the cleaner execution window.';
    }
    return 'The setup is still a repair trade: short-term averages are stabilizing, but momentum confirmation is incomplete, so wait for a second volume expansion before increasing risk.';
  }

  if (tone === 'bearish' || hasBearishMa) {
    return '技术面仍受均线压制，空头动能尚未完全释放，量价结构没有给出有效反包信号，短线应先降风险而不是补仓。';
  }
  if (tone === 'bullish' || hasBullishMa) {
    return hasOverbought
      ? '技术面呈现均线多头排列，量价配合理想，但 RSI 已进入超买区，短线更适合逢高减仓而不是追价。'
      : '技术面维持均线多头排列，动能确认仍在，回踩短期支撑簇时更适合分批试仓，放量跌破则立即收缩风险。';
  }
  return '技术面处于均线修复段，短线动能尚未完全失效，但量价确认不足，当前以等待二次放量和支撑回踩确认为主。';
}

function resolveInsightBody(
  locale: DashboardLocale,
  tone: SignalTone,
  candidates: Array<string | undefined>,
  technicalFields?: StandardReportField[],
): string {
  const primary = candidates.map((value) => String(value || '').trim()).find(Boolean);
  if (!primary || primary === EMPTY_FIELD_VALUE || isGenericInsightText(primary)) {
    return buildTechnicalInsightFallback(locale, tone, technicalFields);
  }
  return primary;
}

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
    sector?: string;
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
      reasonTitle: '最近报告归因',
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
      reasonTitle: 'Latest Report Context',
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

type DashboardPayload = (typeof CONTENT)['zh'];
type DashboardVariant = DashboardPayload;

const DASHBOARD_VARIANTS: Record<DashboardLocale, Record<string, DashboardVariant>> = {
  zh: {
    NVDA: {
      ...CONTENT.zh,
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
    },
  },
  en: {
    NVDA: {
      ...CONTENT.en,
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

function formatHistoryTimestamp(value?: string, locale: DashboardLocale = 'zh'): string {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return text;
  }

  const parts = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`;
}

function resolveHistoryGeneratedAt(historyItem: HistoryItem, locale: DashboardLocale): string {
  return formatHistoryTimestamp(historyItem.generatedAt || historyItem.createdAt, locale);
}

function resolveHistoryCompanyLabel(historyItem: HistoryItem): string {
  const ticker = normalizeTickerQuery(historyItem.stockCode);
  const companyName = String(historyItem.companyName || historyItem.stockName || '').trim();
  if (!companyName || companyName.toUpperCase() === ticker) {
    return ticker;
  }
  return `${companyName} (${ticker})`;
}

function buildInPlacePlaceholderDashboard(
  locale: DashboardLocale,
  ticker?: string | null,
): DashboardPayload {
  const normalizedTicker = normalizeTickerQuery(ticker ?? undefined) || EMPTY_FIELD_VALUE;
  const base = DASHBOARD_VARIANTS[locale].NVDA;
  const companyProfile = resolveCompanyProfile(normalizedTicker);
  const neutralStrategyMetrics = neutralizeDashboardFields(base.strategy.metrics);
  const neutralTechSignals = neutralizeDashboardSignals(base.tech.signals);
  const neutralFundamentals = neutralizeDashboardFields(base.fundamentals.metrics);

  return enrichDashboardPayload(locale, {
    ...base,
    instrument: normalizedTicker,
    ticker: normalizedTicker,
    decision: {
      ...base.decision,
      company: companyProfile.company,
      sector: companyProfile.sector,
      heroValue: EMPTY_FIELD_VALUE,
      heroUnit: '',
      heroLabel: locale === 'en' ? 'Status' : '当前状态',
      signalLabel: EMPTY_FIELD_VALUE,
      signalTone: 'neutral',
      scoreLabel: locale === 'en' ? 'Signal Direction' : '信号方向',
      scoreValue: EMPTY_FIELD_VALUE,
      badge: EMPTY_FIELD_VALUE,
      chartLabel: EMPTY_FIELD_VALUE,
      summary: EMPTY_FIELD_VALUE,
      reasonBody: EMPTY_FIELD_VALUE,
    },
    strategy: {
      ...base.strategy,
      metrics: neutralStrategyMetrics,
      positionBody: EMPTY_FIELD_VALUE,
    },
    tech: {
      ...base.tech,
      signals: neutralTechSignals,
    },
    fundamentals: {
      ...base.fundamentals,
      metrics: neutralFundamentals,
    },
  });
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

const REPORT_LABEL_EN_BY_KEY: Record<string, string> = {
  entryzone: 'Entry Zone',
  forwardpe一致预期: 'Forward PE (Consensus)',
  freecashflow: 'Free Cash Flow',
  grossmargin: 'Gross Margin',
  institutionalownership: 'Institutional Ownership',
  ma10: 'MA10',
  ma20: 'MA20',
  ma5: 'MA5',
  ma60: 'MA60',
  macd: 'MACD',
  movingaverages: 'Moving Averages',
  pe: 'PE',
  pe一致预期: 'Forward PE (Consensus)',
  pettm: 'PE (TTM)',
  positionrhythm: 'Position Rhythm',
  revenuegrowth: 'Revenue Growth',
  roe: 'ROE',
  rsi14: 'RSI14',
  stop: 'Stop',
  target: 'Target',
  volumeprofile: 'Volume Profile',
  均线结构: 'Moving Averages',
  回踩支撑确认: 'Pullback support confirmed',
  建仓区间: 'Entry Zone',
  总股本最新值: 'Shares Outstanding (Latest)',
  总市值最新值: 'Market Cap (Latest)',
  技术失效位: 'Technical invalidation',
  收入增速: 'Revenue Growth',
  机构持仓: 'Institutional Ownership',
  止损位: 'Stop',
  毛利率: 'Gross Margin',
  流通市值最新值: 'Free-Float Cap (Latest)',
  流通股最新值: 'Free-Float Shares (Latest)',
  波动率: 'Volatility',
  目标位: 'Target',
  目标区间: 'Target zone',
  量价配合: 'Volume Profile',
  预期市盈率一致预期: 'Forward PE (Consensus)',
  市盈率ttm: 'PE (TTM)',
  自由现金流: 'Free Cash Flow',
  财报驱动后维持上沿强势: 'Post-earnings strength still holds the upper rail',
};

const REPORT_TEXT_EN_BY_KEY: Record<string, string> = {
  中性偏多: 'Neutral to bullish',
  乐观: 'Bullish',
  偏多: 'Constructive',
  回踩支撑确认: 'Pullback support confirmed',
  字段待接入: 'field pending',
  技术失效位: 'Technical invalidation',
  持有: 'Hold',
  技术面与基本面相互印证综合建议以持有为主: 'Technical and fundamental signals align, so the composite stance remains Hold.',
  持有技术结构价格仍位于ma20上方防守位在17548近期支撑ma簇一带若回踩企稳趋势延续概率更高方向偏多置信度中: 'Hold · Structure still sits above MA20, with defense near 175.48 (recent support / MA cluster). Trend continuation improves if the pullback stabilizes, and the directional bias remains constructive with medium conviction.',
  理想做法是回踩支撑簇小仓试错若站回ma5ma10再做第二笔: 'Start with probe size on a pullback into the support cluster, then add only if price reclaims MA5 and MA10.',
  短线技术偏强均线结构偏强价格位于ma20上方价格位于ma60上方: 'Short-term technical posture remains constructive, with price holding above both MA20 and MA60.',
  目标区间: 'Target zone',
  近期支撑ma簇: 'recent support / MA cluster',
};

function convertChineseUnits(value: string): string {
  return value
    .replace(/(\d+(?:\.\d+)?)亿/g, (_, amount: string) => `${(Number(amount) / 10).toFixed(Number(amount) >= 100 ? 2 : 1).replace(/\.0$/, '')}B`)
    .replace(/(\d+(?:\.\d+)?)万/g, (_, amount: string) => `${(Number(amount) / 100).toFixed(Number(amount) >= 1000 ? 1 : 2).replace(/\.0$/, '')}M`);
}

function replaceEnglishFragments(raw: string): string {
  return raw
    .replace(/分析过程出错[:：]\s*/g, 'Analysis process hit an error: ')
    .replace(/NA[（(]字段待接入[）)]/g, 'N/A (field pending)')
    .replace(/[（(]回踩支撑确认[）)]/g, ' (Pullback support confirmed)')
    .replace(/[（(]目标区间[）)]/g, ' (Target zone)')
    .replace(/[（(]技术失效位[）)]/g, ' (Technical invalidation)');
}

function localizeSentimentLabel(locale: DashboardLocale, raw: string | undefined, fallback: string): string {
  const value = String(raw || '').trim();
  if (!value) {
    return fallback;
  }
  if (locale === 'zh') {
    return value;
  }
  return REPORT_TEXT_EN_BY_KEY[normalizeDetailKey(value)] || (containsCjk(value) ? fallback : value);
}

function localizeFieldLabel(locale: DashboardLocale, raw: string | undefined, fallback: string): string {
  const value = String(raw || '').trim();
  if (!value) {
    return fallback;
  }
  if (locale === 'zh') {
    return value;
  }
  return REPORT_LABEL_EN_BY_KEY[normalizeDetailKey(value)] || (containsCjk(value) ? fallback : value);
}

function localizeMetricValue(locale: DashboardLocale, raw: string | undefined, fallback: string): string {
  const value = sanitizeMetricValue(raw);
  if (!value) {
    return fallback;
  }
  if (value === '-') {
    return '-';
  }
  if (locale === 'zh') {
    return value;
  }
  const exact = REPORT_TEXT_EN_BY_KEY[normalizeDetailKey(value)];
  if (exact) {
    return exact;
  }
  const localized = convertChineseUnits(replaceEnglishFragments(value)).replace(/\s+/g, ' ').trim();
  if (!containsCjk(localized)) {
    return localized;
  }
  return fallback;
}

function buildTechSignalHeadline(locale: DashboardLocale, ticker: string, label: string, value: string): string {
  const key = normalizeDetailKey(label);
  const raw = sanitizeMetricValue(value);
  const isEnglish = locale === 'en';

  if (raw === EMPTY_FIELD_VALUE) {
    return EMPTY_FIELD_VALUE;
  }

  if (key === 'macd') {
    if (/below zero|零轴下方|收敛|compression/i.test(raw)) {
      return isEnglish ? 'Momentum is compressing below zero, so the bounce still needs proof' : '零轴下方动能收敛，反弹仍待确认';
    }
    if (/second expansion|二次扩张/i.test(raw)) {
      return isEnglish ? 'Momentum is expanding again above zero, keeping buyers in control' : '零轴上方二次扩张，动能继续偏强';
    }
    return isEnglish ? 'The bullish MACD posture still supports trend continuation' : 'MACD 仍偏多头结构，趋势延续占优';
  }

  if (key === 'ma5') {
    return isEnglish ? 'Short-term momentum is riding the five-day line higher' : '短线动能充沛，价格沿五日线攀升';
  }

  if (key === 'ma10') {
    return isEnglish ? 'The ten-day trend line is holding, so pullbacks still screen as entryable' : '趋势支撑确认，回踩不破可视作介入点';
  }

  if (key === 'ma20') {
    if (/pressing lower|下压|压制/i.test(raw) || (ticker === 'TSLA' && /ma20/i.test(raw))) {
      return isEnglish ? 'MA20 is still capping price, so the repair phase is not finished' : 'MA20 仍在压制价格，趋势修复尚未完成';
    }
    return isEnglish ? 'MA20 is propping up MA60, keeping the medium-term bull stack intact' : 'MA20 托举 MA60，中期多头排列延续';
  }

  if (key === 'ma60') {
    return isEnglish ? 'The long-term bull-bear divider is still rising, so the core base remains intact' : '长线牛熊分界稳步上移，中线底仓逻辑未坏';
  }

  if (key === '均线结构' || key === 'movingaverages' || key === 'ma20ma60') {
    if (/pressing lower|下压|压制/i.test(raw) || (ticker === 'TSLA' && /ma20/i.test(raw))) {
      return isEnglish ? 'MA20 is still capping price, so the repair phase is not finished' : 'MA20 仍在压制价格，趋势修复尚未完成';
    }
    return isEnglish ? 'MA20 keeps lifting MA60, so the trend stack stays constructive' : 'MA20 托举 MA60，多头排列延续';
  }

  if (key === '量价配合' || key === 'volumeprofile') {
    if (/follow-through pending|续航待定/i.test(raw)) {
      return isEnglish ? 'The first bounce had volume, but follow-through still needs confirmation' : '首波反弹已有量能，但续航还需二次确认';
    }
    return isEnglish ? 'Pullback volume stayed calm and the breakout re-expanded cleanly' : '回踩缩量、突破放量，趋势承接仍然健康';
  }

  if (key === 'rsi' || key === 'rsi14') {
    const numeric = Number.parseFloat(raw);
    if (Number.isFinite(numeric) && numeric >= 70) {
      return isEnglish ? 'RSI is hot enough to watch for short-term exhaustion' : 'RSI 已接近过热区，短线需防透支';
    }
    if (Number.isFinite(numeric) && numeric >= 55) {
      return isEnglish ? 'RSI is firm but not overbought, leaving room for continuation' : 'RSI 强势但未过热，趋势仍有延续空间';
    }
    return isEnglish ? 'RSI has only partially repaired, so conviction still needs confirmation' : 'RSI 修复有限，信号强度仍待确认';
  }

  if (key === '波动率' || key === 'volatility') {
    const numeric = Number.parseFloat(raw.replace('%', ''));
    if (Number.isFinite(numeric) && numeric >= 4) {
      return isEnglish ? 'Volatility remains elevated, so sizing should stay conservative' : '波动率仍然偏高，仓位节奏需要收敛';
    }
    return isEnglish ? 'Volatility remains controlled enough for staggered execution' : '波动率可控，适合按节奏分批执行';
  }

  return raw;
}

function buildFundamentalMetricHeadline(locale: DashboardLocale, label: string, value: string): string {
  const key = normalizeDetailKey(label);
  if (String(value || '').trim().toUpperCase() === 'N/A') {
    return 'N/A';
  }
  const raw = sanitizeMetricValue(value);
  const isEnglish = locale === 'en';

  if (raw === '-' || raw === 'N/A') {
    return raw;
  }

  if (key === '收入增速' || key === 'revenuegrowth') {
    const numeric = Number.parseFloat(raw.replace('%', '').replace('+', ''));
    if (Number.isFinite(numeric) && numeric >= 6) {
      return isEnglish ? 'Revenue is still expanding, so the demand spine remains intact' : '营收仍在稳步扩张，需求主线未坏';
    }
    return isEnglish ? 'Growth has slowed, so the next leg needs a fresh catalyst' : '营收增速放缓，期待新驱动接力';
  }

  if (key === '自由现金流' || key === 'freecashflow') {
    return isEnglish ? 'Free cash flow still cushions volatility and funding pressure' : '自由现金流充裕，波动缓冲仍在';
  }

  if (key === '毛利率' || key === 'grossmargin') {
    const numeric = Number.parseFloat(raw.replace('%', ''));
    if (Number.isFinite(numeric) && numeric >= 40) {
      return isEnglish ? 'Margins are still rich enough to defend pricing power' : '毛利率保持高位，定价权仍然稳固';
    }
    return isEnglish ? 'Margins stay under pressure, so earnings quality still needs repair' : '毛利率承压，盈利质量仍待修复';
  }

  if (key === 'roe') {
    const numeric = Number.parseFloat(raw.replace('%', ''));
    if (Number.isFinite(numeric) && numeric >= 25) {
      return isEnglish ? 'Capital returns remain strong, which supports operating quality' : '资本回报效率强，经营质量仍有支撑';
    }
    return isEnglish ? 'Returns remain healthy, but not yet at a standout level' : '资本回报仍属健康，但尚非极致强势';
  }

  if (key === '市盈率ttm' || key === '市盈率pe' || key === 'pe' || key === 'pettm') {
    return isEnglish ? 'Valuation still sits in a growth-premium zone' : '估值仍在成长溢价区，需业绩继续兑现';
  }

  if (key === '预期市盈率一致预期' || key === 'pe一致预期' || key === 'forwardpe一致预期') {
    return isEnglish ? 'Forward valuation is calmer than spot, but growth expectations stay high' : '远期估值较现值更温和，但成长预期仍高';
  }

  if (key === '机构持仓' || key === 'institutionalownership') {
    return isEnglish ? 'Institutional sponsorship still looks sticky and orderly' : '机构筹码相对稳定，抛压风险可控';
  }

  if (key === '总市值最新值' || key === 'marketcaplatest') {
    return isEnglish ? 'Market-cap liquidity still provides deep sponsorship' : '总市值体量充足，流动性承接仍强';
  }

  if (key === '流通市值最新值' || key === 'freefloatcaplatest') {
    return isEnglish ? 'Free-float liquidity remains usable for institutional participation' : '流通市值承接尚可，交易流动性仍在线';
  }

  if (key === '总股本最新值' || key === 'sharesoutstandinglatest') {
    return isEnglish ? 'Share count looks stable, so dilution pressure is contained' : '总股本规模稳定，摊薄压力相对可控';
  }

  if (key === '流通股最新值' || key === 'freefloatshareslatest') {
    return isEnglish ? 'Float size remains adequate for orderly turnover' : '流通盘规模适中，换手承接相对平衡';
  }

  return raw;
}

function localizeNarrativeText(locale: DashboardLocale, raw: string | undefined, fallback: string): string {
  const value = String(raw || '').trim();
  if (!value) {
    return fallback;
  }
  if (/all llm models failed|ratelimiterror|分析过程出错/i.test(value)) {
    return fallback;
  }
  if (locale === 'zh') {
    return value;
  }
  const exact = REPORT_TEXT_EN_BY_KEY[normalizeDetailKey(value)];
  if (exact) {
    return exact;
  }
  const localized = convertChineseUnits(replaceEnglishFragments(value)).replace(/\s+/g, ' ').trim();
  if (!containsCjk(localized)) {
    return localized;
  }
  return fallback;
}

function mapStandardFields(
  locale: DashboardLocale,
  fields: StandardReportField[] | undefined,
  fallback: DashboardField[],
  count: number,
) : DashboardField[] {
  const visibleFields = (fields || []).filter((field) => field.label).slice(0, count);

  return Array.from({ length: count }, (_, index) => {
    const field = visibleFields[index];
    const fallbackField = field
      ? fallback.find((item) => normalizeDetailKey(item.label) === normalizeDetailKey(field.label)) || fallback[index]
      : fallback[index];
    const neutralFallback = fallbackField || {
      label: field?.label || EMPTY_FIELD_VALUE,
      value: EMPTY_FIELD_VALUE,
      rawValue: EMPTY_FIELD_VALUE,
      tone: 'neutral' as const,
      details: EMPTY_FIELD_VALUE,
    };

    if (!field) {
      return neutralFallback;
    }

    const localizedValue = localizeMetricValue(locale, field.value, neutralFallback.value || EMPTY_FIELD_VALUE);
    const isEmpty = isPendingMetricValue(localizedValue);
    return {
      label: localizeFieldLabel(locale, field.label, neutralFallback.label || field.label),
      value: localizedValue,
      rawValue: localizedValue,
      tone: isEmpty ? 'neutral' : toneFromFieldValue(field.value || localizedValue),
      details: isEmpty ? neutralFallback.details : undefined,
    };
  });
}

function buildTechSignalDetails(locale: DashboardLocale, ticker: string, label: string, value: string): string {
  const key = normalizeDetailKey(label);
  const rawValue = sanitizeMetricValue(value);
  const isEnglish = locale === 'en';

  if (rawValue === '-' || rawValue === 'N/A') {
    return rawValue;
  }

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
      ? `RSI is at ${rawValue}, which is firm but not yet an exhaustion print. It supports continuation as long as price does not diverge against new highs.`
      : `RSI 处在 ${rawValue}，强势但还没到典型透支区；只要价格创新高时不出现背离，趋势延续概率仍占优。`;
  }

  if (key === '波动率' || key === 'volatility') {
    return isEnglish
      ? `Realized volatility is ${rawValue}; position sizing should stay tied to wider risk bands instead of headline-driven chasing.`
      : `实现波动率约为 ${rawValue}，仓位和止损都要按更宽的风险带来做，不能用追涨方式处理。`;
  }

  return isEnglish
    ? `${label} is currently reading ${rawValue}, and the drill-down should stay anchored to that live signal instead of a separate narrative block.`
    : `${label} 当前读数为 ${rawValue}，下钻说明应继续围绕这个实时信号展开，而不是脱离主卡片另写一套叙事。`;
}

function buildFundamentalMetricDetails(locale: DashboardLocale, ticker: string, label: string, value: string): string {
  const key = normalizeDetailKey(label);
  if (String(value || '').trim().toUpperCase() === 'N/A') {
    return 'N/A';
  }
  const rawValue = sanitizeMetricValue(value);
  const isEnglish = locale === 'en';

  if (rawValue === '-') {
    return '-';
  }

  if (key === '收入增速' || key === 'revenuegrowth') {
    if (ticker === 'TSLA') {
      return isEnglish
        ? 'Auto delivery growth is slowing and that is capping the top-line pace, while the higher-margin energy storage line is carrying a larger share of the earnings support.'
        : '汽车交付量放缓拖累整体营收增速，但储能业务的高毛利贡献正在抬升，对冲了汽车主业的增速压力。';
    }
    return isEnglish
      ? `Revenue growth is running at ${rawValue}, which still supports the current thesis as long as demand conversion remains ahead of cost pressure.`
      : `收入增速为 ${rawValue}，只要需求兑现继续快于成本压力，这个读数就仍然支撑当前主线判断。`;
  }

  if (key === '自由现金流' || key === 'freecashflow') {
    return isEnglish
      ? `Free cash flow at ${rawValue} keeps financing pressure contained and gives the company room to absorb volatility without breaking the medium-term thesis.`
      : `自由现金流达到 ${rawValue}，说明公司仍有能力承受阶段波动，不至于因为融资压力打断中期逻辑。`;
  }

  if (key === '毛利率' || key === 'grossmargin') {
    return isEnglish
      ? `Gross margin at ${rawValue} is the cleanest read on pricing power versus cost pressure, so this line is critical for validating whether the earnings base is expanding or compressing.`
      : `毛利率为 ${rawValue}，这是检验定价权和成本压力最直接的指标，决定利润底盘是在扩张还是收缩。`;
  }

  if (key === 'roe') {
    return isEnglish
      ? `ROE at ${rawValue} measures how efficiently equity is being converted into earnings, which matters for judging whether the current valuation premium has operating support.`
      : `ROE 为 ${rawValue}，反映股东权益转化为利润的效率，用来判断当前估值溢价是否有经营效率支撑。`;
  }

  if (key === '市盈率pe' || key === 'pe') {
    return isEnglish
      ? `A PE of ${rawValue} means the market is still paying for forward growth; unless growth durability improves, the rerating room stays bounded.`
      : `市盈率约为 ${rawValue}，说明市场仍在为未来成长付费；如果增长持续性没有继续抬升，估值扩张空间会受到约束。`;
  }

  if (key === '机构持仓' || key === 'institutionalownership') {
    return isEnglish
      ? `Institutional ownership at ${rawValue} helps gauge sponsorship stability; higher stickiness usually lowers the probability of purely retail-driven air pockets.`
      : `机构持仓约为 ${rawValue}，用来判断筹码稳定性；机构黏性越高，纯情绪性踩踏的概率通常越低。`;
  }

  return isEnglish
    ? `${label} is currently ${rawValue}, and the supporting note should remain attached to that same fundamental observation.`
    : `${label} 当前为 ${rawValue}，支撑说明需要继续绑定在这条基本面观测本身。`;
}

function buildStrategyMetricDetails(locale: DashboardLocale, label: string, value: string): string {
  const key = normalizeDetailKey(label);
  const rawValue = sanitizeMetricValue(value);
  const isEnglish = locale === 'en';

  if (rawValue === EMPTY_FIELD_VALUE) {
    return EMPTY_FIELD_VALUE;
  }

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

function enrichDashboardPayload(locale: DashboardLocale, payload: DashboardVariant | DashboardPayload): DashboardPayload {
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
        rawValue: signal.rawValue || signal.value,
        value: buildTechSignalHeadline(locale, payload.ticker, signal.label, signal.rawValue || signal.value),
        details: signal.details || buildTechSignalDetails(locale, payload.ticker, signal.label, signal.rawValue || signal.value),
      })),
    },
    fundamentals: {
      ...payload.fundamentals,
      metrics: payload.fundamentals.metrics.map((metric) => ({
        ...metric,
        rawValue: metric.rawValue || metric.value,
        value: buildFundamentalMetricHeadline(locale, metric.label, metric.rawValue || metric.value),
        details: metric.details || buildFundamentalMetricDetails(locale, payload.ticker, metric.label, metric.rawValue || metric.value),
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
  if (hasUntrustedReportMarker(report)) {
    return buildInPlacePlaceholderDashboard(locale, stockCode);
  }

  const seed = buildInPlacePlaceholderDashboard(locale, stockCode);
  const neutralTechSignals = neutralizeDashboardSignals(seed.tech.signals);
  const neutralFundamentals = neutralizeDashboardFields(seed.fundamentals.metrics);
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
    : EMPTY_FIELD_VALUE;
  const reasonBody = resolveInsightBody(
    locale,
    sentimentTone,
    [
      reasonLayer?.coreReasons?.[0],
      reasonLayer?.topCatalyst,
      reasonLayer?.latestKeyUpdate,
      summaryPanel?.oneSentence,
      report.summary.analysisSummary,
    ],
    technicalFields,
  );
  const badge = [
    summaryPanel?.operationAdvice,
    reasonLayer?.topCatalyst,
    reasonLayer?.newsValueTier,
  ].filter(Boolean).slice(0, 2).join(' · ') || EMPTY_FIELD_VALUE;
  const rawCompany = report.meta.companyName || report.meta.stockName || summaryPanel?.stock || stockCode;
  const companyProfile = resolveCompanyProfile(stockCode, rawCompany);
  const rawSignalLabel = report.summary.sentimentLabel || EMPTY_FIELD_VALUE;
  const rawScoreValue = decisionContext?.shortTermView || report.summary.trendPrediction || report.summary.operationAdvice || EMPTY_FIELD_VALUE;
  const rawSummary = summaryPanel?.oneSentence || report.summary.analysisSummary || EMPTY_FIELD_VALUE;
  const entryValue = decisionPanel?.idealEntry || decisionPanel?.support || report.strategy?.idealBuy || EMPTY_FIELD_VALUE;
  const targetValue = decisionPanel?.target || decisionPanel?.targetZone || report.strategy?.takeProfit || EMPTY_FIELD_VALUE;
  const stopValue = decisionPanel?.stopLoss || report.strategy?.stopLoss || EMPTY_FIELD_VALUE;
  const positionBody = decisionPanel?.buildStrategy
    || decisionPanel?.holderAdvice
    || decisionPanel?.noPositionAdvice
    || report.summary.operationAdvice
    || EMPTY_FIELD_VALUE;
  const localizedEntryValue = localizeMetricValue(locale, entryValue, EMPTY_FIELD_VALUE);
  const localizedTargetValue = localizeMetricValue(locale, targetValue, EMPTY_FIELD_VALUE);
  const localizedStopValue = localizeMetricValue(locale, stopValue, EMPTY_FIELD_VALUE);

  return enrichDashboardPayload(locale, {
    ...seed,
    ticker: stockCode,
    decision: {
      ...seed.decision,
      company: companyProfile.company,
      sector: companyProfile.sector,
      heroValue: scoreText,
      signalLabel: localizeSentimentLabel(locale, rawSignalLabel, EMPTY_FIELD_VALUE),
      signalTone: sentimentTone,
      scoreValue: localizeNarrativeText(locale, rawScoreValue, EMPTY_FIELD_VALUE),
      badge: localizeNarrativeText(locale, badge, EMPTY_FIELD_VALUE),
      summary: localizeNarrativeText(locale, rawSummary, EMPTY_FIELD_VALUE),
      reasonTitle: locale === 'en' ? 'Latest Report Context' : '最近报告归因',
      reasonBody: localizeNarrativeText(locale, reasonBody, EMPTY_FIELD_VALUE),
    },
    strategy: {
      ...seed.strategy,
      metrics: [
        {
          label: locale === 'en' ? 'Entry Zone' : '建仓区间',
          value: localizedEntryValue,
          tone: 'neutral',
        },
        {
          label: locale === 'en' ? 'Target' : '目标位',
          value: localizedTargetValue,
          tone: isPendingMetricValue(localizedTargetValue) ? 'neutral' : 'bullish',
        },
        {
          label: locale === 'en' ? 'Stop' : '止损位',
          value: localizedStopValue,
          tone: isPendingMetricValue(localizedStopValue) ? 'neutral' : 'bearish',
        },
      ],
      positionBody: localizeNarrativeText(locale, positionBody, EMPTY_FIELD_VALUE),
    },
    tech: {
      ...seed.tech,
      signals: mapStandardFields(locale, technicalFields, neutralTechSignals, 5).map((item) => ({ ...item, tone: item.tone || 'neutral' })),
    },
    fundamentals: {
      ...seed.fundamentals,
      metrics: mapStandardFields(locale, fundamentalFields, neutralFundamentals, 6),
    },
  });
}

const SKELETON_CARD_CLASS = 'animate-pulse border-indigo-500/20 bg-white/[0.05] shadow-[0_0_42px_rgba(79,70,229,0.10)]';
const SKELETON_LINE_CLASS = 'rounded-full bg-white/[0.08] shadow-[0_0_24px_rgba(99,102,241,0.12)]';

function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`${SKELETON_LINE_CLASS} ${className}`} />;
}

function InPlaceDecisionSkeleton({ locale, ticker }: { locale: DashboardLocale; ticker: string }) {
  return (
    <BentoCard
      eyebrow={locale === 'en' ? 'WOLFY AI Decision' : 'WOLFY AI 决断'}
      className={`h-full w-full rounded-[24px] ${SKELETON_CARD_CLASS}`}
      testId="home-bento-card-decision"
    >
      <div className="flex h-full min-h-[420px] flex-col gap-5" data-testid="home-bento-inplace-loading-decision">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <SkeletonLine className="h-5 w-36" />
            <SkeletonLine className="mt-3 h-3 w-20" />
          </div>
          <span className="font-mono text-xs uppercase tracking-[0.22em] text-indigo-100/52">{ticker}</span>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-[28px] border border-indigo-400/10 bg-black/10 px-5 py-10">
          <img
            src="/wolfystock-logo-mark.png"
            alt="WolfyStock analyzing"
            className="h-9 w-9 rounded-full object-contain shadow-[0_0_15px_rgba(79,70,229,0.3)] animate-spin"
          />
          <p className="text-center text-xs font-semibold uppercase tracking-[0.22em] text-indigo-100/70">
            {locale === 'en' ? 'Wolfy AI reasoning...' : 'Wolfy AI 引擎推理中...'}
          </p>
        </div>

        <div className="grid gap-3 rounded-[28px] border border-white/[0.06] bg-black/10 p-4">
          <SkeletonLine className="h-3 w-24" />
          <SkeletonLine className="h-3 w-full" />
          <SkeletonLine className="h-3 w-5/6" />
          <SkeletonLine className="h-3 w-2/3" />
        </div>
      </div>
    </BentoCard>
  );
}

function InPlaceStrategySkeleton({ locale }: { locale: DashboardLocale }) {
  return (
    <BentoCard
      eyebrow={locale === 'en' ? 'Execution Strategy' : '执行策略'}
      className={`w-full rounded-[24px] ${SKELETON_CARD_CLASS}`}
      testId="home-bento-card-strategy"
    >
      <div className="grid h-full gap-6 md:grid-cols-2" data-testid="home-bento-inplace-loading-strategy">
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <SkeletonLine className="col-span-2 h-12" />
          <SkeletonLine className="h-12" />
          <SkeletonLine className="h-12" />
          <SkeletonLine className="h-12" />
          <SkeletonLine className="h-12" />
        </div>
        <div className="border-t border-white/[0.08] pt-5 md:border-l md:border-t-0 md:pl-6 md:pt-0">
          <SkeletonLine className="h-3 w-24" />
          <div className="mt-4 space-y-3">
            <SkeletonLine className="h-3 w-full" />
            <SkeletonLine className="h-3 w-11/12" />
            <SkeletonLine className="h-3 w-4/5" />
          </div>
        </div>
      </div>
    </BentoCard>
  );
}

function InPlaceListSkeleton({
  locale,
  kind,
}: {
  locale: DashboardLocale;
  kind: 'tech' | 'fundamentals';
}) {
  const title = kind === 'tech'
    ? (locale === 'en' ? 'Technical Structure' : '技术结构')
    : (locale === 'en' ? 'Fundamental Profile' : '基本面画像');

  return (
    <BentoCard
      eyebrow={title}
      className={`h-full w-full rounded-[24px] ${SKELETON_CARD_CLASS}`}
      testId={kind === 'tech' ? 'home-bento-card-tech' : 'home-bento-card-fundamentals'}
    >
      <div
        className={kind === 'tech' ? 'space-y-5' : 'grid grid-cols-2 gap-x-6 gap-y-5'}
        data-testid={`home-bento-inplace-loading-${kind}`}
      >
        {Array.from({ length: kind === 'tech' ? 4 : 6 }).map((_, index) => (
          <div
            key={`${kind}-skeleton-${index}`}
            className={kind === 'tech' ? 'grid gap-3 border-b border-white/[0.07] pb-5 last:border-b-0 last:pb-0' : 'min-w-0'}
          >
            <SkeletonLine className="h-3 w-20" />
            <SkeletonLine className="mt-2 h-5 w-full" />
          </div>
        ))}
      </div>
    </BentoCard>
  );
}

const HomeBentoDashboardPage: React.FC = () => {
  const { isReady: isSafariReady, surfaceRef } = useSafariRenderReady();
  const shouldGuardA11y = shouldApplySafariA11yGuard();
  const { language, t } = useI18n();
  const locale: DashboardLocale = language === 'en' ? 'en' : 'zh';
  const [activeDrawer, setActiveDrawer] = useState<DetailDrawerKey | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTicker, setActiveTicker] = useState<string | null>(null);
  const [pendingAnalysisTicker, setPendingAnalysisTicker] = useState<string | null>(null);
  const [hasHydratedInitialTicker, setHasHydratedInitialTicker] = useState(false);
  const [isDashboardLoading, setDashboardLoading] = useState(false);
  const [statusToast, setStatusToast] = useState<{ message: string; tone: 'error' | 'warning' } | null>(null);
  const [pendingHistoryDelete, setPendingHistoryDelete] = useState<PendingHistoryDelete | null>(null);
  const isAnalyzing = useStockPoolStore((state) => state.isAnalyzing);
  const historyItems = useStockPoolStore((state) => state.historyItems);
  const selectedReport = useStockPoolStore((state) => state.selectedReport);
  const [isHistoryDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const refreshHistory = useStockPoolStore((state) => state.refreshHistory);
  const focusLatestHistoryForStock = useStockPoolStore((state) => state.focusLatestHistoryForStock);
  const selectHistoryItem = useStockPoolStore((state) => state.selectHistoryItem);
  const selectCachedHistoryForStock = useStockPoolStore((state) => state.selectCachedHistoryForStock);
  const deleteHistoryRecords = useStockPoolStore((state) => state.deleteHistoryRecords);
  const isDeletingHistory = useStockPoolStore((state) => state.isDeletingHistory);
  const submitAnalysis = useStockPoolStore((state) => state.submitAnalysis);
  const clearError = useStockPoolStore((state) => state.clearError);
  const loadInitialHistory = useStockPoolStore((state) => state.loadInitialHistory);
  const hydrateRecentTasks = useStockPoolStore((state) => state.hydrateRecentTasks);
  const activeTasks = useStockPoolStore((state) => state.activeTasks);
  const syncTaskCreated = useStockPoolStore((state) => state.syncTaskCreated);
  const syncTaskUpdated = useStockPoolStore((state) => state.syncTaskUpdated);
  const syncTaskFailed = useStockPoolStore((state) => state.syncTaskFailed);
  const refreshTaskProgress = useStockPoolStore((state) => state.refreshTaskProgress);
  const openHistoryDrawerButton = useSafariWarmActivation<HTMLButtonElement>(() => setHistoryDrawerOpen(true));
  const recentHistoryItems = useMemo(
    () => historyItems.filter((item) => !item.isTest).slice(0, 8),
    [historyItems],
  );
  const hasRunningTasks = useMemo(
    () => activeTasks.some((task) => task.status === 'pending' || task.status === 'processing'),
    [activeTasks],
  );
  const selectedTicker = normalizeTickerQuery(selectedReport?.meta.stockCode);
  const completedTaskReport = useMemo(() => {
    const taskTicker = pendingAnalysisTicker || activeTicker;
    if (!taskTicker) {
      return null;
    }
    return activeTasks.find(
      (task) => normalizeTickerQuery(task.stockCode) === taskTicker && task.status === 'completed' && task.result?.report,
    )?.result?.report || null;
  }, [activeTasks, activeTicker, pendingAnalysisTicker]);
  const focusedTask = useMemo(() => {
    const taskTicker = pendingAnalysisTicker || activeTicker;
    if (taskTicker) {
      const matched = activeTasks.find((task) => normalizeTickerQuery(task.stockCode) === taskTicker);
      if (matched) {
        return matched;
      }
    }
    return activeTasks[0] || null;
  }, [activeTasks, activeTicker, pendingAnalysisTicker]);
  const isTaskAnalyzing = Boolean(
    pendingAnalysisTicker
    && focusedTask
    && (focusedTask.status === 'pending' || focusedTask.status === 'processing'),
  );
  const isHomeAnalyzing = isAnalyzing || isTaskAnalyzing || Boolean(pendingAnalysisTicker && isDashboardLoading);
  const isBusy = isHomeAnalyzing || isDashboardLoading;
  const dashboardData = useMemo<DashboardPayload>(() => {
    const effectiveTicker = activeTicker || selectedTicker || normalizeTickerQuery(recentHistoryItems[0]?.stockCode) || null;

    if (completedTaskReport && effectiveTicker && normalizeTickerQuery(completedTaskReport.meta.stockCode) === effectiveTicker) {
      return buildDashboardFromReport(locale, completedTaskReport);
    }

    if (selectedReport && effectiveTicker && selectedTicker === effectiveTicker) {
      return buildDashboardFromReport(locale, selectedReport);
    }

    if (pendingAnalysisTicker && effectiveTicker === pendingAnalysisTicker) {
      return buildInPlacePlaceholderDashboard(locale, effectiveTicker);
    }

    return buildInPlacePlaceholderDashboard(locale, effectiveTicker);
  }, [activeTicker, completedTaskReport, locale, pendingAnalysisTicker, recentHistoryItems, selectedReport, selectedTicker]);
  const copy = dashboardData;
  const standbyCopy = useMemo(() => (
    locale === 'en'
      ? {
        analyzeButton: 'Analyze',
        omnibarPlaceholder: 'Enter a valid ticker...',
      }
      : {
        analyzeButton: '分析',
        omnibarPlaceholder: '输入有效股票代码...',
      }
  ), [locale]);
  const activeDrawerPayload = activeDrawer && copy ? buildDrawerPayload(locale, copy, activeDrawer) : null;
  const deleteCopy = useMemo(() => ({
    title: t('home.deleteTitle'),
    single: t('home.deleteSingle'),
    multiple: (count: number) => t('home.deleteMultiple', { count }),
    confirm: t('home.deleteConfirm'),
    deleting: t('home.deleting'),
    cancel: t('home.cancel'),
    clearVisible: t('home.deleteAll'),
    deleteOne: t('home.deleteOne'),
    visibleCount: t('home.visibleCount'),
  }), [t]);

  useEffect(() => {
    document.title = copy.documentTitle;
  }, [copy.documentTitle]);

  useEffect(() => {
    purgeZombieDashboardStorage();
  }, []);

  useDashboardLifecycle({
    loadInitialHistory,
    refreshHistory,
    hydrateRecentTasks,
    syncTaskCreated,
    syncTaskUpdated,
    syncTaskFailed,
    hasRunningTasks,
  });

  const focusedTaskId = focusedTask?.taskId;
  const focusedTaskStatus = focusedTask?.status;

  useEffect(() => {
    if (!focusedTaskId || focusedTaskStatus === 'completed' || focusedTaskStatus === 'failed') {
      return undefined;
    }

    void refreshTaskProgress(focusedTaskId);
    if (import.meta.env.MODE === 'test') {
      return undefined;
    }
    const timer = window.setInterval(() => {
      void refreshTaskProgress(focusedTaskId);
    }, 1500);

    return () => {
      window.clearInterval(timer);
    };
  }, [focusedTaskId, focusedTaskStatus, refreshTaskProgress]);

  useEffect(() => {
    if (hasHydratedInitialTicker) {
      return;
    }
    if (pendingAnalysisTicker) {
      return;
    }

    const nextTicker = normalizeTickerQuery(selectedReport?.meta.stockCode) || normalizeTickerQuery(recentHistoryItems[0]?.stockCode);
    if (!nextTicker) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setActiveTicker(nextTicker);
      setHasHydratedInitialTicker(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [hasHydratedInitialTicker, pendingAnalysisTicker, recentHistoryItems, selectedReport?.meta.stockCode]);

  useEffect(() => {
    if (pendingAnalysisTicker) {
      return;
    }

    if (selectedTicker && !activeTicker) {
      setActiveTicker(selectedTicker);
      return;
    }

  }, [activeTicker, pendingAnalysisTicker, selectedTicker]);

  useEffect(() => {
    if (pendingAnalysisTicker && selectedTicker === pendingAnalysisTicker) {
      setPendingAnalysisTicker(null);
      setDashboardLoading(false);
    }
  }, [pendingAnalysisTicker, selectedTicker]);

  useEffect(() => {
    if (!statusToast) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setStatusToast(null);
    }, 3200);

    return () => window.clearTimeout(timer);
  }, [statusToast]);

  useEffect(() => {
    if (!pendingAnalysisTicker) {
      return;
    }

    const completedTask = activeTasks.find(
      (task) => normalizeTickerQuery(task.stockCode) === pendingAnalysisTicker && task.status === 'completed' && task.result?.report,
    );
    if (!completedTask) {
      return;
    }

    setActiveTicker(pendingAnalysisTicker);
    setPendingAnalysisTicker(null);
    setDashboardLoading(false);
    void refreshHistory(true);
    void focusLatestHistoryForStock(pendingAnalysisTicker);
  }, [activeTasks, focusLatestHistoryForStock, pendingAnalysisTicker, refreshHistory]);

  const handleAnalyze = async (tickerOverride?: string) => {
    const rawQuery = (tickerOverride ?? searchQuery).trim();
    if (!rawQuery) {
      return;
    }

    const normalizedTicker = rawQuery.toUpperCase();
    if (!TICKER_FORMAT_RE.test(normalizedTicker)) {
      setStatusToast({
        message: locale === 'en' ? 'Please enter a correctly formatted ticker.' : '请输入格式正确的股票代码',
        tone: 'error',
      });
      return;
    }

    setStatusToast(null);
    clearError();
    setDashboardLoading(true);
    setActiveTicker(normalizedTicker);
    setPendingAnalysisTicker(normalizedTicker);
    setHasHydratedInitialTicker(true);
    setSearchQuery('');

    try {
      const result = await submitAnalysis({
        stockCode: normalizedTicker,
        originalQuery: normalizedTicker,
        selectionSource: 'manual',
      });

      if (result.ok) {
        setActiveTicker(result.stockCode);
        void refreshHistory(true);
        return;
      }

      if (result.duplicate) {
        return;
      }

      setPendingAnalysisTicker(null);
      setStatusToast({
        message: locale === 'en' ? 'LLM analysis failed. Please try again later.' : 'LLM 分析失败，请稍后重试',
        tone: 'error',
      });
    } catch {
      setPendingAnalysisTicker(null);
      setStatusToast({
        message: locale === 'en' ? 'LLM analysis failed. Please try again later.' : 'LLM 分析失败，请稍后重试',
        tone: 'error',
      });
    } finally {
      setDashboardLoading(false);
    }
  };

  const handleHistoryClick = async (historyItem: HistoryItem) => {
    const normalizedTicker = normalizeTickerQuery(historyItem.stockCode);
    if (!normalizedTicker) {
      return;
    }

    setHistoryDrawerOpen(false);
    setStatusToast(null);
    setPendingAnalysisTicker(null);
    clearError();
    setActiveTicker(normalizedTicker);

    // Local snapshots are only a visual bridge; the persisted history detail remains the source of truth.
    const hasCachedSnapshot = selectCachedHistoryForStock(normalizedTicker);
    if (!hasCachedSnapshot) {
      setDashboardLoading(true);
    }

    try {
      await selectHistoryItem(historyItem.id);
    } finally {
      setDashboardLoading(false);
    }
  };

  const handleConfirmDeleteHistory = async () => {
    if (!pendingHistoryDelete || isDeletingHistory) {
      return;
    }

    try {
      await deleteHistoryRecords(
        pendingHistoryDelete.recordIds,
        pendingHistoryDelete.mode === 'visible' ? { deleteAll: true } : undefined,
      );
      setHistoryDrawerOpen(false);
    } finally {
      setPendingHistoryDelete(null);
    }
  };

  return (
    <div
      ref={surfaceRef}
      data-testid="home-bento-dashboard"
      data-bento-surface="true"
      aria-hidden={shouldGuardA11y && !isSafariReady ? true : undefined}
      aria-live={shouldGuardA11y ? (isSafariReady ? 'polite' : 'off') : undefined}
      className={getSafariReadySurfaceClassName(
        isSafariReady,
        `${BENTO_SURFACE_ROOT_CLASS} w-full flex-1 flex flex-col gap-6 min-h-0 min-w-0 bg-transparent`,
      )}
    >
      {statusToast ? (
        <div className="pointer-events-none fixed right-6 top-24 z-50" data-testid="home-bento-fallback-toast">
          <div className={statusToast.tone === 'warning'
            ? 'rounded-2xl border border-amber-300/35 bg-amber-950/82 px-4 py-3 text-sm font-semibold text-amber-50 shadow-[0_18px_50px_rgba(120,53,15,0.35)] backdrop-blur-xl'
            : 'rounded-2xl border border-red-400/35 bg-red-950/82 px-4 py-3 text-sm font-semibold text-red-50 shadow-[0_18px_50px_rgba(127,29,29,0.35)] backdrop-blur-xl'}>
            {statusToast.message}
          </div>
        </div>
      ) : null}
      <main className="w-full flex-1 flex flex-col gap-6 min-h-0 min-w-0" data-testid="home-bento-main">
        {(() => {
          const readyCopy = dashboardData;
          return (
            <div
              data-testid="home-bento-grid"
              data-bento-grid="true"
              className="w-full grid grid-cols-1 gap-6 items-stretch xl:grid-cols-5"
            >
              <div
                className="xl:col-span-2 flex h-full min-h-0 flex-col gap-6"
                data-testid="home-bento-primary-stack"
              >
                <form
                  className="flex h-12 w-full min-w-0 shrink-0 gap-3"
                  data-testid="home-bento-omnibar"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleAnalyze();
                  }}
                >
                  <div
                    className="group relative flex min-w-0 flex-1 items-center overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02] shadow-lg transition-all focus-within:border-white/20 focus-within:bg-white/[0.04]"
                    data-testid="home-bento-omnibar-input-shell"
                  >
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
                      className="h-full min-w-0 flex-1 bg-transparent pl-11 pr-4 text-sm leading-none text-white caret-white outline-none [appearance:textfield] placeholder:text-white/30"
                      placeholder={copy?.omnibarPlaceholder || standbyCopy.omnibarPlaceholder}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isBusy}
                    className="h-full shrink-0 rounded-2xl border border-white/10 bg-white/[0.05] px-6 text-sm font-bold text-white backdrop-blur-md transition-all hover:border-white/20 hover:bg-white/[0.1] disabled:cursor-wait disabled:border-white/10 disabled:bg-white/[0.05] disabled:text-white/60"
                    data-testid="home-bento-analyze-button"
                  >
                    {isHomeAnalyzing ? (locale === 'en' ? 'Analyzing...' : '分析中...') : (copy?.analyzeButton || standbyCopy.analyzeButton)}
                  </button>
                  <button
                    ref={openHistoryDrawerButton.ref}
                    type="button"
                    aria-label={locale === 'en' ? 'History' : '历史记录'}
                    onClick={openHistoryDrawerButton.onClick}
                    onPointerUp={openHistoryDrawerButton.onPointerUp}
                    disabled={isBusy}
                    className="flex h-full shrink-0 items-center justify-center rounded-2xl border border-white/5 bg-white/[0.02] px-4 text-white/70 transition-all hover:bg-white/[0.08] hover:text-white disabled:cursor-wait disabled:text-white/40"
                    data-testid="home-bento-history-drawer-trigger"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l2.5 2.5M21 12a9 9 0 1 1-3.2-6.9M21 4v5h-5" />
                    </svg>
                  </button>
                </form>
                <div className="flex min-h-0 flex-1 flex-col gap-4">
                  <div className="min-h-0 flex-1">
                    {isHomeAnalyzing ? (
                      <InPlaceDecisionSkeleton
                        locale={locale}
                        ticker={pendingAnalysisTicker || activeTicker || readyCopy.ticker}
                      />
                    ) : (
                      <div
                        className="h-full"
                        data-testid={completedTaskReport ? 'home-bento-analysis-result-card' : undefined}
                      >
                        <DecisionCard
                          eyebrow={readyCopy.decision.eyebrow}
                          company={readyCopy.decision.company}
                          ticker={readyCopy.ticker}
                          heroValue={readyCopy.decision.heroValue}
                          heroUnit={readyCopy.decision.heroUnit}
                          heroLabel={readyCopy.decision.heroLabel}
                          signalLabel={readyCopy.decision.signalLabel}
                          signalTone={readyCopy.decision.signalTone}
                          sector={readyCopy.decision.sector}
                          scoreLabel={readyCopy.decision.scoreLabel}
                          scoreValue={readyCopy.decision.scoreValue}
                          badge={readyCopy.decision.badge}
                          summary={readyCopy.decision.summary}
                          locale={locale}
                          reason={{ title: readyCopy.decision.reasonTitle, body: readyCopy.decision.reasonBody }}
                          detailLabel={readyCopy.decision.detailLabel}
                          onOpenDetails={() => setActiveDrawer('decision')}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div
                className="min-w-0 xl:col-span-3 flex flex-col gap-6"
                data-testid="home-bento-secondary-stack"
              >
                {isHomeAnalyzing ? (
                  <>
                    <InPlaceStrategySkeleton locale={locale} />
                    <div
                      className="grid flex-1 grid-cols-1 items-stretch gap-6 md:grid-cols-2"
                      data-testid="home-bento-secondary-grid"
                    >
                      <InPlaceListSkeleton locale={locale} kind="tech" />
                      <InPlaceListSkeleton locale={locale} kind="fundamentals" />
                    </div>
                  </>
                ) : (
                  <>
                    <StrategyCard
                      title={readyCopy.strategy.title}
                      subtitle={readyCopy.strategy.subtitle}
                      metrics={readyCopy.strategy.metrics}
                      positionLabel={readyCopy.strategy.positionLabel}
                      positionBody={readyCopy.strategy.positionBody}
                      detailLabel={readyCopy.strategy.detailLabel}
                      onOpenDetails={() => setActiveDrawer('strategy')}
                    />
                    <div
                      className="grid flex-1 grid-cols-1 items-stretch gap-6 md:grid-cols-2"
                      data-testid="home-bento-secondary-grid"
                    >
                      <TechCard
                        title={readyCopy.tech.title}
                        signals={readyCopy.tech.signals}
                        detailLabel={readyCopy.tech.detailLabel}
                        onOpenDetails={() => setActiveDrawer('tech')}
                      />
                      <FundamentalsCard
                        title={readyCopy.fundamentals.title}
                        metrics={readyCopy.fundamentals.metrics}
                        detailLabel={readyCopy.fundamentals.detailLabel}
                        onOpenDetails={() => setActiveDrawer('fundamentals')}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })()}
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
          {recentHistoryItems.length > 0 ? (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-white/[0.02] px-4 py-3">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                  {deleteCopy.visibleCount}
                </p>
                <p className="mt-1 text-sm text-white/72">
                  {recentHistoryItems.length}
                </p>
              </div>
              <Button
                type="button"
                variant="danger-subtle"
                size="sm"
                disabled={isDeletingHistory}
                className="shrink-0"
                onClick={() => setPendingHistoryDelete({
                  mode: 'visible',
                  recordIds: recentHistoryItems.map((item) => item.id),
                })}
                data-testid="home-bento-history-delete-all"
              >
                {isDeletingHistory ? deleteCopy.deleting : deleteCopy.clearVisible}
              </Button>
            </div>
          ) : null}
          {recentHistoryItems.length > 0 ? recentHistoryItems.map((item) => {
            const ticker = normalizeTickerQuery(item.stockCode);
            const isSelected = selectedReport?.meta.id === item.id;
            const generatedAt = resolveHistoryGeneratedAt(item, locale);
            const companyLabel = resolveHistoryCompanyLabel(item);
            return (
              <div
                key={item.id}
                className={`flex min-w-0 items-center gap-3 rounded-2xl border px-3 py-3 transition-colors ${
                  isSelected
                    ? 'border-white/15 bg-white/[0.08] text-white'
                    : 'border-white/5 bg-white/[0.02] text-white/72 hover:bg-white/[0.05]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => { void handleHistoryClick(item); }}
                  className="flex min-w-0 flex-1 items-center justify-between gap-4 text-left"
                  data-testid={`home-bento-history-item-${item.id}`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{companyLabel}</p>
                    <p className="mt-1 truncate text-[11px] uppercase tracking-[0.16em] text-white/40">
                      {ticker} · {locale === 'en' ? 'Recent analysis' : '最近分析'}
                    </p>
                    {generatedAt ? (
                      <p className="mt-1 truncate text-[11px] text-white/45">
                        {generatedAt}
                      </p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-[10px] uppercase tracking-[0.16em] text-white/35">
                    {isSelected ? (locale === 'en' ? 'Loaded' : '当前') : (locale === 'en' ? 'Open' : '打开')}
                  </span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isDeletingHistory}
                  className="shrink-0 border border-white/8 bg-white/[0.03] px-3 text-white/62 hover:border-red-400/30 hover:bg-red-500/10 hover:text-red-100"
                  onClick={() => setPendingHistoryDelete({ mode: 'single', recordIds: [item.id] })}
                  data-testid={`home-bento-history-delete-${item.id}`}
                >
                  {deleteCopy.deleteOne}
                </Button>
              </div>
            );
          }) : (
            <div className="rounded-2xl border border-white/5 bg-white/[0.02] px-4 py-5 text-sm text-white/48">
              {locale === 'en' ? 'No synced analysis history yet.' : '历史分析尚未同步。'}
            </div>
          )}
        </div>
      </Drawer>

      <ConfirmDialog
        isOpen={Boolean(pendingHistoryDelete)}
        title={deleteCopy.title}
        message={
          pendingHistoryDelete
            ? pendingHistoryDelete.mode === 'single'
              ? deleteCopy.single
              : deleteCopy.multiple(pendingHistoryDelete.recordIds.length)
            : deleteCopy.single
        }
        confirmText={isDeletingHistory ? deleteCopy.deleting : deleteCopy.confirm}
        cancelText={deleteCopy.cancel}
        isDanger
        onConfirm={() => { void handleConfirmDeleteHistory(); }}
        onCancel={() => {
          if (!isDeletingHistory) {
            setPendingHistoryDelete(null);
          }
        }}
      />
    </div>
  );
};

export default HomeBentoDashboardPage;
