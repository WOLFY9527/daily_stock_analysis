import type React from 'react';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ApiErrorAlert } from './components/common/ApiErrorAlert';
import { BrandedLoadingScreen } from './components/common/BrandedLoadingScreen';
import { Shell } from './components/layout/Shell';
import { PreviewShell } from './components/layout/PreviewShell';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { useI18n } from './contexts/UiLanguageContext';
import {
  buildLoginPath,
  buildRegistrationPath,
  resolveAuthRedirect,
  useProductSurface,
} from './hooks/useProductSurface';
import type { UiLanguage } from './i18n/core';
import { buildLocalizedPath, parseLocaleFromPathname, stripLocalePrefix } from './utils/localeRouting';
import { useAgentChatStore } from './stores/agentChatStore';

const APP_BOOT_SPLASH_MIN_MS = 950;
const APP_BOOT_SPLASH_FADE_MS = 380;
const STATIC_BOOT_SPLASH_ID = 'boot-splash';

const AccessGatePage = lazy(() => import('./components/access/AccessGatePage').then((module) => ({
  default: module.AccessGatePage,
})));
const HomeSurfacePage = lazy(() => import('./pages/HomeSurfacePage'));
const GuestHomePage = lazy(() => import('./pages/GuestHomePage'));
const ScannerSurfacePage = lazy(() => import('./pages/ScannerSurfacePage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const PreviewReportPage = lazy(() => import('./pages/PreviewReportPage'));
const PreviewFullReportDrawerPage = lazy(() => import('./pages/PreviewFullReportDrawerPage'));
const ChatPage = lazy(() => import('./pages/ChatPage'));
const PortfolioPage = lazy(() => import('./pages/PortfolioPage'));
const BacktestPage = lazy(() => import('./pages/BacktestPage'));
const RuleBacktestComparePage = lazy(() => import('./pages/RuleBacktestComparePage'));
const DeterministicBacktestResultPage = lazy(() => import('./pages/DeterministicBacktestResultPage'));
const PersonalSettingsPage = lazy(() => import('./pages/PersonalSettingsPage'));
const SystemSettingsPage = lazy(() => import('./pages/SystemSettingsPage'));
const AdminLogsPage = lazy(() => import('./pages/AdminLogsPage'));

type GateCopy = {
  eyebrow: string;
  title: string;
  description: string;
  bullets: string[];
  statusLabel?: string;
  note?: string;
  secondaryAction?: { label: string; to: string };
  tertiaryAction?: { label: string; to: string };
};

function getRegisteredSurfaceCopy(pathname: string, redirectTarget: string, language: UiLanguage): GateCopy {
  const isEnglish = language === 'en';

  if (pathname.startsWith('/chat')) {
    return {
      eyebrow: isEnglish ? 'Registered User Only' : '仅限注册用户',
      statusLabel: isEnglish ? 'Guest Preview Only' : '仅限游客预览',
      title: isEnglish ? 'Sign in to continue Ask Stock follow-up' : '登录后继续问股追问',
      description: isEnglish
        ? 'Follow-up chat depends on a real account identity so report context, conversation memory, and saved sessions stay attached to you.'
        : '问股追问依赖真实账户身份，这样报告上下文、会话记忆和保存记录才会稳定绑定到你本人。',
      bullets: isEnglish
        ? [
          'Guest access stops at preview analysis and locked follow-up features.',
          'Authenticated chat sessions reuse your own saved report context and conversation history.',
          'Access rules are still enforced by the backend.',
        ]
        : [
          '游客模式只保留分析预览和锁定的追问入口，不直接进入深度问股。',
          '登录后的问股会复用你自己的报告上下文和会话历史。',
          '实际访问权限仍以后端规则为准。',
        ],
      note: isEnglish
        ? 'After sign-in, we will bring you back here automatically.'
        : '登录成功后，系统会自动把你带回当前页面。',
      secondaryAction: {
        label: isEnglish ? 'Create account' : '创建账户',
        to: buildRegistrationPath(redirectTarget),
      },
      tertiaryAction: {
        label: isEnglish ? 'Back to guest preview' : '返回游客预览',
        to: '/guest',
      },
    };
  }

  if (pathname.startsWith('/portfolio')) {
    return {
      eyebrow: isEnglish ? 'Registered User Only' : '仅限注册用户',
      statusLabel: isEnglish ? 'Personal Data Required' : '需要个人数据身份',
      title: isEnglish ? 'Sign in to open your portfolio' : '登录后查看你的持仓',
      description: isEnglish
        ? 'Portfolio accounts, trades, cash events, and risk snapshots are personal and never shown in guest mode.'
        : '持仓账户、交易、资金流水和风险快照都属于个人账户范围，游客模式不会暴露这些数据。',
      bullets: isEnglish
        ? [
          'Portfolio data stays tied to your signed-in account.',
          'Guest mode does not create shared ledgers or placeholder portfolio state.',
          'Sign in or create an account to keep positions, cash events, and risk snapshots under your own name.',
        ]
        : [
          '持仓数据属于个人空间，只会绑定到已认证身份。',
          '游客模式不会创建共享账本或伪造持仓状态。',
          '登录或创建账户后，持仓、流水和风险快照才会归到你自己的名下。',
        ],
      note: isEnglish
        ? 'After sign-in, we will bring you back to your portfolio page.'
        : '登录成功后，系统会把你带回你的持仓页面。',
      secondaryAction: {
        label: isEnglish ? 'Create account' : '创建账户',
        to: buildRegistrationPath(redirectTarget),
      },
      tertiaryAction: {
        label: isEnglish ? 'Back to guest preview' : '返回游客预览',
        to: '/guest',
      },
    };
  }

  if (pathname.startsWith('/backtest/results/')) {
    return {
      eyebrow: isEnglish ? 'Registered User Only' : '仅限注册用户',
      statusLabel: isEnglish ? 'Saved Result Locked' : '已保存结果已锁定',
      title: isEnglish ? 'Sign in to reopen saved backtest results' : '登录后重新打开已保存的回测结果',
      description: isEnglish
        ? 'Historical backtest results remain bound to authenticated identity so one user never reopens another user’s saved result.'
        : '历史回测结果会绑定到已认证身份，避免一个用户重新打开另一个用户保存的回测记录。',
      bullets: isEnglish
        ? [
          'Backtest results and history remain protected by account-based backend checks.',
          'Guest mode does not expose saved result details or historical metrics.',
          'Sign in to reopen the results saved under your own account.',
        ]
        : [
          '回测结果与历史已经由基于归属的后端规则保护。',
          '游客模式不会暴露已保存回测记录的细节和历史指标。',
          '登录后才可以重新打开保存在你自己账户下的结果。',
        ],
      note: isEnglish
        ? 'If this result belongs to another account, the backend will continue to block access after sign-in.'
        : '如果这个结果属于其他账户，登录后后端仍会继续阻止访问。',
      secondaryAction: {
        label: isEnglish ? 'Create account' : '创建账户',
        to: buildRegistrationPath(redirectTarget),
      },
      tertiaryAction: {
        label: isEnglish ? 'Open scanner teaser' : '查看扫描器预告',
        to: '/scanner',
      },
    };
  }

  if (pathname.startsWith('/backtest')) {
    return {
      eyebrow: isEnglish ? 'Registered User Only' : '仅限注册用户',
      statusLabel: isEnglish ? 'Backtests Locked' : '回测功能已锁定',
      title: isEnglish ? 'Sign in to open backtests' : '登录后进入回测',
      description: isEnglish
        ? 'Backtests, saved result history, and follow-up analysis all depend on a real user identity.'
        : '回测、已保存结果历史和后续分析都依赖真实用户身份。',
      bullets: isEnglish
        ? [
          'Guest access stops before saved backtests and result history.',
          'Signed-in users can run and revisit their own backtests without shared state.',
          'Access rules continue to be enforced by the backend.',
        ]
        : [
          '游客模式不会开放可保存的回测和结果历史。',
          '登录用户可以运行并重新查看属于自己的回测结果，而不是共享状态。',
          '实际访问权限仍继续由后端执行。',
        ],
      note: isEnglish
        ? 'After sign-in, we will take you back to backtests.'
        : '登录成功后，系统会把你带回回测页面。',
      secondaryAction: {
        label: isEnglish ? 'Create account' : '创建账户',
        to: buildRegistrationPath(redirectTarget),
      },
      tertiaryAction: {
        label: isEnglish ? 'Open scanner teaser' : '查看扫描器预告',
        to: '/scanner',
      },
    };
  }

  return {
    eyebrow: isEnglish ? 'Registered User Only' : '仅限注册用户',
    statusLabel: isEnglish ? 'Guest Preview Only' : '仅限游客预览',
    title: isEnglish ? 'Sign in to continue' : '登录后继续使用',
    description: isEnglish
      ? 'This page depends on a real account for saved history and personal data.'
      : '这个页面依赖真实账户来承载保存历史与个人数据。',
    bullets: isEnglish
      ? [
        'Chat, portfolio, backtests, and saved history stay tied to signed-in users.',
        'Guest access stays limited to preview flows and locked pages.',
        'Access rules are still enforced by the backend.',
      ]
      : [
        '问股、持仓、回测和保存历史都必须绑定到已认证用户。',
        '游客模式只保留预览流和锁定页面。',
        '实际访问权限仍以后端规则为准。',
      ],
    note: isEnglish
      ? 'After sign-in, we will return you to this page automatically.'
      : '登录成功后，系统会自动把你带回当前页面。',
    secondaryAction: {
      label: isEnglish ? 'Create account' : '创建账户',
      to: buildRegistrationPath(redirectTarget),
    },
    tertiaryAction: {
      label: isEnglish ? 'Back to guest preview' : '返回游客预览',
      to: '/guest',
    },
  };
}

function getAdminSurfaceCopy(pathname: string, language: UiLanguage, isGuest: boolean): GateCopy {
  const isEnglish = language === 'en';

  if (pathname.startsWith('/admin/logs')) {
    return isGuest
      ? {
        eyebrow: isEnglish ? 'Admin Only' : '仅限管理员',
        statusLabel: isEnglish ? 'Admin Sign-in Required' : '需要管理员登录',
        title: isEnglish ? 'Sign in with an admin account to open logs' : '请使用管理员账户登录后查看日志',
        description: isEnglish
          ? 'Execution logs are reserved for admins and are not available in guest or regular user pages.'
          : '执行日志只对管理员开放，不属于游客或普通用户页面的一部分。',
        bullets: isEnglish
          ? [
            'Guest access never maps to setup or admin identities.',
            'System logs stay protected even when the route is known.',
            'Use an admin account if you need logs, schedules, or system controls.',
          ]
          : [
            '游客模式绝不会映射到初始设置账户或管理员身份。',
            '即使知道路由地址，系统日志仍然会被保护。',
            '如果你需要日志、调度或系统控制，请使用管理员账户。',
          ],
        secondaryAction: {
          label: isEnglish ? 'Back home' : '返回首页',
          to: '/',
        },
      }
      : {
        eyebrow: isEnglish ? 'Admin Only' : '仅限管理员',
        statusLabel: isEnglish ? 'Admin Account Required' : '需要管理员账户',
        title: isEnglish ? 'This logs route requires an admin account' : '这个日志页面需要管理员账户',
        description: isEnglish
          ? 'Your current account can keep using the regular app, but the logs page stays reserved for admins.'
          : '你当前账户仍可继续使用普通页面，但日志页只对管理员开放。',
        bullets: isEnglish
          ? [
            'Regular users no longer see raw system logs in the default navigation.',
            'If you expected access, sign out and re-enter with an admin account.',
            'Personal preferences remain available in personal settings.',
          ]
        : [
            '普通用户不会再在默认导航里看到原始系统日志界面。',
            '如果你本应拥有权限，请先退出当前账户，再使用管理员账户重新进入。',
            '你的个人偏好仍然可以在个人设置页面继续使用。',
          ],
        note: isEnglish
          ? 'Need the regular app instead? Personal settings remain the right next stop.'
          : '如果你要继续使用普通页面，个人设置仍然是更合适的下一站。',
        secondaryAction: {
          label: isEnglish ? 'Back home' : '返回首页',
          to: '/',
        },
      };
  }

  return isGuest
    ? {
      eyebrow: isEnglish ? 'Admin Only' : '仅限管理员',
      statusLabel: isEnglish ? 'Admin Sign-in Required' : '需要管理员登录',
      title: isEnglish ? 'Sign in with an admin account to open admin settings' : '请使用管理员账户登录后打开管理设置',
      description: isEnglish
        ? 'System settings, data-source controls, schedules, channels, and admin logs are reserved for admin accounts.'
        : '系统设置、数据源控制、调度、通道和管理员日志只对管理员账户开放。',
      bullets: isEnglish
        ? [
          'Guest mode never maps to admin or initial-setup identities.',
          'Admin tools stay behind explicit admin-only entry points.',
          'Use an admin account if you need system settings rather than personal preferences.',
        ]
        : [
          '游客模式绝不会映射到管理员或初始设置身份。',
          '管理员工具仍然保留在显式的管理员入口之后。',
          '如果你需要系统设置而不是个人偏好，请使用管理员账户登录。',
        ],
      secondaryAction: {
        label: isEnglish ? 'Back home' : '返回首页',
        to: '/',
      },
    }
    : {
      eyebrow: isEnglish ? 'Admin Only' : '仅限管理员',
      statusLabel: isEnglish ? 'Admin Account Required' : '需要管理员账户',
      title: isEnglish ? 'This page requires an admin account' : '这个页面需要管理员账户',
      description: isEnglish
        ? 'System configuration, provider controls, schedules, channels, and admin logs stay outside the regular app.'
        : '系统配置、数据源控制、调度、通道和管理员日志仍然留在普通用户页面之外。',
      bullets: isEnglish
        ? [
          'Regular users no longer see raw system controls in the default navigation.',
          'If you expected access, sign out and re-enter with an admin account.',
          'Personal preferences remain available in personal settings.',
        ]
        : [
          '普通用户不会再在默认导航里看到原始系统控制项。',
          '如果你本应拥有权限，请先退出当前账户，再使用管理员账户重新进入。',
          '个人偏好仍然保留在标准设置页面。',
        ],
      note: isEnglish
        ? 'Need regular tools instead? Open personal settings or return home.'
        : '如果你要继续普通工具，请打开个人设置或返回首页。',
      secondaryAction: {
        label: isEnglish ? 'Back home' : '返回首页',
        to: '/',
      },
    };
}

export const RegisteredSurfaceRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const { language } = useI18n();
  const { isGuest } = useProductSurface();
  const routePathname = stripLocalePrefix(location.pathname);
  const routeTarget = `${routePathname}${location.search}`;
  const gateCopy = getRegisteredSurfaceCopy(routePathname, routeTarget, language);

  if (!isGuest) {
    return <>{children}</>;
  }

  return (
    <AccessGatePage
      eyebrow={gateCopy.eyebrow}
      title={gateCopy.title}
      description={gateCopy.description}
      bullets={gateCopy.bullets}
      statusLabel={gateCopy.statusLabel}
      note={gateCopy.note}
      primaryAction={{
        label: language === 'en' ? 'Sign in now' : '立即登录',
        to: buildLoginPath(routeTarget),
      }}
      secondaryAction={gateCopy.secondaryAction}
      tertiaryAction={gateCopy.tertiaryAction}
    />
  );
};

export const AdminSurfaceRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const { language } = useI18n();
  const { isAdmin, isGuest } = useProductSurface();
  const routePathname = stripLocalePrefix(location.pathname);
  const routeTarget = `${routePathname}${location.search}`;
  const gateCopy = getAdminSurfaceCopy(routePathname, language, isGuest);

  if (isAdmin) {
    return <>{children}</>;
  }

  return (
    <AccessGatePage
      eyebrow={gateCopy.eyebrow}
      title={gateCopy.title}
      description={gateCopy.description}
      bullets={gateCopy.bullets}
      statusLabel={gateCopy.statusLabel}
      note={gateCopy.note}
      primaryAction={{
        label: isGuest ? (language === 'en' ? 'Sign in' : '登录') : (language === 'en' ? 'Open personal settings' : '打开个人设置'),
        to: isGuest ? buildLoginPath(routeTarget) : '/settings',
      }}
      secondaryAction={gateCopy.secondaryAction}
    />
  );
};

