import type React from 'react';
import type { MarketOverviewPanel } from '../../api/marketOverview';
import { useI18n } from '../../contexts/UiLanguageContext';
import { MarketOverviewCard } from './MarketOverviewCard';

export const CryptoCard: React.FC<{
  panel?: MarketOverviewPanel;
  loading?: boolean;
  refreshing?: boolean;
  onRefresh: () => void;
}> = ({ panel, loading, refreshing = false, onRefresh }) => {
  const { t } = useI18n();

  return (
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
  );
};
