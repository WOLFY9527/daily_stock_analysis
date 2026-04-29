import type React from 'react';
import type { MarketOverviewPanel } from '../../api/marketOverview';
import { GlassCard } from '../common';
import { cn } from '../../utils/cn';
import { formatMetricValue, getDirectionTone } from './marketOverviewUtils';
import {
  MarketOverviewPanelFooter,
  MarketOverviewSparkline,
} from './marketOverviewPrimitives';

type MarketOverviewCardProps = {
  title: string;
  eyebrow: string;
  description: string;
  panel?: MarketOverviewPanel;
  loading?: boolean;
  className?: string;
};

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
                      <p className="min-w-0 truncate text-2xl font-mono text-white">{formatMetricValue(item)}</p>
                      {item.unit ? <span className="pb-0.5 text-[10px] uppercase tracking-widest text-white/25">{item.unit}</span> : null}
                    </div>
                  </div>
                  <span className={cn('shrink-0 text-xs font-bold', getDirectionTone(direction))}>
                    {item.changePct === null || item.changePct === undefined ? direction : `${item.changePct.toFixed(2)}%`}
                  </span>
                </div>
                <div className="mt-3">
                  <MarketOverviewSparkline values={item.trend} tone={sparklineTone} className="mt-0 h-10" />
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

        <MarketOverviewPanelFooter panel={panel} />
      </div>
    </GlassCard>
  );
};
