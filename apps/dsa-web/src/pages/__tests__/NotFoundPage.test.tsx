import type React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NotFoundPage from '../NotFoundPage';

const navigate = vi.fn();

vi.mock('../../contexts/UiLanguageContext', () => ({
  useI18n: () => ({
    language: window.location.pathname.startsWith('/en') ? 'en' : 'zh',
    t: (key: string) => key,
  }),
}));

vi.mock('../../components/common', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

describe('NotFoundPage', () => {
  beforeEach(() => {
    navigate.mockClear();
  });

  it('renders localized Chinese copy on /zh paths', () => {
    window.history.replaceState(window.history.state, '', '/zh/missing-route');

    render(
      <MemoryRouter initialEntries={['/zh/missing-route']}>
        <NotFoundPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '页面未找到' })).toBeInTheDocument();
    expect(screen.getByText('当前地址不存在或已经迁移。返回首页后，可以继续进入研究、持仓或回测区域。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回首页' })).toBeInTheDocument();
  });

  it('renders localized English copy on /en paths', () => {
    window.history.replaceState(window.history.state, '', '/en/missing-route');

    render(
      <MemoryRouter initialEntries={['/en/missing-route']}>
        <NotFoundPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByText('This address does not exist or has moved. Go back home to continue into research, portfolio, or backtest areas.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to home' })).toBeInTheDocument();
  });
});
