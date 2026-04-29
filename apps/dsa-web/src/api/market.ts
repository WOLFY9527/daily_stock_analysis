import apiClient from './index';
import type { MarketOverviewPanel, MarketOverviewItem } from './marketOverview';
import { toCamelCase } from './utils';

type MarketSnapshotItem = {
  symbol?: string;
  name?: string;
  label?: string;
  price?: number | null;
  value?: number | null;
  change?: number | null;
  changePercent?: number | null;
  changeText?: string | null;
  trend?: number[];
  sparkline?: number[];
  unit?: string | null;
  source?: string | null;
  market?: string | null;
  explanation?: string | null;
  hoverDetails?: string[] | null;
  riskDirection?: 'increasing' | 'decreasing' | 'neutral';
};

type MarketSnapshotPayload = {
  items?: MarketSnapshotItem[];
  lastUpdate?: string;
  updatedAt?: string;
  error?: string | null;
  fallbackUsed?: boolean;
  source?: string | null;
  logSessionId?: string | null;
};

function normalizeItem(item: MarketSnapshotItem): MarketOverviewItem {
  const hoverDetails = Array.isArray(item.hoverDetails) ? [...item.hoverDetails] : [];
  if (item.market) {
    hoverDetails.push(`Market ${item.market}`);
  }
  if (item.explanation) {
    hoverDetails.push(item.explanation);
  }
  return {
    symbol: item.symbol || '',
    label: item.label || item.name || item.symbol || '',
    value: item.price ?? item.value,
    unit: item.unit,
    changePct: item.changePercent ?? item.change,
    changeText: item.changeText,
    riskDirection: item.riskDirection,
    trend: Array.isArray(item.trend) ? item.trend : Array.isArray(item.sparkline) ? item.sparkline : [],
    source: item.source,
    hoverDetails,
  };
}

async function getPanel(path: string, panelName: string): Promise<MarketOverviewPanel> {
  const response = await apiClient.get<Record<string, unknown>>(path);
  const payload = toCamelCase<MarketSnapshotPayload>(response.data);
  return {
    panelName,
    lastRefreshAt: payload.lastUpdate || payload.updatedAt || new Date().toISOString(),
    status: payload.fallbackUsed ? 'failure' : 'success',
    errorMessage: payload.fallbackUsed ? payload.error : null,
    logSessionId: payload.logSessionId,
    items: Array.isArray(payload.items) ? payload.items.map(normalizeItem) : [],
  };
}

export const marketApi = {
  getCrypto: () => getPanel('/api/v1/market/crypto', 'CryptoCard'),
  getSentiment: () => getPanel('/api/v1/market/sentiment', 'MarketSentimentCard'),
  getCnIndices: () => getPanel('/api/v1/market/cn-indices', 'ChinaIndicesCard'),
  getCnBreadth: () => getPanel('/api/v1/market/cn-breadth', 'ChinaBreadthCard'),
  getCnFlows: () => getPanel('/api/v1/market/cn-flows', 'ChinaFlowsCard'),
  getSectorRotation: () => getPanel('/api/v1/market/sector-rotation', 'SectorRotationCard'),
  getRates: () => getPanel('/api/v1/market/rates', 'RatesCard'),
  getFxCommodities: () => getPanel('/api/v1/market/fx-commodities', 'FxCommoditiesCard'),
};
