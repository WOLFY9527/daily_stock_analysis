import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MarketOverviewPage from '../MarketOverviewPage';
import { marketOverviewApi } from '../../api/marketOverview';

vi.mock('../../api/marketOverview', () => ({
  marketOverviewApi: {
    getIndices: vi.fn(),
    getVolatility: vi.fn(),
    getSentiment: vi.fn(),
    getFundsFlow: vi.fn(),
    getMacro: vi.fn(),
  },
}));

const panel = (panelName: string, symbol: string) => ({
  panelName,
  lastRefreshAt: '2026-04-29T10:00:00',
  status: 'success' as const,
  logSessionId: `${panelName}-log`,
  items: [
    {
      symbol,
      label: symbol,
      value: 100,
      unit: 'pts',
      changePct: 1.2,
      riskDirection: 'decreasing' as const,
      trend: [96, 98, 100],
    },
  ],
});

describe('MarketOverviewPage', () => {
  beforeEach(() => {
    vi.mocked(marketOverviewApi.getIndices).mockResolvedValue(panel('IndexTrendsCard', 'SPX'));
    vi.mocked(marketOverviewApi.getVolatility).mockResolvedValue(panel('VolatilityCard', 'VIX'));
    vi.mocked(marketOverviewApi.getSentiment).mockResolvedValue(panel('MarketSentimentCard', 'FGI'));
    vi.mocked(marketOverviewApi.getFundsFlow).mockResolvedValue(panel('FundsFlowCard', 'ETF'));
    vi.mocked(marketOverviewApi.getMacro).mockResolvedValue(panel('MacroIndicatorsCard', 'US10Y'));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders every market overview card with fetched data and log status', async () => {
    render(<MarketOverviewPage />);

    expect(screen.getByRole('heading', { name: /Market Overview/i })).toBeInTheDocument();

    expect((await screen.findAllByText('SPX')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('VIX').length).toBeGreaterThan(0);
    expect(screen.getAllByText('FGI').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ETF').length).toBeGreaterThan(0);
    expect(screen.getAllByText('US10Y').length).toBeGreaterThan(0);

    expect(screen.getAllByTestId('market-overview-sparkline').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Log:/i).length).toBeGreaterThanOrEqual(5);
    await waitFor(() => expect(marketOverviewApi.getMacro).toHaveBeenCalledTimes(1));
  });
});
