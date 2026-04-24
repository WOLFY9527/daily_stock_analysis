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
    <div className="space-y-3">
      {signals.map((signal, index) => (
        <div
          key={signal.label}
          className="flex items-center justify-between gap-3 rounded-[32px] border border-white/5 bg-white/[0.02] p-6 backdrop-blur-2xl"
        >
          <span className="text-sm text-white/62">{signal.label}</span>
          <span
            className={`text-sm font-semibold ${getToneTextClass(signal.tone)}`}
            style={getToneTextStyle(signal.tone, index === 0)}
          >
            {signal.value}
          </span>
        </div>
      ))}
    </div>
  </BentoCard>
);
