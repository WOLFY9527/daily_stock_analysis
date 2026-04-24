import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '../../i18n/core';
import LoginPage from '../LoginPage';

const { navigate, useSearchParamsMock, useAuthMock } = vi.hoisted(() => ({
  navigate: vi.fn(),
  useSearchParamsMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock('../../hooks', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
    useSearchParams: () => useSearchParamsMock(),
  };
});

describe('LoginPage', () => {
  const renderPage = () => render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    useSearchParamsMock.mockReturnValue([new URLSearchParams('redirect=%2Fsettings')]);
  });

  it('blocks first-time setup when confirmation does not match', async () => {
    const login = vi.fn();
    useAuthMock.mockReturnValue({
      login,
      passwordSet: false,
      setupState: 'no_password',
    });

    renderPage();

    fireEvent.change(screen.getByLabelText(translate('zh', 'auth.login.passwordLabelSetup')), { target: { value: 'passwd6' } });
    fireEvent.change(screen.getByLabelText(translate('zh', 'auth.login.passwordConfirmLabel')), { target: { value: 'passwd7' } });
    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'auth.login.submitSetup') }));

    expect(await screen.findByText(translate('zh', 'auth.login.errorPasswordMismatch'))).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('navigates to redirect after a successful login', async () => {
    useAuthMock.mockReturnValue({
      login: vi.fn().mockResolvedValue({ success: true }),
      passwordSet: true,
      setupState: 'enabled',
    });

    renderPage();

    fireEvent.change(screen.getByLabelText(translate('zh', 'auth.login.passwordLabelLogin')), { target: { value: 'passwd6' } });
    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'auth.login.submitLogin') }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/settings', { replace: true }));
  });

  it('enters create-account mode directly when requested by the route and shows destination context', () => {
    useSearchParamsMock.mockReturnValue([new URLSearchParams('mode=create&redirect=%2Fscanner')]);
    useAuthMock.mockReturnValue({
      login: vi.fn(),
      passwordSet: true,
      setupState: 'enabled',
    });

    renderPage();

    expect(screen.getByRole('heading', { name: translate('zh', 'auth.login.panelTitleCreate') })).toBeInTheDocument();
    expect(screen.getByLabelText(translate('zh', 'auth.login.usernameLabel'))).toBeInTheDocument();
    expect(screen.getByLabelText(translate('zh', 'auth.login.displayNameLabel'))).toBeInTheDocument();
    expect(screen.getByText(translate('zh', 'auth.login.continuePrefix', { label: translate('zh', 'auth.login.redirectTarget.scanner') }))).toBeInTheDocument();
  });

  it('offers a safe exit back to home for direct login entry', () => {
    useSearchParamsMock.mockReturnValue([new URLSearchParams('')]);
    useAuthMock.mockReturnValue({
      login: vi.fn(),
      passwordSet: true,
      setupState: 'enabled',
    });

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'auth.login.exitTarget.homeLabel') }));

    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('offers a safe exit back to the public scanner surface when redirected from scanner', () => {
    useSearchParamsMock.mockReturnValue([new URLSearchParams('redirect=%2Fscanner')]);
    useAuthMock.mockReturnValue({
      login: vi.fn(),
      passwordSet: true,
      setupState: 'enabled',
    });

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'auth.login.exitTarget.scannerLabel') }));

    expect(navigate).toHaveBeenCalledWith('/scanner', { replace: true });
  });

  it('keeps locale-prefixed exit targets when redirected from a localized route', () => {
    window.history.replaceState(window.history.state, '', '/en/login?redirect=%2Fen%2Fscanner');
    useSearchParamsMock.mockReturnValue([new URLSearchParams('redirect=%2Fen%2Fscanner')]);
    useAuthMock.mockReturnValue({
      login: vi.fn(),
      passwordSet: true,
      setupState: 'enabled',
    });

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: translate('en', 'auth.login.exitTarget.scannerLabel') }));

    expect(navigate).toHaveBeenCalledWith('/en/scanner', { replace: true });
  });

  it('renders visible login copy in English for /en/login', () => {
    window.history.replaceState(window.history.state, '', '/en/login?redirect=%2Fen%2Fchat');
    useSearchParamsMock.mockReturnValue([new URLSearchParams('redirect=%2Fen%2Fchat')]);
    useAuthMock.mockReturnValue({
      login: vi.fn(),
      passwordSet: true,
      setupState: 'enabled',
    });

    renderPage();

    expect(screen.getByRole('heading', { name: translate('en', 'auth.login.heroTitleLogin') })).toBeInTheDocument();
    expect(screen.getByText(translate('en', 'auth.login.continueAfterLogin'))).toBeInTheDocument();
    expect(screen.getByText(translate('en', 'auth.login.continuePrefix', { label: translate('en', 'auth.login.redirectTarget.chat') }))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: translate('en', 'auth.login.exitTarget.homeLabel') })).toBeInTheDocument();
    expect(screen.getByLabelText(translate('en', 'auth.login.passwordLabelLogin'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: translate('en', 'auth.login.submitLogin') })).toBeInTheDocument();
  });

  it('links the login page to the reset-password route', () => {
    window.history.replaceState(window.history.state, '', '/login?redirect=%2Fsettings');
    useSearchParamsMock.mockReturnValue([new URLSearchParams('redirect=%2Fsettings')]);
    useAuthMock.mockReturnValue({
      login: vi.fn(),
      passwordSet: true,
      setupState: 'enabled',
    });

    renderPage();

    expect(screen.getByRole('link', { name: translate('zh', 'auth.login.forgotPassword') })).toHaveAttribute(
      'href',
      '/reset-password?redirect=%2Fsettings',
    );
  });
});
