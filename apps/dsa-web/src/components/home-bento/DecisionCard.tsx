import type React from 'react';
import { PanelRightOpen } from 'lucide-react';
import { Label } from '../common';
import { useSafariWarmActivation } from '../../hooks/useSafariInteractionReady';
import { BentoCard } from './BentoCard';
import {
  CARD_BUTTON_CLASS,
  SYSTEM_ACCENT_GLOW_CLASS,
  type SignalTone,
  getToneTextClass,
  getToneTextStyle,
} from './theme';

type DecisionReason = {
  body: string;
  title: string;
};

type SupportingIndicator = {
  context: string;
  label: string;
  value: string;
};

type DecisionCardProps = {
  badge: string;
  company: string;
  detailLabel: string;
  eyebrow: string;
  heroLabel: string;
  heroUnit: string;
  heroValue: string;
  locale: 'zh' | 'en';
  onOpenDetails: () => void;
  reason: DecisionReason;
  scoreLabel: string;
  scoreValue: string;
  signalLabel: string;
  signalTone: SignalTone;
  sector?: string;
  summary: string;
  ticker: string;
};

function resolveSignalActionKey(signalLabel: string, tone: SignalTone): 'buy' | 'sell' | 'hold' {
  const normalized = signalLabel.trim().toUpperCase();

  if (/SELL|SHORT|BEAR|卖|空|看空/.test(normalized)) {
    return 'sell';
  }
  if (/HOLD|NEUTRAL|WAIT|WATCH|OBSERVE|持有|中性|观望/.test(normalized)) {
    return 'hold';
  }
  if (/BUY|LONG|BULL|买|多|看多|乐观|偏多/.test(normalized)) {
    return 'buy';
  }
  return tone === 'bearish' ? 'sell' : tone === 'neutral' ? 'hold' : 'buy';
}

function getSignalCommand(locale: 'zh' | 'en', signalLabel: string, tone: SignalTone): { bias: string; command: string } {
  const actionKey = resolveSignalActionKey(signalLabel, tone);

  if (actionKey === 'sell') {
    return locale === 'en'
      ? { command: /STRONG|SHORT/i.test(signalLabel) ? 'STRONG SELL' : 'SELL', bias: 'BEARISH' }
      : { command: /强|空/.test(signalLabel) ? '强力做空' : '卖出', bias: '看空' };
  }

  if (actionKey === 'hold') {
    return locale === 'en'
      ? { command: /HOLD/i.test(signalLabel) ? 'HOLD' : 'WAIT', bias: 'NEUTRAL' }
      : { command: /持有/.test(signalLabel) ? '继续持有' : '观望', bias: '中性' };
  }

  return locale === 'en'
    ? { command: /STRONG|LONG/i.test(signalLabel) ? 'STRONG BUY' : 'BUY', bias: 'BULLISH' }
    : { command: /强|多/.test(signalLabel) ? '强力做多' : '买入', bias: '看多' };
}

function getActionToneClass(tone: SignalTone): string {
  return tone === 'neutral' ? 'text-white' : getToneTextClass(tone);
}

function getActionToneStyle(tone: SignalTone): React.CSSProperties {
  if (tone !== 'neutral') {
    return getToneTextStyle(tone, true);
  }
  return {
    color: '#F8FAFC',
    textShadow: '0 0 18px rgba(99, 102, 241, 0.18)',
  };
}

function getSupportingIndicators(locale: 'zh' | 'en', tone: SignalTone): SupportingIndicator[] {
  if (tone === 'bearish') {
    return locale === 'en'
      ? [
          { label: 'MA ALIGNMENT', value: 'BEARISH', context: 'MA20 < MA60' },
          { label: 'LIQUIDITY AB.', value: 'THIN', context: 'Bid weakens' },
          { label: 'RSI-14', value: '41', context: 'Weak zone' },
          { label: 'MACD-12/26/9', value: 'BEAR CROSS', context: 'Below zero' },
          { label: 'VOLUME CONF.', value: 'NO', context: 'Failed follow-through' },
        ]
      : [
          { label: '均线排列', value: '空头', context: 'MA20 低于 MA60' },
          { label: '资金承接', value: '偏弱', context: '买盘退潮' },
          { label: 'RSI-14', value: '41', context: '弱势区' },
          { label: 'MACD-12/26/9', value: '死叉', context: '零轴下方' },
          { label: '量能确认', value: '否', context: '承接不足' },
        ];
  }

  if (tone === 'neutral') {
    return locale === 'en'
      ? [
          { label: 'MA ALIGNMENT', value: 'MIXED', context: 'Short-term repair' },
          { label: 'LIQUIDITY AB.', value: 'BALANCED', context: 'Flow stabilizing' },
          { label: 'RSI-14', value: '54', context: 'Repair zone' },
          { label: 'MACD-12/26/9', value: 'EARLY TURN', context: 'Histogram improving' },
          { label: 'VOLUME CONF.', value: 'PENDING', context: 'Needs a second push' },
        ]
      : [
          { label: '均线排列', value: '混合', context: '短线修复中' },
          { label: '资金承接', value: '均衡', context: '流向趋稳' },
          { label: 'RSI-14', value: '54', context: '修复区' },
          { label: 'MACD-12/26/9', value: '拐点初现', context: '柱体改善' },
          { label: '量能确认', value: '待确认', context: '需要二次放量' },
        ];
  }

  return locale === 'en'
    ? [
        { label: 'MA ALIGNMENT', value: 'BULLISH', context: 'Stacked higher' },
        { label: 'LIQUIDITY AB.', value: 'STRONG', context: 'Institutional bid' },
        { label: 'RSI-14', value: '68', context: 'Strong zone' },
        { label: 'MACD-12/26/9', value: 'BULL CROSSOVER', context: 'Above zero' },
        { label: 'VOLUME CONF.', value: 'YES', context: 'Quiet pullback / active breakout' },
      ]
    : [
        { label: '均线排列', value: '多头', context: '均线多头排列' },
        { label: '资金承接', value: '强力', context: '机构承接' },
        { label: 'RSI-14', value: '68', context: '强势区' },
        { label: 'MACD-12/26/9', value: '金叉', context: '零轴上方' },
        { label: '量能确认', value: '是', context: '缩量回踩 / 放量突破' },
      ];
}

