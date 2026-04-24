import type { CSSProperties } from 'react';

export type SignalTone = 'bullish' | 'bearish' | 'neutral';

export const CARD_KICKER_CLASS = 'text-[11px] font-semibold uppercase tracking-[0.2em] text-white/42';
export const CARD_BUTTON_CLASS = 'inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/72 transition-colors duration-150 hover:border-white/18 hover:bg-white/[0.08] hover:text-white';
export const PANEL_METRIC_CLASS = 'rounded-[24px] border border-white/[0.08] bg-black/30 px-4 py-4';

const TONE_COLOR: Record<SignalTone, string> = {
  bullish: '#34D399',
  bearish: '#FB7185',
  neutral: '#F5F5F5',
};

const TONE_GLOW: Record<SignalTone, string> = {
  bullish: '0 0 30px rgba(52, 211, 153, 0.4)',
  bearish: '0 0 30px rgba(251, 113, 133, 0.38)',
  neutral: '0 0 24px rgba(255, 255, 255, 0.14)',
};

export function getToneTextClass(tone: SignalTone): string {
  if (tone === 'bullish') {
    return 'text-[#34D399]';
  }
  if (tone === 'bearish') {
    return 'text-[#FB7185]';
  }
  return 'text-white';
}

export function getToneBorderClass(tone: SignalTone): string {
  if (tone === 'bullish') {
    return 'border-[#34D399]/22 bg-[#34D399]/10 text-[#34D399]';
  }
  if (tone === 'bearish') {
    return 'border-[#FB7185]/22 bg-[#FB7185]/10 text-[#FB7185]';
  }
  return 'border-white/12 bg-white/[0.06] text-white/78';
}

export function getCardGlowClass(tone: SignalTone): string {
  if (tone === 'bullish') {
    return 'bg-[#34D399]/18';
  }
  if (tone === 'bearish') {
    return 'bg-[#FB7185]/18';
  }
  return 'bg-white/10';
}

export function getToneTextStyle(tone: SignalTone): CSSProperties {
  return {
    color: TONE_COLOR[tone],
    textShadow: TONE_GLOW[tone],
  };
}

