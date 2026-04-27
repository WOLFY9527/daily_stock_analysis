import type React from 'react';
import { PanelRightOpen } from 'lucide-react';
import { Label } from '../common';
import { useSafariWarmActivation } from '../../hooks/useSafariInteractionReady';
import { BentoCard } from './BentoCard';
import { CARD_BUTTON_CLASS, getToneTextClass, getToneTextStyle, type SignalTone } from './theme';

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
          className={CARD_BUTTON_CLASS}
          data-testid="home-bento-drawer-trigger-tech"
          onClick={handleOpenDetailsClick}
          onPointerUp={handleOpenDetailsPointerUp}
        >
          <PanelRightOpen className="h-4 w-4" />
          <span>{detailLabel}</span>
        </button>
      )}
    >
      <div className="space-y-5">
        {signals.map((signal, index) => (
          <div
            key={signal.label}
            data-testid={`home-bento-tech-signal-${signal.label}`}
            className="grid min-w-0 gap-2.5 border-b border-white/[0.07] pb-5 last:border-b-0 last:pb-0"
          >
            <Label micro className="block truncate">{signal.label}</Label>
            <span
              className={`block break-words whitespace-normal text-base font-bold leading-tight ${getToneTextClass(signal.tone)}`}
              style={getToneTextStyle(signal.tone, index === 0)}
            >
              {signal.value}
            </span>
          </div>
        ))}
      </div>
    </BentoCard>
  );
};
