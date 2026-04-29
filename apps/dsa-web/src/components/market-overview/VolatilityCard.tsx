import type React from 'react';
import type { MarketOverviewItem, MarketOverviewPanel } from '../../api/marketOverview';
import { useI18n } from '../../contexts/UiLanguageContext';
import { GlassCard } from '../common';
import { cn } from '../../utils/cn';
import {
  formatChangeSummary,
  formatMetricValue,
  getDirectionTone,
} from './marketOverviewUtils';
import {
  MarketOverviewPanelFooter,
} from './marketOverviewPrimitives';

const VOLATILITY_FLOOR = 10;
const VOLATILITY_CEILING = 40;

function resolvePrimaryItem(items: MarketOverviewItem[]): MarketOverviewItem | undefined {
  return items.find((item) => item.symbol.toUpperCase() === 'VIX') || items[0];
}

function clampNeedle(value?: number | null): number {
  if (value === null || value === undefined) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, (value - VOLATILITY_FLOOR) / (VOLATILITY_CEILING - VOLATILITY_FLOOR)));
}

export const VolatilityCard: React.FC<{ panel?: MarketOverviewPanel; loading?: boolean }> = ({ panel, loading }) => {
  const { t } = useI18n();
  const status = panel?.status || (loading ? 'loading' : 'failure');
  const items = panel?.items || [];
  const primary = resolvePrimaryItem(items);
  const supporting = items.filter((item) => item.symbol !== primary?.symbol);
  const needleOffset = `${clampNeedle(primary?.value) * 100}%`;

  return (
    <GlassCard as="section" className="xl:col-span-4 flex h-full flex-col p-6">
      <div className="flex h-full flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40">{t('marketOverviewPage.cards.volatility.eyebrow')}</p>
            <h2 className="mt-2 text-xl font-semibold text-white">{t('marketOverviewPage.cards.volatility.title')}</h2>
          </div>
          <span className={cn('text-[10px] font-semibold uppercase tracking-widest', status === 'success' ? 'text-emerald-400' : 'text-red-400')}>
            {t(`marketOverviewPage.status.${status}`)}
          </span>
        </div>

        {panel?.errorMessage ? (
          <div className="rounded-2xl border border-red-300/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {panel.errorMessage}
          </div>
        ) : null}

        {primary ? (
          <div className="rounded-2xl border border-white/6 bg-white/[0.015] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-white/40">{t('marketOverviewPage.cards.volatility.primaryLabel')}</p>
                <p className="text-3xl font-bold font-mono text-white">{formatMetricValue(primary)}</p>
                <p className="mt-1 text-xs uppercase tracking-widest text-white/28">{t('marketOverviewPage.cards.volatility.primaryMeta')}</p>
              </div>
              <span className={cn('pt-1 text-[11px] font-bold', getDirectionTone(primary.riskDirection))}>
                {formatChangeSummary(primary, t('marketOverviewPage.direction.neutral'))}
              </span>
            </div>

            <div className="mt-6">
              <div className="relative h-2 overflow-hidden rounded-full bg-white/6">
                <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(52,211,153,0.95)_0%,rgba(99,102,241,0.85)_50%,rgba(248,113,113,0.95)_100%)]" />
                <div
                  className="absolute top-1/2 h-5 w-px -translate-y-1/2 bg-white shadow-[0_0_12px_rgba(255,255,255,0.95)]"
                  style={{ left: needleOffset }}
                  aria-hidden="true"
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-widest text-white/35">
                <span>{t('marketOverviewPage.cards.volatility.left')}</span>
                <span>{primary.value?.toFixed(2) ?? 'N/A'}</span>
                <span>{t('marketOverviewPage.cards.volatility.right')}</span>
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {supporting.map((item) => (
            <div key={item.symbol} className="min-w-0 rounded-2xl border border-white/6 bg-white/[0.015] p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-widest text-white/40">{item.label}</p>
                <span className={cn('shrink-0 text-[11px] font-bold', getDirectionTone(item.riskDirection))}>
                  {item.changePct === null || item.changePct === undefined ? t('marketOverviewPage.direction.neutral') : `${item.changePct >= 0 ? '+' : ''}${item.changePct.toFixed(2)}%`}
                </span>
              </div>
              <p className="mt-3 truncate text-2xl font-mono text-white">{formatMetricValue(item)}</p>
              <div className="mt-2 flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/24">
                {item.unit ? <span>{item.unit}</span> : null}
                <span>{item.symbol}</span>
              </div>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm text-white/60">
            {t('marketOverviewPage.loading')}
          </div>
        ) : null}

        <MarketOverviewPanelFooter panel={panel} sourceLabel={t('marketOverviewPage.cards.volatility.source')} />
      </div>
    </GlassCard>
  );
};
