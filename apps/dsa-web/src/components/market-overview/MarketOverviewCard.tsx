import type React from 'react';
import type { MarketOverviewItem, MarketOverviewPanel } from '../../api/marketOverview';
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
  increasing: 'text-red-300 bg-red-500/10 ring-red-400/20',
  decreasing: 'text-emerald-300 bg-emerald-500/10 ring-emerald-400/20',
  neutral: 'text-sky-200 bg-sky-500/10 ring-sky-400/20',
};

function formatValue(item: MarketOverviewItem): string {
  if (item.value === null || item.value === undefined) {
    return 'N/A';
  }
  const value = Math.abs(item.value) >= 100 ? item.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : item.value.toFixed(2);
  return item.unit ? `${value} ${item.unit}` : value;
}

function Sparkline({ values }: { values?: number[] }) {
  const points = Array.isArray(values) ? values.filter((value) => Number.isFinite(value)) : [];
  if (points.length < 2) {
    return <div className="h-10 rounded-lg bg-white/[0.03]" data-testid="market-overview-sparkline" />;
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
      className="h-10 w-full overflow-visible"
      preserveAspectRatio="none"
      data-testid="market-overview-sparkline"
      aria-hidden="true"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
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
    <section
      className={cn(
        'group relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#07111f]/90 p-5 shadow-[0_22px_80px_rgba(0,0,0,0.38)] ring-1 ring-white/[0.03]',
        'before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_top_right,rgba(125,211,252,0.16),transparent_38%),linear-gradient(135deg,rgba(255,255,255,0.08),transparent_42%)] before:opacity-90',
        className || '',
      )}
    >
      <div className="relative z-10 flex h-full flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.26em] text-cyan-200/80">{eyebrow}</p>
            <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-white">{title}</h2>
            <p className="mt-1 max-w-xl text-sm text-slate-300/75">{description}</p>
          </div>
          <span className={cn(
            'rounded-full px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] ring-1',
            status === 'success' ? 'bg-emerald-400/10 text-emerald-200 ring-emerald-300/20' : 'bg-red-400/10 text-red-200 ring-red-300/20',
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

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(panel?.items || []).map((item) => {
            const direction = item.riskDirection || 'neutral';
            return (
              <article key={item.symbol} className="rounded-2xl border border-white/8 bg-white/[0.035] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{item.label}</p>
                    <p className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-white">{formatValue(item)}</p>
                  </div>
                  <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ring-1', riskTone[direction])}>
                    {item.changePct === null || item.changePct === undefined ? direction : `${item.changePct.toFixed(2)}%`}
                  </span>
                </div>
                <div className={cn('mt-4', direction === 'increasing' ? 'text-red-300' : direction === 'decreasing' ? 'text-emerald-300' : 'text-cyan-200')}>
                  <Sparkline values={item.trend} />
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 text-[0.68rem] uppercase tracking-[0.16em] text-slate-500">
                  <span>{item.symbol}</span>
                  <span>{item.source || 'source'}</span>
                </div>
              </article>
            );
          })}
        </div>

        {loading ? (
          <div className="rounded-2xl border border-white/8 bg-white/[0.035] p-4 text-sm text-slate-300">
            Loading live market data...
          </div>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3 text-xs text-slate-400">
          <span>Last refresh: {panel?.lastRefreshAt ? new Date(panel.lastRefreshAt).toLocaleString() : 'pending'}</span>
          <span>Log: {panel?.logSessionId || 'pending'}</span>
        </div>
      </div>
    </section>
  );
};
