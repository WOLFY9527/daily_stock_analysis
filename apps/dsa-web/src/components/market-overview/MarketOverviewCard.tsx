import type React from 'react';
import type { MarketOverviewItem, MarketOverviewPanel } from '../../api/marketOverview';
import { GlassCard } from '../common';
import { cn } from '../../utils/cn';

type MarketOverviewCardProps = {
  title: string;
  eyebrow: string;
  description: string;
  panel?: MarketOverviewPanel;
  loading?: boolean;
  className?: string;
};

const riskTone = {
  increasing: 'text-red-400',
  decreasing: 'text-emerald-400',
  neutral: 'text-white/45',
};

function formatValue(item: MarketOverviewItem): string {
  if (item.value === null || item.value === undefined) {
    return 'N/A';
  }
  return Math.abs(item.value) >= 100
    ? item.value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : item.value.toFixed(2);
}

function Sparkline({ values, tone }: { values?: number[]; tone: string }) {
  const points = Array.isArray(values) ? values.filter((value) => Number.isFinite(value)) : [];
  if (points.length < 2) {
    return <div className="h-10" data-testid="market-overview-sparkline" />;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const path = points.map((value, index) => {
    const x = (index / (points.length - 1)) * 100;
    const y = 36 - ((value - min) / span) * 30;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');

  return (
    <svg
      viewBox="0 0 100 40"
      className={cn('h-10 w-full overflow-visible', tone)}
      preserveAspectRatio="none"
      data-testid="market-overview-sparkline"
      aria-hidden="true"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export const MarketOverviewCard: React.FC<MarketOverviewCardProps> = ({
  title,
  eyebrow,
  description,
  panel,
  loading = false,
  className,
}) => {
  const status = panel?.status || (loading ? 'loading' : 'failure');

  return (
    <GlassCard
      as="section"
      className={cn(
        'flex h-full flex-col p-6',
        className || '',
      )}
    >
      <div className="flex h-full flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40">{eyebrow}</p>
            <h2 className="mt-2 text-xl font-semibold text-white">{title}</h2>
            <p className="mt-1 max-w-xl text-sm text-white/55">{description}</p>
          </div>
          <span className={cn(
            'text-[10px] font-semibold uppercase tracking-widest',
            status === 'success' ? 'text-emerald-400' : 'text-red-400',
          )}
          >
            {status}
          </span>
        </div>

        {panel?.errorMessage ? (
          <div className="rounded-2xl border border-red-300/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {panel.errorMessage}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-x-8 gap-y-6 lg:grid-cols-3">
          {(panel?.items || []).map((item) => {
            const direction = item.riskDirection || 'neutral';
            const sparklineTone = direction === 'increasing'
              ? 'text-red-400'
              : direction === 'decreasing'
                ? 'text-emerald-400'
                : 'text-white/35';
            return (
              <article key={item.symbol} className="min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-white/40">{item.label}</p>
                    <div className="mt-2 flex items-end gap-2">
                      <p className="min-w-0 truncate text-2xl font-mono text-white">{formatValue(item)}</p>
                      {item.unit ? <span className="pb-0.5 text-[10px] uppercase tracking-widest text-white/25">{item.unit}</span> : null}
                    </div>
                  </div>
                  <span className={cn('shrink-0 text-xs font-bold', riskTone[direction])}>
                    {item.changePct === null || item.changePct === undefined ? direction : `${item.changePct.toFixed(2)}%`}
                  </span>
                </div>
                <div className="mt-3">
                  <Sparkline values={item.trend} tone={sparklineTone} />
                </div>
                <div className="mt-2 text-[10px] uppercase tracking-widest text-white/24">{item.symbol}</div>
              </article>
            );
          })}
        </div>

        {loading ? (
          <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm text-white/60">
            Loading live market data...
          </div>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3 text-xs text-white/35">
          <span>Last refresh: {panel?.lastRefreshAt ? new Date(panel.lastRefreshAt).toLocaleString() : 'pending'}</span>
          <span>Log: {panel?.logSessionId || 'pending'}</span>
        </div>
      </div>
    </GlassCard>
  );
};
