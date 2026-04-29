import apiClient from './index';
import { toCamelCase } from './utils';

export type MarketRiskDirection = 'increasing' | 'decreasing' | 'neutral';
export type MarketPanelStatus = 'success' | 'failure';

export interface MarketOverviewItem {
  symbol: string;
  label: string;
  value?: number | null;
  unit?: string | null;
  changePct?: number | null;
  riskDirection?: MarketRiskDirection;
  trend?: number[];
  source?: string | null;
}

export interface MarketOverviewPanel {
  panelName: string;
  lastRefreshAt: string;
  status: MarketPanelStatus;
  errorMessage?: string | null;
  logSessionId?: string | null;
  items: MarketOverviewItem[];
}

function normalizePanel(payload: Record<string, unknown>): MarketOverviewPanel {
  const normalized = toCamelCase<MarketOverviewPanel>(payload);
  return {
    panelName: normalized.panelName,
    lastRefreshAt: normalized.lastRefreshAt,
    status: normalized.status,
    errorMessage: normalized.errorMessage,
    logSessionId: normalized.logSessionId,
    items: Array.isArray(normalized.items) ? normalized.items : [],
  };
}

async function getPanel(path: string): Promise<MarketOverviewPanel> {
  const response = await apiClient.get<Record<string, unknown>>(path);
  return normalizePanel(response.data);
}

export const marketOverviewApi = {
  getIndices: () => getPanel('/api/v1/market-overview/indices'),
  getVolatility: () => getPanel('/api/v1/market-overview/volatility'),
  getSentiment: () => getPanel('/api/v1/market-overview/sentiment'),
  getFundsFlow: () => getPanel('/api/v1/market-overview/funds-flow'),
  getMacro: () => getPanel('/api/v1/market-overview/macro'),
};
