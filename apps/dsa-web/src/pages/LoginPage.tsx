import type React from 'react';
import { useEffect, useState } from 'react';
import { Button, Input } from '../components/common';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { ParsedApiError } from '../api/error';
import { isParsedApiError } from '../api/error';
import { useAuth } from '../hooks';
import { SettingsAlert } from '../components/settings';
import { normalizeRedirectPath } from '../hooks/useProductSurface';
import { buildLocalizedPath, parseLocaleFromPathname, stripLocalePrefix } from '../utils/localeRouting';

type LoginLanguage = 'zh' | 'en';

const LOGIN_COPY: Record<LoginLanguage, {
  documentTitle: string;
  authFacts: string[];
  authFactsLabel: string;
  heroEyebrow: string;
  heroTitleSetup: string;
  heroTitleCreate: string;
  heroTitleLogin: string;
  heroBodySetup: string;
  heroBodyCreate: string;
  heroBodyLogin: string;
  panelEyebrowSetup: string;
  panelEyebrowCreate: string;
  panelEyebrowLogin: string;
  panelTitleSetup: string;
  panelTitleCreate: string;
  panelTitleLogin: string;
  panelBodySetup: string;
  panelBodyCreate: string;
  panelBodyLogin: string;
  continueAfterLogin: string;
  continuePrefix: string;
  continueRequiresAdmin: string;
  continueStandard: string;
  leaveAuthPage: string;
  usernameLabel: string;
  usernamePlaceholderCreate: string;
  usernamePlaceholderLogin: string;
  displayNameLabel: string;
  displayNamePlaceholder: string;
  passwordLabelSetup: string;
  passwordLabelLogin: string;
  passwordPlaceholderSetup: string;
  passwordPlaceholderLogin: string;
  passwordConfirmLabel: string;
  passwordConfirmPlaceholderSetup: string;
  passwordConfirmPlaceholderLogin: string;
  errorUsernameRequired: string;
  errorPasswordMismatch: string;
  errorLoginFailed: string;
  errorTitleSetup: string;
  errorTitleDefault: string;
  loadingTextSetup: string;
  loadingTextCreate: string;
  loadingTextLogin: string;
  submitSetup: string;
  submitCreate: string;
  submitLogin: string;
  toggleToLogin: string;
  toggleToCreate: string;
  footSession: string;
  footWorkspace: string;
  footStable: string;
  redirectTargets: {
    systemSettings: string;
    adminLogs: string;
    chat: string;
    portfolio: string;
    backtestResult: string;
    backtest: string;
    scanner: string;
    settings: string;
    home: string;
  };
  exitTargets: {
    scannerLabel: string;
    scannerDescription: string;
    homeLabel: string;
    homeDescription: string;
  };
}> = {
  zh: {
    documentTitle: '登录 - WolfyStock',
    authFacts: [
      '一个账户贯通分析、问股、持仓与回测',
      '受保护的个人会话与历史记录',
      '登录后所有保存内容都会归到你的身份下',
    ],
    authFactsLabel: '认证说明',
    heroEyebrow: 'WolfyStock 账户',
    heroTitleSetup: '设置管理员访问口令',
    heroTitleCreate: '创建账户',
    heroTitleLogin: '登录进入 WolfyStock',
    heroBodySetup: '首次启用认证时，先设置管理员密码。完成后即可继续使用系统设置、日志和其他受保护页面。',
    heroBodyCreate: '创建账户后，你的报告、问股、持仓、回测和历史都会保存在自己的身份下。',
    heroBodyLogin: '登录后即可继续查看保存的报告、任务、问股、持仓与回测。',
    panelEyebrowSetup: '初始访问',
    panelEyebrowCreate: '创建账户',
    panelEyebrowLogin: '安全登录',
    panelTitleSetup: '设置初始密码',
    panelTitleCreate: '创建账户并登录',
    panelTitleLogin: '账户登录',
    panelBodySetup: '设置后续登录使用的管理员密码。',
    panelBodyCreate: '输入用户名与密码，立即创建普通用户账户。',
    panelBodyLogin: '输入用户名和密码以继续访问当前页面。',
    continueAfterLogin: '登录后继续',
    continuePrefix: '登录后将继续进入：',
    continueRequiresAdmin: '如果目标页面仍然要求管理员身份，登录后系统会继续提示你使用正确账户。',
    continueStandard: '建立会话成功后，系统会自动把你带回刚才尝试访问的页面。',
    leaveAuthPage: '离开认证页',
    usernameLabel: '用户名',
    usernamePlaceholderCreate: '请输入用户名',
    usernamePlaceholderLogin: '留空则登录管理员账户',
    displayNameLabel: '显示名称',
    displayNamePlaceholder: '可选，用于界面显示',
    passwordLabelSetup: '管理员密码',
    passwordLabelLogin: '登录密码',
    passwordPlaceholderSetup: '请设置 6 位以上密码',
    passwordPlaceholderLogin: '请输入密码',
    passwordConfirmLabel: '确认密码',
    passwordConfirmPlaceholderSetup: '再次确认管理员密码',
    passwordConfirmPlaceholderLogin: '再次确认登录密码',
    errorUsernameRequired: '请输入用户名',
    errorPasswordMismatch: '两次输入的密码不一致',
    errorLoginFailed: '登录失败',
    errorTitleSetup: '配置失败',
    errorTitleDefault: '验证未通过',
    loadingTextSetup: '初始化安全凭据',
    loadingTextCreate: '创建账户并建立会话',
    loadingTextLogin: '建立登录会话',
    submitSetup: '完成设置并登录',
    submitCreate: '创建账户并登录',
    submitLogin: '登录继续',
    toggleToLogin: '已有账户，返回登录',
    toggleToCreate: '没有账户？立即创建',
    footSession: '受保护会话',
    footWorkspace: '个人页面',
    footStable: '保存历史',
    redirectTargets: {
      systemSettings: '系统设置',
      adminLogs: '管理员日志',
      chat: '问股',
      portfolio: '持仓',
      backtestResult: '已保存的回测结果',
      backtest: '回测',
      scanner: '扫描器',
      settings: '个人设置',
      home: '首页',
    },
    exitTargets: {
      scannerLabel: '返回扫描器预览',
      scannerDescription: '先回到公开可见的扫描器预览，再决定是否登录继续使用个人页面或管理页面。',
      homeLabel: '返回首页',
      homeDescription: '回到公开产品首页，不会影响后续再次登录或注册。',
    },
  },
  en: {
    documentTitle: 'Login - WolfyStock',
    authFacts: [
      'One account for analysis, Ask Stock, portfolio, and backtests',
      'Protected sessions tied to your identity',
      'Saved reports, chats, and history stay under your account',
    ],
    authFactsLabel: 'Authentication facts',
    heroEyebrow: 'WolfyStock account',
    heroTitleSetup: 'Set the admin access password',
    heroTitleCreate: 'Create an account',
    heroTitleLogin: 'Sign in to WolfyStock',
    heroBodySetup: 'When authentication is enabled for the first time, set the admin password before opening protected settings and logs.',
    heroBodyCreate: 'Create an account to keep reports, chats, portfolio data, backtests, and history under your own profile.',
    heroBodyLogin: 'Sign in to continue with your saved reports, tasks, chats, portfolio, and backtests.',
    panelEyebrowSetup: 'Initial access',
    panelEyebrowCreate: 'Create account',
    panelEyebrowLogin: 'Secure sign-in',
    panelTitleSetup: 'Set the initial password',
    panelTitleCreate: 'Create account and sign in',
    panelTitleLogin: 'Account sign-in',
    panelBodySetup: 'Create the admin password used for later sign-ins.',
    panelBodyCreate: 'Enter a username and password to create a standard user account immediately.',
    panelBodyLogin: 'Enter your username and password to continue.',
    continueAfterLogin: 'Continue after sign-in',
    continuePrefix: 'After sign-in you will continue to: ',
    continueRequiresAdmin: 'If the destination still requires admin access, the app will continue to prompt for the correct account after sign-in.',
    continueStandard: 'After the session is established, the app will take you back to the page you just tried to open.',
    leaveAuthPage: 'Leave sign-in page',
    usernameLabel: 'Username',
    usernamePlaceholderCreate: 'Enter a username',
    usernamePlaceholderLogin: 'Leave blank to sign in as admin',
    displayNameLabel: 'Display name',
    displayNamePlaceholder: 'Optional, shown in the UI',
    passwordLabelSetup: 'Admin password',
    passwordLabelLogin: 'Password',
    passwordPlaceholderSetup: 'Set a password with at least 6 characters',
    passwordPlaceholderLogin: 'Enter your password',
    passwordConfirmLabel: 'Confirm password',
    passwordConfirmPlaceholderSetup: 'Confirm the admin password again',
    passwordConfirmPlaceholderLogin: 'Confirm the sign-in password again',
    errorUsernameRequired: 'Enter a username',
    errorPasswordMismatch: 'The two password entries do not match',
    errorLoginFailed: 'Sign-in failed',
    errorTitleSetup: 'Setup failed',
    errorTitleDefault: 'Validation failed',
    loadingTextSetup: 'Initializing secure credentials',
    loadingTextCreate: 'Creating account and session',
    loadingTextLogin: 'Establishing sign-in session',
    submitSetup: 'Finish setup and sign in',
    submitCreate: 'Create account and sign in',
    submitLogin: 'Sign in',
    toggleToLogin: 'Already have an account? Back to sign-in',
    toggleToCreate: 'No account yet? Create one now',
    footSession: 'Protected session',
    footWorkspace: 'Personal pages',
    footStable: 'Saved history',
    redirectTargets: {
      systemSettings: 'System settings',
      adminLogs: 'Admin logs',
      chat: 'Ask Stock',
      portfolio: 'Portfolio',
      backtestResult: 'Saved backtest result',
      backtest: 'Backtest',
      scanner: 'Scanner',
      settings: 'Personal settings',
      home: 'Home',
    },
    exitTargets: {
      scannerLabel: 'Back to scanner preview',
      scannerDescription: 'Return to the public scanner preview first, then decide whether to sign in.',
      homeLabel: 'Back to home',
      homeDescription: 'Return to the public product home without affecting later sign-in or account creation.',
    },
  },
};

