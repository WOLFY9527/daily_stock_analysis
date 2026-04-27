import type React from 'react';
import { PanelRightOpen } from 'lucide-react';
import { Label } from '../common';
import { useSafariWarmActivation } from '../../hooks/useSafariInteractionReady';
import { BentoCard } from './BentoCard';
import { CARD_BUTTON_CLASS, getToneTextClass, getToneTextStyle, type SignalTone } from './theme';

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
          className={CARD_BUTTON_CLASS}
          data-testid="home-bento-drawer-trigger-fundamentals"
          onClick={handleOpenDetailsClick}
          onPointerUp={handleOpenDetailsPointerUp}
        >
          <PanelRightOpen className="h-4 w-4" />
          <span>{detailLabel}</span>
        </button>
      )}
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-5">
        {metrics.map((metric, index) => (
          <div key={metric.label} className="min-w-0" data-testid={`home-bento-fundamental-metric-${metric.label}`}>
            <Label micro as="p" className="block truncate">{metric.label}</Label>
            <p
              className={`mt-2.5 break-words whitespace-normal text-lg font-bold leading-tight ${getToneTextClass(metric.tone || 'neutral')}`}
              style={getToneTextStyle(metric.tone || 'neutral', index === 0)}
            >
              {metric.value}
            </p>
          </div>
        ))}
      </div>
    </BentoCard>
  );
};
