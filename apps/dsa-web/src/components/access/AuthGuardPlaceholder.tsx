import type React from 'react';
import { LockKeyhole } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useI18n } from '../../contexts/UiLanguageContext';
import { buildLocalizedPath, parseLocaleFromPathname } from '../../utils/localeRouting';

type AuthGuardPlaceholderProps = {
  moduleName: string;
};

export const AuthGuardPlaceholder: React.FC<AuthGuardPlaceholderProps> = ({ moduleName }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { language } = useI18n();
  const routeLocale = parseLocaleFromPathname(location.pathname);
  const loginPath = routeLocale ? buildLocalizedPath('/login', routeLocale) : '/login';
  const title = language === 'en' ? `Sign in to unlock ${moduleName}` : `登录解锁 ${moduleName} 功能`;
  const body = language === 'en'
    ? 'Guest mode only supports the core home preview. Personal workspaces and historical review require a real account.'
    : '游客模式仅支持首页基础查询。保存个人工作区与历史回溯需绑定正式账户。';
  const buttonLabel = language === 'en' ? 'Sign in / Create account' : '登录 / 创建账户';

  return (
    <div className="flex-1 w-full flex items-center justify-center min-h-[500px]" data-testid="auth-guard-shell">
      <div
        className="bg-white/[0.02] border border-white/5 rounded-2xl p-8 flex flex-col items-center max-w-sm text-center backdrop-blur-md"
        data-testid="auth-guard-card"
      >
        <LockKeyhole className="w-8 h-8 text-white/20 mb-4" aria-hidden="true" />
        <h3 className="text-base font-bold text-white mb-2">{title}</h3>
        <p className="text-xs text-white/40 mb-6">{body}</p>
        <button
          type="button"
          onClick={() => navigate(loginPath)}
          className="w-full py-2.5 bg-white text-black font-bold text-sm rounded-xl hover:bg-white/90 transition-all"
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
};
