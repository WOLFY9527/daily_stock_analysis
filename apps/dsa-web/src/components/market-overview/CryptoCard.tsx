import type React from 'react';
import type { MarketOverviewPanel } from '../../api/marketOverview';
import { useI18n } from '../../contexts/UiLanguageContext';
import { MarketOverviewCard } from './MarketOverviewCard';

export const CryptoCard: React.FC<{
  panel?: MarketOverviewPanel;
  loading?: boolean;
  refreshing?: boolean;
  realtimeStatus?: 'live' | 'reconnecting' | 'snapshot';
  onRefresh: () => void;
}> = ({ panel, loading, refreshing = false, realtimeStatus = 'snapshot', onRefresh }) => {
  const { t } = useI18n();
  const statusLabel = realtimeStatus === 'live' ? 'Live' : realtimeStatus === 'reconnecting' ? 'Reconnecting' : 'Snapshot';

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-end">
        <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/55">
          {statusLabel}
        </span>
      </div>
      {realtimeStatus === 'reconnecting' ? (
        <div className="rounded-lg border border-amber-300/20 bg-amber-400/8 px-3 py-2 text-xs text-amber-100/80">
          实时连接断开，显示最近快照
        </div>
      ) : null}
      <MarketOverviewCard
        title={t('marketOverviewPage.cards.crypto.title')}
        eyebrow={t('marketOverviewPage.cards.crypto.eyebrow')}
        description={t('marketOverviewPage.cards.crypto.description')}
        sourceLabel={t('marketOverviewPage.cards.crypto.source')}
        panel={panel}
        loading={loading}
        refreshing={refreshing}
        onRefresh={onRefresh}
      />
    </div>
  );
};
