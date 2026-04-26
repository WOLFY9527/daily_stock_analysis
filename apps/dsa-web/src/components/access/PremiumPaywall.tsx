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
    ? 'Guest mode only includes the home preview. Personal workspaces, deeper historical review, and advanced metrics stay behind a real account.'
    : '游客模式仅支持首页基础查询。保存个人工作区、深度历史回溯及进阶指标测算，均需绑定正式账户。';
  const buttonLabel = language === 'en' ? 'Sign in / Create account' : '登录 / 创建账户';

  return (
    <div className="w-full h-[calc(100vh-80px)] flex items-center justify-center p-4" data-testid="premium-paywall-shell">
      <div
        className="relative w-full max-w-md overflow-hidden rounded-[24px] border border-white/5 bg-white/[0.02] p-8 text-center shadow-2xl backdrop-blur-3xl"
        data-testid="premium-paywall-card"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full bg-indigo-500/10 blur-3xl"
        />
        <div className="mb-6 flex items-center justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.05]">
            <LockKeyhole className="h-5 w-5 text-white/50" />
          </div>
        </div>
        <h1 className="mb-2 text-xl font-bold text-white">{title}</h1>
        <p className="mb-8 text-sm leading-relaxed text-white/40">{body}</p>
        <Link
          to={loginPath}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] py-3.5 text-white transition-colors hover:bg-white/[0.1]"
        >
          {buttonLabel}
        </Link>
      </div>
    </div>
  );
};
