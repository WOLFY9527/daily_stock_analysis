import type React from 'react';
import type { MarketOverviewPanel } from '../../api/marketOverview';
import { useI18n } from '../../contexts/UiLanguageContext';
import { GlassCard } from '../common';
import { cn } from '../../utils/cn';
import { isRenderableMarketOverviewItem } from './marketOverviewUtils';
import {
  MarketOverviewDataRow,
  MarketOverviewPanelFooter,
  MarketOverviewRefreshButton,
} from './marketOverviewPrimitives';

type MarketOverviewCardProps = {
  title: string;
  eyebrow: string;
  description: string;
  sourceLabel: string;
  panel?: MarketOverviewPanel;
  loading?: boolean;
  refreshing?: boolean;
  onRefresh: () => void;
  className?: string;
};

export const MarketOverviewCard: React.FC<MarketOverviewCardProps> = ({
  title,
  eyebrow,
  description,
  sourceLabel,
  panel,
  loading = false,
  refreshing = false,
  onRefresh,
  className,
}) => {
  const { t } = useI18n();
  const items = (panel?.items || []).filter(isRenderableMarketOverviewItem);

  return (
    <GlassCard
      as="section"
      className={cn(
        'flex h-full flex-col p-6',
        className || '',
      )}
    >
      <div className="flex h-full flex-col gap-5">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40">{eyebrow}</p>
            <h2 className="mt-2 text-xl font-semibold text-white">{title}</h2>
            <p className="mt-1 max-w-xl text-sm text-white/55">{description}</p>
          </div>
          <MarketOverviewRefreshButton
            label={t('marketOverviewPage.refreshCard', { title })}
            refreshing={refreshing}
            onRefresh={onRefresh}
          />
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
            />
          ))}
        </div>

        {loading ? (
          <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm text-white/60">
            {t('marketOverviewPage.loading')}
          </div>
        ) : null}

        <MarketOverviewPanelFooter panel={panel} sourceLabel={sourceLabel} />
      </div>
    </GlassCard>
  );
};
