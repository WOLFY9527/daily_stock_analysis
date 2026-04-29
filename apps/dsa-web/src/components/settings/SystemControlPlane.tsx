import type React from 'react';
import { Button, Disclosure, GlassCard } from '../common';
import { BentoHeroStrip, type BentoHeroItem } from '../home-bento';
import { SettingsAlert } from './SettingsAlert';
import { SettingsSectionCard } from './SettingsSectionCard';

type AdminStat = {
  key: string;
  label: string;
  value: string;
  detail: string;
};

type AdminActionDialogKey = 'runtime_cache' | 'factory_reset' | null;

type TranslateFn = (key: string, vars?: Record<string, string | number | undefined>) => string;

type SystemControlPlaneProps = {
  t: TranslateFn;
  overviewStats: BentoHeroItem[];
  globalAdminStats: AdminStat[];
  isRunningAdminAction: boolean;
  adminActionDialog: AdminActionDialogKey;
  adminActionMessage: string | null;
  adminActionTone: 'success' | 'error';
  onOpenAdminLogs: () => void;
  onSetAdminActionDialog: (value: Exclude<AdminActionDialogKey, null>) => void;
};

const SystemControlPlane: React.FC<SystemControlPlaneProps> = ({
  t,
  overviewStats,
  globalAdminStats,
  isRunningAdminAction,
  adminActionDialog,
  adminActionMessage,
  adminActionTone,
  onOpenAdminLogs,
  onSetAdminActionDialog,
}) => (
  <SettingsSectionCard
    title={t('settings.controlPlaneTitle')}
    description={t('settings.controlPlaneDesc')}
  >
    <div className="space-y-4">
      <BentoHeroStrip items={overviewStats} testId="settings-bento-hero" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.95fr)]">
      <GlassCard className="px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--accent-positive-hsl))]">
              {t('settings.adminSurfaceActiveLabel')}
            </p>
            <p className="mt-1 text-base font-semibold text-foreground">{t('settings.adminSurfaceActiveTitle')}</p>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-secondary-text">{t('settings.adminSurfaceActiveDesc')}</p>
          </div>
          <span className="rounded-full border border-[hsl(var(--accent-positive-hsl)/0.36)] bg-[hsl(var(--accent-positive-hsl)/0.12)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--accent-positive-hsl))]">
            {t('settings.adminSurfaceGlobalScope')}
          </span>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {globalAdminStats.map((item) => (
            <div key={item.key} className="rounded-xl bg-white/[0.03] px-3 py-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-muted-text">{item.label}</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{item.value}</p>
              <p className="mt-2 text-xs leading-5 text-secondary-text">{item.detail}</p>
            </div>
          ))}
        </div>
      </GlassCard>

      <Disclosure
        summary={(
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--accent-warning-hsl))]">
                {t('settings.controlPlaneMaintenanceTitle')}
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">{t('settings.controlPlaneMaintenanceSummary')}</p>
              <p className="mt-2 text-xs leading-5 text-secondary-text">{t('settings.controlPlaneMaintenanceDesc')}</p>
            </div>
            <span className="rounded-full border border-[hsl(var(--accent-warning-hsl)/0.3)] bg-[hsl(var(--accent-warning-hsl)/0.12)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--accent-warning-hsl))]">
              {t('settings.controlPlaneMaintenanceBadge')}
            </span>
          </div>
        )}
        className="rounded-2xl border border-white/5 bg-white/[0.02]"
        summaryClassName="px-4 py-4"
        bodyClassName="space-y-4 px-4 pb-4"
      >
        <GlassCard className="px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground">{t('settings.controlPlaneLogsTitle')}</p>
          <p className="mt-2 text-sm leading-6 text-secondary-text">{t('settings.controlPlaneLogsDesc')}</p>
          <div className="mt-4 flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="settings-secondary"
              onClick={onOpenAdminLogs}
            >
              {t('settings.viewAdminLogs')}
            </Button>
          </div>
        </GlassCard>

        <div className="rounded-2xl bg-[hsl(var(--accent-warning-hsl)/0.08)] px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--accent-warning-hsl))]">
                {t('settings.adminActionsTitle')}
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">{t('settings.adminActionsDesc')}</p>
              <p className="mt-2 text-xs leading-5 text-secondary-text">{t('settings.adminActionsSafetyDesc')}</p>
            </div>
          </div>
          <div className="mt-4 divide-y divide-white/5 rounded-2xl bg-white/[0.03]">
            <div className="px-3 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{t('settings.adminMaintenanceTitle')}</p>
                  <p className="mt-1 text-xs leading-5 text-secondary-text">{t('settings.adminMaintenanceDesc')}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="settings-secondary"
                  onClick={() => onSetAdminActionDialog('runtime_cache')}
                  disabled={isRunningAdminAction}
                >
                  {isRunningAdminAction && adminActionDialog === 'runtime_cache'
                    ? t('settings.saving')
                    : t('settings.adminActionResetRuntimeCaches')}
                </Button>
              </div>
              <p className="mt-3 text-xs text-secondary-text">{t('settings.adminActionResetRuntimeCachesHint')}</p>
            </div>
            <div className="px-3 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{t('settings.adminFactoryResetTitle')}</p>
                  <p className="mt-1 text-xs leading-5 text-secondary-text">{t('settings.adminFactoryResetDesc')}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="danger-subtle"
                  onClick={() => onSetAdminActionDialog('factory_reset')}
                  disabled={isRunningAdminAction}
                >
                  {isRunningAdminAction && adminActionDialog === 'factory_reset'
                    ? t('settings.saving')
                    : t('settings.adminActionFactoryReset')}
                </Button>
              </div>
              <p className="mt-3 text-xs text-[hsl(var(--accent-danger-hsl))]">{t('settings.adminActionFactoryResetHint')}</p>
            </div>
          </div>
          {adminActionMessage ? (
            <div className="mt-3">
              <span className="sr-only">
                {(adminActionTone === 'success' ? t('settings.success') : t('settings.adminActionErrorTitle'))}:{adminActionMessage}
              </span>
              <SettingsAlert
                title={adminActionTone === 'success' ? t('settings.success') : t('settings.adminActionErrorTitle')}
                message={adminActionMessage}
                variant={adminActionTone === 'success' ? 'success' : 'error'}
              />
            </div>
          ) : null}
        </div>
      </Disclosure>
      </div>
    </div>
  </SettingsSectionCard>
);

export default SystemControlPlane;
