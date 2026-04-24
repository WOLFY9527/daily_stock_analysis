import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GuestScannerPage from '../GuestScannerPage';

let currentLanguage: 'zh' | 'en' = 'zh';

vi.mock('../../contexts/UiLanguageContext', () => ({
  useI18n: () => ({
    language: currentLanguage,
    t: (key: string) => key,
  }),
}));

vi.mock('../../hooks/useProductSurface', () => ({
  buildLoginPath: (path: string) => `/${currentLanguage}/login?redirect=${encodeURIComponent(`/${currentLanguage}${path}`)}`,
  buildRegistrationPath: (path: string) => `/${currentLanguage}/login?mode=create&redirect=${encodeURIComponent(`/${currentLanguage}${path}`)}`,
}));

describe('GuestScannerPage', () => {
  beforeEach(() => {
    currentLanguage = 'zh';
  });

  it('shows zh sign-in and create-account CTAs for the guest scanner teaser', async () => {
    render(
      <MemoryRouter>
        <GuestScannerPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('guest-scanner-bento-page')).toHaveAttribute('data-bento-surface', 'true');
    expect(screen.getByTestId('guest-scanner-bento-page')).toHaveClass('bento-surface-root');
    expect(screen.getByTestId('guest-scanner-bento-hero')).toBeInTheDocument();
    expect(screen.getByTestId('guest-scanner-bento-hero-history-value')).toHaveStyle({ textShadow: '0 0 30px rgba(52, 211, 153, 0.4)' });
    expect(screen.getByRole('link', { name: '登录后运行扫描器' })).toHaveAttribute('href', '/zh/login?redirect=%2Fzh%2Fscanner');
    expect(screen.getByRole('link', { name: '创建账户' })).toHaveAttribute('href', '/zh/login?mode=create&redirect=%2Fzh%2Fscanner');
    expect(screen.getByText('登录用户只会看到自己的手动扫描结果、候选名单详情，以及通向分析或回测的个人流程，不再与其他账户共享历史。')).toBeInTheDocument();
    expect(screen.getByText('管理员专属的系统观察名单、调度、运行状态与管理员历史继续保留在游客页和普通用户扫描器之外。')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('guest-scanner-bento-drawer-trigger'));
    expect(await screen.findByTestId('guest-scanner-bento-drawer')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '扫描器访问说明' })).toBeInTheDocument();
  });

  it('shows en guest boundary copy and CTA paths when language is English', () => {
    currentLanguage = 'en';

    render(
      <MemoryRouter>
        <GuestScannerPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('guest-scanner-bento-page')).toBeInTheDocument();
    expect(screen.getByTestId('guest-scanner-bento-hero')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in to run scanner' })).toHaveAttribute('href', '/en/login?redirect=%2Fen%2Fscanner');
    expect(screen.getByRole('link', { name: 'Create account' })).toHaveAttribute('href', '/en/login?mode=create&redirect=%2Fen%2Fscanner');
    expect(screen.getByText('Signed-in users get their own manual scanner runs, shortlist details, and links into analysis or backtest without sharing history across accounts.')).toBeInTheDocument();
    expect(screen.getByText('Admin-only watchlists, schedules, run status, and admin history stay outside guest and regular-user scanner pages.')).toBeInTheDocument();
  });
});
