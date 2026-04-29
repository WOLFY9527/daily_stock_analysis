import type React from 'react';
import type { MarketOverviewPanel } from '../../api/marketOverview';
import { useI18n } from '../../contexts/UiLanguageContext';
import { GlassCard } from '../common';
import { cn } from '../../utils/cn';
import { isRenderableMarketOverviewItem } from './marketOverviewUtils';
import {
  MarketOverviewDataRow,
  MarketOverviewPanelFooter,
} from './marketOverviewPrimitives';

export const IndexTrendsCard: React.FC<{ panel?: MarketOverviewPanel; loading?: boolean }> = ({ panel, loading }) => {
  const { t } = useI18n();
  const status = panel?.status || (loading ? 'loading' : 'failure');
  const items = (panel?.items || []).filter(isRenderableMarketOverviewItem);

  return (
    <GlassCard as="section" className="flex h-full flex-col p-6">
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

        <div className="flex flex-col">
          {items.map((item) => (
            <MarketOverviewDataRow
              key={item.symbol}
              item={item}
              neutralLabel={t('marketOverviewPage.direction.neutral')}
              valueClassName="text-xl"
            />
          ))}
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
