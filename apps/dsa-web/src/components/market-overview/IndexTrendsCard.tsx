import type React from 'react';
import type { MarketOverviewPanel } from '../../api/marketOverview';
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
  MarketOverviewSparkline,
} from './marketOverviewPrimitives';

export const IndexTrendsCard: React.FC<{ panel?: MarketOverviewPanel; loading?: boolean }> = ({ panel, loading }) => {
  const { t } = useI18n();
  const status = panel?.status || (loading ? 'loading' : 'failure');

  return (
    <GlassCard as="section" className="xl:col-span-4 flex h-full flex-col p-6">
      <div className="flex h-full flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40">{t('marketOverviewPage.cards.indexTrends.eyebrow')}</p>
            <h2 className="mt-2 text-xl font-semibold text-white">{t('marketOverviewPage.cards.indexTrends.title')}</h2>
            <p className="mt-1 text-sm text-white/55">{t('marketOverviewPage.cards.indexTrends.description')}</p>
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

        <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
          {(panel?.items || []).map((item) => {
            const tone = getDirectionTone(item.riskDirection);
            const sparklineTone = item.riskDirection === 'increasing'
              ? 'text-red-400'
              : item.riskDirection === 'decreasing'
                ? 'text-emerald-400'
                : 'text-white/35';

            return (
              <article key={item.symbol} className="min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-widest text-white/40">{item.label}</p>
                  <span className={cn('shrink-0 text-[11px] font-bold', tone)}>{formatChangeSummary(item, t('marketOverviewPage.direction.neutral'))}</span>
                </div>
                <p className="mt-2 truncate text-3xl font-bold font-mono text-white">{formatMetricValue(item)}</p>
                <div className="mt-1 flex items-center gap-2">
                  {item.unit ? <span className="text-[10px] uppercase tracking-widest text-white/24">{item.unit}</span> : null}
                  <span className="text-[10px] uppercase tracking-widest text-white/18">{item.symbol}</span>
                </div>
                <MarketOverviewSparkline values={item.trend} tone={sparklineTone} className="mt-2 h-8" />
              </article>
            );
          })}
        </div>

        {loading ? (
          <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm text-white/60">
            {t('marketOverviewPage.loading')}
          </div>
        ) : null}

        <MarketOverviewPanelFooter panel={panel} sourceLabel={t('marketOverviewPage.cards.indexTrends.source')} />
      </div>
    </GlassCard>
  );
};
