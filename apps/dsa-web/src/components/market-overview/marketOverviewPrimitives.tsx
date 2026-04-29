import type React from 'react';
import { useI18n } from '../../contexts/UiLanguageContext';
import type { MarketOverviewPanel } from '../../api/marketOverview';
import { cn } from '../../utils/cn';
import { formatMarketOverviewTimestamp } from './marketOverviewFormat';
export const MarketOverviewSparkline: React.FC<{ values?: number[]; tone?: string; className?: string }> = ({
  values,
  tone = 'text-white/35',
  className,
}) => {
  const points = Array.isArray(values) ? values.filter((value) => Number.isFinite(value)) : [];
  if (points.length < 2) {
    return <div className={cn('h-8', className)} data-testid="market-overview-sparkline" />;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const path = points.map((value, index) => {
    const x = (index / (points.length - 1)) * 100;
    const y = 32 - ((value - min) / span) * 24;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');

  return (
    <svg
      viewBox="0 0 100 34"
      className={cn('w-full overflow-visible', tone, className)}
      preserveAspectRatio="none"
      data-testid="market-overview-sparkline"
      aria-hidden="true"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

export const MarketOverviewPanelFooter: React.FC<{ panel?: MarketOverviewPanel; sourceLabel: string }> = ({ panel, sourceLabel }) => {
  const { t } = useI18n();
  const timestamp = formatMarketOverviewTimestamp(panel?.lastRefreshAt);

  return (
    <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3">
      <span className="text-[10px] uppercase tracking-widest text-white/30">
        {t('marketOverviewPage.footer.lastRefresh', {
          timestamp: timestamp || t('marketOverviewPage.footer.pending'),
        })}
      </span>
      <span className="text-[10px] uppercase tracking-widest text-white/30">{sourceLabel}</span>
    </div>
  );
};
