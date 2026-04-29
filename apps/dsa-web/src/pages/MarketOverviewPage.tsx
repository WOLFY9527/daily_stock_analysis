import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MarketOverviewPanel } from '../api/marketOverview';
import { marketOverviewApi } from '../api/marketOverview';
import { marketApi } from '../api/market';
import { CryptoCard } from '../components/market-overview/CryptoCard';
import { FundsFlowCard } from '../components/market-overview/FundsFlowCard';
import { IndexTrendsCard } from '../components/market-overview/IndexTrendsCard';
import { MacroIndicatorsCard } from '../components/market-overview/MacroIndicatorsCard';
import { MarketSentimentCard } from '../components/market-overview/MarketSentimentCard';
import { VolatilityCard } from '../components/market-overview/VolatilityCard';

type PanelState = {
  indices?: MarketOverviewPanel;
  volatility?: MarketOverviewPanel;
  crypto?: MarketOverviewPanel;
  sentiment?: MarketOverviewPanel;
  fundsFlow?: MarketOverviewPanel;
  macro?: MarketOverviewPanel;
};

type PanelKey = keyof PanelState;
type CardKey = 'indices' | 'volatility' | 'crypto' | 'sentiment' | 'fundsFlow' | 'macro';

const DEFAULT_CARD_ORDER: CardKey[] = ['indices', 'volatility', 'crypto', 'sentiment', 'fundsFlow', 'macro'];
const CARD_ORDER_STORAGE_KEY = 'market-overview-card-order';
const AUTO_REFRESH_MS = 60_000;

function readStoredCardOrder(): CardKey[] {
  if (typeof window === 'undefined') {
    return DEFAULT_CARD_ORDER;
  }
  try {
    const raw = window.localStorage.getItem(CARD_ORDER_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) {
      return DEFAULT_CARD_ORDER;
    }
    const filtered = parsed.filter((item): item is CardKey => DEFAULT_CARD_ORDER.includes(item));
    const missing = DEFAULT_CARD_ORDER.filter((item) => !filtered.includes(item));
    return filtered.length ? [...filtered, ...missing] : DEFAULT_CARD_ORDER;
  } catch {
    return DEFAULT_CARD_ORDER;
  }
}

function persistCardOrder(order: CardKey[]): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(CARD_ORDER_STORAGE_KEY, JSON.stringify(order));
}

const MarketOverviewPage: React.FC = () => {
  const [panels, setPanels] = useState<PanelState>({});
  const [loading, setLoading] = useState(true);
  const [refreshingPanel, setRefreshingPanel] = useState<PanelKey | null>(null);
  const [cardOrder, setCardOrder] = useState<CardKey[]>(() => readStoredCardOrder());
  const [draggingCard, setDraggingCard] = useState<CardKey | null>(null);

  const loadPanels = useCallback(async (cancelledRef?: { current: boolean }) => {
    setLoading(true);
    try {
      const [indices, volatility, crypto, sentiment, fundsFlow, macro] = await Promise.all([
        marketOverviewApi.getIndices(),
        marketOverviewApi.getVolatility(),
        marketApi.getCrypto(),
        marketApi.getSentiment(),
        marketOverviewApi.getFundsFlow(),
        marketOverviewApi.getMacro(),
      ]);
      if (!cancelledRef?.current) {
        setPanels({ indices, volatility, crypto, sentiment, fundsFlow, macro });
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

  const moveCard = useCallback((source: CardKey, target: CardKey) => {
    if (source === target) {
      return;
    }
    setCardOrder((currentOrder) => {
      const next = currentOrder.filter((item) => item !== source);
      const targetIndex = next.indexOf(target);
      next.splice(targetIndex < 0 ? next.length : targetIndex, 0, source);
      persistCardOrder(next);
      return next;
    });
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

  useEffect(() => {
    const timer = window.setInterval(() => {
      const cancelledRef = { current: false };
      void loadPanels(cancelledRef);
    }, AUTO_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [loadPanels]);

  const cardNodes = useMemo<Record<CardKey, React.ReactNode>>(() => ({
    indices: (
      <IndexTrendsCard
        panel={panels.indices}
        loading={loading && !panels.indices}
        refreshing={refreshingPanel === 'indices'}
        onRefresh={() => {
          void refreshPanel('indices', marketOverviewApi.getIndices);
        }}
      />
    ),
    volatility: (
      <VolatilityCard
        panel={panels.volatility}
        loading={loading && !panels.volatility}
        refreshing={refreshingPanel === 'volatility'}
        onRefresh={() => {
          void refreshPanel('volatility', marketOverviewApi.getVolatility);
        }}
      />
    ),
    crypto: (
      <CryptoCard
        panel={panels.crypto}
        loading={loading && !panels.crypto}
        refreshing={refreshingPanel === 'crypto'}
        onRefresh={() => {
          void refreshPanel('crypto', marketApi.getCrypto);
        }}
      />
    ),
    sentiment: (
      <MarketSentimentCard
        panel={panels.sentiment}
        loading={loading && !panels.sentiment}
        refreshing={refreshingPanel === 'sentiment'}
        onRefresh={() => {
          void refreshPanel('sentiment', marketApi.getSentiment);
        }}
      />
    ),
    fundsFlow: (
      <FundsFlowCard
        panel={panels.fundsFlow}
        loading={loading && !panels.fundsFlow}
        refreshing={refreshingPanel === 'fundsFlow'}
        onRefresh={() => {
          void refreshPanel('fundsFlow', marketOverviewApi.getFundsFlow);
        }}
      />
    ),
    macro: (
      <MacroIndicatorsCard
        panel={panels.macro}
        loading={loading && !panels.macro}
        refreshing={refreshingPanel === 'macro'}
        onRefresh={() => {
          void refreshPanel('macro', marketOverviewApi.getMacro);
        }}
      />
    ),
  }), [loading, panels.crypto, panels.fundsFlow, panels.indices, panels.macro, panels.sentiment, panels.volatility, refreshPanel, refreshingPanel]);

  const columns = [0, 1, 2].map((columnIndex) => cardOrder.filter((_, index) => index % 3 === columnIndex));

  return (
    <div className="w-full flex-1 flex flex-col min-w-0 min-h-0 bg-[#030303] text-white">
      <div className="flex-1 overflow-y-auto pb-12 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-6">
          <main className="flex flex-col items-start gap-6 xl:flex-row">
            {columns.map((columnCards, columnIndex) => (
              <div key={columnIndex} className="flex w-full flex-col gap-6 xl:w-[calc((100%_-_3rem)/3)]">
                {columnCards.map((cardKey) => (
                  <div
                    key={cardKey}
                    data-testid={`market-overview-card-${cardKey}`}
                    draggable
                    onDragStart={() => setDraggingCard(cardKey)}
                    onDragEnd={() => setDraggingCard(null)}
                    onDragOver={(event) => {
                      event.preventDefault();
                    }}
                    onDrop={() => {
                      if (draggingCard) {
                        moveCard(draggingCard, cardKey);
                      }
                      setDraggingCard(null);
                    }}
                    className={`transition-transform ${draggingCard === cardKey ? 'scale-[0.985] opacity-80' : ''}`}
                  >
                    {cardNodes[cardKey]}
                  </div>
                ))}
              </div>
            ))}
          </main>
        </div>
      </div>
    </div>
  );
};

export default MarketOverviewPage;