function describeRedirectTarget(pathname: string, language: LoginLanguage): {
  label: string;
  requiresAdmin: boolean;
} {
  const copy = LOGIN_COPY[language].redirectTargets;
  if (pathname.startsWith('/settings/system')) {
    return { label: copy.systemSettings, requiresAdmin: true };
  }
  if (pathname.startsWith('/admin/logs')) {
    return { label: copy.adminLogs, requiresAdmin: true };
  }
  if (pathname.startsWith('/chat')) {
    return { label: copy.chat, requiresAdmin: false };
  }
  if (pathname.startsWith('/portfolio')) {
    return { label: copy.portfolio, requiresAdmin: false };
  }
  if (pathname.startsWith('/backtest/results/')) {
    return { label: copy.backtestResult, requiresAdmin: false };
  }
  if (pathname.startsWith('/backtest')) {
    return { label: copy.backtest, requiresAdmin: false };
  }
  if (pathname.startsWith('/scanner')) {
    return { label: copy.scanner, requiresAdmin: false };
  }
  if (pathname.startsWith('/settings')) {
    return { label: copy.settings, requiresAdmin: false };
  }
  return { label: copy.home, requiresAdmin: false };
}

function describeExitTarget(
  pathname: string,
  routeLanguage: ReturnType<typeof parseLocaleFromPathname>,
  language: LoginLanguage,
): {
  label: string;
  destination: string;
  description: string;
} {
  const localize = (path: string) => (routeLanguage ? buildLocalizedPath(path, routeLanguage) : path);
  const copy = LOGIN_COPY[language].exitTargets;
  if (pathname.startsWith('/scanner')) {
    return {
      label: copy.scannerLabel,
      destination: localize('/scanner'),
      description: copy.scannerDescription,
    };
  }
  return {
    label: copy.homeLabel,
    destination: localize('/'),
    description: copy.homeDescription,
  };
}

