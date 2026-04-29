import type React from 'react';
import { useI18n } from '../../contexts/UiLanguageContext';
import type { MarketOverviewItem, MarketOverviewPanel } from '../../api/marketOverview';
import { cn } from '../../utils/cn';
import { formatMarketOverviewTimestamp } from './marketOverviewFormat';
import {
  formatChangeSummary,
  formatMetricValue,
  getDirectionTone,
} from './marketOverviewUtils';
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

export const MarketOverviewDataRow: React.FC<{
  item: MarketOverviewItem;
  neutralLabel: string;
  valueClassName?: string;
  valueDigitsBelowHundred?: number;
}> = ({ item, neutralLabel, valueClassName, valueDigitsBelowHundred = 2 }) => {
  const direction = item.riskDirection || 'neutral';
  const tone = getDirectionTone(direction);
  const sparklineTone = direction === 'increasing'
    ? 'text-red-400'
    : direction === 'decreasing'
      ? 'text-emerald-400'
      : 'text-white/35';

  return (
    <article className="flex min-h-12 items-center gap-3 border-b border-white/[0.045] py-2.5 last:border-b-0">
      <div className="flex w-32 shrink-0 items-center gap-2">
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full bg-current shadow-[0_0_12px_currentColor]', tone)} aria-hidden="true" />
        <div className="min-w-0">
          <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-white/40">{item.label}</p>
          <p className="mt-0.5 truncate text-[9px] font-semibold uppercase tracking-widest text-white/22">{item.symbol}</p>
        </div>
      </div>
      <div className="w-24 shrink-0">
        <MarketOverviewSparkline values={item.trend} tone={sparklineTone} className="h-8" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-end text-right font-mono">
        <p className={cn('truncate text-lg font-semibold leading-none text-white', valueClassName)}>{formatMetricValue(item, valueDigitsBelowHundred)}</p>
        <div className="mt-0.5 flex items-center justify-end">
          <span className={cn('text-[11px] font-bold leading-none', tone)}>
            {formatChangeSummary(item, neutralLabel)}
          </span>
        </div>
      </div>
    </article>
  );
};
