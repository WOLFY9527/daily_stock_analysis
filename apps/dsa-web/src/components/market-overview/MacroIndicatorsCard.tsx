import type React from 'react';
import type { MarketOverviewPanel } from '../../api/marketOverview';
import { MarketOverviewCard } from './MarketOverviewCard';

export const MacroIndicatorsCard: React.FC<{ panel?: MarketOverviewPanel; loading?: boolean }> = ({ panel, loading }) => (
  <MarketOverviewCard
    title="Macro Indicators"
    eyebrow="Rates + commodities"
    description="Yield curve, DXY, gold, oil, Fed, inflation, and credit spread context."
    panel={panel}
    loading={loading}
    className="xl:col-span-4"
  />
);
