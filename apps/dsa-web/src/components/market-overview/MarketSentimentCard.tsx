import type React from 'react';
import type { MarketOverviewPanel } from '../../api/marketOverview';
import { MarketOverviewCard } from './MarketOverviewCard';

export const MarketSentimentCard: React.FC<{ panel?: MarketOverviewPanel; loading?: boolean }> = ({ panel, loading }) => (
  <MarketOverviewCard
    title="Market Sentiment"
    eyebrow="Positioning mood"
    description="Fear & Greed, Put/Call, Bull/Bear spread, and AAII sentiment in one audit-friendly panel."
    panel={panel}
    loading={loading}
    className="xl:col-span-4"
  />
);
