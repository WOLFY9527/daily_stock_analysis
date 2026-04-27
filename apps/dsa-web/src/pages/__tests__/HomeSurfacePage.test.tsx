import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analysisApi } from '../../api/analysis';
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
        { id: 3, queryId: 'q3', stockCode: 'ORCL', stockName: 'Oracle', createdAt: '2026-04-27T08:00:00Z' },
        { id: 2, queryId: 'q2', stockCode: 'TSLA', stockName: 'Tesla', createdAt: '2026-04-27T07:00:00Z' },
        { id: 1, queryId: 'q1', stockCode: 'NVDA', stockName: 'NVIDIA', createdAt: '2026-04-27T06:00:00Z' },
      ],
    });
    vi.mocked(historyApi.getDetail).mockResolvedValue({
      meta: {
        queryId: 'q3',
        stockCode: 'ORCL',
        stockName: 'Oracle',
        reportType: 'detailed',
        createdAt: '2026-04-27T08:00:00Z',
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
    });
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
    const root = screen.getByTestId('home-bento-dashboard');
    const grid = screen.getByTestId('home-bento-grid');
    const main = screen.getByTestId('home-bento-main');
    const omnibar = screen.getByTestId('home-bento-omnibar');
    const recentHistory = await screen.findByTestId('home-bento-recent-history');
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
    expect(grid).toHaveAttribute('data-bento-grid', 'true');
    expect(grid).toHaveClass('bento-grid-root');
    expect(main).toHaveClass('w-full', 'flex-1', 'min-w-0', 'flex', 'flex-col', 'py-6', 'px-6', 'md:px-8', 'xl:px-12');
    expect(main.className).not.toContain('overflow-hidden');
    expect(grid).toHaveClass('w-full', 'flex-1', 'min-h-0', 'grid-cols-1', 'items-stretch', 'gap-6', 'lg:grid-cols-3', 'xl:grid-cols-5');
    expect(grid.className).not.toContain('mt-8');
    expect(omnibar).toHaveClass('lg:col-span-3', 'xl:col-span-2', 'flex', 'h-11', 'gap-3');
    expect(grid.firstElementChild).toBe(omnibar);
    expect(grid.children[1]).toBe(recentHistory);
    expect(recentHistory).toHaveClass('hidden', 'xl:flex', 'xl:col-span-3', 'items-center', 'gap-3', 'pl-2');
    expect(homeSearch).toHaveAttribute('placeholder', '输入代码或公司名 (如 ORCL)...');
    expect(homeSearch).toHaveClass('bg-white/[0.03]', 'border', 'border-white/10', 'text-sm', 'rounded-xl', 'pl-10');
    expect(screen.getByTestId('home-bento-analyze-button')).toHaveTextContent('分析');
    expect(screen.getByTestId('home-bento-analyze-button')).toHaveClass('rounded-xl');
    expect(screen.queryByText('SYSTEM VIEW')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /扫描器/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /持仓/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /回测/i })).not.toBeInTheDocument();
    expect(screen.getByText('WOLFY AI 决断')).toBeInTheDocument();
    expect(screen.getByTestId('home-bento-drawer-trigger-decision')).toBeInTheDocument();
    expect(screen.getByTestId('home-bento-drawer-trigger-strategy')).toBeInTheDocument();
    expect(screen.getByTestId('home-bento-drawer-trigger-tech')).toBeInTheDocument();
    expect(screen.getByTestId('home-bento-drawer-trigger-fundamentals')).toBeInTheDocument();
    expect(screen.getByTestId('home-bento-breakout-pill')).toHaveClass('bg-emerald-500', 'text-black', 'rounded-full');
    expect(screen.getByTestId('home-bento-breakout-reason')).toBeInTheDocument();
    expect(screen.getByText('AI 突破归因')).toBeInTheDocument();
    expect(screen.queryByTestId('home-bento-sibling-row')).not.toBeInTheDocument();
    expect(strategyCard).toHaveClass('w-full', 'self-start', 'lg:col-span-1', 'xl:col-span-1', 'rounded-[24px]');
    expect(techCard).toHaveClass('w-full', 'self-start', 'lg:col-span-1', 'xl:col-span-1', 'rounded-[24px]');
    expect(fundamentalsCard).toHaveClass('w-full', 'self-start', 'lg:col-span-1', 'xl:col-span-1', 'rounded-[24px]');
    expect(screen.getByTestId('home-bento-card-decision')).toHaveClass('w-full', 'h-full', 'lg:col-span-3', 'xl:col-span-2', 'rounded-[24px]');
    expect(techCard).toHaveClass('bg-white/[0.02]', 'backdrop-blur-2xl', 'border-white/5');
    expect(fundamentalsCard).toHaveClass('bg-white/[0.02]', 'backdrop-blur-2xl', 'border-white/5');
    expect(entryMetric).not.toHaveClass('bg-white/[0.02]', 'border-white/[0.08]', 'p-6');
    expect(strategyMetricsGrid).toHaveClass('grid', 'grid-cols-2', 'gap-y-3.5', 'gap-x-4', 'w-full');
    expect(entryMetric).toHaveClass('col-span-2', 'flex', 'flex-col', 'gap-1');
    expect(targetMetric).not.toHaveClass('col-span-2');
    expect(stopLossMetric).not.toHaveClass('col-span-2');
    expect(screen.getByText('建仓区间')).toHaveClass('text-[10px]', 'tracking-widest', 'text-white/40');
    expect(screen.getByText('118.40 - 121.00')).toHaveClass('text-lg', 'font-bold');
    expect(screen.getByText('136.00')).toHaveClass('text-lg', 'font-bold');
    expect(screen.getByText('111.80')).toHaveClass('text-lg', 'font-bold');
    expect(screen.getByText('零轴上方金叉')).toHaveClass('text-base', 'font-bold');
    expect(screen.getByText('+18.2%')).toHaveClass('text-lg', 'font-bold');
    expect(screen.getByText('118.40 - 121.00').className).not.toContain('text-2xl');
    expect(screen.getByText('+18.2%').className).not.toContain('text-2xl');
    expect(screen.getByText('+18.2%').className).not.toContain('text-3xl');
    expect(screen.getByText('65.4')).toBeInTheDocument();
    expect(screen.getByText('2.4%')).toBeInTheDocument();
    expect(screen.getByText('市盈率 (PE)')).toBeInTheDocument();
    expect(screen.getByText('68.2%')).toBeInTheDocument();
    expect(techMetricTiles.length).toBe(0);
    expect(fundamentalsMetricTiles.length).toBe(0);
    expect(screen.getByText('零轴上方金叉')).toHaveStyle({ textShadow: '0 0 30px rgba(52, 211, 153, 0.4)' });
    expect(screen.getByText('MA20 / MA60 扩张')).toHaveStyle({ textShadow: 'none' });
    expect(screen.getByText('+18.2%')).toHaveStyle({ textShadow: '0 0 30px rgba(52, 211, 153, 0.4)' });
    expect(screen.getByText('$16.4B')).toHaveStyle({ textShadow: 'none' });
    expect(strategyCard.compareDocumentPosition(techCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(techCard.compareDocumentPosition(fundamentalsCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByTestId('home-bento-card-workflow')).not.toBeInTheDocument();
    expect(screen.queryByText('先给出区间，再决定节奏。')).not.toBeInTheDocument();
    expect(screen.queryByText('最近没有基本面特征')).not.toBeInTheDocument();
  });

  it('renders localized English copy for the signed-in dashboard', () => {
    window.localStorage.setItem('dsa-ui-language', 'en');
    useProductSurfaceMock.mockReturnValue({ isGuest: false });
    renderSurface();
    expect(screen.queryByText('WolfyStock Command Center')).not.toBeInTheDocument();
    expect(screen.getByTestId('home-bento-omnibar-input')).toHaveAttribute('placeholder', 'Enter a ticker or company name (for example ORCL)...');
    expect(screen.getByText('Execution Strategy')).toBeInTheDocument();
    expect(screen.getByText('Technical Structure')).toBeInTheDocument();
    expect(screen.getByText('Fundamental Profile')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /scanner/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /portfolio/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /backtest/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Lock the range first, then decide the pace.')).not.toBeInTheDocument();
  });

  it('opens and closes the progressive-disclosure drawer from the strategy card', async () => {
    useProductSurfaceMock.mockReturnValue({ isGuest: false });
    renderSurface();
    expect(document.body.style.overflow).toBe('');
    fireEvent.click(screen.getByTestId('home-bento-drawer-trigger-strategy'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('home-bento-drawer')).toBeInTheDocument();
    expect(screen.getAllByText('技术形态').length).toBeGreaterThan(0);
    expect(screen.getAllByText('基本面画像').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/MACD/i).length).toBeGreaterThan(0);
    fireEvent.keyDown(document, { key: 'Escape' });
    await new Promise((resolve) => window.setTimeout(resolve, 220));
    expect(await screen.findByTestId('home-bento-dashboard')).toBeInTheDocument();
  });

  it('updates the dashboard when a recent-history ticker is selected', async () => {
    useProductSurfaceMock.mockReturnValue({ isGuest: false });
    renderSurface();
    fireEvent.click(await screen.findByRole('button', { name: 'ORCL' }));
    const company = await screen.findByText('Oracle');
    const entryRange = await screen.findByText('121.80 - 124.60');
    expect(company).toHaveClass('text-lg');
    expect(entryRange).toHaveClass('text-lg', 'font-bold');
    expect(entryRange.className).not.toContain('text-2xl');
  });

  it('updates the dashboard immediately when the analyze button is pressed', async () => {
    useProductSurfaceMock.mockReturnValue({ isGuest: false });
    renderSurface();
    fireEvent.change(screen.getByTestId('home-bento-omnibar-input'), { target: { value: 'tsla' } });
    fireEvent.click(screen.getByTestId('home-bento-analyze-button'));
    expect(await screen.findByText('TSLA')).toBeInTheDocument();
    expect(analysisApi.analyzeAsync).toHaveBeenCalled();
  });
});
