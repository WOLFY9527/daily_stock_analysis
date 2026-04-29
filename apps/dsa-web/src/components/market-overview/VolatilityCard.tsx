import type React from 'react';
import type { MarketOverviewItem, MarketOverviewPanel } from '../../api/marketOverview';
import { useI18n } from '../../contexts/UiLanguageContext';
import { GlassCard } from '../common';
import { cn } from '../../utils/cn';
import { isRenderableMarketOverviewItem } from './marketOverviewUtils';
import {
  MarketOverviewDataRow,
  MarketOverviewPanelFooter,
} from './marketOverviewPrimitives';

function resolvePrimaryItem(items: MarketOverviewItem[]): MarketOverviewItem | undefined {
  return items.find((item) => item.symbol.toUpperCase() === 'VIX') || items[0];
}

function greedFearItem(): MarketOverviewItem {
  return {
    symbol: 'FGI',
    label: 'GREED / FEAR INDEX',
    value: 65,
    unit: 'GREED',
    changePct: 0,
    riskDirection: 'decreasing',
    trend: [48, 52, 57, 61, 65],
    source: 'layout_baseline',
  };
}

export const VolatilityCard: React.FC<{ panel?: MarketOverviewPanel; loading?: boolean }> = ({ panel, loading }) => {
  const { t } = useI18n();
  const status = panel?.status || (loading ? 'loading' : 'failure');
  const items = (panel?.items || []).filter(isRenderableMarketOverviewItem);
  const primary = resolvePrimaryItem(items);
  const compactItems = [
    ...(primary ? [primary] : []),
    greedFearItem(),
    ...items.filter((item) => item.symbol !== primary?.symbol),
  ];

  return (
    <GlassCard as="section" className="flex h-full flex-col p-6">
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

        <div className="flex flex-col">
          {compactItems.map((item) => (
            <MarketOverviewDataRow
              key={item.symbol}
              item={item}
              neutralLabel={t('marketOverviewPage.direction.neutral')}
              valueClassName={item.symbol === 'FGI' ? 'text-emerald-400' : undefined}
              valueDigitsBelowHundred={item.symbol === 'FGI' ? 1 : 2}
            />
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
