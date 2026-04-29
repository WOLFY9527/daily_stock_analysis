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

function splitMetricSurprise(value: string): { main: string; surprise?: string; tone: SignalTone } {
  const match = value.match(/^(.*?)(\s*[（(][^）)]*[）)])\s*$/);
  if (!match) {
    return { main: value, tone: 'neutral' };
  }

  const surprise = match[2].trim();
  const normalized = surprise.toLowerCase();
  const tone: SignalTone = /beat|超预期|\+\s*\d|above|高于/.test(normalized)
    ? 'bullish'
    : /miss|不及预期|-\s*\d|below|低于/.test(normalized)
      ? 'bearish'
      : 'neutral';

  return {
    main: match[1].trim(),
    surprise,
    tone,
  };
}

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
      <div className="grid grid-cols-2 gap-3">
        {metrics.map((metric, index) => {
          const surprise = splitMetricSurprise(metric.value);
          const metricTone = metric.tone || 'neutral';
          return (
            <div
              key={metric.label}
              className="min-w-0 rounded-[18px] border border-white/[0.06] bg-white/[0.025] px-3.5 py-3"
              data-testid={`home-bento-fundamental-metric-${metric.label}`}
            >
              <Label micro as="p" className="block truncate">{metric.label}</Label>
              <p
                className={`mt-2.5 break-words whitespace-normal font-mono text-xl font-bold leading-tight ${getToneTextClass(metricTone)}`}
                style={getToneTextStyle(metricTone, index === 0)}
              >
                {surprise.main}
                {surprise.surprise ? (
                  <span
                    className={`mt-1 block text-[11px] font-semibold leading-tight tracking-[0.04em] ${getToneTextClass(surprise.tone)}`}
                    style={getToneTextStyle(surprise.tone)}
                  >
                    {surprise.surprise}
                  </span>
                ) : null}
              </p>
            </div>
          );
        })}
      </div>
    </BentoCard>
  );
};
