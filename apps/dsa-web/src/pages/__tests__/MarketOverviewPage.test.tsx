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
    getCnIndices: vi.fn(),
    getCnBreadth: vi.fn(),
    getCnFlows: vi.fn(),
    getSectorRotation: vi.fn(),
    getRates: vi.fn(),
    getFxCommodities: vi.fn(),
    getTemperature: vi.fn(),
    getMarketBriefing: vi.fn(),
    getFutures: vi.fn(),
    getCnShortSentiment: vi.fn(),
  },
}));

const panel = (panelName: string, symbol: string, label = symbol) => ({
  panelName,
  lastRefreshAt: '2026-04-29T10:00:00',
  status: 'success' as const,
  logSessionId: `${panelName}-log`,
  items: [
    {
      symbol,
      label,
      value: 100,
      unit: 'pts',
      changePct: 1.2,
      riskDirection: 'decreasing' as const,
      trend: [96, 98, 100],
    },
  ],
});

const macroPanel = () => ({
  ...panel('MacroIndicatorsCard', 'US10Y', 'US 10Y'),
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

const snapshotPanel = (panelName: string, symbol: string, label = symbol) => ({
  panelName,
  lastRefreshAt: '2026-04-29T10:00:00',
  status: 'success' as const,
  logSessionId: `${panelName}-log`,
  items: [
    {
      symbol,
      label,
      value: 100,
      unit: 'pts',
      changePct: 1.2,
      riskDirection: 'decreasing' as const,
      trend: [96, 98, 100],
      source: 'fallback',
      hoverDetails: ['fallback snapshot'],
    },
  ],
});

const temperaturePayload = () => ({
  source: 'computed',
  updatedAt: '2026-04-29T10:00:00',
  scores: {
    overall: { value: 62, label: '偏暖', trend: 'improving' as const, description: '风险偏好改善，但宏观压力仍需关注。' },
    usRiskAppetite: { value: 68, label: '偏暖', trend: 'improving' as const, description: '美股指数与风险情绪同步改善。' },
    cnMoneyEffect: { value: 55, label: '中性', trend: 'stable' as const, description: '指数表现尚可，但市场宽度一般。' },
    macroPressure: { value: 58, label: '中性偏高', trend: 'rising' as const, description: '美元与利率走强。' },
    liquidity: { value: 52, label: '中性', trend: 'stable' as const, description: '资金环境整体平稳。' },
  },
});

const briefingPayload = () => ({
  source: 'computed',
  updatedAt: '2026-04-29T10:00:00',
  items: [
    { title: '美股风险偏好偏暖', message: '主要指数走强，VIX 回落。', severity: 'positive' as const, category: 'us' },
    { title: 'A股赚钱效应中性', message: '指数上涨但上涨家数占比一般。', severity: 'neutral' as const, category: 'cn' },
    { title: '宏观压力仍需关注', message: '美债收益率和美元指数同步走强。', severity: 'warning' as const, category: 'macro' },
  ],
});

const futuresPayload = () => ({
  source: 'fallback',
  updatedAt: '2026-04-29T10:00:00',
  items: [
    { name: '纳指期货', symbol: 'NQ', value: 18420.5, change: 65.2, changePercent: 0.35, market: 'US', session: 'premarket', sparkline: [18320, 18380, 18420.5], source: 'fallback' },
    { name: '富时A50期货', symbol: 'CN00Y', value: 12580, change: 38, changePercent: 0.3, market: 'CN', session: 'day', sparkline: [12420, 12542, 12580], source: 'fallback' },
  ],
});

const cnShortSentimentPayload = () => ({
  source: 'fallback',
  updatedAt: '2026-04-29T10:00:00',
  sentimentScore: 64,
  summary: '涨停家数占优，炸板率可控，短线情绪偏暖。',
  metrics: {
    limitUpCount: 68,
    limitDownCount: 18,
    failedLimitUpRate: 24.5,
    maxConsecutiveLimitUps: 5,
    yesterdayLimitUpPerformance: 2.8,
    firstBoardCount: 42,
    secondBoardCount: 12,
    highBoardCount: 6,
    twentyCmLimitUpCount: 9,
    stRiskLevel: 'normal',
  },
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
    vi.mocked(marketApi.getCnIndices).mockResolvedValue({
      ...snapshotPanel('ChinaIndicesCard', 'CSI300', '沪深300'),
      items: [
        ...snapshotPanel('ChinaIndicesCard', 'CSI300', '沪深300').items,
        {
          symbol: '000001.SH',
          label: '上证指数',
          value: 3120.55,
          unit: 'pts',
          changePct: 0.39,
          riskDirection: 'decreasing' as const,
          trend: [3098, 3105, 3120.55],
          source: 'fallback',
        },
      ],
    });
    vi.mocked(marketApi.getCnBreadth).mockResolvedValue(snapshotPanel('ChinaBreadthCard', 'BREADTH', '赚钱效应'));
    vi.mocked(marketApi.getCnFlows).mockResolvedValue(snapshotPanel('ChinaFlowsCard', 'NORTHBOUND', '北向资金'));
    vi.mocked(marketApi.getSectorRotation).mockResolvedValue(snapshotPanel('SectorRotationCard', 'AI', 'AI / 算力'));
    vi.mocked(marketApi.getRates).mockResolvedValue({
      ...snapshotPanel('RatesCard', 'US10Y', 'US 10Y'),
      items: [
        ...snapshotPanel('RatesCard', 'US10Y', 'US 10Y').items,
        {
          symbol: 'CN10Y',
          label: '中国10年国债收益率',
          value: 2.35,
          unit: '%',
          changePct: -1.5,
          riskDirection: 'decreasing' as const,
          trend: [2.4, 2.37, 2.35],
          source: 'fallback',
        },
      ],
    });
    vi.mocked(marketApi.getFxCommodities).mockResolvedValue({
      ...snapshotPanel('FxCommoditiesCard', 'DXY', 'DXY'),
      items: [
        ...snapshotPanel('FxCommoditiesCard', 'DXY', 'DXY').items,
        {
          symbol: 'USDCNH',
          label: 'USD/CNH',
          value: 7.24,
          unit: '',
          changePct: 0.2,
          riskDirection: 'increasing' as const,
          trend: [7.2, 7.22, 7.24],
          source: 'fallback',
        },
      ],
    });
    vi.mocked(marketApi.getTemperature).mockResolvedValue(temperaturePayload());
    vi.mocked(marketApi.getMarketBriefing).mockResolvedValue(briefingPayload());
    vi.mocked(marketApi.getFutures).mockResolvedValue(futuresPayload());
    vi.mocked(marketApi.getCnShortSentiment).mockResolvedValue(cnShortSentimentPayload());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('renders the overview as a cross-asset hero ribbon plus macro command room', async () => {
    render(<MarketOverviewPage />);

    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '美股' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'A股/港股' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全球宏观' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '加密货币' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /大市全景监控/i })).not.toBeInTheDocument();

    expect(await screen.findByTestId('market-overview-hero-ribbon')).toBeInTheDocument();
    expect(screen.getByTestId('market-temperature-strip')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /市场温度总览/i })).toBeInTheDocument();
    expect(screen.getByText(/综合市场温度/i)).toBeInTheDocument();
    expect(screen.getAllByText(/美股风险偏好/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/A股赚钱效应/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/全球宏观压力/i)).toBeInTheDocument();
    expect(screen.getByText(/流动性环境/i)).toBeInTheDocument();
    expect(screen.getByTestId('market-briefing-card')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /今日市场解读/i })).toBeInTheDocument();
    expect(screen.getByText(/美股风险偏好偏暖/i)).toBeInTheDocument();
    expect(screen.getByTestId('market-overview-hero-SPX')).toBeInTheDocument();
    expect(screen.getByTestId('market-overview-hero-CSI300')).toBeInTheDocument();
    expect(screen.getByTestId('market-overview-hero-BTC')).toBeInTheDocument();
    expect(screen.getByTestId('market-overview-hero-VIX')).toBeInTheDocument();
    expect(screen.getByTestId('market-overview-hero-US10Y')).toBeInTheDocument();
    expect(screen.getByTestId('market-overview-hero-DXY')).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: /情绪与资金面/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /利率与债券市场/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /商品与外汇/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /期货与盘前风向/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /A股短线情绪/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /同步最新行情/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /刷新 情绪与资金面/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /刷新 商品与外汇/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /刷新 利率与债券市场/i })).toBeInTheDocument();
    expect(screen.queryByText(/同步完成/i)).not.toBeInTheDocument();

    expect(await screen.findByTestId('market-overview-hero-SPX')).toBeInTheDocument();
    expect(screen.getAllByText(/比特币/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/标普500/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/美债10年期/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/美元指数/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('76,837.04').length).toBeGreaterThan(0);
    expect(screen.getByText(/贪婪与恐慌指数/i)).toBeInTheDocument();
    expect(screen.getByText('26.00')).toBeInTheDocument();
    expect(screen.getByText(/更新失败/i)).toBeInTheDocument();
    expect(screen.getAllByText(/US10Y/i).length).toBeGreaterThan(0);
    expect(screen.queryByText('Fed Funds')).not.toBeInTheDocument();
    expect(screen.queryByText('pts')).not.toBeInTheDocument();

    expect(screen.getAllByTestId('market-overview-sparkline').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/Log:/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/数据来源: FALLBACK \/ PUBLIC/i).length).toBeGreaterThan(0);
    await waitFor(() => expect(marketOverviewApi.getMacro).toHaveBeenCalledTimes(1));
  });

  it('switches market categories without refetching all cards', async () => {
    render(<MarketOverviewPage />);

    await waitFor(() => expect(marketApi.getCnIndices).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'A股/港股' }));
    expect(screen.getByRole('button', { name: 'A股/港股' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: /市场温度总览/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /今日市场解读/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /A股短线情绪/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /A股与港股指数/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /市场宽度与赚钱效应/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /资金流向/i })).toBeInTheDocument();
    expect(screen.queryByText('USD/CNH')).not.toBeInTheDocument();
    expect(screen.queryByText('中国10年国债收益率')).not.toBeInTheDocument();
    expect(screen.getByTestId('market-overview-card-cnShortSentiment')).toHaveAttribute('data-market-card-rank', '0');
    expect(screen.getByTestId('market-overview-card-futures')).toHaveAttribute('data-market-card-rank', '1');
    expect(screen.getByTestId('market-overview-card-cnIndices')).toHaveAttribute('data-market-card-rank', '2');

    fireEvent.click(screen.getByRole('button', { name: '美股' }));
    expect(screen.getByRole('heading', { name: /期货与盘前风向/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /全球核心指数走势/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /波动率与风险压力/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /ETF 资金流向/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /情绪与资金面/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /利率与债券市场/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /商品与外汇/i })).not.toBeInTheDocument();
    expect(screen.queryByText('CSI 300')).not.toBeInTheDocument();
    expect(screen.queryByText('Shanghai Composite')).not.toBeInTheDocument();
    expect(screen.queryByText('Shenzhen Component')).not.toBeInTheDocument();
    expect(screen.queryByText('DXY')).not.toBeInTheDocument();
    expect(screen.getByTestId('market-overview-card-futures')).toHaveAttribute('data-market-card-rank', '0');
    expect(screen.getByTestId('market-overview-card-indices')).toHaveAttribute('data-market-card-rank', '1');
    expect(screen.getByTestId('market-overview-card-fundsFlow')).toHaveAttribute('data-market-card-rank', '2');

    expect(marketApi.getCnIndices).toHaveBeenCalledTimes(1);
    expect(marketApi.getRates).toHaveBeenCalledTimes(1);
  });

  it('keeps other cards visible when one initial API request fails', async () => {
    vi.mocked(marketApi.getCnBreadth).mockRejectedValueOnce(new Error('breadth down'));

    render(<MarketOverviewPage />);

    expect(await screen.findByTestId('market-overview-hero-ribbon')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /市场温度总览/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /情绪与资金面/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /利率与债券市场/i })).toBeInTheDocument();
  });

  it('refreshes only the requested panel when a card refresh icon is clicked', async () => {
    render(<MarketOverviewPage />);

    await waitFor(() => expect(marketOverviewApi.getMacro).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: '美股' }));
    fireEvent.click(screen.getByRole('button', { name: /刷新 波动率与风险压力/i }));

    await waitFor(() => {
      expect(marketOverviewApi.getVolatility).toHaveBeenCalledTimes(2);
    });
    expect(marketOverviewApi.getIndices).toHaveBeenCalledTimes(1);
    expect(marketApi.getCrypto).toHaveBeenCalledTimes(1);
    expect(marketApi.getSentiment).toHaveBeenCalledTimes(1);
    expect(marketOverviewApi.getFundsFlow).toHaveBeenCalledTimes(1);
    expect(marketOverviewApi.getMacro).toHaveBeenCalledTimes(1);
    expect(marketApi.getFutures).toHaveBeenCalledTimes(1);
  });

  it('keeps fallback summary modules visible when new APIs fail', async () => {
    vi.mocked(marketApi.getTemperature).mockRejectedValueOnce(new Error('temperature down'));
    vi.mocked(marketApi.getMarketBriefing).mockRejectedValueOnce(new Error('briefing down'));
    vi.mocked(marketApi.getFutures).mockRejectedValueOnce(new Error('futures down'));
    vi.mocked(marketApi.getCnShortSentiment).mockRejectedValueOnce(new Error('sentiment down'));

    render(<MarketOverviewPage />);

    expect(await screen.findByRole('heading', { name: /市场温度总览/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /今日市场解读/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '美股' }));
    expect(screen.getByRole('heading', { name: /期货与盘前风向/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'A股/港股' }));
    expect(screen.getByRole('heading', { name: /A股短线情绪/i })).toBeInTheDocument();
  });

  it('keeps stale card data visible while refreshing a single card', async () => {
    let resolveRefresh: ((value: ReturnType<typeof snapshotPanel>) => void) | undefined;
    vi.mocked(marketApi.getCnIndices)
      .mockResolvedValueOnce(snapshotPanel('ChinaIndicesCard', '000001.SH', '上证指数'))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveRefresh = resolve;
      }));

    render(<MarketOverviewPage />);

    fireEvent.click(screen.getByRole('button', { name: 'A股/港股' }));
    expect(await screen.findByText('上证指数')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /刷新 A股与港股指数/i }));
    expect(screen.getByText('上证指数')).toBeInTheDocument();

    resolveRefresh?.(snapshotPanel('ChinaIndicesCard', '399001.SZ', '深证成指'));
    expect(await screen.findByText('深证成指')).toBeInTheDocument();
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

    const fxCard = screen.getByTestId('market-overview-card-fxCommodities');
    const sentimentCard = screen.getByTestId('market-overview-card-sentiment');

    fireEvent.dragStart(fxCard);
    fireEvent.dragOver(sentimentCard);
    fireEvent.drop(sentimentCard);

    expect(window.localStorage.getItem('market-overview-order-all')).toContain('fxCommodities');

    fireEvent.click(screen.getByRole('button', { name: 'A股/港股' }));
    const sectorCard = screen.getByTestId('market-overview-card-sectorRotation');
    const cnIndicesCard = screen.getByTestId('market-overview-card-cnIndices');

    fireEvent.dragStart(sectorCard);
    fireEvent.dragOver(cnIndicesCard);
    fireEvent.drop(cnIndicesCard);

    expect(window.localStorage.getItem('market-overview-order-cn')).toContain('sectorRotation');
  });
});
