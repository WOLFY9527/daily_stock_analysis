import type React from 'react';
import { PanelRightOpen } from 'lucide-react';
import { Label } from '../common';
import { useSafariWarmActivation } from '../../hooks/useSafariInteractionReady';
import { BentoCard } from './BentoCard';
import {
  CARD_BUTTON_CLASS,
  CARD_KICKER_CLASS,
  PANEL_METRIC_CLASS,
  SYSTEM_ACCENT_GLOW_CLASS,
  type SignalTone,
  getToneBorderClass,
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
  summary: string;
  ticker: string;
};

function getSignalCommand(locale: 'zh' | 'en', tone: SignalTone): { bias: string; command: string } {
  if (tone === 'bearish') {
    return locale === 'en'
      ? { command: 'SHORT', bias: 'BEARISH' }
      : { command: 'SHORT', bias: '看空' };
  }

  if (tone === 'neutral') {
    return locale === 'en'
      ? { command: 'HOLD', bias: 'NEUTRAL' }
      : { command: 'HOLD', bias: '中性' };
  }

  return locale === 'en'
    ? { command: 'LONG', bias: 'BULLISH' }
    : { command: 'LONG', bias: '看多' };
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
  badge,
  company,
  detailLabel,
  eyebrow,
  heroLabel,
  heroUnit,
  heroValue,
  locale,
  onOpenDetails,
  reason,
  scoreLabel,
  scoreValue,
  signalLabel,
  signalTone,
  summary,
  ticker,
}) => {
  const {
    ref: openDetailsButtonRef,
    onClick: handleOpenDetailsClick,
    onPointerUp: handleOpenDetailsPointerUp,
  } = useSafariWarmActivation<HTMLButtonElement>(onOpenDetails);
  const signalCommand = getSignalCommand(locale, signalTone);
  const supportingIndicators = getSupportingIndicators(locale, signalTone);
  const isEnglish = locale === 'en';

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
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-end gap-2">
              <span className="min-w-0 truncate text-lg font-semibold leading-tight text-white">{company}</span>
              <span className="text-xs font-mono uppercase tracking-[0.22em] text-white/40">{ticker}</span>
            </div>
            <div className={`mt-3 inline-flex min-h-8 items-center gap-2 rounded-full border px-3 py-1 text-sm ${getToneBorderClass(signalTone)}`}>
              <span className="h-2 w-2 rounded-full bg-current" />
              <span className="min-w-0 break-words whitespace-normal">{badge}</span>
            </div>
          </div>
          <div className={`${PANEL_METRIC_CLASS} min-w-[12rem] max-w-full px-4 py-3`}>
            <p className={CARD_KICKER_CLASS}>{scoreLabel}</p>
            <p className="mt-2 text-sm font-semibold leading-relaxed text-white/78">{scoreValue}</p>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(16rem,0.95fr)]">
          <div className="rounded-[28px] border border-white/[0.08] bg-white/[0.02] px-5 py-5 backdrop-blur-xl md:px-6">
            <Label micro className="text-white/32">{isEnglish ? 'AI SIGNAL DIRECTION' : 'AI 信号方向'}</Label>
            <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
              <span
                className={`text-3xl font-semibold leading-none md:text-4xl ${getToneTextClass(signalTone)}`}
                data-testid="home-bento-decision-signal-hero"
                style={getToneTextStyle(signalTone, true)}
              >
                {signalCommand.command}
              </span>
              <span className={`pb-1 text-sm font-semibold uppercase tracking-[0.22em] ${getToneTextClass(signalTone)}`} style={getToneTextStyle(signalTone, true)}>
                {signalLabel || signalCommand.bias}
              </span>
            </div>
            <p className="mt-4 max-w-3xl text-sm leading-[1.7] text-white/72">{summary}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1" data-testid="home-bento-decision-core-metrics">
            <div className={`${PANEL_METRIC_CLASS} flex flex-col gap-1`}>
              <Label micro>{heroLabel}</Label>
              <p className="text-2xl font-semibold leading-none text-white">
                {heroValue}
                <span className="ml-1 text-sm font-medium text-white/42">{heroUnit}</span>
              </p>
            </div>
            <div className={`${PANEL_METRIC_CLASS} flex flex-col gap-1`}>
              <Label micro>{isEnglish ? 'BIAS' : '方向'}</Label>
              <p className={`text-lg font-semibold leading-tight ${getToneTextClass(signalTone)}`} style={getToneTextStyle(signalTone, true)}>
                {signalCommand.bias}
              </p>
            </div>
            <div className={`${PANEL_METRIC_CLASS} flex flex-col gap-1 sm:col-span-2 xl:col-span-1`}>
              <Label micro>{isEnglish ? 'OPERATING THESIS' : '执行主线'}</Label>
              <p className="text-sm leading-[1.7] text-white/70">{scoreValue}</p>
            </div>
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

        <div className="shrink-0 border-t border-white/5 pt-4" data-testid="home-bento-breakout-reason">
          <Label micro as="h4" className="mb-1 text-white/30">{reason.title}</Label>
          <p className="text-xs leading-[1.75] text-white/60">{reason.body}</p>
        </div>
      </div>
    </BentoCard>
  );
};
