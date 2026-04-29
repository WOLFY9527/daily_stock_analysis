import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import type { MarketOverviewPanel } from '../api/marketOverview';
import { marketOverviewApi } from '../api/marketOverview';
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

type PanelKey = keyof PanelState;

const MarketOverviewPage: React.FC = () => {
  const [panels, setPanels] = useState<PanelState>({});
  const [loading, setLoading] = useState(true);
  const [refreshingPanel, setRefreshingPanel] = useState<PanelKey | null>(null);

  const loadPanels = useCallback(async (cancelledRef?: { current: boolean }) => {
    setLoading(true);
    try {
      const [indices, volatility, sentiment, fundsFlow, macro] = await Promise.all([
        marketOverviewApi.getIndices(),
        marketOverviewApi.getVolatility(),
        marketOverviewApi.getSentiment(),
        marketOverviewApi.getFundsFlow(),
        marketOverviewApi.getMacro(),
      ]);
      if (!cancelledRef?.current) {
        setPanels({ indices, volatility, sentiment, fundsFlow, macro });
      }
    } finally {
      if (!cancelledRef?.current) {
        setLoading(false);
      }
    }
  }, []);

  const refreshPanel = useCallback(async (
    panelKey: PanelKey,
    loadPanel: () => Promise<MarketOverviewPanel>,
  ) => {
    setRefreshingPanel(panelKey);
    try {
      const panel = await loadPanel();
      setPanels((currentPanels) => ({
        ...currentPanels,
        [panelKey]: panel,
      }));
    } finally {
      setRefreshingPanel((currentPanel) => (currentPanel === panelKey ? null : currentPanel));
    }
  }, []);

  useEffect(() => {
    const cancelledRef = { current: false };

    void loadPanels(cancelledRef).catch(() => {
      if (!cancelledRef.current) {
        setLoading(false);
      }
    });

    return () => {
      cancelledRef.current = true;
    };
  }, [loadPanels]);

  return (
    <div className="w-full flex-1 flex flex-col min-w-0 min-h-0 bg-[#030303] text-white">
      <div className="flex-1 overflow-y-auto pb-12 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-6">
          <main className="flex flex-col items-start gap-6 xl:flex-row">
            <div className="flex w-full flex-col gap-6 xl:w-[calc((100%_-_3rem)/3)]">
              <IndexTrendsCard
                panel={panels.indices}
                loading={loading && !panels.indices}
                refreshing={refreshingPanel === 'indices'}
                onRefresh={() => {
                  void refreshPanel('indices', marketOverviewApi.getIndices);
                }}
              />
            </div>
            <div className="flex w-full flex-col gap-6 xl:w-[calc((100%_-_3rem)/3)]">
              <VolatilityCard
                panel={panels.volatility}
                loading={loading && !panels.volatility}
                refreshing={refreshingPanel === 'volatility'}
                onRefresh={() => {
                  void refreshPanel('volatility', marketOverviewApi.getVolatility);
                }}
              />
              <FundsFlowCard
                panel={panels.fundsFlow}
                loading={loading && !panels.fundsFlow}
                refreshing={refreshingPanel === 'fundsFlow'}
                onRefresh={() => {
                  void refreshPanel('fundsFlow', marketOverviewApi.getFundsFlow);
                }}
              />
            </div>
            <div className="flex w-full flex-col gap-6 xl:w-[calc((100%_-_3rem)/3)]">
              <MarketSentimentCard
                panel={panels.sentiment}
                loading={loading && !panels.sentiment}
                refreshing={refreshingPanel === 'sentiment'}
                onRefresh={() => {
                  void refreshPanel('sentiment', marketOverviewApi.getSentiment);
                }}
              />
              <MacroIndicatorsCard
                panel={panels.macro}
                loading={loading && !panels.macro}
                refreshing={refreshingPanel === 'macro'}
                onRefresh={() => {
                  void refreshPanel('macro', marketOverviewApi.getMacro);
                }}
              />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};

export default MarketOverviewPage;
