import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UiLanguageProvider } from '../../contexts/UiLanguageContext';
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

vi.mock('../HomePage', () => ({
  default: () => <div data-testid="legacy-home-page">full home page</div>,
}));

describe('HomeSurfacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
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
    expect(root).toHaveAttribute('data-bento-surface', 'true');
    expect(root).toHaveClass('bento-surface-root');
    expect(screen.getByTestId('home-bento-grid')).toHaveAttribute('data-bento-grid', 'true');
    expect(screen.getByTestId('home-bento-grid')).toHaveClass('bento-grid-root');
    expect(screen.getByText('WolfyStock 决策面板')).toBeInTheDocument();
    expect(screen.getByText('WOLFY AI 决断')).toBeInTheDocument();
    expect(screen.getByTestId('home-bento-drawer-trigger-decision')).toBeInTheDocument();
    expect(screen.getByTestId('home-bento-drawer-trigger-strategy')).toBeInTheDocument();
    expect(screen.getByTestId('home-bento-drawer-trigger-tech')).toBeInTheDocument();
    expect(screen.getByTestId('home-bento-drawer-trigger-fundamentals')).toBeInTheDocument();
    expect(techCard).toHaveClass('xl:col-span-6');
    expect(fundamentalsCard).toHaveClass('xl:col-span-6');
    expect(screen.getByTestId('home-bento-sibling-row')).toBeInTheDocument();
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
    expect(screen.getByText('Execution Strategy')).toBeInTheDocument();
    expect(screen.getByText('Technical Structure')).toBeInTheDocument();
    expect(screen.getByText('Fundamental Profile')).toBeInTheDocument();
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
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    await new Promise((resolve) => window.setTimeout(resolve, 220));
    expect(document.body.style.overflow).toBe('');
    expect(await screen.findByTestId('home-bento-dashboard')).toBeInTheDocument();
  });
});
