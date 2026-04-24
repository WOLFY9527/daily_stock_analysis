import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Input } from '../components/common';
import type { ParsedApiError } from '../api/error';
import { isParsedApiError } from '../api/error';
import { SettingsAlert } from '../components/settings';
import { useAuth } from '../hooks';
import { translate, type UiLanguage } from '../i18n/core';
import { normalizeRedirectPath } from '../hooks/useProductSurface';
import { buildLocalizedPath, parseLocaleFromPathname, stripLocalePrefix } from '../utils/localeRouting';

type LoginLanguage = UiLanguage;

type LoginCopy = {
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
  continuePrefix: (label: string) => string;
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
  forgotPassword: string;
  footSession: string;
  footWorkspace: string;
  footStable: string;
  redirectTargets: Record<'systemSettings' | 'adminLogs' | 'chat' | 'portfolio' | 'backtestResult' | 'backtest' | 'scanner' | 'settings' | 'home', string>;
  exitTargets: {
    scannerLabel: string;
    scannerDescription: string;
    homeLabel: string;
    homeDescription: string;
  };
};

function auth(language: LoginLanguage, key: string, vars?: Record<string, string | number | undefined>): string {
  return translate(language, `auth.login.${key}`, vars);
}

function buildLoginCopy(language: LoginLanguage): LoginCopy {
  return {
    documentTitle: auth(language, 'documentTitle'),
    authFacts: [
      auth(language, 'factUnified'),
      auth(language, 'factProtected'),
      auth(language, 'factOwned'),
    ],
    authFactsLabel: auth(language, 'authFactsLabel'),
    heroEyebrow: auth(language, 'heroEyebrow'),
    heroTitleSetup: auth(language, 'heroTitleSetup'),
    heroTitleCreate: auth(language, 'heroTitleCreate'),
    heroTitleLogin: auth(language, 'heroTitleLogin'),
    heroBodySetup: auth(language, 'heroBodySetup'),
    heroBodyCreate: auth(language, 'heroBodyCreate'),
    heroBodyLogin: auth(language, 'heroBodyLogin'),
    panelEyebrowSetup: auth(language, 'panelEyebrowSetup'),
    panelEyebrowCreate: auth(language, 'panelEyebrowCreate'),
    panelEyebrowLogin: auth(language, 'panelEyebrowLogin'),
    panelTitleSetup: auth(language, 'panelTitleSetup'),
    panelTitleCreate: auth(language, 'panelTitleCreate'),
    panelTitleLogin: auth(language, 'panelTitleLogin'),
    panelBodySetup: auth(language, 'panelBodySetup'),
    panelBodyCreate: auth(language, 'panelBodyCreate'),
    panelBodyLogin: auth(language, 'panelBodyLogin'),
    continueAfterLogin: auth(language, 'continueAfterLogin'),
    continuePrefix: (label: string) => auth(language, 'continuePrefix', { label }),
    continueRequiresAdmin: auth(language, 'continueRequiresAdmin'),
    continueStandard: auth(language, 'continueStandard'),
    leaveAuthPage: auth(language, 'leaveAuthPage'),
    usernameLabel: auth(language, 'usernameLabel'),
    usernamePlaceholderCreate: auth(language, 'usernamePlaceholderCreate'),
    usernamePlaceholderLogin: auth(language, 'usernamePlaceholderLogin'),
    displayNameLabel: auth(language, 'displayNameLabel'),
    displayNamePlaceholder: auth(language, 'displayNamePlaceholder'),
    passwordLabelSetup: auth(language, 'passwordLabelSetup'),
    passwordLabelLogin: auth(language, 'passwordLabelLogin'),
    passwordPlaceholderSetup: auth(language, 'passwordPlaceholderSetup'),
    passwordPlaceholderLogin: auth(language, 'passwordPlaceholderLogin'),
    passwordConfirmLabel: auth(language, 'passwordConfirmLabel'),
    passwordConfirmPlaceholderSetup: auth(language, 'passwordConfirmPlaceholderSetup'),
    passwordConfirmPlaceholderLogin: auth(language, 'passwordConfirmPlaceholderLogin'),
    errorUsernameRequired: auth(language, 'errorUsernameRequired'),
    errorPasswordMismatch: auth(language, 'errorPasswordMismatch'),
    errorLoginFailed: auth(language, 'errorLoginFailed'),
    errorTitleSetup: auth(language, 'errorTitleSetup'),
    errorTitleDefault: auth(language, 'errorTitleDefault'),
    loadingTextSetup: auth(language, 'loadingTextSetup'),
    loadingTextCreate: auth(language, 'loadingTextCreate'),
    loadingTextLogin: auth(language, 'loadingTextLogin'),
    submitSetup: auth(language, 'submitSetup'),
    submitCreate: auth(language, 'submitCreate'),
    submitLogin: auth(language, 'submitLogin'),
    toggleToLogin: auth(language, 'toggleToLogin'),
    toggleToCreate: auth(language, 'toggleToCreate'),
    forgotPassword: auth(language, 'forgotPassword'),
    footSession: auth(language, 'footSession'),
    footWorkspace: auth(language, 'footWorkspace'),
    footStable: auth(language, 'footStable'),
    redirectTargets: {
      systemSettings: auth(language, 'redirectTarget.systemSettings'),
      adminLogs: auth(language, 'redirectTarget.adminLogs'),
      chat: auth(language, 'redirectTarget.chat'),
      portfolio: auth(language, 'redirectTarget.portfolio'),
      backtestResult: auth(language, 'redirectTarget.backtestResult'),
      backtest: auth(language, 'redirectTarget.backtest'),
      scanner: auth(language, 'redirectTarget.scanner'),
      settings: auth(language, 'redirectTarget.settings'),
      home: auth(language, 'redirectTarget.home'),
    },
    exitTargets: {
      scannerLabel: auth(language, 'exitTarget.scannerLabel'),
      scannerDescription: auth(language, 'exitTarget.scannerDescription'),
      homeLabel: auth(language, 'exitTarget.homeLabel'),
      homeDescription: auth(language, 'exitTarget.homeDescription'),
    },
  };
}

