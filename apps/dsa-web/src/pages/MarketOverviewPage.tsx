import type React from 'react';
import { useEffect, useState } from 'react';
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
    <div className="relative min-h-full overflow-hidden bg-[#02070d] px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(34,211,238,0.20),transparent_30%),radial-gradient(circle_at_82%_16%,rgba(16,185,129,0.14),transparent_28%),linear-gradient(180deg,#02070d_0%,#07111f_52%,#02070d_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,.8)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.8)_1px,transparent_1px)] [background-size:42px_42px]" />

      <div className="relative z-10 mx-auto flex w-full max-w-[1680px] flex-col gap-5">
        <header className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.045] p-6 shadow-[0_30px_100px_rgba(0,0,0,0.42)] backdrop-blur-xl">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-200">Independent Market Radar</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-[-0.06em] text-white sm:text-6xl">Market Overview</h1>
              <p className="mt-3 max-w-3xl text-base text-slate-300">
                A standalone cross-market panel for index direction, volatility pressure, sentiment, liquidity, and macro risk. Every card refresh records an audit log entry.
              </p>
            </div>
            <div className="grid gap-2 rounded-2xl border border-cyan-200/15 bg-cyan-300/10 p-4 text-sm text-cyan-50 sm:min-w-80">
              <span className="font-semibold">Risk color contract</span>
              <span><span className="text-red-300">Red</span> means risk is increasing.</span>
              <span><span className="text-emerald-300">Green</span> means risk is decreasing or bullish.</span>
            </div>
          </div>
        </header>

        <main className="grid grid-cols-1 gap-5 xl:grid-cols-12">
          <IndexTrendsCard panel={panels.indices} loading={loading && !panels.indices} />
          <VolatilityCard panel={panels.volatility} loading={loading && !panels.volatility} />
          <MarketSentimentCard panel={panels.sentiment} loading={loading && !panels.sentiment} />
          <FundsFlowCard panel={panels.fundsFlow} loading={loading && !panels.fundsFlow} />
          <MacroIndicatorsCard panel={panels.macro} loading={loading && !panels.macro} />
        </main>
      </div>
    </div>
  );
};

export default MarketOverviewPage;
