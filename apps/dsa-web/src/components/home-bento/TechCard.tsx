import type React from 'react';
import { PanelRightOpen } from 'lucide-react';
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
}) => (
  <BentoCard
    eyebrow={title}
    className="col-span-6 xl:col-span-6"
    testId="home-bento-card-tech"
    action={(
      <button
        type="button"
        className={CARD_BUTTON_CLASS}
        data-testid="home-bento-drawer-trigger-tech"
        onClick={onOpenDetails}
      >
        <PanelRightOpen className="h-4 w-4" />
        <span>{detailLabel}</span>
      </button>
    )}
  >
    <div className="space-y-6">
      {signals.map((signal, index) => (
        <div
          key={signal.label}
          data-testid={`home-bento-tech-signal-${signal.label}`}
          className="grid gap-3 border-b border-white/[0.07] pb-6 last:border-b-0 last:pb-0"
        >
          <span className="text-[10px] font-semibold uppercase tracking-widest text-white/40">{signal.label}</span>
          <span
            className={`text-xl font-medium leading-tight ${getToneTextClass(signal.tone)}`}
            style={getToneTextStyle(signal.tone, index === 0)}
          >
            {signal.value}
          </span>
        </div>
      ))}
    </div>
  </BentoCard>
);