function describeRedirectTarget(pathname: string, copy: LoginCopy): {
  label: string;
  requiresAdmin: boolean;
} {
  if (pathname.startsWith('/settings/system')) {
    return { label: copy.redirectTargets.systemSettings, requiresAdmin: true };
  }
  if (pathname.startsWith('/admin/logs')) {
    return { label: copy.redirectTargets.adminLogs, requiresAdmin: true };
  }
  if (pathname.startsWith('/chat')) {
    return { label: copy.redirectTargets.chat, requiresAdmin: false };
  }
  if (pathname.startsWith('/portfolio')) {
    return { label: copy.redirectTargets.portfolio, requiresAdmin: false };
  }
  if (pathname.startsWith('/backtest/results/')) {
    return { label: copy.redirectTargets.backtestResult, requiresAdmin: false };
  }
  if (pathname.startsWith('/backtest')) {
    return { label: copy.redirectTargets.backtest, requiresAdmin: false };
  }
  if (pathname.startsWith('/scanner')) {
    return { label: copy.redirectTargets.scanner, requiresAdmin: false };
  }
  if (pathname.startsWith('/settings')) {
    return { label: copy.redirectTargets.settings, requiresAdmin: false };
  }
  return { label: copy.redirectTargets.home, requiresAdmin: false };
}

function describeExitTarget(
  pathname: string,
  routeLanguage: ReturnType<typeof parseLocaleFromPathname>,
  copy: LoginCopy,
): {
  label: string;
  destination: string;
  description: string;
} {
  const localize = (path: string) => (routeLanguage ? buildLocalizedPath(path, routeLanguage) : path);
  if (pathname.startsWith('/scanner')) {
    return {
      label: copy.exitTargets.scannerLabel,
      destination: localize('/scanner'),
      description: copy.exitTargets.scannerDescription,
    };
  }
  return {
    label: copy.exitTargets.homeLabel,
    destination: localize('/'),
    description: copy.exitTargets.homeDescription,
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
  const copy = useMemo(() => buildLoginCopy(language), [language]);
  const normalizedRedirect = stripLocalePrefix(redirect);
  const redirectTarget = describeRedirectTarget(normalizedRedirect, copy);
  const exitTarget = describeExitTarget(normalizedRedirect, routeLanguage, copy);
  const resetPasswordPath = routeLanguage
    ? buildLocalizedPath(`/reset-password?redirect=${encodeURIComponent(redirect)}`, routeLanguage)
    : `/reset-password?redirect=${encodeURIComponent(redirect)}`;

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
    document.title = copy.documentTitle;
  }, [copy.documentTitle]);

  useEffect(() => {
    if (!isAdminBootstrap) {
      setCreateUser(createModeRequested);
    }
  }, [createModeRequested, isAdminBootstrap]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
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
            {isAdminBootstrap ? copy.heroBodySetup : isCreateUserMode ? copy.heroBodyCreate : copy.heroBodyLogin}
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
              {isAdminBootstrap ? copy.panelBodySetup : isCreateUserMode ? copy.panelBodyCreate : copy.panelBodyLogin}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="auth-form">
            {redirect !== '/' ? (
              <div className="rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-2)]/45 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-secondary-text">{copy.continueAfterLogin}</p>
                <p className="mt-2 text-sm font-semibold text-foreground">{copy.continuePrefix(redirectTarget.label)}</p>
                <p className="mt-1 text-xs leading-5 text-secondary-text">
                  {redirectTarget.requiresAdmin ? copy.continueRequiresAdmin : copy.continueStandard}
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
                onChange={(event) => setUsername(event.target.value)}
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
                onChange={(event) => setDisplayName(event.target.value)}
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
              onChange={(event) => setPassword(event.target.value)}
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
                onChange={(event) => setPasswordConfirm(event.target.value)}
                disabled={isSubmitting}
                autoComplete="new-password"
              />
            ) : null}

            {!isAdminBootstrap && !isCreateUserMode ? (
              <div className="flex justify-end">
                <Link className="text-sm font-medium text-[var(--brand-primary)] hover:underline" to={resetPasswordPath}>
                  {copy.forgotPassword}
                </Link>
              </div>
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
