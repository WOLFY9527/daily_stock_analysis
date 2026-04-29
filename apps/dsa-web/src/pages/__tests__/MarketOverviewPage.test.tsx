import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MarketOverviewPage from '../MarketOverviewPage';
import { marketOverviewApi } from '../../api/marketOverview';
import { marketApi } from '../../api/market';

vi.mock('../../api/marketOverview', () => ({
  marketOverviewApi: {
    getIndices: vi.fn(),
    getVolatility: vi.fn(),
    getFundsFlow: vi.fn(),
    getMacro: vi.fn(),
  },
}));

vi.mock('../../api/market', () => ({
  marketApi: {
    getCrypto: vi.fn(),
    getSentiment: vi.fn(),
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

const macroPanel = () => ({
  ...panel('MacroIndicatorsCard', 'US10Y'),
  items: [
    ...panel('MacroIndicatorsCard', 'US10Y').items,
    {
      symbol: 'FEDFUNDS',
      label: 'Fed Funds',
      value: null,
      unit: '%',
      changePct: null,
      riskDirection: 'neutral' as const,
      trend: [],
    },
  ],
});

const cryptoPanel = () => ({
  panelName: 'CryptoCard',
  lastRefreshAt: '2026-04-29T10:00:00',
  status: 'success' as const,
  logSessionId: 'crypto-log',
  items: [
    {
      symbol: 'BTC',
      label: 'Bitcoin',
      value: 76837.04,
      unit: 'USD',
      changePct: 1.47,
      riskDirection: 'decreasing' as const,
      trend: [74211, 75120, 76003, 76837.04],
      hoverDetails: ['24H +1.47%', '7D +3.22%'],
    },
  ],
});

const sentimentPanel = () => ({
  panelName: 'MarketSentimentCard',
  lastRefreshAt: '2026-04-29T10:00:00',
  status: 'success' as const,
  logSessionId: 'sentiment-log',
  items: [
    {
      symbol: 'FGI',
      label: 'Fear & Greed',
      value: 26,
      unit: 'score',
      changePct: -7,
      riskDirection: 'increasing' as const,
      trend: [42, 38, 33, 26],
      hoverDetails: ['24H -7.00%', '7D -18.00%'],
    },
    {
      symbol: 'SOURCE',
      label: 'Provider',
      value: 26,
      unit: 'fallback',
      changePct: null,
      riskDirection: 'neutral' as const,
      trend: [26, 26],
    },
  ],
  errorMessage: '更新失败：已回退到最近一次有效数据',
});

describe('MarketOverviewPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(marketOverviewApi.getIndices).mockResolvedValue(panel('IndexTrendsCard', 'SPX'));
    vi.mocked(marketOverviewApi.getVolatility).mockResolvedValue(panel('VolatilityCard', 'VIX'));
    vi.mocked(marketOverviewApi.getFundsFlow).mockResolvedValue(panel('FundsFlowCard', 'ETF'));
    vi.mocked(marketOverviewApi.getMacro).mockResolvedValue(macroPanel());
    vi.mocked(marketApi.getCrypto).mockResolvedValue(cryptoPanel());
    vi.mocked(marketApi.getSentiment).mockResolvedValue(sentimentPanel());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('renders every market overview card with localized copy and source attribution', async () => {
    render(<MarketOverviewPage />);

    expect(screen.queryByRole('heading', { name: /大市全景监控/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /波动率与风险压力/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /加密货币行情/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /情绪与资金面/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /同步最新行情/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /刷新 全球核心指数走势/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /刷新 波动率与风险压力/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /刷新 加密货币行情/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /刷新 情绪与资金面/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /刷新 ETF 资金流向/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /刷新 宏观经济与流动性/i })).toBeInTheDocument();
    expect(screen.queryByText(/同步完成/i)).not.toBeInTheDocument();

    expect((await screen.findAllByText('SPX')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('BTC').length).toBeGreaterThan(0);
    expect(screen.getByText('76,837.04')).toBeInTheDocument();
    expect(screen.getByText(/24H \+1.47%/i)).toBeInTheDocument();
    expect(screen.getByText(/7D \+3.22%/i)).toBeInTheDocument();
    expect(screen.getByText(/贪婪与恐慌指数/i)).toBeInTheDocument();
    expect(screen.getByText('26.00')).toBeInTheDocument();
    expect(screen.getByText(/更新失败/i)).toBeInTheDocument();
    expect(screen.getAllByText('ETF').length).toBeGreaterThan(0);
    expect(screen.getAllByText('US10Y').length).toBeGreaterThan(0);
    expect(screen.queryByText('Fed Funds')).not.toBeInTheDocument();
    expect(screen.queryByText('pts')).not.toBeInTheDocument();

    expect(screen.getAllByTestId('market-overview-sparkline').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/Log:/i)).not.toBeInTheDocument();
    expect(screen.getByText(/数据驱动: BINANCE/i)).toBeInTheDocument();
    await waitFor(() => expect(marketOverviewApi.getMacro).toHaveBeenCalledTimes(1));
  });

  it('refreshes only the requested panel when a card refresh icon is clicked', async () => {
    render(<MarketOverviewPage />);

    await waitFor(() => expect(marketOverviewApi.getMacro).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /刷新 波动率与风险压力/i }));

    await waitFor(() => {
      expect(marketOverviewApi.getVolatility).toHaveBeenCalledTimes(2);
    });
    expect(marketOverviewApi.getIndices).toHaveBeenCalledTimes(1);
    expect(marketApi.getCrypto).toHaveBeenCalledTimes(1);
    expect(marketApi.getSentiment).toHaveBeenCalledTimes(1);
    expect(marketOverviewApi.getFundsFlow).toHaveBeenCalledTimes(1);
    expect(marketOverviewApi.getMacro).toHaveBeenCalledTimes(1);
  });

  it('polls market cards on the configured interval', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    render(<MarketOverviewPage />);

    await waitFor(() => expect(marketApi.getCrypto).toHaveBeenCalledTimes(1));

    const pollCallback = setIntervalSpy.mock.calls[0]?.[0] as TimerHandler | undefined;
    expect(typeof pollCallback).toBe('function');
    (pollCallback as () => void)();

    await waitFor(() => {
      expect(marketApi.getCrypto).toHaveBeenCalledTimes(2);
      expect(marketApi.getSentiment).toHaveBeenCalledTimes(2);
    });
    setIntervalSpy.mockRestore();
  });

  it('persists drag-sorted card order', async () => {
    render(<MarketOverviewPage />);

    await waitFor(() => expect(marketApi.getCrypto).toHaveBeenCalledTimes(1));

    const cryptoCard = screen.getByTestId('market-overview-card-crypto');
    const indicesCard = screen.getByTestId('market-overview-card-indices');

    fireEvent.dragStart(cryptoCard);
    fireEvent.dragOver(indicesCard);
    fireEvent.drop(indicesCard);

    expect(window.localStorage.getItem('market-overview-card-order')).toContain('crypto');
  });
});
