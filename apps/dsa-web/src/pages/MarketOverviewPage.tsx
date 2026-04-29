import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { MarketOverviewPanel } from '../api/marketOverview';
import { marketOverviewApi } from '../api/marketOverview';
import { WorkspacePageHeader } from '../components/common';
import { FundsFlowCard } from '../components/market-overview/FundsFlowCard';
import { IndexTrendsCard } from '../components/market-overview/IndexTrendsCard';
import { MacroIndicatorsCard } from '../components/market-overview/MacroIndicatorsCard';
import { formatMarketOverviewTimestamp } from '../components/market-overview/marketOverviewFormat';
import { MarketSentimentCard } from '../components/market-overview/MarketSentimentCard';
import { VolatilityCard } from '../components/market-overview/VolatilityCard';
import { useI18n } from '../contexts/UiLanguageContext';

type PanelState = {
  indices?: MarketOverviewPanel;
  volatility?: MarketOverviewPanel;
  sentiment?: MarketOverviewPanel;
  fundsFlow?: MarketOverviewPanel;
  macro?: MarketOverviewPanel;
};

const MarketOverviewPage: React.FC = () => {
  const { t } = useI18n();
  const [panels, setPanels] = useState<PanelState>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadPanels = useCallback(async (cancelledRef?: { current: boolean }) => {
    setLoading(true);
    setRefreshing(true);
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
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    const cancelledRef = { current: false };

    void loadPanels(cancelledRef).catch(() => {
      if (!cancelledRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    });

    return () => {
      cancelledRef.current = true;
    };
  }, [loadPanels]);

  const lastUpdatedAt = useMemo(() => {
    return Object.values(panels)
      .map((panel) => panel?.lastRefreshAt || '')
      .filter(Boolean)
      .sort()
      .at(-1) || '';
  }, [panels]);

  return (
    <div className="w-full flex-1 flex flex-col min-w-0 min-h-0 bg-[#030303] pt-8 px-6 text-white md:px-8 xl:px-12">
      <div className="flex-1 overflow-y-auto pb-12 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-6">
          <WorkspacePageHeader
            eyebrow={t('marketOverviewPage.header.eyebrow')}
            title={t('marketOverviewPage.header.title')}
            description={t('marketOverviewPage.header.description')}
            actions={(
              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    void loadPanels().catch(() => {
                      setLoading(false);
                      setRefreshing(false);
                    });
                  }}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
                  disabled={refreshing}
                >
                  <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
                  <span>{t('marketOverviewPage.header.refresh')}</span>
                </button>
                <span className="text-[10px] text-white/40">
                  {t('marketOverviewPage.header.lastUpdated', {
                    timestamp: formatMarketOverviewTimestamp(lastUpdatedAt) || t('marketOverviewPage.header.pending'),
                  })}
                </span>
              </div>
            )}
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
