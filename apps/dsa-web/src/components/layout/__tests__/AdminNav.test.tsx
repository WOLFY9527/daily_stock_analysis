import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '../../../i18n/core';
import { AdminNav } from '../AdminNav';

const { useProductSurfaceMock } = vi.hoisted(() => ({
  useProductSurfaceMock: vi.fn(),
}));

vi.mock('../../../hooks/useProductSurface', () => ({
  useProductSurface: () => useProductSurfaceMock(),
}));

vi.mock('../../../contexts/UiLanguageContext', () => ({
  useI18n: () => ({
    language: 'en',
    t: (key: string, vars?: Record<string, string | number | undefined>) => translate('en', key, vars),
  }),
}));

describe('AdminNav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders localized admin console links for admin sessions', () => {
    useProductSurfaceMock.mockReturnValue({
      isAdmin: true,
    });

    render(
      <MemoryRouter initialEntries={['/en/settings/system']}>
        <AdminNav />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: translate('en', 'nav.independentConsole') })).toHaveAttribute('href', '/en/settings/system');
    expect(screen.getByRole('link', { name: translate('en', 'adminNav.logs') })).toHaveAttribute('href', '/en/admin/logs');
  });

  it('stays hidden for non-admin sessions', () => {
    useProductSurfaceMock.mockReturnValue({
      isAdmin: false,
    });

    render(
      <MemoryRouter initialEntries={['/settings']}>
        <AdminNav />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('navigation', { name: translate('en', 'adminNav.title') })).not.toBeInTheDocument();
  });
});