const LoginPage: React.FC = () => {
  const { login, passwordSet, setupState } = useAuth();
  const navigate = useNavigate();

  const [searchParams] = useSearchParams();
  const redirect = normalizeRedirectPath(searchParams.get('redirect'), '/');
  const createModeRequested = searchParams.get('mode') === 'create';
  const routeLanguage = parseLocaleFromPathname(redirect) || parseLocaleFromPathname(window.location.pathname);
  const language: LoginLanguage = routeLanguage === 'en' ? 'en' : 'zh';
  const copy = LOGIN_COPY[language];
  const normalizedRedirect = stripLocalePrefix(redirect);
  const redirectTarget = describeRedirectTarget(normalizedRedirect, language);
  const exitTarget = describeExitTarget(normalizedRedirect, routeLanguage, language);

  useEffect(() => {
    document.title = copy.documentTitle;
  }, [copy.documentTitle]);

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [createUser, setCreateUser] = useState(createModeRequested);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | ParsedApiError | null>(null);

  const isAdminBootstrap = setupState === 'no_password' || !passwordSet;
  const isCreateUserMode = !isAdminBootstrap && createUser;

  useEffect(() => {
    if (!isAdminBootstrap) {
      setCreateUser(createModeRequested);
    }
  }, [createModeRequested, isAdminBootstrap]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isAdminBootstrap && isCreateUserMode && !username.trim()) {
      setError(copy.errorUsernameRequired);
      return;
    }

    if ((isAdminBootstrap || isCreateUserMode) && password !== passwordConfirm) {
      setError(copy.errorPasswordMismatch);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await login({
        username: isAdminBootstrap ? 'admin' : (username.trim() || 'admin'),
        displayName: isCreateUserMode ? displayName.trim() : undefined,
        password,
        passwordConfirm: isAdminBootstrap || isCreateUserMode ? passwordConfirm : undefined,
        createUser: isCreateUserMode,
      });
      if (result.success) {
        navigate(redirect, { replace: true });
      } else {
        setError(result.error ?? copy.errorLoginFailed);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-screen">
      <div className="auth-screen__backdrop" aria-hidden="true" />
      <div className="auth-screen__grid" aria-hidden="true" />

      <div className="auth-shell">
        <section className="auth-hero">
          <p className="auth-hero__eyebrow">{copy.heroEyebrow}</p>
          <h1 className="auth-hero__title">
            {isAdminBootstrap ? copy.heroTitleSetup : isCreateUserMode ? copy.heroTitleCreate : copy.heroTitleLogin}
          </h1>
          <p className="auth-hero__body">
            {isAdminBootstrap
              ? copy.heroBodySetup
              : isCreateUserMode
                ? copy.heroBodyCreate
                : copy.heroBodyLogin}
          </p>

          <div className="auth-hero__facts" role="list" aria-label={copy.authFactsLabel}>
            {copy.authFacts.map((item) => (
              <div key={item} className="auth-fact" role="listitem">
                <span className="auth-fact__line" aria-hidden="true" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="auth-panel theme-panel-glass">
          <div className="auth-panel__header">
            <p className="label-uppercase text-secondary-text">
              {isAdminBootstrap ? copy.panelEyebrowSetup : isCreateUserMode ? copy.panelEyebrowCreate : copy.panelEyebrowLogin}
            </p>
            <h2 className="auth-panel__title">
              <span>{isAdminBootstrap ? copy.panelTitleSetup : isCreateUserMode ? copy.panelTitleCreate : copy.panelTitleLogin}</span>
            </h2>
            <p className="auth-panel__body">
              {isAdminBootstrap
                ? copy.panelBodySetup
                : isCreateUserMode
                  ? copy.panelBodyCreate
                  : copy.panelBodyLogin}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="auth-form">
            {redirect !== '/' ? (
              <div className="rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-2)]/45 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-secondary-text">{copy.continueAfterLogin}</p>
                <p className="mt-2 text-sm font-semibold text-foreground">
                  {copy.continuePrefix}{redirectTarget.label}
                </p>
                <p className="mt-1 text-xs leading-5 text-secondary-text">
                  {redirectTarget.requiresAdmin
                    ? copy.continueRequiresAdmin
                    : copy.continueStandard}
                </p>
              </div>
            ) : null}

            <div className="rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-2)]/35 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.14em] text-secondary-text">{copy.leaveAuthPage}</p>
              <p className="mt-2 text-sm font-semibold text-foreground">{exitTarget.label}</p>
              <p className="mt-1 text-xs leading-5 text-secondary-text">{exitTarget.description}</p>
              <button
                type="button"
                className="btn-ghost mt-3 w-full justify-center"
                onClick={() => navigate(exitTarget.destination, { replace: true })}
                disabled={isSubmitting}
              >
                {exitTarget.label}
              </button>
            </div>

            {!isAdminBootstrap ? (
              <Input
                id="username"
                type="text"
                label={copy.usernameLabel}
                placeholder={isCreateUserMode ? copy.usernamePlaceholderCreate : copy.usernamePlaceholderLogin}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isSubmitting}
                autoFocus
                autoComplete="username"
              />
            ) : null}

            {isCreateUserMode ? (
              <Input
                id="displayName"
                type="text"
                label={copy.displayNameLabel}
                placeholder={copy.displayNamePlaceholder}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={isSubmitting}
                autoComplete="nickname"
              />
            ) : null}

            <Input
              id="password"
              type="password"
              allowTogglePassword
              iconType="password"
              label={isAdminBootstrap ? copy.passwordLabelSetup : copy.passwordLabelLogin}
              placeholder={isAdminBootstrap ? copy.passwordPlaceholderSetup : copy.passwordPlaceholderLogin}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isSubmitting}
              autoComplete={isAdminBootstrap || isCreateUserMode ? 'new-password' : 'current-password'}
            />

            {isAdminBootstrap || isCreateUserMode ? (
              <Input
                id="passwordConfirm"
                type="password"
                allowTogglePassword
                iconType="password"
                label={copy.passwordConfirmLabel}
                placeholder={isAdminBootstrap ? copy.passwordConfirmPlaceholderSetup : copy.passwordConfirmPlaceholderLogin}
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                disabled={isSubmitting}
                autoComplete="new-password"
              />
            ) : null}

            {error ? (
              <SettingsAlert
                title={isAdminBootstrap ? copy.errorTitleSetup : copy.errorTitleDefault}
                message={isParsedApiError(error) ? error.message : error}
                variant="error"
              />
            ) : null}

            <Button
              type="submit"
              variant="primary"
              size="xl"
              className="w-full justify-center"
              disabled={isSubmitting}
              isLoading={isSubmitting}
              loadingText={isAdminBootstrap ? copy.loadingTextSetup : isCreateUserMode ? copy.loadingTextCreate : copy.loadingTextLogin}
            >
              {isAdminBootstrap ? copy.submitSetup : isCreateUserMode ? copy.submitCreate : copy.submitLogin}
            </Button>

            {!isAdminBootstrap ? (
              <button
                type="button"
                className="btn-ghost w-full justify-center"
                onClick={() => {
                  setCreateUser((value) => !value);
                  setPasswordConfirm('');
                  setError(null);
                }}
                disabled={isSubmitting}
              >
                {isCreateUserMode ? copy.toggleToLogin : copy.toggleToCreate}
              </button>
            ) : null}
          </form>

          <div className="auth-panel__foot">
            <span>{copy.footSession}</span>
            <span>{copy.footWorkspace}</span>
            <span>{copy.footStable}</span>
          </div>
        </section>
      </div>
    </main>
  );
};

export default LoginPage;
