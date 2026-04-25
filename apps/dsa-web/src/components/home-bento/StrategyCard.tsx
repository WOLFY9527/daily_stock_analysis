import type React from 'react';
import { PanelRightOpen } from 'lucide-react';
import { BentoCard } from './BentoCard';
import { CARD_BUTTON_CLASS, getToneTextClass, getToneTextStyle } from './theme';

type StrategyMetric = {
  label: string;
  value: string;
  tone?: 'bullish' | 'bearish' | 'neutral';
};

type StrategyCardProps = {
  title: string;
  subtitle?: string;
  metrics: StrategyMetric[];
  positionLabel: string;
  positionBody: string;
  detailLabel: string;
  onOpenDetails: () => void;
};

export const StrategyCard: React.FC<StrategyCardProps> = ({
  title,
  subtitle,
  metrics,
  positionLabel,
  positionBody,
  detailLabel,
  onOpenDetails,
}) => {
  const isEntryMetric = (label: string) => label === '建仓区间' || label === 'Entry Zone';

  return (
  <BentoCard
    eyebrow={title}
    subtitle={subtitle}
    className="h-full"
    testId="home-bento-card-strategy"
    action={(
      <button
        type="button"
        className={CARD_BUTTON_CLASS}
        data-testid="home-bento-drawer-trigger-strategy"
        onClick={onOpenDetails}
      >
        <PanelRightOpen className="h-4 w-4" />
        <span>{detailLabel}</span>
      </button>
    )}
  >
    <div className="flex h-full flex-col">
      <div className="grid gap-8 md:grid-cols-3">
      {metrics.map((metric) => (
        <div key={metric.label} className="min-w-0" data-testid={`home-bento-strategy-metric-${metric.label}`}>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40">{metric.label}</p>
          <p
            className={`mt-3 font-medium leading-tight ${isEntryMetric(metric.label) ? 'whitespace-nowrap text-xl' : 'text-2xl'} ${getToneTextClass(metric.tone || 'neutral')}`}
            style={getToneTextStyle(metric.tone || 'neutral', false)}
          >
            {metric.value}
          </p>
        </div>
      ))}
      </div>
      <div className="mt-8 flex-1 border-t border-white/[0.08] pt-6">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40">{positionLabel}</p>
        <p className="mt-4 text-sm leading-relaxed text-white/68">{positionBody}</p>
      </div>
    </div>
  </BentoCard>
  );
};
