import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MarketOverviewItem, MarketOverviewPanel } from '../api/marketOverview';
import { marketOverviewApi } from '../api/marketOverview';
import { marketApi } from '../api/market';
import { CryptoCard } from '../components/market-overview/CryptoCard';
import { FundsFlowCard } from '../components/market-overview/FundsFlowCard';
import { IndexTrendsCard } from '../components/market-overview/IndexTrendsCard';
import { MacroIndicatorsCard } from '../components/market-overview/MacroIndicatorsCard';
import { MarketSentimentCard } from '../components/market-overview/MarketSentimentCard';
import { MarketOverviewCard } from '../components/market-overview/MarketOverviewCard';
import { VolatilityCard } from '../components/market-overview/VolatilityCard';
import { useI18n } from '../contexts/UiLanguageContext';

type PanelState = {
  indices?: MarketOverviewPanel;
  volatility?: MarketOverviewPanel;
  crypto?: MarketOverviewPanel;
  sentiment?: MarketOverviewPanel;
  fundsFlow?: MarketOverviewPanel;
  macro?: MarketOverviewPanel;
  cnIndices?: MarketOverviewPanel;
  cnBreadth?: MarketOverviewPanel;
  cnFlows?: MarketOverviewPanel;
  sectorRotation?: MarketOverviewPanel;
  rates?: MarketOverviewPanel;
  fxCommodities?: MarketOverviewPanel;
};

type PanelKey = keyof PanelState;
type CardKey = PanelKey;
type CategoryKey = 'all' | 'us' | 'cn' | 'macro' | 'crypto';

const CATEGORY_CARDS: Record<CategoryKey, CardKey[]> = {
  all: ['sentiment', 'macro', 'rates', 'fxCommodities'],
  us: ['indices', 'fundsFlow', 'volatility', 'rates', 'sentiment', 'fxCommodities', 'crypto'],
  cn: ['cnIndices', 'cnFlows', 'cnBreadth', 'sectorRotation', 'rates', 'fxCommodities'],
  macro: ['rates', 'fxCommodities', 'macro', 'volatility'],
  crypto: ['crypto'],
};
const CATEGORY_STORAGE_KEYS: Record<CategoryKey, string> = {
  all: 'market-overview-order-all',
  us: 'market-overview-order-us',
  cn: 'market-overview-order-cn',
  macro: 'market-overview-order-macro',
  crypto: 'market-overview-order-crypto',
};
const AUTO_REFRESH_MS = 60_000;

function readStoredCardOrder(category: CategoryKey): CardKey[] {
  const defaultOrder = CATEGORY_CARDS[category];
  if (typeof window === 'undefined') {
    return defaultOrder;
  }
  try {
    const raw = window.localStorage.getItem(CATEGORY_STORAGE_KEYS[category]);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) {
      return defaultOrder;
    }
    const filtered = parsed.filter((item): item is CardKey => defaultOrder.includes(item));
    const missing = defaultOrder.filter((item) => !filtered.includes(item));
    return filtered.length ? [...filtered, ...missing] : defaultOrder;
  } catch {
    return defaultOrder;
  }
}

function persistCardOrder(category: CategoryKey, order: CardKey[]): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(CATEGORY_STORAGE_KEYS[category], JSON.stringify(order));
}

type HeroAnchor = {
  key: string;
  label: string;
  item?: MarketOverviewItem;
};

function findPanelItem(panel: MarketOverviewPanel | undefined, symbols: string[]): MarketOverviewItem | undefined {
  const normalizedSymbols = symbols.map((symbol) => symbol.toUpperCase());
  return panel?.items.find((item) => normalizedSymbols.includes(item.symbol.toUpperCase()));
}

function buildHeroAnchors(panels: PanelState): HeroAnchor[] {
  return [
    { key: 'SPX', label: 'S&P 500', item: findPanelItem(panels.indices, ['SPX']) },
    { key: 'CSI300', label: '沪深300', item: findPanelItem(panels.cnIndices, ['CSI300', '000300.SH']) || findPanelItem(panels.indices, ['CSI300']) },
    { key: 'BTC', label: 'BTC', item: findPanelItem(panels.crypto, ['BTC']) },
    { key: 'VIX', label: 'VIX', item: findPanelItem(panels.volatility, ['VIX']) },
    { key: 'US10Y', label: 'US10Y', item: findPanelItem(panels.rates, ['US10Y']) || findPanelItem(panels.macro, ['US10Y']) },
    { key: 'DXY', label: 'DXY', item: findPanelItem(panels.fxCommodities, ['DXY']) || findPanelItem(panels.macro, ['DXY']) },
  ];
}

function formatHeroValue(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: Math.abs(value) >= 100 ? 2 : 3,
  }).format(value);
}

