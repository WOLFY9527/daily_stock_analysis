import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PremiumPaywall } from '../PremiumPaywall';

const { languageState } = vi.hoisted(() => ({
  languageState: { value: 'zh' as 'zh' | 'en' },
}));

vi.mock('../../../contexts/UiLanguageContext', () => ({
  useI18n: () => ({
    language: languageState.value,
  }),
}));

vi.mock('../../../hooks/useProductSurface', () => ({
  buildLoginPath: (path: string) => `/${languageState.value}/login?redirect=${encodeURIComponent(path)}`,
}));

describe('PremiumPaywall', () => {
  beforeEach(() => {
    languageState.value = 'zh';
  });

  it('renders the frosted glass guest paywall shell in Chinese', () => {
    render(
      <MemoryRouter initialEntries={['/zh/chat']}>
        <PremiumPaywall moduleName="问股" />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('premium-paywall-shell')).toHaveClass('w-full', 'h-[calc(100vh-80px)]', 'flex', 'items-center', 'justify-center', 'p-4');
    expect(screen.getByTestId('premium-paywall-card')).toHaveClass(
      'bg-white/[0.02]',
      'backdrop-blur-3xl',
      'border',
      'border-white/5',
      'rounded-[24px]',
      'shadow-2xl',
    );
    expect(screen.getByRole('heading', { name: '登录解锁 问股 功能' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '登录 / 创建账户' })).toHaveAttribute('href', '/zh/login?redirect=%2Fzh%2Fchat');
  });

  it('renders the English frosted CTA copy', () => {
    languageState.value = 'en';

    render(
      <MemoryRouter initialEntries={['/en/portfolio']}>
        <PremiumPaywall moduleName="Portfolio" />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Sign in to unlock Portfolio' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in / Create account' })).toHaveAttribute('href', '/en/login?redirect=%2Fen%2Fportfolio');
  });
});
