import type React from 'react';
import { Button } from '../common';
import { SettingsSectionCard } from './SettingsSectionCard';

const GLASS_SUBCARD_CLASS = 'rounded-2xl bg-white/[0.015] px-4 py-4';

type TranslateFn = (key: string, vars?: Record<string, string | number | undefined>) => string;

type SystemLogsConfigProps = {
  t: TranslateFn;
  showRuntimeExecutionSummary: boolean;
  adminLocked: boolean;
  isSaving: boolean;
  onOpenRuntimeVisibilityDrawer: () => void;
};

const SystemLogsConfig: React.FC<SystemLogsConfigProps> = ({
  t,
  showRuntimeExecutionSummary,
  adminLocked,
  isSaving,
  onOpenRuntimeVisibilityDrawer,
}) => (
  <SettingsSectionCard
    title={t('settings.runtimeSummaryVisibilityTitle')}
    description={t('settings.runtimeSummaryVisibilityDesc')}
  >
    <div className={GLASS_SUBCARD_CLASS}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {showRuntimeExecutionSummary ? t('settings.runtimeSummaryVisibleOn') : t('settings.runtimeSummaryVisibleOff')}
          </p>
          <p className="mt-1 text-xs text-secondary-text">{t('settings.runtimeSummaryVisibilityDesc')}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="settings-secondary"
          onClick={onOpenRuntimeVisibilityDrawer}
          disabled={adminLocked || isSaving}
        >
          {t('settings.dataSourceManageAction')}
        </Button>
      </div>
    </div>
  </SettingsSectionCard>
);

export default SystemLogsConfig;
