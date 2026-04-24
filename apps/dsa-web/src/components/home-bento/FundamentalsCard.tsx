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
    className="xl:col-span-3"
    testId="home-bento-card-fundamentals"
    action={(
      <button type="button" className={CARD_BUTTON_CLASS} onClick={onOpenDetails}>
        <PanelRightOpen className="h-4 w-4" />
        <span>{detailLabel}</span>
      </button>
    )}
  >
    <div className="grid grid-cols-2 gap-3">
      {metrics.map((metric) => (
        <div key={metric.label} className="rounded-[24px] border border-white/[0.08] bg-black/28 px-4 py-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">{metric.label}</p>
          <p
            className={`mt-3 text-lg font-semibold ${getToneTextClass(metric.tone || 'neutral')}`}
            style={getToneTextStyle(metric.tone || 'neutral')}
          >
            {metric.value}
          </p>
        </div>
      ))}
    </div>
  </BentoCard>
);

