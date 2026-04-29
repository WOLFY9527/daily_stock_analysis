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

  it('renders every market overview card with localized copy and source attribution', async () => {
    render(<MarketOverviewPage />);

    expect(screen.getByRole('heading', { name: /大市全景监控/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /波动率与风险压力/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /情绪与资金面/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /同步最新行情/i })).toBeInTheDocument();

    expect((await screen.findAllByText('SPX')).length).toBeGreaterThan(0);
    expect(screen.getByText(/VIX 实时脉搏/i)).toBeInTheDocument();
    expect(screen.getByText(/贪婪与恐慌指数/i)).toBeInTheDocument();
    expect(screen.getAllByText('ETF').length).toBeGreaterThan(0);
    expect(screen.getAllByText('US10Y').length).toBeGreaterThan(0);
    expect(screen.getByText(/平静/i)).toBeInTheDocument();
    expect(screen.getByText(/警戒/i)).toBeInTheDocument();

    expect(screen.getAllByTestId('market-overview-sparkline').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/Log:/i)).not.toBeInTheDocument();
    expect(screen.getByText(/数据驱动: CBOE/i)).toBeInTheDocument();
    await waitFor(() => expect(marketOverviewApi.getMacro).toHaveBeenCalledTimes(1));
  });
});
