import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analysisApi } from '../../api/analysis';
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

vi.mock('../../api/analysis', () => ({
  analysisApi: {
    analyzeAsync: vi.fn(),
    getTasks: vi.fn(),
    getTaskStreamUrl: vi.fn(),
  },
  DuplicateTaskError: class DuplicateTaskError extends Error {},
}));

describe('HomeSurfacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    useStockPoolStore.getState().resetDashboardState();
    vi.mocked(analysisApi.analyzeAsync).mockResolvedValue({
      taskId: 'task-home-bento',
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

  it('renders the signed-in bento dashboard for authenticated users', () => {
    useProductSurfaceMock.mockReturnValue({ isGuest: false });
    renderSurface();
    const root = screen.getByTestId('home-bento-dashboard');
    const strategyCard = screen.getByTestId('home-bento-card-strategy');
    const techCard = screen.getByTestId('home-bento-card-tech');
    const fundamentalsCard = screen.getByTestId('home-bento-card-fundamentals');
    const entryMetric = screen.getByTestId('home-bento-strategy-metric-建仓区间');
    const targetMetric = screen.getByTestId('home-bento-strategy-metric-目标位');
    const stopLossMetric = screen.getByTestId('home-bento-strategy-metric-止损位');
    const strategyMetricsGrid = entryMetric.parentElement;
    const techMetricTiles = Array.from(techCard.querySelectorAll('div')).filter((node) => node.className.includes('rounded-[32px]'));
    const fundamentalsMetricTiles = Array.from(fundamentalsCard.querySelectorAll('div')).filter((node) => node.className.includes('rounded-[32px]'));
    expect(root).toHaveAttribute('data-bento-surface', 'true');
    expect(root).toHaveClass('bento-surface-root');
    expect(screen.queryByTestId('home-bento-header-logo')).not.toBeInTheDocument();
    expect(root).toHaveClass('workspace-width-wide', 'w-full', 'max-w-[1920px]', 'flex', 'min-h-[calc(100vh-80px)]', 'flex-col', 'items-center', 'overflow-x-hidden');
    expect(root.className).not.toContain('md:h-[calc(100dvh-var(--shell-masthead-height)-var(--shell-masthead-height)-4.9rem)]');
    expect(root.className).not.toContain('overflow-hidden');
    expect(screen.getByTestId('home-bento-grid')).toHaveAttribute('data-bento-grid', 'true');
    expect(screen.getByTestId('home-bento-grid')).toHaveClass('bento-grid-root');
    expect(screen.getByText('WolfyStock 决策面板')).toBeInTheDocument();
    const header = screen.getByTestId('home-bento-header');
    const main = screen.getByTestId('home-bento-main');
    const omnibar = screen.getByTestId('home-bento-omnibar');
    const omnibarInput = screen.getByPlaceholderText('输入股票代码或公司名称，唤醒 AI 深度分析...');
    const omnibarSubmit = screen.getByTestId('home-bento-omnibar-submit');
    expect(header).toHaveClass('shrink-0', 'flex', 'w-full', 'flex-col', 'gap-3');
    expect(main).toHaveClass('w-full', 'flex-1', 'min-h-0');
    expect(main.className).not.toContain('overflow-hidden');
    expect(omnibar).toHaveClass(
      'flex',
      'w-full',
      'items-center',
      'gap-2.5',
      'rounded-full',
      'border-white/5',
      'bg-white/[0.01]',
      'backdrop-blur-md',
      'focus-within:border-white/15',
      'focus-within:bg-white/[0.02]',
      'focus-within:ring-1',
      'focus-within:ring-white/10',
    );
    expect(omnibarInput).toHaveAttribute('type', 'search');
    expect(omnibarSubmit).toHaveAttribute('type', 'submit');
    expect(omnibarSubmit).toHaveClass('relative', 'z-10', 'hover:bg-white/10', 'cursor-pointer');
    expect(screen.getByText('分析')).toHaveClass('text-[10px]', 'bg-white/5');
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
    const siblingRow = screen.getByTestId('home-bento-sibling-row');
    expect(siblingRow).toBeInTheDocument();
    expect(screen.getByTestId('home-bento-grid')).toHaveClass('w-full', 'max-w-6xl', 'grid-cols-1', 'gap-6', 'md:grid-cols-2', 'xl:grid-cols-3');
    expect(siblingRow).toHaveClass('grid', 'grid-cols-1', 'gap-6', 'md:col-span-2', 'md:grid-cols-2', 'xl:col-span-2', 'xl:grid-cols-3');
    expect(strategyCard).toHaveClass('h-full');
    expect(techCard).toHaveClass('h-full');
    expect(fundamentalsCard).toHaveClass('h-full');
    expect(techCard).toHaveClass('bg-white/[0.02]', 'backdrop-blur-2xl', 'border-white/5');
    expect(fundamentalsCard).toHaveClass('bg-white/[0.02]', 'backdrop-blur-2xl', 'border-white/5');
    expect(entryMetric).not.toHaveClass('bg-white/[0.02]', 'border-white/[0.08]', 'p-6');
    expect(strategyMetricsGrid).toHaveClass('grid', 'grid-cols-2', 'gap-y-4', 'gap-x-4', 'w-full');
    expect(entryMetric).toHaveClass('col-span-2', 'flex', 'flex-col', 'gap-1');
    expect(targetMetric).not.toHaveClass('col-span-2');
    expect(stopLossMetric).not.toHaveClass('col-span-2');
    expect(screen.getByText('建仓区间')).toHaveClass('text-[10px]', 'tracking-widest', 'text-white/40');
    expect(screen.getByText('118.40 - 121.00')).toHaveClass('text-xl', 'sm:text-2xl');
    expect(screen.getByText('136.00')).toHaveClass('text-xl', 'sm:text-2xl', 'font-medium');
    expect(screen.getByText('111.80')).toHaveClass('text-xl', 'sm:text-2xl', 'font-medium');
    expect(screen.getByText('零轴上方金叉')).toHaveClass('text-xl', 'font-medium');
    expect(screen.getByText('+18.2%')).toHaveClass('text-2xl', 'font-medium');
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
    expect(strategyCard.compareDocumentPosition(fundamentalsCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByTestId('home-bento-card-workflow')).not.toBeInTheDocument();
    expect(screen.queryByText('先给出区间，再决定节奏。')).not.toBeInTheDocument();
  });

  it('renders localized English copy for the signed-in dashboard', () => {
    window.localStorage.setItem('dsa-ui-language', 'en');
    useProductSurfaceMock.mockReturnValue({ isGuest: false });
    renderSurface();
    expect(screen.getByText('WolfyStock Command Center')).toBeInTheDocument();
    expect(screen.getByText('Analyze')).toBeInTheDocument();
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

  it('submits the home omnibar into analysis instead of navigating to chat', async () => {
    useProductSurfaceMock.mockReturnValue({ isGuest: false });
    renderSurface();
    fireEvent.change(screen.getByPlaceholderText('输入股票代码或公司名称，唤醒 AI 深度分析...'), {
      target: { value: 'NVDA' },
    });
    fireEvent.click(screen.getByTestId('home-bento-omnibar-submit'));
    expect(analysisApi.analyzeAsync).toHaveBeenCalledWith({
      stockCode: 'NVDA',
      reportType: 'detailed',
      stockName: undefined,
      originalQuery: 'NVDA',
      selectionSource: 'manual',
    });
    expect(screen.getByTestId('home-bento-dashboard')).toBeInTheDocument();
  });
});
