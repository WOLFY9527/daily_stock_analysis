import type React from 'react';
import { PanelRightOpen } from 'lucide-react';
import { useSafariWarmActivation } from '../../hooks/useSafariInteractionReady';
import { BentoCard } from './BentoCard';
import { type SignalTone } from './theme';

type FundamentalMetric = {
  label: string;
  value: string;
  tone?: SignalTone;
};

type FundamentalsCardProps = {
  title: string;
  metrics: FundamentalMetric[];
  detailLabel: string;
  onOpenDetails: () => void;
};

function splitMetricSurprise(value: string): { main: string; surprise?: string; tone: SignalTone } {
  const match = value.match(/^(.*?)(\s*[（(][^）)]*[）)])\s*$/);
  if (!match) {
    return { main: value, tone: 'neutral' };
  }

  const surprise = match[2].trim();
  const normalized = surprise.toLowerCase();
  const tone: SignalTone = /beat|超预期|\+\s*\d|above|高于/.test(normalized)
    ? 'bullish'
    : /miss|不及预期|-\s*\d|below|低于/.test(normalized)
      ? 'bearish'
      : 'neutral';

  return {
    main: match[1].trim(),
    surprise,
    tone,
  };
}

function isMutedValue(value: string): boolean {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized === '' || normalized === '-' || normalized === 'N/A';
}

export const FundamentalsCard: React.FC<FundamentalsCardProps> = ({
  title,
  metrics,
  detailLabel,
  onOpenDetails,
}) => {
  const {
    ref: openDetailsButtonRef,
    onClick: handleOpenDetailsClick,
    onPointerUp: handleOpenDetailsPointerUp,
  } = useSafariWarmActivation<HTMLButtonElement>(onOpenDetails);

  return (
    <BentoCard
      eyebrow={title}
      className="w-full h-full rounded-[24px]"
      testId="home-bento-card-fundamentals"
      action={(
        <button
          ref={openDetailsButtonRef}
          type="button"
          className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-white/40 transition-colors hover:text-white"
          data-testid="home-bento-drawer-trigger-fundamentals"
          onClick={handleOpenDetailsClick}
          onPointerUp={handleOpenDetailsPointerUp}
        >
          <PanelRightOpen className="h-3.5 w-3.5" />
          <span>{detailLabel}</span>
        </button>
      )}
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        {metrics.map((metric) => {
          const surprise = splitMetricSurprise(metric.value);
          const muted = isMutedValue(surprise.main);
          return (
            <div
              key={metric.label}
              className="min-w-0"
              data-testid={`home-bento-fundamental-metric-${metric.label}`}
            >
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-white/40">
                {metric.label}
              </span>
              <p className={`text-lg font-mono font-medium leading-tight ${muted ? 'text-white/20' : 'text-white'}`}>
                {surprise.main}
              </p>
              {surprise.surprise ? (
                <p className={`mt-1 text-[10px] font-medium leading-tight ${
                  surprise.tone === 'bullish'
                    ? 'text-emerald-400'
                    : surprise.tone === 'bearish'
                      ? 'text-red-400'
                      : 'text-white/35'
                }`}>
                  {surprise.surprise}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </BentoCard>
  );
};
