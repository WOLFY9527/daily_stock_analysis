import type React from 'react';
import type { MarketOverviewPanel } from '../../api/marketOverview';
import { MarketOverviewCard } from './MarketOverviewCard';

export const FundsFlowCard: React.FC<{ panel?: MarketOverviewPanel; loading?: boolean }> = ({ panel, loading }) => (
  <MarketOverviewCard
    title="Funds Flow"
    eyebrow="Liquidity tape"
    description="ETF, institutional, and industry flow proxies show whether capital is adding risk or leaving."
    panel={panel}
    loading={loading}
    className="xl:col-span-4"
  />
);
