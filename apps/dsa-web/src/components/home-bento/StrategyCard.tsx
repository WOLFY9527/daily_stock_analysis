import type React from 'react';
import { PanelRightOpen } from 'lucide-react';
import { useSafariWarmActivation } from '../../hooks/useSafariInteractionReady';
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
  const openDetailsButton = useSafariWarmActivation<HTMLButtonElement>(onOpenDetails);
  const isEntryMetric = (label: string) => label === '建仓区间' || label === 'Entry Zone';
  const positionParagraphs = positionBody
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <BentoCard
      eyebrow={title}
      subtitle={subtitle}
      className="w-full rounded-[24px]"
      testId="home-bento-card-strategy"
      action={(
        <button
          ref={openDetailsButton.ref}
          type="button"
          className={CARD_BUTTON_CLASS}
          data-testid="home-bento-drawer-trigger-strategy"
          onClick={openDetailsButton.onClick}
          onPointerUp={openDetailsButton.onPointerUp}
        >
          <PanelRightOpen className="h-4 w-4" />
          <span>{detailLabel}</span>
        </button>
      )}
    >
      <div className="grid h-full gap-6 md:grid-cols-2">
        <div className="grid w-full grid-cols-2 gap-x-4 gap-y-3.5 self-start">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className={`${isEntryMetric(metric.label) ? 'col-span-2 flex flex-col gap-1' : 'flex flex-col gap-1'} min-w-0`}
              data-testid={`home-bento-strategy-metric-${metric.label}`}
            >
              <p className="block truncate text-[10px] font-semibold uppercase tracking-widest text-white/40">{metric.label}</p>
              <p
                className={`break-words whitespace-normal text-lg font-bold leading-tight ${getToneTextClass(metric.tone || 'neutral')}`}
                style={getToneTextStyle(metric.tone || 'neutral', false)}
              >
                {metric.value}
              </p>
            </div>
          ))}
        </div>
        <div className="border-t border-white/[0.08] pt-5 md:border-l md:border-t-0 md:pl-6 md:pt-0">
          <p className="block truncate text-[10px] font-semibold uppercase tracking-widest text-white/40">{positionLabel}</p>
          <div className="mt-3 space-y-2 break-words text-[13px] leading-[1.7] text-white/70 whitespace-normal">
            {(positionParagraphs.length ? positionParagraphs : [positionBody]).map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </div>
      </div>
    </BentoCard>
  );
};