export const DecisionCard: React.FC<DecisionCardProps> = ({
  company,
  detailLabel,
  eyebrow,
  heroUnit,
  heroValue,
  locale,
  onOpenDetails,
  reason,
  scoreValue,
  signalLabel,
  signalTone,
  sector,
  summary,
  ticker,
}) => {
  const {
    ref: openDetailsButtonRef,
    onClick: handleOpenDetailsClick,
    onPointerUp: handleOpenDetailsPointerUp,
  } = useSafariWarmActivation<HTMLButtonElement>(onOpenDetails);
  const signalCommand = getSignalCommand(locale, signalLabel, signalTone);
  const supportingIndicators = getSupportingIndicators(locale, signalTone);
  const isEnglish = locale === 'en';
  const insightCopy = reason.body || summary || scoreValue || '-';
  const sectorLabel = (sector || (isEnglish ? 'UNCLASSIFIED' : '未分类')).toUpperCase();

  return (
    <BentoCard
      eyebrow={eyebrow}
      tone={signalTone}
      accentGlow
      accentGlowClassName={SYSTEM_ACCENT_GLOW_CLASS}
      className="h-full w-full rounded-[24px]"
      testId="home-bento-card-decision"
      action={(
        <button
          ref={openDetailsButtonRef}
          type="button"
          className={CARD_BUTTON_CLASS}
          data-testid="home-bento-drawer-trigger-decision"
          onClick={handleOpenDetailsClick}
          onPointerUp={handleOpenDetailsPointerUp}
        >
          <PanelRightOpen className="h-4 w-4" />
          <span>{detailLabel}</span>
        </button>
      )}
    >
      <div className="flex h-full flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3" data-testid="home-bento-decision-company-header">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="min-w-0 truncate text-xl font-bold leading-tight text-white">{company}</span>
              <span className="font-mono text-base text-white/40">({ticker})</span>
            </div>
            <div
              className="mt-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-white/34"
              data-testid="home-bento-decision-sector"
            >
              {sectorLabel}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <div
            className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between"
            data-testid="home-bento-decision-hero-row"
          >
            <div className="min-w-0 flex-1">
              <Label micro className="text-white/28">{isEnglish ? 'ACTION' : 'AI 动作'}</Label>
              <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
                <span
                  className={`text-5xl font-black leading-none tracking-[0] md:text-6xl ${getActionToneClass(signalTone)}`}
                  data-testid="home-bento-decision-signal-hero"
                  style={getActionToneStyle(signalTone)}
                >
                  {signalCommand.command}
                </span>
              </div>
            </div>

            <div
              className="min-w-0 rounded-[24px] border border-white/[0.08] bg-white/[0.03] px-5 py-4 text-right xl:min-w-[10rem]"
              data-testid="home-bento-decision-core-metrics"
            >
              <Label micro className="text-white/28">{isEnglish ? 'SCORE' : '评分'}</Label>
              <div className="mt-2 flex items-end justify-end gap-2">
                <p
                  className="font-mono text-5xl font-semibold leading-none text-white"
                  data-testid="home-bento-decision-score"
                >
                  {heroValue}
                </p>
                <span className="pb-1 text-sm font-medium text-white/42">{heroUnit}</span>
              </div>
            </div>
          </div>

          <div className="max-w-3xl" data-testid="home-bento-decision-insight">
            <Label micro className="text-white/28">{isEnglish ? 'AI INSIGHT' : '执行主线'}</Label>
            <p
              className="mt-3 line-clamp-3 text-sm leading-relaxed text-white/70"
              data-testid="home-bento-decision-insight-copy"
            >
              {insightCopy}
            </p>
          </div>
        </div>

        <div className="flex flex-1 flex-col rounded-[28px] border border-white/[0.06] bg-black/10 px-4 py-4 backdrop-blur-xl md:px-5">
          <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-3">
            <Label micro className="text-white/30">{isEnglish ? 'SUPPORTING INDICATORS' : '量化佐证指标'}</Label>
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/28">
              {isEnglish ? 'SIMULATED FEED' : '模拟信号流'}
            </span>
          </div>
          <div className="flex-1 divide-y divide-white/6" data-testid="home-bento-decision-support-grid">
            {supportingIndicators.map((indicator) => (
              <div
                key={indicator.label}
                className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,0.8fr)_minmax(0,1fr)] items-center gap-3 py-3 text-xs md:text-[13px]"
              >
                <div className="min-w-0">
                  <Label micro className="text-white/26">{indicator.label}</Label>
                </div>
                <div className={`min-w-0 font-semibold uppercase tracking-[0.14em] ${getToneTextClass(signalTone)}`} style={getToneTextStyle(signalTone, true)}>
                  <span className="block truncate">{indicator.value}</span>
                </div>
                <div className="min-w-0 text-right text-white/56">
                  <span className="block truncate">{indicator.context}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </BentoCard>
  );
};
