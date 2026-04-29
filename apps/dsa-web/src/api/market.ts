import apiClient from './index';
import type { MarketOverviewPanel, MarketOverviewItem } from './marketOverview';
import { toCamelCase } from './utils';

type MarketSnapshotItem = {
  symbol?: string;
  label?: string;
  price?: number | null;
  change?: number | null;
  changeText?: string | null;
  trend?: number[];
  unit?: string | null;
  source?: string | null;
  hoverDetails?: string[] | null;
  riskDirection?: 'increasing' | 'decreasing' | 'neutral';
};

type MarketSnapshotPayload = {
  items?: MarketSnapshotItem[];
  lastUpdate?: string;
  error?: string | null;
  fallbackUsed?: boolean;
  source?: string | null;
  logSessionId?: string | null;
};

function normalizeItem(item: MarketSnapshotItem): MarketOverviewItem {
  return {
    symbol: item.symbol || '',
    label: item.label || item.symbol || '',
    value: item.price,
    unit: item.unit,
    changePct: item.change,
    changeText: item.changeText,
    riskDirection: item.riskDirection,
    trend: Array.isArray(item.trend) ? item.trend : [],
    source: item.source,
    hoverDetails: Array.isArray(item.hoverDetails) ? item.hoverDetails : [],
  };
}

async function getPanel(path: string, panelName: string): Promise<MarketOverviewPanel> {
  const response = await apiClient.get<Record<string, unknown>>(path);
  const payload = toCamelCase<MarketSnapshotPayload>(response.data);
  return {
    panelName,
    lastRefreshAt: payload.lastUpdate || new Date().toISOString(),
    status: payload.fallbackUsed ? 'failure' : 'success',
    errorMessage: payload.fallbackUsed ? payload.error : null,
    logSessionId: payload.logSessionId,
    items: Array.isArray(payload.items) ? payload.items.map(normalizeItem) : [],
  };
}

export const marketApi = {
  getCrypto: () => getPanel('/api/v1/market/crypto', 'CryptoCard'),
  getSentiment: () => getPanel('/api/v1/market/sentiment', 'MarketSentimentCard'),
};
