import type React from 'react';
import { useEffect, useState } from 'react';
import type { MarketOverviewPanel } from '../api/marketOverview';
import { marketOverviewApi } from '../api/marketOverview';
import { WorkspacePageHeader } from '../components/common';
import { FundsFlowCard } from '../components/market-overview/FundsFlowCard';
import { IndexTrendsCard } from '../components/market-overview/IndexTrendsCard';
import { MacroIndicatorsCard } from '../components/market-overview/MacroIndicatorsCard';
import { MarketSentimentCard } from '../components/market-overview/MarketSentimentCard';
import { VolatilityCard } from '../components/market-overview/VolatilityCard';

type PanelState = {
  indices?: MarketOverviewPanel;
  volatility?: MarketOverviewPanel;
  sentiment?: MarketOverviewPanel;
  fundsFlow?: MarketOverviewPanel;
  macro?: MarketOverviewPanel;
};

const MarketOverviewPage: React.FC = () => {
  const [panels, setPanels] = useState<PanelState>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadPanels() {
      setLoading(true);
      const [indices, volatility, sentiment, fundsFlow, macro] = await Promise.all([
        marketOverviewApi.getIndices(),
        marketOverviewApi.getVolatility(),
        marketOverviewApi.getSentiment(),
        marketOverviewApi.getFundsFlow(),
        marketOverviewApi.getMacro(),
      ]);
      if (!cancelled) {
        setPanels({ indices, volatility, sentiment, fundsFlow, macro });
        setLoading(false);
      }
    }

    void loadPanels().catch(() => {
      if (!cancelled) {
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="w-full flex-1 flex flex-col min-w-0 min-h-0 bg-[#030303] pt-8 px-6 text-white md:px-8 xl:px-12">
      <div className="flex-1 overflow-y-auto pb-12 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-6">
          <WorkspacePageHeader
            eyebrow="Cross-market monitor"
            title="Market Overview"
            description="Index direction, volatility pressure, sentiment, liquidity, and macro risk in one workspace."
            className="px-0"
          />

          <main className="grid grid-cols-1 gap-5 xl:grid-cols-12">
            <IndexTrendsCard panel={panels.indices} loading={loading && !panels.indices} />
            <VolatilityCard panel={panels.volatility} loading={loading && !panels.volatility} />
            <MarketSentimentCard panel={panels.sentiment} loading={loading && !panels.sentiment} />
            <FundsFlowCard panel={panels.fundsFlow} loading={loading && !panels.fundsFlow} />
            <MacroIndicatorsCard panel={panels.macro} loading={loading && !panels.macro} />
          </main>
        </div>
      </div>
    </div>
  );
};

export default MarketOverviewPage;
