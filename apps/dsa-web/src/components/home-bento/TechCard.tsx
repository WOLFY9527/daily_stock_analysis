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
    className="xl:col-span-6"
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
    <div className="space-y-3">
      {signals.map((signal) => (
        <div
          key={signal.label}
          className="flex items-center justify-between gap-3 rounded-[28px] border border-white/[0.08] bg-white/[0.02] p-6 backdrop-blur-xl"
        >
          <span className="text-sm text-white/62">{signal.label}</span>
          <span
            className={`text-sm font-semibold ${getToneTextClass(signal.tone)}`}
            style={getToneTextStyle(signal.tone, false)}
          >
            {signal.value}
          </span>
        </div>
      ))}
    </div>
  </BentoCard>
);
