import type React from 'react';
import type { MarketOverviewPanel } from '../../api/marketOverview';
import { MarketOverviewCard } from './MarketOverviewCard';

export const VolatilityCard: React.FC<{ panel?: MarketOverviewPanel; loading?: boolean }> = ({ panel, loading }) => (
  <MarketOverviewCard
    title="Volatility"
    eyebrow="Risk pressure"
    description="VIX, VVIX, VXN, and ATR highlight whether volatility risk is expanding or fading."
    panel={panel}
    loading={loading}
    className="xl:col-span-5"
  />
);
