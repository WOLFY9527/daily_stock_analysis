import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analysisApi } from '../../api/analysis';
import { createApiError, createParsedApiError } from '../../api/error';
import { historyApi } from '../../api/history';
import { UiLanguageProvider } from '../../contexts/UiLanguageContext';
import { useStockPoolStore } from '../../stores';
import HomeSurfacePage from '../HomeSurfacePage';

const { useProductSurfaceMock } = vi.hoisted(() => ({
  useProductSurfaceMock: vi.fn(),
}));

vi.mock('../../hooks/useProductSurface', () => ({
  useProductSurface: () => useProductSurfaceMock(),
}));

vi.mock('../GuestHomePage', () => ({
  default: () => <div>guest home page</div>,
}));

vi.mock('../../api/history', () => ({
  historyApi: {
    getList: vi.fn(),
    getDetail: vi.fn(),
    getNews: vi.fn(),
    getMarkdown: vi.fn(),
    deleteRecords: vi.fn(),
  },
}));

vi.mock('../../api/analysis', async () => {
  const actual = await vi.importActual<typeof import('../../api/analysis')>('../../api/analysis');
  return {
    ...actual,
    analysisApi: {
      ...actual.analysisApi,
      analyzeAsync: vi.fn(),
      getTasks: vi.fn(),
    },
  };
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const defaultHistoryReport = {
  meta: {
    queryId: 'q3',
    stockCode: 'ORCL',
    stockName: 'Oracle',
    reportType: 'detailed' as const,
    createdAt: '2026-04-27T08:00:00Z',
    reportGeneratedAt: '2026-04-27T08:03:00Z',
  },
  summary: {
    analysisSummary: 'Oracle is holding its post-earnings platform.',
    operationAdvice: 'Wait for a controlled pullback before adding.',
    trendPrediction: 'Constructive for the next 72 hours.',
    sentimentScore: 78,
    sentimentLabel: 'Bullish',
  },
  strategy: {
    idealBuy: '121.80 - 124.60',
    stopLoss: '117.40',
    takeProfit: '133.50',
  },
  details: {
    standardReport: {
      summaryPanel: {
        stock: 'Oracle',
        ticker: 'ORCL',
        oneSentence: 'Cloud backlog keeps the medium-term floor intact.',
      },
      decisionContext: {
        shortTermView: 'Post-earnings strength still holds the upper rail',
      },
      decisionPanel: {
        idealEntry: '121.80 - 124.60',
        target: '133.50',
        stopLoss: '117.40',
        buildStrategy: 'Start light, then add only after the pullback stays orderly.',
      },
      reasonLayer: {
        coreReasons: ['Institutional sponsorship remains intact after earnings.'],
      },
      technicalFields: [
        { label: 'MACD', value: 'Second expansion above zero' },
        { label: 'Moving Averages', value: 'MA20 lifting MA60' },
      ],
      fundamentalFields: [
        { label: 'Revenue Growth', value: '+9.4%' },
        { label: 'Free Cash Flow', value: '$12.1B' },
      ],
    },
  },
};

describe('HomeSurfacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    useStockPoolStore.getState().resetDashboardState();
    vi.mocked(historyApi.getList).mockResolvedValue({
      total: 3,
      page: 1,
      limit: 20,
      items: [
        { id: 3, queryId: 'q3', stockCode: 'ORCL', stockName: 'Oracle', companyName: 'Oracle', createdAt: '2026-04-27T08:00:00Z', generatedAt: '2026-04-27T08:03:00Z', isTest: false },
        { id: 2, queryId: 'q2', stockCode: 'TSLA', stockName: 'Tesla', companyName: 'Tesla', createdAt: '2026-04-27T07:00:00Z', generatedAt: '2026-04-27T07:05:00Z', isTest: false },
        { id: 1, queryId: 'q1', stockCode: 'NVDA', stockName: 'NVIDIA', companyName: 'NVIDIA', createdAt: '2026-04-27T06:00:00Z', generatedAt: '2026-04-27T06:04:00Z', isTest: false },
      ],
    });
    vi.mocked(historyApi.getDetail).mockResolvedValue(defaultHistoryReport);
    vi.mocked(analysisApi.analyzeAsync).mockResolvedValue({
      taskId: 'task-1',
      status: 'pending',
      message: 'submitted',
    });
  });

  const renderSurface = () => render(
    <MemoryRouter>
      <UiLanguageProvider>
        <HomeSurfacePage />
      </UiLanguageProvider>
    </MemoryRouter>,
  );

  it('renders the guest homepage when the current surface role is guest', () => {
    useProductSurfaceMock.mockReturnValue({ isGuest: true });
    renderSurface();
    expect(screen.getByText('guest home page')).toBeInTheDocument();
  });

  it('renders the signed-in bento dashboard for authenticated users', async () => {
    useProductSurfaceMock.mockReturnValue({ isGuest: false });
    renderSurface();
    await screen.findByText('甲骨文');
    const root = screen.getByTestId('home-bento-dashboard');
    const grid = screen.getByTestId('home-bento-grid');
    const main = screen.getByTestId('home-bento-main');
    const omnibar = screen.getByTestId('home-bento-omnibar');
    const primaryStack = screen.getByTestId('home-bento-primary-stack');
    const secondaryStack = screen.getByTestId('home-bento-secondary-stack');
    const secondaryGrid = screen.getByTestId('home-bento-secondary-grid');
    const strategyCard = screen.getByTestId('home-bento-card-strategy');
    const techCard = screen.getByTestId('home-bento-card-tech');
    const fundamentalsCard = screen.getByTestId('home-bento-card-fundamentals');
    const homeSearch = screen.getByTestId('home-bento-omnibar-input');
    const entryMetric = screen.getByTestId('home-bento-strategy-metric-建仓区间');
    const targetMetric = screen.getByTestId('home-bento-strategy-metric-目标位');
    const stopLossMetric = screen.getByTestId('home-bento-strategy-metric-止损位');
    const strategyMetricsGrid = entryMetric.parentElement;
    const techMetricTiles = Array.from(techCard.querySelectorAll('div')).filter((node) => node.className.includes('rounded-[32px]'));
    const fundamentalsMetricTiles = Array.from(fundamentalsCard.querySelectorAll('div')).filter((node) => node.className.includes('rounded-[32px]'));
    expect(root).toHaveAttribute('data-bento-surface', 'true');
    expect(root).toHaveClass('bento-surface-root');
    expect(screen.queryByTestId('home-bento-header-logo')).not.toBeInTheDocument();
    expect(root).toHaveClass('workspace-width-wide', 'w-full', 'flex', 'flex-1', 'min-h-[calc(100vh-80px)]', 'flex-col', 'overflow-x-hidden');
    expect(root.className).not.toContain('max-w-[1920px]');
    expect(root.className).not.toContain('md:h-[calc(100dvh-var(--shell-masthead-height)-var(--shell-masthead-height)-4.9rem)]');
    expect(root.className).not.toContain('overflow-hidden');
    expect(omnibar).toHaveClass('w-full', 'flex', 'gap-3', 'h-12', 'mb-6', 'shrink-0');
    expect(grid).toHaveAttribute('data-bento-grid', 'true');
    expect(main).toHaveClass('w-full', 'flex-1', 'min-w-0', 'flex', 'flex-col', 'py-6', 'px-6', 'md:px-8', 'xl:px-12');
    expect(main.className).not.toContain('overflow-hidden');
    expect(main.firstElementChild).toBe(omnibar);
    expect(main.children[1]).toBe(grid);
    expect(grid).toHaveClass('w-full', 'grid', 'grid-cols-1', 'items-stretch', 'gap-6', 'xl:grid-cols-5');
    expect(grid.className).not.toContain('flex-1');
    expect(primaryStack).toHaveClass('xl:col-span-2', 'flex', 'flex-col', 'gap-6', 'h-full', 'min-h-0');
    expect(grid.firstElementChild).toBe(primaryStack);
    expect(secondaryStack).toHaveClass('xl:col-span-3', 'flex', 'flex-col', 'gap-6', 'min-w-0');
    expect(secondaryGrid).toHaveClass('grid', 'grid-cols-1', 'md:grid-cols-2', 'gap-6', 'flex-1', 'items-stretch');
    expect(homeSearch).toHaveAttribute('placeholder', '输入代码唤醒 AI (如 ORCL)...');
    expect(homeSearch).toHaveValue('');
    expect(homeSearch).toHaveClass('bg-white/[0.02]', 'border', 'border-white/5', 'text-sm', 'rounded-2xl', 'pl-11', 'shadow-lg');
    expect(screen.getByTestId('home-bento-analyze-button')).toHaveTextContent('分析');
    expect(screen.getByTestId('home-bento-analyze-button')).toHaveClass('rounded-2xl', 'bg-white/[0.05]', 'border', 'border-white/10', 'backdrop-blur-md');
    expect(within(omnibar).getByTestId('home-bento-history-drawer-trigger')).toBeInTheDocument();
    expect(within(omnibar).getByRole('button', { name: '历史记录' })).toBeInTheDocument();
    expect(screen.queryByText('SYSTEM VIEW')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /扫描器/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /持仓/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /回测/i })).not.toBeInTheDocument();
    expect(screen.getByText('WOLFY AI 决断')).toBeInTheDocument();
    expect(screen.getByTestId('home-bento-drawer-trigger-decision')).toBeInTheDocument();
    expect(screen.getByTestId('home-bento-drawer-trigger-strategy')).toBeInTheDocument();
    expect(screen.getByTestId('home-bento-drawer-trigger-tech')).toBeInTheDocument();
    expect(screen.getByTestId('home-bento-drawer-trigger-fundamentals')).toBeInTheDocument();
    expect(screen.getByTestId('home-bento-decision-chart-workspace')).toHaveAttribute('data-chart-engine', 'echarts');
    expect(screen.getByTestId('home-bento-decision-timeframe-swing')).toHaveTextContent('日K');
    expect(screen.getByTestId('home-bento-decision-timeframe-intraday')).toHaveTextContent('分时');
    expect(screen.getByTestId('home-bento-decision-timeframe-position')).toHaveTextContent('周K');
    expect(screen.getByTestId('home-bento-breakout-reason')).toBeInTheDocument();
    expect(screen.getByText('最近报告归因')).toBeInTheDocument();
    expect(screen.queryByTestId('home-bento-sibling-row')).not.toBeInTheDocument();
    expect(strategyCard).toHaveClass('w-full', 'rounded-[24px]');
    expect(strategyCard.className).not.toContain('xl:col-span-1');
    expect(techCard).toHaveClass('w-full', 'h-full', 'rounded-[24px]');
    expect(techCard.className).not.toContain('xl:col-span-1');
    expect(fundamentalsCard).toHaveClass('w-full', 'h-full', 'rounded-[24px]');
    expect(fundamentalsCard.className).not.toContain('xl:col-span-1');
    expect(screen.getByTestId('home-bento-card-decision')).toHaveClass('w-full', 'h-full', 'rounded-[24px]');
    expect(screen.getByTestId('home-bento-card-decision').className).not.toContain('xl:col-span-2');
    expect(techCard).toHaveClass('bg-white/[0.02]', 'backdrop-blur-2xl', 'border-white/5');
    expect(fundamentalsCard).toHaveClass('bg-white/[0.02]', 'backdrop-blur-2xl', 'border-white/5');
    expect(entryMetric).not.toHaveClass('bg-white/[0.02]', 'border-white/[0.08]', 'p-6');
    expect(strategyMetricsGrid).toHaveClass('grid', 'grid-cols-2', 'gap-y-3.5', 'gap-x-4', 'w-full');
    expect(entryMetric).toHaveClass('col-span-2', 'flex', 'flex-col', 'gap-1');
    expect(targetMetric).not.toHaveClass('col-span-2');
    expect(stopLossMetric).not.toHaveClass('col-span-2');
    const macdSignal = screen.getByTestId('home-bento-tech-signal-MACD');
    const macdSignalValue = macdSignal.querySelectorAll('span')[1];
    expect(screen.getByText('建仓区间')).toHaveClass('text-[10px]', 'tracking-widest', 'text-white/40', 'truncate');
    expect(screen.getByText('121.80 - 124.60')).toHaveClass('text-lg', 'font-bold');
    expect(screen.getByText('133.50')).toHaveClass('text-lg', 'font-bold');
    expect(screen.getByText('117.40')).toHaveClass('text-lg', 'font-bold');
    expect(macdSignalValue).not.toBeUndefined();
    expect(macdSignalValue).toHaveClass('text-base', 'font-bold');
    expect(screen.getByText('营收仍在稳步扩张，需求主线未坏')).toHaveClass('text-lg', 'font-bold');
    expect(screen.getByText('121.80 - 124.60').className).not.toContain('text-2xl');
    expect(screen.getByText('营收仍在稳步扩张，需求主线未坏').className).not.toContain('text-2xl');
    expect(screen.getByText('营收仍在稳步扩张，需求主线未坏').className).not.toContain('text-3xl');
    expect(techMetricTiles.length).toBe(0);
    expect(fundamentalsMetricTiles.length).toBe(0);
    expect(macdSignalValue).toHaveStyle({ textShadow: '0 0 30px rgba(52, 211, 153, 0.4)' });
    expect(screen.getByText('零轴上方二次扩张，动能继续偏强')).toBeInTheDocument();
    expect(screen.getByText('MA20 托举 MA60，多头排列延续')).toBeInTheDocument();
    expect(screen.getByText('营收仍在稳步扩张，需求主线未坏')).toHaveStyle({ textShadow: '0 0 30px rgba(52, 211, 153, 0.4)' });
    expect(screen.getByText('自由现金流充裕，波动缓冲仍在')).toHaveStyle({ textShadow: 'none' });
    expect(screen.queryByText('+9.4%')).not.toBeInTheDocument();
    expect(screen.queryByText('$12.1B')).not.toBeInTheDocument();
    expect(primaryStack.compareDocumentPosition(secondaryStack) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(omnibar.compareDocumentPosition(screen.getByTestId('home-bento-card-decision')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(strategyCard.compareDocumentPosition(secondaryGrid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(techCard.compareDocumentPosition(fundamentalsCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByTestId('home-bento-card-workflow')).not.toBeInTheDocument();
    expect(screen.queryByText('先给出区间，再决定节奏。')).not.toBeInTheDocument();
    expect(screen.queryByText('最近没有基本面特征')).not.toBeInTheDocument();
  });

  it('renders the standby zero-state when there is no non-test history', async () => {
    useProductSurfaceMock.mockReturnValue({ isGuest: false });
    vi.mocked(historyApi.getList).mockResolvedValueOnce({
      total: 0,
      page: 1,
      limit: 20,
      items: [],
    });

    renderSurface();

    const zeroState = await screen.findByTestId('home-bento-zero-state');
    const omnibar = screen.getByTestId('home-bento-omnibar');
    expect(omnibar).toBeInTheDocument();
    expect(screen.getByTestId('home-bento-history-drawer-trigger')).toBeInTheDocument();
    expect(screen.getByText('系统待命')).toBeInTheDocument();
    expect(screen.getByText('在上方输入股票代码或公司名称，唤醒 Wolfy AI 量化分析引擎。')).toBeInTheDocument();
    expect(zeroState).toHaveClass('w-full', 'flex-1', 'flex', 'flex-col', 'items-center', 'justify-center', 'bg-white/[0.02]', 'border', 'border-white/5', 'rounded-[24px]', 'min-h-[500px]');
    expect(screen.queryByTestId('home-bento-grid')).not.toBeInTheDocument();
    expect(screen.queryByTestId('home-bento-card-decision')).not.toBeInTheDocument();
    expect(screen.queryByText('甲骨文')).not.toBeInTheDocument();
  });

  it('renders localized English copy for the signed-in dashboard', async () => {
    window.localStorage.setItem('dsa-ui-language', 'en');
    useProductSurfaceMock.mockReturnValue({ isGuest: false });
    renderSurface();
    expect(screen.queryByText('WolfyStock Command Center')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'History' })).toBeInTheDocument();
    expect(await screen.findByText('Execution Strategy')).toBeInTheDocument();
    expect(screen.getByTestId('home-bento-omnibar-input')).toHaveAttribute('placeholder', 'Enter a ticker to wake the AI (for example ORCL)...');
    expect(screen.getByText('Technical Structure')).toBeInTheDocument();
    expect(screen.getByText('Fundamental Profile')).toBeInTheDocument();
    expect(screen.getByText('Execution Strategy')).toHaveClass('truncate');
    expect(screen.getByText('Fundamental Profile')).toHaveClass('truncate');
    expect(screen.queryByRole('link', { name: /scanner/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /portfolio/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /backtest/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Lock the range first, then decide the pace.')).not.toBeInTheDocument();
    expect(screen.getByTestId('home-bento-decision-timeframe-swing')).toHaveTextContent('5D');
    expect(screen.getByTestId('home-bento-decision-timeframe-intraday')).toHaveTextContent('1D');
    expect(screen.getByTestId('home-bento-decision-timeframe-position')).toHaveTextContent('1M');
    expect(screen.getByText('Latest Report Context')).toBeInTheDocument();
  });

  it('sanitizes Chinese report fields when the dashboard is viewed in English', async () => {
    window.localStorage.setItem('dsa-ui-language', 'en');
    useProductSurfaceMock.mockReturnValue({ isGuest: false });
    vi.mocked(historyApi.getDetail).mockImplementation((recordId) => {
      if (recordId !== 3) {
        return Promise.resolve(defaultHistoryReport);
      }

      return Promise.resolve({
        ...defaultHistoryReport,
        meta: {
          ...defaultHistoryReport.meta,
          id: 3,
          queryId: 'q3',
          stockCode: 'ORCL',
          stockName: '待确认股票',
        },
        summary: {
          ...defaultHistoryReport.summary,
          analysisSummary: '分析过程出错: All LLM models failed (tried 2 model(s)). Last error: litellm.RateLimitError: litellm.RateLimitError',
          operationAdvice: '理想做法是回踩支撑簇小仓试错，若站回 MA5/MA10 再做第二笔。',
          trendPrediction: '短线技术偏强，均线结构偏强、价格位于 MA20 上方、价格位于 MA60 上方。',
          sentimentLabel: '乐观',
          sentimentScore: 60,
        },
        strategy: {
          idealBuy: '172.92-178.04（回踩支撑确认）',
          stopLoss: '164.39（技术失效位）',
          takeProfit: '180.45-189.17（目标区间）',
        },
        details: {
          standardReport: {
            ...defaultHistoryReport.details.standardReport,
            summaryPanel: {
              ...defaultHistoryReport.details.standardReport.summaryPanel,
              stock: '待确认股票',
            },
            decisionContext: {
              shortTermView: '短线技术偏强，均线结构偏强、价格位于 MA20 上方、价格位于 MA60 上方。',
            },
            reasonLayer: {
              coreReasons: ['技术面与基本面相互印证，综合建议以持有为主。'],
            },
            decisionPanel: {
              ...defaultHistoryReport.details.standardReport.decisionPanel,
              idealEntry: '172.92-178.04（回踩支撑确认）',
              target: '180.45-189.17（目标区间）',
              stopLoss: '164.39（技术失效位）',
              buildStrategy: '理想做法是回踩支撑簇小仓试错，若站回 MA5/MA10 再做第二笔。',
            },
            technicalFields: [
              { label: 'MA5', value: '178.19' },
              { label: 'MA10', value: '175.48' },
              { label: 'MA20', value: '159.63' },
              { label: 'MA60', value: '154.05' },
              { label: 'RSI14', value: '67.97' },
            ],
            fundamentalFields: [
              { label: '总市值(最新值)', value: '4983.61亿' },
              { label: '流通市值(最新值)', value: 'NA（字段待接入）' },
              { label: '总股本(最新值)', value: '28.76亿' },
              { label: '流通股(最新值)', value: '17.09亿' },
              { label: '市盈率(TTM)', value: '31.17' },
              { label: '预期市盈率(一致预期)', value: '21.58' },
            ],
          },
        },
      });
    });

    renderSurface();
    fireEvent.click(await screen.findByTestId('home-bento-history-drawer-trigger'));
    fireEvent.click(await screen.findByTestId('home-bento-history-item-3'));

    await waitFor(() => expect(screen.queryByTestId('home-bento-loading-decision-card')).not.toBeInTheDocument());
    expect(await screen.findByText('Oracle')).toBeInTheDocument();
    expect(screen.getByText('Bullish')).toBeInTheDocument();
    expect(screen.getByText('172.92-178.04 (Pullback support confirmed)')).toBeInTheDocument();
    expect(screen.getByText('180.45-189.17 (Target zone)')).toBeInTheDocument();
    expect(screen.getByText('164.39 (Technical invalidation)')).toBeInTheDocument();
    expect(screen.getByText('Market Cap (Latest)')).toBeInTheDocument();
    expect(screen.getByText('-')).toBeInTheDocument();
    expect(screen.queryByText('N/A (field pending)')).not.toBeInTheDocument();
    expect(screen.queryByText('回踩支撑确认')).not.toBeInTheDocument();
    expect(screen.queryByText('总市值(最新值)')).not.toBeInTheDocument();
    expect(screen.queryByText('待确认股票')).not.toBeInTheDocument();
  });

  it('opens and closes the progressive-disclosure drawer from the strategy card', async () => {
    useProductSurfaceMock.mockReturnValue({ isGuest: false });
    renderSurface();
    expect(document.body.style.overflow).toBe('');
    fireEvent.click(await screen.findByTestId('home-bento-drawer-trigger-strategy'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('home-bento-drawer')).toBeInTheDocument();
    expect(screen.getByText('执行约束')).toBeInTheDocument();
    expect(screen.getAllByText('建仓区间').length).toBeGreaterThan(0);
    expect(screen.getAllByText('仓位节奏').length).toBeGreaterThan(0);
    fireEvent.keyDown(document, { key: 'Escape' });
    await new Promise((resolve) => window.setTimeout(resolve, 220));
    expect(await screen.findByTestId('home-bento-dashboard')).toBeInTheDocument();
  });

  it('loads the clicked history record from the database instead of re-analyzing', async () => {
    useProductSurfaceMock.mockReturnValue({ isGuest: false });
    const deferred = createDeferred<typeof defaultHistoryReport>();
    vi.mocked(historyApi.getDetail).mockImplementationOnce(() => deferred.promise);
    renderSurface();
    fireEvent.click(await screen.findByTestId('home-bento-history-drawer-trigger'));
    expect(await screen.findByTestId('home-bento-history-drawer')).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId('home-bento-history-item-2'));

    expect(await screen.findByTestId('home-bento-loading-decision-card')).toBeInTheDocument();
    expect(historyApi.getDetail).toHaveBeenCalledWith(2);
    expect(analysisApi.analyzeAsync).not.toHaveBeenCalled();

    deferred.resolve({
      ...defaultHistoryReport,
      meta: {
        ...defaultHistoryReport.meta,
        id: 2,
        queryId: 'q2',
        stockCode: 'TSLA',
        stockName: 'Tesla',
      },
    });
  });

  it('shows canonical generated timestamps in the history drawer', async () => {
    useProductSurfaceMock.mockReturnValue({ isGuest: false });
    renderSurface();

    fireEvent.click(await screen.findByTestId('home-bento-history-drawer-trigger'));

    expect(await screen.findByText('Oracle (ORCL)')).toBeInTheDocument();
    expect(screen.getByText('Tesla (TSLA)')).toBeInTheDocument();
    expect(screen.getByText('NVIDIA (NVDA)')).toBeInTheDocument();
    expect(screen.getByText('04/27 16:03')).toBeInTheDocument();
    expect(screen.getByText('04/27 15:05')).toBeInTheDocument();
  });

  it('hides test history rows and falls back to ticker when company name is missing', async () => {
    useProductSurfaceMock.mockReturnValue({ isGuest: false });
    vi.mocked(historyApi.getList).mockResolvedValueOnce({
      total: 3,
      page: 1,
      limit: 20,
      items: [
        { id: 31, queryId: 'q31', stockCode: 'ORCL', stockName: 'Oracle', companyName: 'Oracle', createdAt: '2026-04-27T08:00:00Z', generatedAt: '2026-04-27T08:03:00Z', isTest: false },
        { id: 32, queryId: 'q32', stockCode: 'BCHK', stockName: 'Oracle Browser Check', companyName: 'Oracle Browser Check', createdAt: '2026-04-27T07:00:00Z', generatedAt: '2026-04-27T07:05:00Z', isTest: true },
        { id: 33, queryId: 'q33', stockCode: 'NVDA', stockName: '', companyName: '', createdAt: '2026-04-27T06:00:00Z', generatedAt: '2026-04-27T06:04:00Z', isTest: false },
      ],
    });
    renderSurface();

    fireEvent.click(await screen.findByTestId('home-bento-history-drawer-trigger'));

    expect(await screen.findByText('Oracle (ORCL)')).toBeInTheDocument();
    expect(screen.getByText('NVDA')).toBeInTheDocument();
    expect(screen.queryByText('Oracle Browser Check (BCHK)')).not.toBeInTheDocument();
  });

  it('deletes a single history row from the drawer after confirmation', async () => {
    useProductSurfaceMock.mockReturnValue({ isGuest: false });
    vi.mocked(historyApi.deleteRecords).mockResolvedValueOnce({ deleted: 1 });
    vi.mocked(historyApi.getList)
      .mockResolvedValueOnce({
        total: 3,
        page: 1,
        limit: 20,
        items: [
          { id: 3, queryId: 'q3', stockCode: 'ORCL', stockName: 'Oracle', companyName: 'Oracle', createdAt: '2026-04-27T08:00:00Z', generatedAt: '2026-04-27T08:03:00Z', isTest: false },
          { id: 2, queryId: 'q2', stockCode: 'TSLA', stockName: 'Tesla', companyName: 'Tesla', createdAt: '2026-04-27T07:00:00Z', generatedAt: '2026-04-27T07:05:00Z', isTest: false },
          { id: 1, queryId: 'q1', stockCode: 'NVDA', stockName: 'NVIDIA', companyName: 'NVIDIA', createdAt: '2026-04-27T06:00:00Z', generatedAt: '2026-04-27T06:04:00Z', isTest: false },
        ],
      })
      .mockResolvedValueOnce({
        total: 2,
        page: 1,
        limit: 20,
        items: [
          { id: 3, queryId: 'q3', stockCode: 'ORCL', stockName: 'Oracle', companyName: 'Oracle', createdAt: '2026-04-27T08:00:00Z', generatedAt: '2026-04-27T08:03:00Z', isTest: false },
          { id: 1, queryId: 'q1', stockCode: 'NVDA', stockName: 'NVIDIA', companyName: 'NVIDIA', createdAt: '2026-04-27T06:00:00Z', generatedAt: '2026-04-27T06:04:00Z', isTest: false },
        ],
      });
    vi.mocked(historyApi.getDetail).mockResolvedValue({
      ...defaultHistoryReport,
      meta: {
        ...defaultHistoryReport.meta,
        id: 3,
        queryId: 'q3',
      },
    });

    renderSurface();

    fireEvent.click(await screen.findByTestId('home-bento-history-drawer-trigger'));
    fireEvent.click(await screen.findByTestId('home-bento-history-delete-2'));

    expect(await screen.findByText('删除历史记录')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(historyApi.deleteRecords).toHaveBeenCalledWith([2]));
    await waitFor(() => expect(screen.queryByTestId('home-bento-history-item-2')).not.toBeInTheDocument());
    expect(screen.getByTestId('home-bento-history-item-3')).toBeInTheDocument();
    expect(screen.getByTestId('home-bento-history-item-1')).toBeInTheDocument();
  });

  it('deletes all visible drawer rows after confirmation', async () => {
    useProductSurfaceMock.mockReturnValue({ isGuest: false });
    vi.mocked(historyApi.deleteRecords).mockResolvedValueOnce({ deleted: 3 });
    vi.mocked(historyApi.getList)
      .mockResolvedValueOnce({
        total: 3,
        page: 1,
        limit: 20,
        items: [
          { id: 3, queryId: 'q3', stockCode: 'ORCL', stockName: 'Oracle', companyName: 'Oracle', createdAt: '2026-04-27T08:00:00Z', generatedAt: '2026-04-27T08:03:00Z', isTest: false },
          { id: 2, queryId: 'q2', stockCode: 'TSLA', stockName: 'Tesla', companyName: 'Tesla', createdAt: '2026-04-27T07:00:00Z', generatedAt: '2026-04-27T07:05:00Z', isTest: false },
          { id: 1, queryId: 'q1', stockCode: 'NVDA', stockName: 'NVIDIA', companyName: 'NVIDIA', createdAt: '2026-04-27T06:00:00Z', generatedAt: '2026-04-27T06:04:00Z', isTest: false },
        ],
      })
      .mockResolvedValueOnce({
        total: 0,
        page: 1,
        limit: 20,
        items: [],
      });

    renderSurface();

    fireEvent.click(await screen.findByTestId('home-bento-history-drawer-trigger'));
    fireEvent.click(await screen.findByTestId('home-bento-history-delete-all'));

    expect(await screen.findByText('确认删除选中的 3 条历史记录吗？删除后将不可恢复。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(historyApi.deleteRecords).toHaveBeenCalledWith([3, 2, 1]));
    await waitFor(() => expect(screen.getByText('历史分析尚未同步。')).toBeInTheDocument());
  });

  it('renders a cached history snapshot immediately and then replaces it with database detail', async () => {
    useProductSurfaceMock.mockReturnValue({ isGuest: false });
    renderSurface();
    const deferred = createDeferred<typeof defaultHistoryReport>();

    useStockPoolStore.setState({
      reportSnapshotsByStockCode: {
        TSLA: {
          ...defaultHistoryReport,
          meta: {
            ...defaultHistoryReport.meta,
            id: 2,
            queryId: 'q2',
            stockCode: 'TSLA',
            stockName: 'Tesla',
          },
          summary: {
            ...defaultHistoryReport.summary,
            analysisSummary: 'Tesla cached snapshot should render immediately.',
            operationAdvice: 'Cached report only.',
            trendPrediction: 'No re-analyze should happen.',
            sentimentScore: 56,
            sentimentLabel: 'Neutral',
          },
          strategy: {
            idealBuy: '166.00 - 171.50',
            stopLoss: '159.20',
            takeProfit: '183.00',
          },
          details: {
            standardReport: {
              ...defaultHistoryReport.details.standardReport,
              summaryPanel: {
                ...defaultHistoryReport.details.standardReport.summaryPanel,
                stock: 'Tesla',
                ticker: 'TSLA',
                oneSentence: 'Cached snapshot only.',
              },
              decisionPanel: {
                ...defaultHistoryReport.details.standardReport.decisionPanel,
                idealEntry: '166.00 - 171.50',
                target: '183.00',
                stopLoss: '159.20',
              },
              technicalFields: [
                { label: 'MACD', value: '零轴下方收敛' },
                { label: 'MA20', value: '167.80' },
                { label: 'MA60', value: '161.20' },
              ],
              fundamentalFields: [
                { label: '收入增速', value: '+2.7%' },
                { label: '自由现金流', value: '$4.0B' },
                { label: '毛利率', value: '17.4%' },
              ],
            },
          },
        },
      },
    });

    vi.mocked(historyApi.getDetail).mockImplementationOnce(() => deferred.promise);
    vi.mocked(analysisApi.analyzeAsync).mockClear();

    fireEvent.click(await screen.findByTestId('home-bento-history-drawer-trigger'));
    fireEvent.click(await screen.findByTestId('home-bento-history-item-2'));

    expect(await screen.findByText('Tesla')).toBeInTheDocument();
    expect(screen.getByText('Cached snapshot only.')).toBeInTheDocument();
    expect(historyApi.getDetail).toHaveBeenCalledWith(2);
    expect(analysisApi.analyzeAsync).not.toHaveBeenCalled();

    deferred.resolve({
      ...defaultHistoryReport,
      meta: {
        ...defaultHistoryReport.meta,
        id: 2,
        queryId: 'q2',
        stockCode: 'TSLA',
        stockName: 'Tesla',
      },
      summary: {
        ...defaultHistoryReport.summary,
        analysisSummary: 'Database detail must replace the cached snapshot.',
        operationAdvice: 'Trust the persisted detail.',
        trendPrediction: 'History detail is the source of truth.',
        sentimentScore: 62,
        sentimentLabel: 'Bullish',
      },
      strategy: {
        idealBuy: '168.40 - 170.20',
        stopLoss: '162.80',
        takeProfit: '184.20',
      },
      details: {
        standardReport: {
          ...defaultHistoryReport.details.standardReport,
          summaryPanel: {
            ...defaultHistoryReport.details.standardReport.summaryPanel,
            stock: 'Tesla',
            ticker: 'TSLA',
            oneSentence: 'Persisted database detail replaced the cached snapshot.',
          },
          decisionPanel: {
            ...defaultHistoryReport.details.standardReport.decisionPanel,
            idealEntry: '168.40 - 170.20',
            target: '184.20',
            stopLoss: '162.80',
          },
          technicalFields: [
            { label: 'MACD', value: '金叉后继续放大' },
            { label: 'MA20', value: '168.20' },
            { label: 'MA60', value: '163.10' },
          ],
        },
      },
    });

    expect(await screen.findByText('Persisted database detail replaced the cached snapshot.')).toBeInTheDocument();
    expect(screen.queryByText('Cached snapshot only.')).not.toBeInTheDocument();
  });

  it('keeps TSLA drill-down content synchronized with the active dashboard payload', async () => {
    useProductSurfaceMock.mockReturnValue({ isGuest: false });
    vi.mocked(historyApi.getDetail).mockImplementation((recordId) => {
      if (recordId === 2) {
        return Promise.resolve({
          ...defaultHistoryReport,
          meta: {
            ...defaultHistoryReport.meta,
            id: 2,
            queryId: 'q2',
            stockCode: 'TSLA',
            stockName: 'Tesla',
          },
          summary: {
            ...defaultHistoryReport.summary,
            analysisSummary: 'Tesla remains in a bounce validation zone.',
            operationAdvice: 'Add only after a second confirmation.',
            trendPrediction: 'High-beta rebound still needs follow-through volume.',
            sentimentScore: 56,
            sentimentLabel: 'Neutral',
          },
          strategy: {
            idealBuy: '166.00 - 171.50',
            stopLoss: '159.20',
            takeProfit: '183.00',
          },
          details: {
            standardReport: {
              ...defaultHistoryReport.details.standardReport,
              summaryPanel: {
                ...defaultHistoryReport.details.standardReport.summaryPanel,
                stock: 'Tesla',
                ticker: 'TSLA',
                oneSentence: 'Tesla is still inside a bounce validation zone after the initial squeeze.',
              },
              decisionContext: {
                shortTermView: 'High-beta rebound still needs follow-through volume.',
              },
              decisionPanel: {
                ...defaultHistoryReport.details.standardReport.decisionPanel,
                idealEntry: '166.00 - 171.50',
                target: '183.00',
                stopLoss: '159.20',
                buildStrategy: 'Add only after the second confirmation stays orderly.',
              },
              reasonLayer: {
                coreReasons: ['The bounce is still event-driven and has not converted into a clean trend continuation yet.'],
              },
              technicalFields: [
                { label: 'MACD', value: '零轴下方收敛' },
                { label: '均线结构', value: 'MA20 仍在下压' },
                { label: '量价配合', value: '反弹放量，续航待定' },
              ],
              fundamentalFields: [
                { label: '收入增速', value: '+2.7%' },
                { label: '自由现金流', value: '$4.0B' },
                { label: '毛利率', value: '17.4%' },
              ],
            },
          },
        });
      }
      return Promise.resolve(defaultHistoryReport);
    });

    renderSurface();
    fireEvent.click(await screen.findByTestId('home-bento-history-drawer-trigger'));
    fireEvent.click(await screen.findByTestId('home-bento-history-item-2'));

    expect(await screen.findByText('Tesla')).toBeInTheDocument();
    expect(screen.getByTestId('home-bento-tech-signal-MACD')).toHaveTextContent('零轴下方动能收敛，反弹仍待确认');

    fireEvent.click(screen.getByTestId('home-bento-drawer-trigger-tech'));
    expect(await screen.findByText('TSLA 技术下钻')).toBeInTheDocument();
    expect(screen.getAllByText('零轴下方动能收敛，反弹仍待确认').length).toBeGreaterThan(1);
    expect(screen.getByText('快慢线仍在零轴下方运行，绿柱缩短，说明空头动能在衰减；下一步要看能否形成金叉，把反弹转成可交易的趋势段。')).toBeInTheDocument();
    expect(screen.queryByText(/聚焦 MACD/)).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await new Promise((resolve) => window.setTimeout(resolve, 220));

    fireEvent.click(screen.getByTestId('home-bento-drawer-trigger-fundamentals'));
    expect(await screen.findByText('TSLA 基本面下钻')).toBeInTheDocument();
    expect(screen.getAllByText('营收增速放缓，期待新驱动接力').length).toBeGreaterThan(1);
    expect(screen.getByText('汽车交付量放缓拖累整体营收增速，但储能业务的高毛利贡献正在抬升，对冲了汽车主业的增速压力。')).toBeInTheDocument();
    expect(screen.queryByText(/将接入盈利质量与估值弹性描述卡/)).not.toBeInTheDocument();
  });

  it('enters loading state immediately when the analyze button is pressed and clears the local search query', async () => {
    useProductSurfaceMock.mockReturnValue({ isGuest: false });
    renderSurface();
    fireEvent.change(screen.getByTestId('home-bento-omnibar-input'), { target: { value: 'tsla' } });
    fireEvent.click(screen.getByTestId('home-bento-analyze-button'));
    expect(await screen.findByTestId('home-bento-loading-decision-card')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('home-bento-omnibar-input')).toHaveValue(''));
    expect(analysisApi.analyzeAsync).toHaveBeenCalled();
  });

  it('falls back to demo data with a toast when the analysis API fails', async () => {
    useProductSurfaceMock.mockReturnValue({ isGuest: false });
    const deferred = createDeferred<never>();
    vi.mocked(analysisApi.analyzeAsync).mockImplementationOnce(() => deferred.promise);
    renderSurface();
    fireEvent.change(screen.getByTestId('home-bento-omnibar-input'), { target: { value: 'AAPL' } });
    fireEvent.click(screen.getByTestId('home-bento-analyze-button'));

    expect(await screen.findByTestId('home-bento-loading-decision-card')).toBeInTheDocument();
    deferred.reject(createApiError(createParsedApiError({
        title: '请求过于频繁',
        message: '请求过于频繁，请稍后再试。',
        status: 429,
        category: 'upstream_unavailable',
      })));

    expect(await screen.findByText('AI 引擎调用过载，已加载本地快照数据')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('home-bento-omnibar-input')).toHaveValue(''));
    expect(screen.getByText('甲骨文')).toBeInTheDocument();
    expect(screen.queryByText('待确认股票')).not.toBeInTheDocument();
    expect(screen.getByText('偏多')).toBeInTheDocument();
    expect(screen.getByText('短线技术偏强，均线结构偏多')).toBeInTheDocument();
    expect(screen.getByText('持有。技术结构：价格位于 MA20 上方，防守位在近期支撑带；若回踩企稳，趋势延续概率更高。')).toBeInTheDocument();
    expect(screen.getByText('技术面与基本面相互印证，资金承接良好，综合建议以持有为主。')).toBeInTheDocument();
    expect(screen.getByText('短线动能充沛，价格沿五日线攀升')).toBeInTheDocument();
    expect(screen.getByText('趋势支撑确认，回踩不破可视作介入点')).toBeInTheDocument();
    expect(screen.getByText('总市值体量充足，流动性承接极强')).toBeInTheDocument();
    expect(screen.getByText('估值仍在成长溢价区，需业绩继续兑现')).toBeInTheDocument();
    expect(screen.queryByText(/RateLimitError/i)).not.toBeInTheDocument();
  });
});
