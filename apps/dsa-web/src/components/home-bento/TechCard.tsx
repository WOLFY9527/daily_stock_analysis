import type React from 'react';
import { PanelRightOpen } from 'lucide-react';
import { useSafariWarmActivation } from '../../hooks/useSafariInteractionReady';
import { BentoCard } from './BentoCard';
import { type SignalTone } from './theme';

type TechSignal = {
  label: string;
  value: string;
  tone: SignalTone;
};

type TechCardProps = {
  title: string;
  signals: TechSignal[];
  detailLabel: string;
  onOpenDetails: () => void;
};

function isMutedValue(value: string): boolean {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized === '' || normalized === '-' || normalized === 'N/A';
}

export const TechCard: React.FC<TechCardProps> = ({
  title,
  signals,
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
      testId="home-bento-card-tech"
      action={(
        <button
          ref={openDetailsButtonRef}
          type="button"
          className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-white/40 transition-colors hover:text-white"
          data-testid="home-bento-drawer-trigger-tech"
          onClick={handleOpenDetailsClick}
          onPointerUp={handleOpenDetailsPointerUp}
        >
          <PanelRightOpen className="h-3.5 w-3.5" />
          <span>{detailLabel}</span>
        </button>
      )}
    >
      <div className="divide-y divide-white/5">
        {signals.map((signal) => (
          <div
            key={signal.label}
            data-testid={`home-bento-tech-signal-${signal.label}`}
            className="flex items-center justify-between gap-4 py-2.5"
          >
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-white/40">
              {signal.label}
            </span>
            <span
              className={`min-w-0 text-right text-sm font-medium ${
                isMutedValue(signal.value) ? 'text-white/20' : 'text-white'
              }`}
            >
              {signal.value}
            </span>
          </div>
        ))}
      </div>
    </BentoCard>
  );
};
