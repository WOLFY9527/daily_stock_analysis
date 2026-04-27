import type React from 'react';
import { PanelRightOpen } from 'lucide-react';
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

type ChartPoint = {
  label: string;
  value: number;
};

type DecisionReason = {
  title: string;
  body: string;
};

type DecisionCardProps = {
  eyebrow: string;
  company: string;
  ticker: string;
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
  chartPoints: ChartPoint[];
  breakoutPointIndex: number;
  reason: DecisionReason;
  detailLabel: string;
  onOpenDetails: () => void;
};

export const DecisionCard: React.FC<DecisionCardProps> = ({
  eyebrow,
  company,
  ticker,
  heroValue,
  heroUnit,
  heroLabel,
  signalLabel,
  signalTone,
  scoreLabel,
  scoreValue,
  badge,
  chartLabel,
  summary,
  chartPoints,
  breakoutPointIndex,
  reason,
  detailLabel,
  onOpenDetails,
}) => {
  const high = Math.max(...chartPoints.map((point) => point.value));
  const low = Math.min(...chartPoints.map((point) => point.value));
  const paddedHigh = high + 1.2;
  const paddedLow = low - 1.2;
  const range = paddedHigh - paddedLow || 1;
  const labels = [paddedHigh, paddedLow + range / 2, paddedLow].map((value) => value.toFixed(2));
  const linePoints = chartPoints.map((point, index) => {
    const x = chartPoints.length === 1 ? 0 : (index / (chartPoints.length - 1)) * 100;
    const y = 48 - ((point.value - paddedLow) / range) * 38;
    return `${x},${y}`;
  }).join(' ');
  const breakoutPoint = chartPoints[breakoutPointIndex] || chartPoints[chartPoints.length - 1];
  const breakoutX = chartPoints.length === 1 ? 0 : (breakoutPointIndex / (chartPoints.length - 1)) * 100;
  const breakoutY = 48 - ((breakoutPoint.value - paddedLow) / range) * 38;
  const summaryParagraphs = summary
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const reasonParagraphs = reason.body
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <BentoCard
      eyebrow={eyebrow}
      tone={signalTone}
      accentGlow
      accentGlowClassName={SYSTEM_ACCENT_GLOW_CLASS}
      className="w-full h-full rounded-[24px] lg:col-span-3 xl:col-span-2"
      testId="home-bento-card-decision"
      action={(
        <button
          type="button"
          className={CARD_BUTTON_CLASS}
          data-testid="home-bento-drawer-trigger-decision"
          onClick={onOpenDetails}
        >
          <PanelRightOpen className="h-4 w-4" />
          <span>{detailLabel}</span>
        </button>
      )}
    >
      <div className="flex h-full flex-col gap-5">
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
            <div className="mt-4 break-words text-[13px] leading-[1.7] text-white/70 space-y-2 whitespace-normal">
              {(summaryParagraphs.length ? summaryParagraphs : [summary]).map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 flex-1 min-h-[200px] relative">
          <div className="absolute inset-0 rounded-[28px] border border-white/[0.08] bg-white/[0.02] p-4 backdrop-blur-xl md:p-5">
            <div
              className="grid h-full min-h-0 grid-cols-[2.75rem_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_1.75rem] gap-x-3 gap-y-3"
              data-testid="home-bento-decision-chart-frame"
            >
              <div className="pointer-events-none flex min-w-0 flex-col justify-between text-[10px] leading-4 text-white/28">
                {labels.map((label) => <span key={label} className="truncate">{label}</span>)}
              </div>
              <div className="relative min-h-0 min-w-0" data-testid="home-bento-decision-chart-plot">
                <svg className="absolute inset-0 h-full w-full text-[#34D399]" viewBox="0 0 100 56" preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <linearGradient id="home-bento-decision-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
                      <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <line x1="0" y1="10" x2="100" y2="10" stroke="rgba(255, 255, 255, 0.05)" strokeWidth="0.4" />
                  <line x1="0" y1="28" x2="100" y2="28" stroke="rgba(148, 163, 184, 0.36)" strokeWidth="0.6" strokeDasharray="2.4 2.2" />
                  <line x1="0" y1="46" x2="100" y2="46" stroke="rgba(255, 255, 255, 0.05)" strokeWidth="0.4" />
                  <polygon points={`0,56 ${linePoints} 100,56`} fill="url(#home-bento-decision-fill)" />
                  <polyline
                    points={linePoints}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ filter: 'drop-shadow(0 4px 8px rgba(52, 211, 153, 0.4))' }}
                  />
                  <circle cx={breakoutX} cy={breakoutY} r="2.1" fill="#34D399" />
                  <circle cx={breakoutX} cy={breakoutY} r="5.4" fill="rgba(52, 211, 153, 0.16)" />
                </svg>
                <div
                  className="absolute flex items-center gap-1.5 rounded-full bg-emerald-500 px-3 py-1 text-[10px] font-bold text-black shadow-[0_0_15px_rgba(16,185,129,0.5)]"
                  style={{
                    left: `clamp(4rem, calc(${breakoutX}% - 2rem), calc(100% - 11rem))`,
                    top: `clamp(0.75rem, calc(${(breakoutY / 56) * 100}% - 2.25rem), calc(100% - 2.5rem))`,
                  }}
                  data-testid="home-bento-breakout-pill"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-black animate-pulse" />
                  {chartLabel}
                </div>
              </div>
              <div />
              <div
                className="pointer-events-none flex min-w-0 items-start gap-3 text-[10px] leading-4 text-white/28"
                data-testid="home-bento-decision-chart-x-axis"
              >
                <span className="min-w-0 flex-1 truncate text-left">{chartPoints[0]?.label}</span>
                <span className="min-w-0 flex-1 truncate text-center">{chartPoints[Math.floor(chartPoints.length / 2)]?.label}</span>
                <span className="min-w-0 flex-1 truncate text-right">{chartPoints[chartPoints.length - 1]?.label}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3 flex min-w-0 flex-col gap-2" data-testid="home-bento-breakout-reason">
          <div className="block truncate text-[10px] text-white/40 uppercase tracking-widest font-bold">{reason.title}</div>
          <div className="break-words text-[13px] leading-[1.7] text-white/70 space-y-2 whitespace-normal">
            {(reasonParagraphs.length ? reasonParagraphs : [reason.body]).map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </div>
      </div>
    </BentoCard>
  );
};