function formatHeroChange(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'N/A';
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function heroToneClass(item: MarketOverviewItem | undefined): string {
  if (!item || item.changePct == null) {
    return 'text-white/35';
  }
  return item.changePct >= 0 ? 'text-emerald-400' : 'text-red-400';
}

const CrossAssetHeroRibbon: React.FC<{ anchors: HeroAnchor[] }> = ({ anchors }) => (
  <section
    data-testid="market-overview-hero-ribbon"
    className="grid grid-cols-3 gap-3 border-b border-white/5 pb-5 md:grid-cols-6 md:gap-4"
    aria-label="Cross asset hero ribbon"
  >
    {anchors.map((anchor) => (
      <div
        key={anchor.key}
        data-testid={`market-overview-hero-${anchor.key}`}
        className="min-w-0 border-l border-white/8 bg-white/[0.018] px-3 py-2.5"
      >
        <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-white/36">{anchor.label}</p>
        <p className="mt-1 truncate font-mono text-[22px] font-semibold leading-none text-white md:text-2xl">
          {formatHeroValue(anchor.item?.value)}
        </p>
        <p className={`mt-1 font-mono text-xs font-semibold ${heroToneClass(anchor.item)}`}>
          {formatHeroChange(anchor.item?.changePct)}
        </p>
      </div>
    ))}
  </section>
);

const MarketOverviewPage: React.FC = () => {
  const { t } = useI18n();
  const [panels, setPanels] = useState<PanelState>({});
  const [loading, setLoading] = useState(true);
  const [refreshingPanel, setRefreshingPanel] = useState<PanelKey | null>(null);
  const [activeCategory, setActiveCategory] = useState<CategoryKey>('all');
  const [cardOrders, setCardOrders] = useState<Record<CategoryKey, CardKey[]>>(() => ({
    all: readStoredCardOrder('all'),
    us: readStoredCardOrder('us'),
    cn: readStoredCardOrder('cn'),
    macro: readStoredCardOrder('macro'),
    crypto: readStoredCardOrder('crypto'),
  }));
  const [draggingCard, setDraggingCard] = useState<CardKey | null>(null);

  const loadPanels = useCallback(async (cancelledRef?: { current: boolean }) => {
    setLoading(true);
    const requests: Array<[PanelKey, () => Promise<MarketOverviewPanel>]> = [
      ['indices', marketOverviewApi.getIndices],
      ['volatility', marketOverviewApi.getVolatility],
      ['crypto', marketApi.getCrypto],
      ['sentiment', marketApi.getSentiment],
      ['fundsFlow', marketOverviewApi.getFundsFlow],
      ['macro', marketOverviewApi.getMacro],
      ['cnIndices', marketApi.getCnIndices],
      ['cnBreadth', marketApi.getCnBreadth],
      ['cnFlows', marketApi.getCnFlows],
      ['sectorRotation', marketApi.getSectorRotation],
      ['rates', marketApi.getRates],
      ['fxCommodities', marketApi.getFxCommodities],
    ];
    const results = await Promise.allSettled(requests.map(([, loadPanel]) => loadPanel()));
    if (!cancelledRef?.current) {
      setPanels((currentPanels) => {
        const nextPanels = { ...currentPanels };
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            nextPanels[requests[index][0]] = result.value;
          }
        });
        return nextPanels;
      });
      setLoading(false);
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
    setCardOrders((currentOrders) => {
      const currentOrder = currentOrders[activeCategory];
      const next = currentOrder.filter((item) => item !== source);
      const targetIndex = next.indexOf(target);
      next.splice(targetIndex < 0 ? next.length : targetIndex, 0, source);
      persistCardOrder(activeCategory, next);
      return {
        ...currentOrders,
        [activeCategory]: next,
      };
    });
  }, [activeCategory]);

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

  const categoryTabs = useMemo<Array<{ key: CategoryKey; label: string }>>(() => [
    { key: 'all', label: t('marketOverviewPage.categories.all') },
    { key: 'us', label: t('marketOverviewPage.categories.us') },
    { key: 'cn', label: t('marketOverviewPage.categories.cn') },
    { key: 'macro', label: t('marketOverviewPage.categories.macro') },
    { key: 'crypto', label: t('marketOverviewPage.categories.crypto') },
  ], [t]);

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
    cnIndices: (
      <MarketOverviewCard
        title={t('marketOverviewPage.cards.cnIndices.title')}
        eyebrow={t('marketOverviewPage.cards.cnIndices.eyebrow')}
        description={t('marketOverviewPage.cards.cnIndices.description')}
        sourceLabel={t('marketOverviewPage.cards.cnIndices.source')}
        panel={panels.cnIndices}
        loading={loading && !panels.cnIndices}
        refreshing={refreshingPanel === 'cnIndices'}
        onRefresh={() => {
          void refreshPanel('cnIndices', marketApi.getCnIndices);
        }}
      />
    ),
    cnBreadth: (
      <MarketOverviewCard
        title={t('marketOverviewPage.cards.cnBreadth.title')}
        eyebrow={t('marketOverviewPage.cards.cnBreadth.eyebrow')}
        description={t('marketOverviewPage.cards.cnBreadth.description')}
        sourceLabel={t('marketOverviewPage.cards.cnBreadth.source')}
        panel={panels.cnBreadth}
        loading={loading && !panels.cnBreadth}
        refreshing={refreshingPanel === 'cnBreadth'}
        onRefresh={() => {
          void refreshPanel('cnBreadth', marketApi.getCnBreadth);
        }}
      />
    ),
    cnFlows: (
      <MarketOverviewCard
        title={t('marketOverviewPage.cards.cnFlows.title')}
        eyebrow={t('marketOverviewPage.cards.cnFlows.eyebrow')}
        description={t('marketOverviewPage.cards.cnFlows.description')}
        sourceLabel={t('marketOverviewPage.cards.cnFlows.source')}
        panel={panels.cnFlows}
        loading={loading && !panels.cnFlows}
        refreshing={refreshingPanel === 'cnFlows'}
        onRefresh={() => {
          void refreshPanel('cnFlows', marketApi.getCnFlows);
        }}
      />
    ),
    sectorRotation: (
      <MarketOverviewCard
        title={t('marketOverviewPage.cards.sectorRotation.title')}
        eyebrow={t('marketOverviewPage.cards.sectorRotation.eyebrow')}
        description={t('marketOverviewPage.cards.sectorRotation.description')}
        sourceLabel={t('marketOverviewPage.cards.sectorRotation.source')}
        panel={panels.sectorRotation ? { ...panels.sectorRotation, items: panels.sectorRotation.items.slice(0, 5) } : undefined}
        loading={loading && !panels.sectorRotation}
        refreshing={refreshingPanel === 'sectorRotation'}
        onRefresh={() => {
          void refreshPanel('sectorRotation', marketApi.getSectorRotation);
        }}
      />
    ),
    rates: (
      <MarketOverviewCard
        title={t('marketOverviewPage.cards.rates.title')}
        eyebrow={t('marketOverviewPage.cards.rates.eyebrow')}
        description={t('marketOverviewPage.cards.rates.description')}
        sourceLabel={t('marketOverviewPage.cards.rates.source')}
        panel={panels.rates}
        loading={loading && !panels.rates}
        refreshing={refreshingPanel === 'rates'}
        onRefresh={() => {
          void refreshPanel('rates', marketApi.getRates);
        }}
      />
    ),
    fxCommodities: (
      <MarketOverviewCard
        title={t('marketOverviewPage.cards.fxCommodities.title')}
        eyebrow={t('marketOverviewPage.cards.fxCommodities.eyebrow')}
        description={t('marketOverviewPage.cards.fxCommodities.description')}
        sourceLabel={t('marketOverviewPage.cards.fxCommodities.source')}
        panel={panels.fxCommodities}
        loading={loading && !panels.fxCommodities}
        refreshing={refreshingPanel === 'fxCommodities'}
        onRefresh={() => {
          void refreshPanel('fxCommodities', marketApi.getFxCommodities);
        }}
      />
    ),
  }), [loading, panels, refreshPanel, refreshingPanel, t]);

  const visibleOrder = cardOrders[activeCategory].filter((cardKey) => CATEGORY_CARDS[activeCategory].includes(cardKey));
  const columns = [0, 1, 2].map((columnIndex) => visibleOrder.filter((_, index) => index % 3 === columnIndex));
  const heroAnchors = useMemo(() => buildHeroAnchors(panels), [panels]);

  return (
    <div className="w-full flex-1 flex flex-col min-w-0 min-h-0 bg-[#030303] text-white">
      <div className="flex-1 overflow-y-auto pb-12 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-6 px-3 sm:px-5">
          <div className="sticky top-0 z-10 -mx-3 overflow-x-auto border-b border-white/5 bg-[#030303]/95 px-3 py-3 backdrop-blur sm:-mx-5 sm:px-5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex w-max min-w-full gap-2 rounded-lg bg-white/[0.03] p-1">
              {categoryTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  aria-pressed={activeCategory === tab.key}
                  onClick={() => setActiveCategory(tab.key)}
                  className={`whitespace-nowrap rounded-md px-3 py-2 text-xs font-semibold transition ${
                    activeCategory === tab.key
                      ? 'bg-white/10 text-white shadow-sm'
                      : 'bg-transparent text-white/45 hover:text-white/75'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          {activeCategory === 'all' ? <CrossAssetHeroRibbon anchors={heroAnchors} /> : null}
          <main className="flex flex-col items-start gap-6 xl:flex-row">
            {columns.map((columnCards, columnIndex) => (
              <div key={columnIndex} className="flex w-full flex-col gap-6 xl:w-[calc((100%_-_3rem)/3)]">
                {columnCards.map((cardKey) => (
                  <div
                    key={cardKey}
                    data-testid={`market-overview-card-${cardKey}`}
                    data-market-card-rank={visibleOrder.indexOf(cardKey)}
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
