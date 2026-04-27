import type React from 'react';
import { Button, GlassCard } from '../common';
import { ApiSourceCard } from './ApiSourceCard';
import { SettingsSectionCard } from './SettingsSectionCard';

type TranslateFn = (key: string, vars?: Record<string, string | number | undefined>) => string;
type DataRouteKey = 'market' | 'fundamentals' | 'news' | 'sentiment';
type DataSourceValidationState = 'not_configured' | 'configured_pending' | 'validated' | 'failed' | 'builtin';

type DataRoutingGroup = {
  key: DataRouteKey;
  role: string;
  values: string[];
  available: string[];
};

type DataSourceLibraryEntry = {
  key: string;
  label: string;
  builtin: boolean;
  configured: boolean;
  usable: boolean;
  validationState: DataSourceValidationState;
  validationMessage: string;
  routeUsage: DataRouteKey[];
  capabilityLabels: string[];
  description: string;
};

type DataSourceConfigProps = {
  t: TranslateFn;
  dataRoutingGroups: DataRoutingGroup[];
  dataSourceLibrary: DataSourceLibraryEntry[];
  adminLocked: boolean;
  isSaving: boolean;
  prettySourceLabel: (value: string) => string;
  sourceToneClass: (index: number) => string;
  priorityLabel: (index: number) => string;
  onOpenDataRoutingDrawer: (key: DataRouteKey) => void;
  onOpenCreateDataSourceDrawer: () => void;
  onOpenEditDataSourceDrawer: (sourceId: string) => void;
  onValidateDataSource: (sourceId: string) => void;
};

const DataSourceConfig: React.FC<DataSourceConfigProps> = ({
  t,
  dataRoutingGroups,
  dataSourceLibrary,
  adminLocked,
  isSaving,
  prettySourceLabel,
  sourceToneClass,
  priorityLabel,
  onOpenDataRoutingDrawer,
  onOpenCreateDataSourceDrawer,
  onOpenEditDataSourceDrawer,
  onValidateDataSource,
}) => (
  <SettingsSectionCard
    title={t('settings.dataEffectiveTitle')}
    description={t('settings.dataEffectiveDesc')}
  >
    <div className="space-y-3">
      <GlassCard className="px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-secondary-text">
              {t('settings.dataRoutingLayerTitle')}
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground">{t('settings.dataRoutingCompactTitle')}</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {dataRoutingGroups.map((group) => (
            <div key={group.role} className="rounded-2xl bg-white/[0.02] p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">{group.role}</p>
                  <span className="rounded-full bg-white/[0.04] px-2.5 py-1 text-[11px] text-secondary-text">
                    {group.values.length ? t('settings.configuredNoPriority') : t('settings.notConfigured')}
                  </span>
                </div>
                <p className="mt-2 break-words text-sm font-semibold text-foreground">
                  {group.values.length
                    ? group.values.map((source) => prettySourceLabel(source)).join(' -> ')
                    : t('settings.notConfigured')}
                </p>
                {group.values.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {group.values.map((source, index) => (
                      <span
                        key={`${group.role}-${source}-${index}`}
                        className="rounded-full bg-white/[0.04] px-2.5 py-1 text-[11px] text-secondary-text"
                      >
                        <span className={sourceToneClass(index)}>{priorityLabel(index)}</span>
                        {' · '}
                        {prettySourceLabel(source)}
                      </span>
                    ))}
                  </div>
                ) : null}
                <p className="mt-2 text-xs text-secondary-text">
                  {group.available.length
                    ? group.available.map((source) => prettySourceLabel(source)).join(' · ')
                    : t('settings.dataSourceNotRouted')}
                </p>
              </div>
              <div className="mt-4 flex items-center justify-between gap-2">
                <p className="text-[11px] leading-5 text-muted-text">
                  {group.available.length
                    ? t('settings.dataRoutingSelectableCount', { count: group.available.length })
                    : t('settings.dataSourceNoUsableSources')}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="settings-secondary"
                  disabled={adminLocked || isSaving || group.available.length === 0}
                  data-testid={`data-routing-manage-${group.key}`}
                  onClick={() => onOpenDataRoutingDrawer(group.key)}
                >
                  {t('settings.dataSourceManageAction')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      <GlassCard className="px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-secondary-text">
              {t('settings.dataLibraryLayerTitle')}
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground">{t('settings.dataSourceLibraryCompactTitle')}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="settings-primary"
            onClick={onOpenCreateDataSourceDrawer}
          >
            {t('settings.dataSourceAddAction')}
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {dataSourceLibrary.map((source) => (
            <ApiSourceCard
              key={source.key}
              testId={`data-source-card-${source.key}`}
              label={source.label}
              kindLabel={source.builtin ? t('settings.dataSourceBuiltinKind') : t('settings.dataSourceCustomKind')}
              validationLabel={source.validationState === 'builtin'
                ? t('settings.dataSourceValidationBuiltin')
                : source.validationState === 'validated'
                  ? t('settings.dataSourceValidated')
                  : source.validationState === 'failed'
                    ? t('settings.dataSourceValidationFailed')
                    : source.configured
                      ? t('settings.dataSourceConfiguredPending')
                      : t('settings.notConfigured')}
              validationTone={source.validationState === 'failed'
                ? 'warning'
                : source.validationState === 'validated'
                  ? 'success'
                  : 'default'}
              capabilities={source.capabilityLabels}
              statusText={source.configured
                ? t('settings.dataSourceStatusConfigured')
                : t('settings.dataSourceStatusMissing')}
              validationMessage={source.validationMessage}
              usedByText={`${t('settings.dataSourceUsedByLabel')}: ${source.routeUsage.length
                ? source.routeUsage.map((routeKey) => t(`settings.dataRouteName.${routeKey}`)).join(' · ')
                : t('settings.dataSourceNotRouted')}`}
              endpointText={`${t('settings.dataSourceEndpointNameLabel')}: ${source.key}`}
              internalFlagText={`${t('settings.dataSourceInternalFlagLabel')}: ${source.builtin
                ? t('settings.dataSourceInternalFlagBuiltin')
                : t('settings.dataSourceInternalFlagExternal')}`}
              description={source.description}
              manageLabel={source.builtin ? t('settings.dataSourceManageAction') : t('settings.dataSourceEditAction')}
              validateLabel={t('settings.dataSourceValidateAction')}
              validateDisabled={!source.usable}
              onManage={() => onOpenEditDataSourceDrawer(source.key)}
              onValidate={() => onValidateDataSource(source.key)}
            />
          ))}
        </div>
      </GlassCard>
    </div>
  </SettingsSectionCard>
);

export default DataSourceConfig;
