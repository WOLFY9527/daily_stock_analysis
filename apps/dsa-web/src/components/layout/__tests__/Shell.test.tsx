import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '../../../i18n/core';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { Shell } from '../Shell';
import { setAdminSurfaceMode } from '../../../hooks/useProductSurface';
import { useShellRailSlot } from '../useShellRailSlot';

const { mockLogout, mockGetAgentStatus, mockHardRedirect, useAuthMock } = vi.hoisted(() => ({
  mockLogout: vi.fn().mockResolvedValue(undefined),
  mockGetAgentStatus: vi.fn().mockResolvedValue({ enabled: true }),
  mockHardRedirect: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('../../../contexts/UiLanguageContext', () => ({
  useI18n: () => ({
    language: 'zh',
    toggleLanguage: vi.fn(),
    t: (key: string, vars?: Record<string, string | number | undefined>) => translate('zh', key, vars),
  }),
}));

vi.mock('../../../stores/agentChatStore', () => ({
  useAgentChatStore: (selector: (state: { completionBadge: boolean }) => unknown) =>
    selector({ completionBadge: true }),
}));

vi.mock('../../../api/agent', () => ({
  agentApi: {
    getStatus: (...args: unknown[]) => mockGetAgentStatus(...args),
  },
}));

vi.mock('../../../utils/browserRedirect', () => ({
  hardRedirect: (...args: unknown[]) => mockHardRedirect(...args),
}));

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  window.innerWidth = 1024;
  window.dispatchEvent(new Event('resize'));
});

const ShellRailFixture = () => {
  useShellRailSlot(<div>archive content</div>);
  return <div>page content</div>;
};

const settleDrawerMotion = () => new Promise((resolve) => window.setTimeout(resolve, 260));
const settleDrawerStability = () => new Promise((resolve) => window.setTimeout(resolve, 480));

describe('Shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAdminSurfaceMode('user');
    window.sessionStorage.clear();
    useAuthMock.mockReturnValue({
      authEnabled: true,
      loggedIn: true,
      currentUser: { isAdmin: false },
      logout: mockLogout,
    });
  });

  it('renders the streamlined navigation and completion badge without the old theme control', () => {
    render(
      <MemoryRouter initialEntries={['/chat']}>
        <ThemeProvider>
          <Shell>
            <div>page content</div>
          </Shell>
        </ThemeProvider>
      </MemoryRouter>
    );

    expect(screen.queryByRole('button', { name: '切换主题' })).not.toBeInTheDocument();
    const brandLink = screen.getByRole('link', { name: 'WolfyStock' });
    expect(brandLink).toHaveAttribute('href', '/');
    const logo = within(brandLink).getByRole('img', { name: 'WolfyStock logo' });
    expect(logo).toHaveAttribute('src', '/wolfystock-logo-mark.svg');
    expect(logo).not.toHaveClass('invert');
    expect(screen.getByRole('link', { name: '问股' })).toBeInTheDocument();
    expect(screen.getByTestId('chat-completion-badge')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '退出' })).toBeInTheDocument();
  });

  it('shows a guest-safe navigation set when the visitor is not signed in', () => {
    useAuthMock.mockReturnValue({
      authEnabled: true,
      loggedIn: false,
      currentUser: null,
      logout: mockLogout,
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <ThemeProvider>
          <Shell>
            <div>page content</div>
          </Shell>
        </ThemeProvider>
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: translate('zh', 'nav.home') })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: translate('zh', 'nav.signIn') })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: translate('zh', 'nav.scanner') })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: translate('zh', 'nav.chat') })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: translate('zh', 'nav.portfolio') })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: translate('zh', 'nav.backtest') })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: translate('zh', 'nav.settings') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: translate('zh', 'nav.logout') })).not.toBeInTheDocument();
  });

  it('falls back to the guest-safe shell when auth is disabled and no user is logged in', () => {
    useAuthMock.mockReturnValue({
      authEnabled: false,
      loggedIn: false,
      currentUser: null,
      logout: mockLogout,
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <ThemeProvider>
          <Shell>
            <div>page content</div>
          </Shell>
        </ThemeProvider>
      </MemoryRouter>
    );

    expect(screen.queryByRole('link', { name: '登录' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '退出' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '扫描器' })).not.toBeInTheDocument();
  });

  it('hides the Ask Stock navigation entry when the agent runtime is unavailable', async () => {
    mockGetAgentStatus.mockResolvedValueOnce({ enabled: false });

    render(
      <MemoryRouter initialEntries={['/']}>
        <ThemeProvider>
          <Shell>
            <div>page content</div>
          </Shell>
        </ThemeProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: '问股' })).not.toBeInTheDocument();
    });
  });

  it('shows a confirmation dialog before logout and hard-redirects to the guest page', async () => {
    render(
      <MemoryRouter initialEntries={['/chat']}>
        <ThemeProvider>
          <Shell>
            <div>page content</div>
          </Shell>
        </ThemeProvider>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'nav.logout') }));

    expect(await screen.findByRole('heading', { name: translate('zh', 'nav.logoutTitle') })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'nav.logoutConfirm') }));

    await waitFor(() => expect(mockLogout).toHaveBeenCalled());
    expect(mockHardRedirect).toHaveBeenCalledWith('/guest');
  });

  it('keeps language/logout controls inside the mobile drawer instead of duplicating them in the top bar', async () => {
    window.innerWidth = 375;

    render(
      <MemoryRouter initialEntries={['/chat']}>
        <ThemeProvider>
          <Shell>
            <div>page content</div>
          </Shell>
        </ThemeProvider>
      </MemoryRouter>
    );

    expect(screen.queryByRole('button', { name: '切换主题' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '切换语言' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '打开导航菜单' }));

    expect(await screen.findByRole('button', { name: '切换语言' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '退出' })).toBeInTheDocument();
  });

  it('keeps the mobile navigation drawer open until the user closes it or navigates away', async () => {
    window.innerWidth = 375;

    render(
      <MemoryRouter initialEntries={['/chat']}>
        <ThemeProvider>
          <Shell>
            <div>page content</div>
          </Shell>
        </ThemeProvider>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '打开导航菜单' }));
    expect(await screen.findByRole('heading', { name: '导航菜单' })).toBeInTheDocument();

    await act(async () => {
      await settleDrawerStability();
    });

    expect(screen.getByRole('heading', { name: '导航菜单' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '切换语言' })).toBeInTheDocument();
  });

  it('adds dedicated shell modifiers for the scanner route', () => {
    render(
      <MemoryRouter initialEntries={['/scanner']}>
        <ThemeProvider>
          <Shell>
            <div>page content</div>
          </Shell>
        </ThemeProvider>
      </MemoryRouter>
    );

    expect(document.querySelector('.theme-shell--scanner')).not.toBeNull();
    expect(document.querySelector('.theme-shell--wide')).not.toBeNull();
    expect(document.querySelector('.shell-content-frame--scanner')).not.toBeNull();
    expect(document.querySelector('.shell-content-frame--wide')).not.toBeNull();
    expect(document.querySelector('.shell-content-frame')).toHaveClass('flex');
    expect(document.querySelector('.shell-main-column--scanner')).not.toBeNull();
    expect(document.documentElement.dataset.scannerShell).toBe('true');
    expect(document.body.dataset.scannerShell).toBe('true');
  });

  it('adds wide-shell modifiers for the home route without enabling backtest mode', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <ThemeProvider>
          <Shell>
            <div>page content</div>
          </Shell>
        </ThemeProvider>
      </MemoryRouter>
    );

    expect(document.querySelector('.theme-shell--wide')).not.toBeNull();
    expect(document.querySelector('.shell-content-frame--wide')).not.toBeNull();
    expect(document.querySelector('.shell-content-frame--backtest')).toBeNull();
  });

  it('adds a dedicated content-frame modifier for the backtest route', () => {
    render(
      <MemoryRouter initialEntries={['/backtest']}>
        <ThemeProvider>
          <Shell>
            <div>page content</div>
          </Shell>
        </ThemeProvider>
      </MemoryRouter>
    );

    expect(document.querySelector('.shell-content-frame--backtest')).not.toBeNull();
    expect(document.querySelector('.shell-content-frame')).toHaveClass('flex');
  });

  it('shows the console entry for admin accounts without an admin-mode switch', async () => {
    useAuthMock.mockReturnValue({
      authEnabled: true,
      loggedIn: true,
      currentUser: { isAdmin: true },
      logout: mockLogout,
    });

    render(
      <MemoryRouter initialEntries={['/settings']}>
        <ThemeProvider>
          <Shell>
            <div>page content</div>
          </Shell>
        </ThemeProvider>
      </MemoryRouter>
    );

    expect(await screen.findByRole('link', { name: translate('zh', 'nav.independentConsole') })).toHaveAttribute('href', '/settings/system');
    expect(screen.queryByRole('button', { name: /管理员模式/ })).not.toBeInTheDocument();
  });

  it('resets mobile drawer and archive rail state when crossing back to desktop', async () => {
    window.innerWidth = 390;

    render(
      <MemoryRouter initialEntries={['/']}>
        <ThemeProvider>
          <Shell>
            <ShellRailFixture />
          </Shell>
        </ThemeProvider>
      </MemoryRouter>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '打开导航菜单' }));
      await settleDrawerMotion();
    });
    expect(await screen.findByRole('heading', { name: '导航菜单' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '分析档案' })[0]);
      await settleDrawerMotion();
    });
    await waitFor(() => {
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
    });
    expect(document.body.style.overflow).toBe('hidden');

    window.innerWidth = 1280;
    await act(async () => {
      fireEvent(window, new Event('resize'));
      await settleDrawerMotion();
    });

    await waitFor(() => {
      expect(screen.queryAllByRole('dialog')).toHaveLength(0);
    });
    expect(document.body.style.overflow).toBe('');

    window.innerWidth = 390;
    await act(async () => {
      fireEvent(window, new Event('resize'));
      await settleDrawerMotion();
    });

    await waitFor(() => {
      expect(screen.queryAllByRole('dialog')).toHaveLength(0);
    });
    expect(screen.getByRole('button', { name: '打开导航菜单' })).toBeInTheDocument();
  });
});
