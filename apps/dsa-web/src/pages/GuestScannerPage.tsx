import type React from 'react';
import { BarChart3, History, Radar, ShieldAlert, TestTubeDiagonal } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, WorkspacePageHeader } from '../components/common';
import { LockedFeatureCard } from '../components/access/LockedFeatureCard';
import { useI18n } from '../contexts/UiLanguageContext';
import { buildLoginPath, buildRegistrationPath } from '../hooks/useProductSurface';

const LOCKED_FEATURES = [
  {
    icon: Radar,
    title: { zh: '手动运行', en: 'Manual runs' },
    body: {
      zh: '在你自己的账户下执行扫描，而不是创建匿名共享状态。',
      en: 'Run scanner sessions in your own account instead of creating anonymous shared activity.',
    },
    ctaLabel: { zh: '登录', en: 'Sign in' },
    ctaTo: 'login',
  },
  {
    icon: History,
    title: { zh: '保存观察名单', en: 'Saved watchlists' },
    body: {
      zh: '查看你自己的历史运行、候选名单变化和后续执行决策。',
      en: 'Review your own run history, shortlist changes, and follow-through decisions.',
    },
    ctaLabel: { zh: '登录', en: 'Sign in' },
    ctaTo: 'login',
  },
  {
    icon: BarChart3,
    title: { zh: '复盘上下文', en: 'Review context' },
    body: {
      zh: '当运行记录归属于注册身份后，才能看到复盘状态和表现上下文。',
      en: 'Review status and performance context appear once your runs are saved under a signed-in account.',
    },
    ctaLabel: { zh: '登录', en: 'Sign in' },
    ctaTo: 'login',
  },
  {
    icon: TestTubeDiagonal,
    title: { zh: '回测联动', en: 'Backtest handoff' },
    body: {
      zh: '把候选送入确定性回测，并将结果保存到你的个人账户中。',
      en: 'Send candidates into deterministic backtests and keep the results in your own account.',
    },
    ctaLabel: { zh: '回到首页预览', en: 'Open home preview' },
    ctaTo: '/',
  },
] as const;

const GuestScannerPage: React.FC = () => {
  const { language } = useI18n();
  const loginPath = buildLoginPath('/scanner');
  const registrationPath = buildRegistrationPath('/scanner');

  return (
    <div className="space-y-6">
      <WorkspacePageHeader
        eyebrow={language === 'en' ? 'Scanner Preview' : '扫描器预告'}
        title={language === 'en' ? 'Market Scanner Preview' : '市场扫描预告'}
        description={language === 'en'
          ? 'Guests can explore how the scanner works, but manual runs, watchlists, and review history unlock only after sign-in.'
          : '游客可以先了解扫描器的工作方式与产品边界，但手动运行、观察名单与复盘历史需要登录后解锁。'}
        actions={(
          <Link
            to={loginPath}
            className="inline-flex min-h-[40px] items-center justify-center rounded-[var(--theme-button-radius)] border border-transparent bg-[var(--pill-active-bg)] px-4 text-[0.75rem] text-foreground transition-colors hover:border-[var(--border-strong)]"
          >
            {language === 'en' ? 'Sign in to run scanner' : '登录后运行扫描器'}
          </Link>
        )}
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(22rem,0.92fr)]">
          <Card title={language === 'en' ? 'How the scanner fits in' : '扫描器在产品中的位置'} subtitle={language === 'en' ? 'Access boundaries' : '角色边界'}>
            <div className="space-y-4">
              <div className="rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-2)]/45 px-4 py-4 text-sm leading-6 text-secondary-text">
                {language === 'en'
                  ? 'Signed-in users get their own manual scanner runs, shortlist details, and links into analysis or backtest without sharing history across accounts.'
                  : '登录用户只会看到自己的手动扫描结果、候选名单详情，以及通向分析或回测的个人流程，不再与其他账户共享历史。'}
              </div>
              <div className="rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-2)]/45 px-4 py-4 text-sm leading-6 text-secondary-text">
                {language === 'en'
                  ? 'Admin-only watchlists, schedules, run status, and admin history stay outside guest and regular-user scanner pages.'
                  : '管理员专属的系统观察名单、调度、运行状态与管理员历史继续保留在游客页和普通用户扫描器之外。'}
              </div>
              <div className="rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-2)]/45 px-4 py-4 text-sm leading-6 text-secondary-text">
                {language === 'en'
                  ? 'This preview explains the scanner instead of running it live, so guests cannot create shared scanner records.'
                  : '这个预览页只做说明而不执行实时运行，确保游客不会创建共享的扫描记录。'}
              </div>
            </div>
          </Card>

          <Card title={language === 'en' ? 'What unlocks after sign-in' : '登录后会解锁什么'} subtitle={language === 'en' ? 'Next step' : '下一步'}>
            <div className="space-y-3">
              <div className="rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-2)]/45 px-4 py-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[hsl(var(--accent-warning-hsl)/0.3)] bg-[hsl(var(--accent-warning-hsl)/0.14)] text-[hsl(var(--accent-warning-hsl))]">
                    <ShieldAlert className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {language === 'en' ? 'Personal scanner' : '个人扫描器'}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-text">
                      {language === 'en'
                        ? 'Run manual scans, keep your own shortlist history, and send candidates into analysis or backtest.'
                        : '执行手动扫描、保留自己的候选名单历史，并把候选直接送进分析或回测。'}
                    </p>
                  </div>
                </div>
              </div>
              <Link
                to={loginPath}
                className="inline-flex min-h-[40px] items-center justify-center rounded-[var(--theme-button-radius)] border border-transparent bg-[var(--pill-active-bg)] px-4 text-[0.75rem] text-foreground transition-colors hover:border-[var(--border-strong)]"
              >
                {language === 'en' ? 'Sign in now' : '立即登录'}
              </Link>
              <Link
                to={registrationPath}
                className="inline-flex min-h-[40px] items-center justify-center rounded-[var(--theme-button-radius)] border border-[var(--border-muted)] bg-[var(--pill-bg)] px-4 text-[0.75rem] text-secondary-text transition-colors hover:border-[var(--border-strong)] hover:text-foreground"
              >
                {language === 'en' ? 'Create account' : '创建账户'}
              </Link>
            </div>
          </Card>
        </div>
      </WorkspacePageHeader>

      <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-4">
        {LOCKED_FEATURES.map((item) => (
          <LockedFeatureCard
            key={item.title[language]}
            icon={item.icon}
            title={item.title[language]}
            body={item.body[language]}
            lockedLabel={language === 'en' ? 'Locked' : '已锁定'}
            ctaLabel={item.ctaLabel[language]}
            ctaTo={item.ctaTo === 'login' ? loginPath : item.ctaTo}
          />
        ))}
      </div>
    </div>
  );
};

export default GuestScannerPage;
