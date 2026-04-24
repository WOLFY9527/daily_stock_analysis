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
    expect(screen.getByTestId('home-bento-dashboard')).toHaveAttribute('data-bento-surface', 'true');
    expect(screen.getByTestId('home-bento-dashboard')).toHaveClass('bento-surface-root');
    expect(screen.getByTestId('home-bento-grid')).toHaveAttribute('data-bento-grid', 'true');
    expect(screen.getByTestId('home-bento-grid')).toHaveClass('bento-grid-root');
    expect(screen.getByText('WolfyStock 决策面板')).toBeInTheDocument();
    expect(screen.getByText('WOLFY AI 决断')).toBeInTheDocument();
  });

  it('renders localized English copy for the signed-in dashboard', () => {
    window.localStorage.setItem('dsa-ui-language', 'en');
    useProductSurfaceMock.mockReturnValue({ isGuest: false });
    renderSurface();
    expect(screen.getByText('WolfyStock Command Center')).toBeInTheDocument();
    expect(screen.getByText('Execution Strategy')).toBeInTheDocument();
    expect(screen.getByText('Technical Structure')).toBeInTheDocument();
  });

  it('opens the progressive-disclosure drawer from the strategy card', async () => {
    useProductSurfaceMock.mockReturnValue({ isGuest: false });
    renderSurface();
    fireEvent.click(screen.getByRole('button', { name: '查看策略细节' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('执行策略细节')).toBeInTheDocument();
  });
});