export const AppContent: React.FC = () => {
  const location = useLocation();
  const { authEnabled, loggedIn, isLoading, loadError, refreshStatus } = useAuth();
  const { isGuest } = useProductSurface();
  const { setLanguage, t } = useI18n();
  const bootStartedAt = useRef<number>(0);
  const [showBootSplash, setShowBootSplash] = useState(true);
  const [bootSplashFading, setBootSplashFading] = useState(false);
  const splashDismissed = useRef(false);
  const routeLocale = parseLocaleFromPathname(location.pathname);
  const routePathname = stripLocalePrefix(location.pathname);
  const localizedHomePath = routeLocale ? buildLocalizedPath('/', routeLocale) : '/';
  const localizedGuestPath = routeLocale ? buildLocalizedPath('/guest', routeLocale) : '/guest';
  const isGuestRestrictedPath = (
    routePathname === '/chat'
    || routePathname.startsWith('/chat/')
    || routePathname === '/portfolio'
    || routePathname.startsWith('/portfolio/')
    || routePathname === '/backtest'
    || routePathname.startsWith('/backtest/')
    || routePathname === '/scanner'
    || routePathname.startsWith('/scanner/')
    || routePathname === '/settings'
    || routePathname.startsWith('/settings/')
    || routePathname === '/admin/logs'
    || routePathname.startsWith('/admin/logs/')
  );

  useEffect(() => {
    useAgentChatStore.getState().setCurrentRoute(location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    if (routeLocale) {
      setLanguage(routeLocale);
    }
  }, [routeLocale, setLanguage]);

  useEffect(() => {
    if (bootStartedAt.current === 0) {
      bootStartedAt.current = Date.now();
    }
  }, []);

  useEffect(() => {
    if (isLoading || splashDismissed.current) {
      return;
    }

    if (bootStartedAt.current === 0) {
      bootStartedAt.current = Date.now();
    }
    const elapsed = Date.now() - bootStartedAt.current;
    const waitMs = Math.max(0, APP_BOOT_SPLASH_MIN_MS - elapsed);
    let hideTimer: number | undefined;
    const fadeTimer = window.setTimeout(() => {
      splashDismissed.current = true;
      setBootSplashFading(true);
      hideTimer = window.setTimeout(() => {
        setShowBootSplash(false);
      }, APP_BOOT_SPLASH_FADE_MS);
    }, waitMs);

    return () => {
      window.clearTimeout(fadeTimer);
      if (hideTimer !== undefined) {
        window.clearTimeout(hideTimer);
      }
    };
  }, [isLoading]);

  let content: React.ReactNode = null;

  if (loadError) {
    content = (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base px-4">
        <div className="theme-panel-glass w-full max-w-xl px-5 py-5">
          <ApiErrorAlert error={loadError} />
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              className="btn-primary"
              onClick={() => void refreshStatus()}
            >
              {t('app.retry')}
            </button>
          </div>
        </div>
      </div>
    );
  } else if (!isLoading) {
    if (routePathname === '/login') {
      const redirectTarget = resolveAuthRedirect(location.search, localizedHomePath);
      if (!authEnabled || loggedIn) {
        content = <Navigate to={redirectTarget} replace />;
      } else {
        content = (
          <Suspense fallback={<BrandedLoadingScreen text={t('app.loadingBrand')} subtext={t('app.loading')} />}>
            <LoginPage />
          </Suspense>
        );
      }
    } else if (routePathname === '/reset-password') {
      if (!authEnabled || loggedIn) {
        content = <Navigate to={localizedHomePath} replace />;
      } else {
        content = (
          <Suspense fallback={<BrandedLoadingScreen text={t('app.loadingBrand')} subtext={t('app.loading')} />}>
            <ResetPasswordPage />
          </Suspense>
        );
      }
    } else if (isGuest && isGuestRestrictedPath) {
      content = <Navigate to={localizedGuestPath} replace />;
    } else {
      content = (
        <Suspense fallback={<BrandedLoadingScreen text={t('app.loadingBrand')} subtext={t('app.loading')} />}>
          <Routes>
            <Route path="/guest/scanner" element={<Navigate to="/scanner" replace />} />
            <Route path="/user/scanner" element={<Navigate to="/scanner" replace />} />
            <Route path="/:locale/guest/scanner" element={<Navigate to="../scanner" replace />} />
            <Route path="/:locale/user/scanner" element={<Navigate to="../scanner" replace />} />
            <Route element={<Shell />}>
              <Route path="/" element={<HomeSurfacePage />} />
              <Route path="/guest" element={<GuestHomePage />} />
              <Route path="/scanner" element={<ScannerSurfacePage />} />
              <Route path="/chat" element={<RegisteredSurfaceRoute><ChatPage /></RegisteredSurfaceRoute>} />
              <Route path="/portfolio" element={<RegisteredSurfaceRoute><PortfolioPage /></RegisteredSurfaceRoute>} />
              <Route path="/backtest" element={<RegisteredSurfaceRoute><BacktestPage /></RegisteredSurfaceRoute>} />
              <Route path="/backtest/compare" element={<RegisteredSurfaceRoute><RuleBacktestComparePage /></RegisteredSurfaceRoute>} />
              <Route path="/backtest/results/:runId" element={<RegisteredSurfaceRoute><DeterministicBacktestResultPage /></RegisteredSurfaceRoute>} />
              <Route path="/settings" element={<PersonalSettingsPage />} />
              <Route path="/settings/system" element={<AdminSurfaceRoute><SystemSettingsPage /></AdminSurfaceRoute>} />
              <Route path="/admin/logs" element={<AdminSurfaceRoute><AdminLogsPage /></AdminSurfaceRoute>} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
            <Route path="/:locale" element={<Shell />}>
              <Route index element={<HomeSurfacePage />} />
              <Route path="guest" element={<GuestHomePage />} />
              <Route path="scanner" element={<ScannerSurfacePage />} />
              <Route path="chat" element={<RegisteredSurfaceRoute><ChatPage /></RegisteredSurfaceRoute>} />
              <Route path="portfolio" element={<RegisteredSurfaceRoute><PortfolioPage /></RegisteredSurfaceRoute>} />
              <Route path="backtest" element={<RegisteredSurfaceRoute><BacktestPage /></RegisteredSurfaceRoute>} />
              <Route path="backtest/compare" element={<RegisteredSurfaceRoute><RuleBacktestComparePage /></RegisteredSurfaceRoute>} />
              <Route path="backtest/results/:runId" element={<RegisteredSurfaceRoute><DeterministicBacktestResultPage /></RegisteredSurfaceRoute>} />
              <Route path="settings" element={<PersonalSettingsPage />} />
              <Route path="settings/system" element={<AdminSurfaceRoute><SystemSettingsPage /></AdminSurfaceRoute>} />
              <Route path="admin/logs" element={<AdminSurfaceRoute><AdminLogsPage /></AdminSurfaceRoute>} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/:locale/login" element={<LoginPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/:locale/reset-password" element={<ResetPasswordPage />} />
          </Routes>
        </Suspense>
      );
    }
  }

  return (
    <>
      {content}
      {showBootSplash ? (
        <BrandedLoadingScreen
          fading={bootSplashFading}
          text={t('app.loadingBrand')}
          subtext={isLoading ? t('app.loading') : undefined}
        />
      ) : null}
    </>
  );
};

const PreviewRoutes: React.FC = () => {
  const location = useLocation();
  const { setLanguage, t } = useI18n();
  const routeLocale = parseLocaleFromPathname(location.pathname);

  useEffect(() => {
    if (routeLocale) {
      setLanguage(routeLocale);
    }
  }, [routeLocale, setLanguage]);

  return (
    <PreviewShell>
      <Suspense fallback={<BrandedLoadingScreen text={t('app.loadingBrand')} subtext={t('app.loading')} />}>
        <Routes>
          <Route path="/__preview/report" element={<PreviewReportPage />} />
          <Route path="/__preview/full-report" element={<PreviewFullReportDrawerPage />} />
          <Route path="/:locale/__preview/report" element={<PreviewReportPage />} />
          <Route path="/:locale/__preview/full-report" element={<PreviewFullReportDrawerPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </PreviewShell>
  );
};

const AppBody: React.FC = () => {
  const location = useLocation();
  const routePathname = stripLocalePrefix(location.pathname);
  const isPreviewRoute = import.meta.env.DEV && routePathname.startsWith('/__preview/');

  if (isPreviewRoute) {
    return <PreviewRoutes />;
  }

  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
};

const App: React.FC = () => {
  useEffect(() => {
    const staticSplash = document.getElementById(STATIC_BOOT_SPLASH_ID);
    if (!staticSplash) {
      return;
    }
    staticSplash.classList.add('is-fading');
    const timer = window.setTimeout(() => {
      staticSplash.remove();
    }, APP_BOOT_SPLASH_FADE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <Router>
      <AppBody />
    </Router>
  );
};

export default App;
