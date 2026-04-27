import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { PanelRightOpen } from 'lucide-react';
import { Label } from '../common';
import { useSafariWarmActivation } from '../../hooks/useSafariInteractionReady';
import { BentoCard } from './BentoCard';
import {
  HomeSignalCandlestickChart,
  type DecisionChartTimeframe,
  type DecisionChartTimeframeId,
} from './HomeSignalCandlestickChart';
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

type DecisionCardProps = {
  badge: string;
  chartLabel: string;
  chartTimeframes: DecisionChartTimeframe[];
  company: string;
  defaultTimeframeId: DecisionChartTimeframeId;
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

export const DecisionCard: React.FC<DecisionCardProps> = ({
  badge,
  chartLabel,
  chartTimeframes,
  company,
  defaultTimeframeId,
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
  const [activeTimeframeId, setActiveTimeframeId] = useState<DecisionChartTimeframeId>(defaultTimeframeId);
  const summaryParagraphs = summary
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const reasonParagraphs = reason.body
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const activeTimeframe = useMemo(
    () => chartTimeframes.find((timeframe) => timeframe.id === activeTimeframeId) || chartTimeframes[0],
    [activeTimeframeId, chartTimeframes],
  );

  useEffect(() => {
    setActiveTimeframeId(defaultTimeframeId);
  }, [defaultTimeframeId]);

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
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-end gap-2">
              <span className="min-w-0 truncate text-lg font-semibold leading-tight text-white">{company}</span>
              <span className="text-xs font-mono uppercase tracking-[0.22em] text-white/40">{ticker}</span>
            </div>
            <div className="mt-4 flex flex-wrap items-end gap-4">
              <div>
                <p className={CARD_KICKER_CLASS}>{heroLabel}</p>
                <div className="mt-2 flex items-end gap-2">
                  <span className="text-[40px] font-semibold leading-none text-white md:text-[48px]">{heroValue}</span>
                  <span className="pb-1.5 text-sm text-white/42">{heroUnit}</span>
                </div>
              </div>
              <div className="pb-2">
                <p className={CARD_KICKER_CLASS}>{scoreLabel}</p>
                <p
                  className={`mt-2 text-lg font-bold leading-tight ${getToneTextClass(signalTone)}`}
                  style={getToneTextStyle(signalTone, true)}
                >
                  {signalLabel}
                </p>
              </div>
            </div>
            <div className={`mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${getToneBorderClass(signalTone)}`}>
              <span className="h-2 w-2 rounded-full bg-current" />
              <span className="min-w-0 break-words whitespace-normal">{badge}</span>
            </div>
          </div>

          <div className={`${PANEL_METRIC_CLASS} min-w-0 xl:min-w-[12rem] xl:max-w-[18rem]`}>
            <p className={CARD_KICKER_CLASS}>{scoreLabel}</p>
            <p className="mt-3 break-words whitespace-normal text-lg font-bold leading-tight text-white">{scoreValue}</p>
            <div className="mt-4 break-words whitespace-normal space-y-2 text-[13px] leading-[1.7] text-white/70">
              {(summaryParagraphs.length ? summaryParagraphs : [summary]).map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-2 flex min-h-[220px] flex-1 flex-col">
          <div className="relative flex min-h-[220px] flex-1 rounded-[28px] border border-white/[0.08] bg-white/[0.02] p-4 backdrop-blur-xl md:p-5">
            <div className="pointer-events-none absolute left-6 top-5 rounded-full border border-white/10 bg-black/35 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/52">
              {chartLabel}
            </div>
            <div className="absolute right-4 top-4 z-10 flex items-center gap-1 rounded-xl bg-black/40 p-0.5 shadow-[0_12px_24px_rgba(0,0,0,0.22)] backdrop-blur-xl">
              {chartTimeframes.map((timeframe) => {
                const isActive = timeframe.id === activeTimeframe?.id;
                return (
                  <button
                    key={timeframe.id}
                    type="button"
                    className={`rounded-lg px-2 py-0.5 text-[10px] transition-colors ${
                      isActive ? 'bg-white/10 font-bold text-white' : 'text-white/40 hover:text-white'
                    }`}
                    data-testid={`home-bento-decision-timeframe-${timeframe.id}`}
                    onClick={() => setActiveTimeframeId(timeframe.id)}
                  >
                    {timeframe.label}
                  </button>
                );
              })}
            </div>
            <div className="flex min-h-0 flex-1 items-stretch pt-6">
              {activeTimeframe ? (
                <HomeSignalCandlestickChart
                  locale={locale}
                  signalTone={signalTone}
                  timeframe={activeTimeframe}
                />
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-1 shrink-0 border-t border-white/5 pt-4" data-testid="home-bento-breakout-reason">
          <Label micro as="h4" className="mb-1 text-white/30">{reason.title}</Label>
          <p className="truncate text-xs leading-relaxed text-white/60" title={reason.body}>
            {(reasonParagraphs[0] || reason.body).trim()}
          </p>
        </div>
      </div>
    </BentoCard>
  );
};
