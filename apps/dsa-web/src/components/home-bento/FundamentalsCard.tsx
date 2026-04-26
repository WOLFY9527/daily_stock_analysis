import type React from 'react';
import { PanelRightOpen } from 'lucide-react';
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
}) => (
  <BentoCard
    eyebrow={title}
    className="w-full h-full rounded-[24px] lg:col-span-1 xl:col-span-1"
    testId="home-bento-card-fundamentals"
    action={(
      <button
        type="button"
        className={CARD_BUTTON_CLASS}
        data-testid="home-bento-drawer-trigger-fundamentals"
        onClick={onOpenDetails}
      >
        <PanelRightOpen className="h-4 w-4" />
        <span>{detailLabel}</span>
      </button>
    )}
  >
    <div className="grid grid-cols-2 gap-x-5 gap-y-4">
      {metrics.map((metric, index) => (
        <div key={metric.label} className="min-w-0" data-testid={`home-bento-fundamental-metric-${metric.label}`}>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40">{metric.label}</p>
          <p
            className={`mt-2 text-2xl font-medium leading-tight ${getToneTextClass(metric.tone || 'neutral')}`}
            style={getToneTextStyle(metric.tone || 'neutral', index === 0)}
          >
            {metric.value}
          </p>
        </div>
      ))}
    </div>
  </BentoCard>
);
