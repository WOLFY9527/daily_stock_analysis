import type { CSSProperties } from 'react';

export type SignalTone = 'bullish' | 'bearish' | 'neutral';

export const CARD_KICKER_CLASS = 'block truncate text-[10px] font-semibold uppercase tracking-widest text-white/40';
export const CARD_BUTTON_CLASS = 'inline-flex items-center gap-1.5 rounded-full border border-white/5 bg-white/[0.01] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/72 backdrop-blur-xl transition-colors duration-150 hover:border-white/[0.08] hover:bg-white/[0.02] hover:text-white';
export const PANEL_METRIC_CLASS = 'rounded-[18px] border border-white/5 bg-white/[0.01] p-4 backdrop-blur-xl';
export const BENTO_SURFACE_ROOT_CLASS = 'bento-surface-root';
export const BENTO_GRID_ROOT_CLASS = 'bento-grid-root';
export const SYSTEM_ACCENT_TEXT_CLASS = 'text-[#60A5FA]';
export const SYSTEM_ACCENT_BORDER_CLASS = 'border-[#60A5FA]/24 bg-[#3B82F6]/10 text-[#60A5FA]';
export const SYSTEM_ACCENT_GLOW_CLASS = 'bg-[#3B82F6]/16';

const TONE_COLOR: Record<SignalTone, string> = {
  bullish: '#34D399',
  bearish: '#FB7185',
  neutral: '#F5F5F5',
};

const TONE_GLOW: Record<SignalTone, string> = {
  bullish: '0 0 30px rgba(52, 211, 153, 0.4)',
  bearish: '0 0 30px rgba(251, 113, 133, 0.38)',
  neutral: 'none',
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
    return 'bg-[#34D399]/14';
  }
  if (tone === 'bearish') {
    return 'bg-[#FB7185]/14';
  }
  return 'bg-transparent';
}

export function getToneTextStyle(tone: SignalTone, glow = false): CSSProperties {
  return {
    color: TONE_COLOR[tone],
    textShadow: glow ? TONE_GLOW[tone] : 'none',
  };
}
