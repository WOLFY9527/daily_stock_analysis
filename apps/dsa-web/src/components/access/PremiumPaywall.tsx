import type React from 'react';
import { LockKeyhole } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useI18n } from '../../contexts/UiLanguageContext';
import { buildLoginPath } from '../../hooks/useProductSurface';

type PremiumPaywallProps = {
  moduleName: string;
};

export const PremiumPaywall: React.FC<PremiumPaywallProps> = ({ moduleName }) => {
  const location = useLocation();
  const { language } = useI18n();
  const loginPath = buildLoginPath(`${location.pathname}${location.search}`);
  const title = language === 'en' ? `Sign in to unlock ${moduleName}` : `登录解锁 ${moduleName} 功能`;
  const body = language === 'en'
    ? 'Guest mode keeps the navigation open, but personal data, saved workspaces, and deeper tools stay behind account-bound access.'
    : '游客模式可以继续浏览导航，但个人数据、可保存工作区和深度工具仍然绑定在真实账户之后。';
  const buttonLabel = language === 'en' ? `Unlock ${moduleName}` : `登录解锁 ${moduleName}`;

  return (
    <div
      className="relative flex min-h-full flex-1 overflow-hidden bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.16),transparent_38%),linear-gradient(180deg,#09111b_0%,#060b12_100%)]"
      data-testid="premium-paywall"
    >
      <div aria-hidden="true" className="absolute inset-0 opacity-60">
        <div className="absolute inset-x-10 top-12 h-24 rounded-[28px] border border-white/6 bg-white/[0.03] blur-sm" />
        <div className="absolute inset-x-16 top-44 h-32 rounded-[32px] border border-white/5 bg-white/[0.025] blur-md" />
        <div className="absolute inset-x-24 bottom-16 h-28 rounded-[30px] border border-white/5 bg-white/[0.02] blur-lg" />
      </div>

      <div className="absolute inset-0 bg-slate-950/52 backdrop-blur-xl" />

      <div className="relative z-10 flex w-full items-center justify-center p-6">
        <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-white/[0.06] px-8 py-9 text-center shadow-[0_30px_120px_rgba(3,7,18,0.55)]">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/10 text-cyan-200">
            <LockKeyhole className="h-6 w-6" />
          </div>
          <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/38">
            {language === 'en' ? 'Premium surface' : '高级模块'}
          </p>
          <h1 className="mt-3 text-2xl font-semibold text-white">{title}</h1>
          <p className="mt-3 text-sm leading-6 text-white/58">{body}</p>
          <Link
            to={loginPath}
            className="mt-7 inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200"
          >
            {buttonLabel}
          </Link>
        </div>
      </div>
    </div>
  );
};
