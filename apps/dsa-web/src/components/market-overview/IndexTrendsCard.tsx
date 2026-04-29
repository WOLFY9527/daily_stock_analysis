import type React from 'react';
import type { MarketOverviewPanel } from '../../api/marketOverview';
import { MarketOverviewCard } from './MarketOverviewCard';

export const IndexTrendsCard: React.FC<{ panel?: MarketOverviewPanel; loading?: boolean }> = ({ panel, loading }) => (
  <MarketOverviewCard
    title="Index Trends"
    eyebrow="US + CN indices"
    description="SPX, NASDAQ, DJIA, Russell 2000, CSI300, SSE, and SZSE with compact trend context."
    panel={panel}
    loading={loading}
    className="xl:col-span-7"
  />
);
