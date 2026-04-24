import type React from 'react';
import { PanelRightOpen } from 'lucide-react';
import { BentoCard } from './BentoCard';
import { CARD_BUTTON_CLASS, PANEL_METRIC_CLASS, getToneTextClass, getToneTextStyle } from './theme';

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
}) => (
  <BentoCard
    eyebrow={title}
    subtitle={subtitle}
    className="xl:col-span-5"
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
    <div className="grid gap-3 md:grid-cols-3">
      {metrics.map((metric) => (
        <div key={metric.label} className={PANEL_METRIC_CLASS}>
          <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">{metric.label}</p>
          <p
            className={`mt-3 text-xl font-semibold ${getToneTextClass(metric.tone || 'neutral')}`}
            style={getToneTextStyle(metric.tone || 'neutral', false)}
          >
            {metric.value}
          </p>
        </div>
      ))}
    </div>
    <div className="mt-4 rounded-[28px] border border-white/[0.08] bg-white/[0.02] p-6 backdrop-blur-xl">
      <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">{positionLabel}</p>
      <p className="mt-3 text-sm leading-6 text-white/68">{positionBody}</p>
    </div>
  </BentoCard>
);
