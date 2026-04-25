import type React from 'react';
import { PanelRightOpen } from 'lucide-react';
import { BentoCard } from './BentoCard';
import {
  CARD_BUTTON_CLASS,
  CARD_KICKER_CLASS,
  PANEL_METRIC_CLASS,
  SYSTEM_ACCENT_BORDER_CLASS,
  SYSTEM_ACCENT_GLOW_CLASS,
  type SignalTone,
  getToneBorderClass,
  getToneTextClass,
  getToneTextStyle,
} from './theme';

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
  detailLabel,
  onOpenDetails,
}) => (
  <BentoCard
    eyebrow={eyebrow}
    tone={signalTone}
    accentGlow
    accentGlowClassName={SYSTEM_ACCENT_GLOW_CLASS}
    className="xl:col-span-6"
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
    <div className="flex h-full flex-col gap-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-white/78">
            <span className="font-medium text-white">{company}</span>
            <span className="font-mono text-white/40">{ticker}</span>
          </div>
          <div className="mt-5 flex flex-wrap items-end gap-4">
            <div>
              <p className={CARD_KICKER_CLASS}>{heroLabel}</p>
              <div className="mt-2 flex items-end gap-2">
                <span className="text-[72px] font-semibold leading-none text-white">{heroValue}</span>
                <span className="pb-2 text-base text-white/42">{heroUnit}</span>
              </div>
            </div>
            <div className="pb-2">
              <p className={CARD_KICKER_CLASS}>{scoreLabel}</p>
              <p
                className={`mt-2 text-[32px] font-semibold leading-none ${getToneTextClass(signalTone)}`}
                style={getToneTextStyle(signalTone, true)}
              >
                {signalLabel}
              </p>
            </div>
          </div>
          <div className={`mt-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${getToneBorderClass(signalTone)}`}>
            <span className="h-2 w-2 rounded-full bg-current" />
            <span>{badge}</span>
          </div>
        </div>

        <div className={`${PANEL_METRIC_CLASS} min-w-[12rem]`}>
          <p className={CARD_KICKER_CLASS}>{scoreLabel}</p>
          <p className="mt-3 text-3xl font-medium text-white">{scoreValue}</p>
          <p className="mt-4 text-sm leading-relaxed text-white/55">{summary}</p>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden rounded-[32px] border border-white/[0.08] bg-white/[0.02] p-6 backdrop-blur-xl">
        <svg className="h-44 w-full text-[#34D399]" viewBox="0 0 100 56" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="home-bento-decision-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1="0" y1="22" x2="100" y2="22" stroke="rgba(148, 163, 184, 0.36)" strokeWidth="0.6" strokeDasharray="2.4 2.2" />
          <line x1="0" y1="8" x2="100" y2="8" stroke="rgba(255, 255, 255, 0.05)" strokeWidth="0.4" />
          <line x1="0" y1="38" x2="100" y2="38" stroke="rgba(255, 255, 255, 0.05)" strokeWidth="0.4" />
          <polygon points="0,56 0,40 18,37 36,27 52,31 70,18 85,12 100,6 100,56" fill="url(#home-bento-decision-fill)" />
          <polyline
            points="0,40 18,37 36,27 52,31 70,18 85,12 100,6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ filter: 'drop-shadow(0 4px 8px rgba(52, 211, 153, 0.4))' }}
          />
          <circle cx="70" cy="18" r="1.9" fill="#34D399" />
          <circle cx="70" cy="18" r="4.8" fill="rgba(52, 211, 153, 0.16)" />
        </svg>
        <div className="pointer-events-none absolute inset-y-6 left-6 flex flex-col justify-between text-[10px] text-white/28">
          <span>120.00</span>
          <span>115.00</span>
          <span>110.00</span>
        </div>
        <div className="pointer-events-none absolute inset-x-8 bottom-5 flex justify-between text-[10px] text-white/28">
          <span>09:30</span>
          <span>11:30</span>
          <span>14:00</span>
        </div>
        <div
          className={`pointer-events-none absolute left-[70%] top-[32%] inline-flex -translate-x-[14%] -translate-y-full items-center gap-2 rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] backdrop-blur-xl ${SYSTEM_ACCENT_BORDER_CLASS}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {chartLabel}
        </div>
      </div>
    </div>
  </BentoCard>
);
