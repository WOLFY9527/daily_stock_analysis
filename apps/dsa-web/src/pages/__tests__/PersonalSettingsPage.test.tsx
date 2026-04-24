import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '../../i18n/core';
import PersonalSettingsPage from '../PersonalSettingsPage';

const zh = (key: string, vars?: Record<string, string | number | undefined>) => translate('zh', key, vars);

const {
  getNotificationPreferences,
  updateNotificationPreferences,
  setLanguage,
  setMarketColorConvention,
  useAuthMock,
  useProductSurfaceMock,
} = vi.hoisted(() => ({
  getNotificationPreferences: vi.fn(),
  updateNotificationPreferences: vi.fn(),
  setLanguage: vi.fn(),
  setMarketColorConvention: vi.fn(),
  useAuthMock: vi.fn(),
  useProductSurfaceMock: vi.fn(),
}));

vi.mock('../../contexts/UiLanguageContext', () => ({
  useI18n: () => ({
    language: 'zh',
    setLanguage,
    t: (key: string, vars?: Record<string, string | number | undefined>) => translate('zh', key, vars),
  }),
}));

vi.mock('../../contexts/UiPreferencesContext', () => ({
  useUiPreferences: () => ({
    marketColorConvention: 'redDownGreenUp',
    setMarketColorConvention,
  }),
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('../../api/auth', () => ({
  authApi: {
    getNotificationPreferences,
    updateNotificationPreferences,
  },
}));

vi.mock('../../hooks/useProductSurface', () => ({
  buildLoginPath: (path: string) => `/login?redirect=${encodeURIComponent(path)}`,
  buildRegistrationPath: (path: string) => `/login?mode=create&redirect=${encodeURIComponent(path)}`,
  useProductSurface: () => useProductSurfaceMock(),
}));

vi.mock('../../components/settings/FontSizeSettingsCard', () => ({
  FontSizeSettingsCard: () => <div data-testid="font-size-card" />,
}));

vi.mock('../../components/settings/ChangePasswordCard', () => ({
  ChangePasswordCard: () => <div data-testid="change-password-card" />,
}));

describe('PersonalSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getNotificationPreferences.mockResolvedValue({
      channel: 'email',
      enabled: false,
      email: null,
      emailEnabled: false,
      discordEnabled: false,
      discordWebhook: null,
      deliveryAvailable: true,
      emailDeliveryAvailable: true,
      discordDeliveryAvailable: true,
      updatedAt: null,
    });
    updateNotificationPreferences.mockResolvedValue({
      channel: 'email',
      enabled: false,
      email: null,
      emailEnabled: false,
      discordEnabled: false,
      discordWebhook: null,
      deliveryAvailable: true,
      emailDeliveryAvailable: true,
      discordDeliveryAvailable: true,
      updatedAt: null,
    });
  });

  it('shows guest-only sign-in guidance without system links', () => {
    useAuthMock.mockReturnValue({
      authEnabled: true,
      passwordChangeable: false,
    });
    useProductSurfaceMock.mockReturnValue({
      isGuest: true,
      isAdmin: false,
      loggedIn: false,
      currentUser: null,
    });

    render(
      <MemoryRouter>
        <PersonalSettingsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText(zh('settings.personalGuestPreferencesTitle'))).toBeInTheDocument();
    expect(screen.getByText(zh('settings.personalGuestPreferencesBody'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: zh('settings.personalGuestSignInAction') })).toHaveAttribute('href', '/login?redirect=%2Fsettings');
    expect(screen.getByRole('link', { name: zh('settings.personalGuestCreateAccountAction') })).toHaveAttribute('href', '/login?mode=create&redirect=%2Fsettings');
    expect(screen.queryByRole('link', { name: zh('nav.independentConsole') })).not.toBeInTheDocument();
    expect(getNotificationPreferences).not.toHaveBeenCalled();
  });

  it('shows admin console links without changing personal settings content', async () => {
    useAuthMock.mockReturnValue({
      authEnabled: true,
      passwordChangeable: true,
    });
    useProductSurfaceMock.mockReturnValue({
      isGuest: false,
      isAdmin: true,
      loggedIn: true,
      currentUser: {
        username: 'admin',
        displayName: 'Admin',
      },
    });
    getNotificationPreferences.mockResolvedValue({
      channel: 'email',
      enabled: true,
      email: 'admin@example.com',
      emailEnabled: true,
      discordEnabled: true,
      discordWebhook: 'https://discord.com/api/webhooks/123/token',
      deliveryAvailable: true,
      emailDeliveryAvailable: true,
      discordDeliveryAvailable: true,
      updatedAt: '2026-04-15T09:00:00Z',
    });

    render(
      <MemoryRouter>
        <PersonalSettingsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(getNotificationPreferences).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('link', { name: zh('nav.independentConsole') })).toHaveAttribute('href', '/settings/system');
    expect(screen.getByRole('link', { name: zh('adminNav.logs') })).toHaveAttribute('href', '/admin/logs');
    expect(screen.queryByRole('button', { name: /管理工具/ })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('admin@example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://discord.com/api/webhooks/123/token')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: zh('settings.personalNotificationSaveAction') })).toBeInTheDocument();
    expect(screen.getByTestId('change-password-card')).toBeInTheDocument();
    expect(screen.getByTestId('font-size-card')).toBeInTheDocument();
  });

  it('saves email and Discord notification targets together for signed-in users', async () => {
    useAuthMock.mockReturnValue({
      authEnabled: true,
      passwordChangeable: false,
    });
    useProductSurfaceMock.mockReturnValue({
      isGuest: false,
      isAdmin: false,
      loggedIn: true,
      currentUser: {
        username: 'alice',
        displayName: 'Alice',
      },
    });
    getNotificationPreferences.mockResolvedValue({
      channel: 'email',
      enabled: false,
      email: null,
      emailEnabled: false,
      discordEnabled: false,
      discordWebhook: null,
      deliveryAvailable: true,
      emailDeliveryAvailable: true,
      discordDeliveryAvailable: true,
      updatedAt: null,
    });
    updateNotificationPreferences.mockResolvedValue({
      channel: 'multi',
      enabled: true,
      email: 'alice@example.com',
      emailEnabled: true,
      discordEnabled: true,
      discordWebhook: 'https://discord.com/api/webhooks/999/token',
      deliveryAvailable: true,
      emailDeliveryAvailable: true,
      discordDeliveryAvailable: true,
      updatedAt: '2026-04-15T10:00:00Z',
    });

    render(
      <MemoryRouter>
        <PersonalSettingsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(getNotificationPreferences).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByLabelText(zh('settings.personalNotificationEmailToggle')));
    fireEvent.change(screen.getByLabelText(zh('settings.personalNotificationEmailLabel')), { target: { value: 'alice@example.com' } });
    fireEvent.click(screen.getByLabelText(zh('settings.personalNotificationDiscordToggle')));
    fireEvent.change(screen.getByLabelText(zh('settings.personalNotificationDiscordLabel')), {
      target: { value: 'https://discord.com/api/webhooks/999/token' },
    });
    fireEvent.click(screen.getByRole('button', { name: zh('settings.personalNotificationSaveAction') }));

    await waitFor(() => {
      expect(updateNotificationPreferences).toHaveBeenCalledWith({
        emailEnabled: true,
        email: 'alice@example.com',
        discordEnabled: true,
        discordWebhook: 'https://discord.com/api/webhooks/999/token',
      });
    });
    expect(await screen.findByText(zh('settings.personalNotificationTargetsSaved'))).toBeInTheDocument();
  });
});
