import type React from 'react';
import type { RefObject } from 'react';
import { Button } from '../common';
import { SettingsSectionCard } from './SettingsSectionCard';

type TranslateFn = (key: string, vars?: Record<string, string | number | undefined>) => string;
type QuickProviderKey = 'aihubmix' | 'gemini' | 'openai' | 'anthropic' | 'deepseek' | 'zhipu';
type QuickProviderTestStatus = 'idle' | 'loading' | 'success' | 'error';

type AiRouteRow = {
  key: string;
  title: string;
  routeMode: string;
  route: string;
  backup: string;
  summary: string;
  actionLabel: string;
  highlighted: boolean;
};

type ProviderCard = {
  key: QuickProviderKey;
  label: string;
  isReady: boolean;
  presetCount: number;
  quickApiConfigured: boolean;
  advancedChannelCount: number;
  suggestedTestModel: string;
  quickTestStatus: QuickProviderTestStatus;
  quickTestText: string;
};

type AIProviderConfigProps = {
  t: TranslateFn;
  aiRoutingScope: string;
  aiRouteRows: AiRouteRow[];
  configuredProvidersText: string;
  routeStatus: string;
  routeMissingButApiConfigured: boolean;
  selectorReadinessMismatch: boolean;
  aiRoutingError: string | null;
  providerCards: ProviderCard[];
  aiChannelConfigRef: RefObject<HTMLDivElement | null>;
  adminLocked: boolean;
  isSaving: boolean;
  onOpenAiRoutingDrawer: () => void;
  onOpenQuickProviderDrawer: (provider: QuickProviderKey) => void;
  onJumpToProviderAdvancedConfig: (provider: QuickProviderKey) => void;
  onSaveDirectProviderKeys: () => void;
  onJumpToAiChannelConfig: () => void;
};

const CONTROL_GHOST_BUTTON_CLASS = 'px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/10 hover:bg-white/10 text-xs transition-colors';
const GHOST_TAG_CLASS = 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] uppercase tracking-widest font-bold bg-white/5 text-white/40 border border-white/5';

const AIProviderConfig: React.FC<AIProviderConfigProps> = ({
  t,
  aiRoutingScope,
  aiRouteRows,
  configuredProvidersText,
  routeStatus,
  routeMissingButApiConfigured,
  selectorReadinessMismatch,
  aiRoutingError,
  providerCards,
  aiChannelConfigRef,
  adminLocked,
  isSaving,
  onOpenAiRoutingDrawer,
  onOpenQuickProviderDrawer,
  onJumpToProviderAdvancedConfig,
  onSaveDirectProviderKeys,
  onJumpToAiChannelConfig,
}) => (
  <SettingsSectionCard
    title={t('settings.aiAnalysisRouteTitle')}
    description={t('settings.aiEffectiveDesc')}
  >
    <div className="space-y-3">
      <div className="settings-surface rounded-[var(--theme-panel-radius-md)] border settings-border px-4 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-secondary-text">{t('settings.aiHierarchyTaskTitle')}</p>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="mt-1 text-xs text-secondary-text">
              {t('settings.aiRouteScopeLabel')}: {t(`settings.aiRouteScope.${aiRoutingScope}`)}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {routeMissingButApiConfigured ? (
              <span className={GHOST_TAG_CLASS}>
                {t('settings.aiConfiguredNoRoute')}
              </span>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="settings-secondary"
              className={CONTROL_GHOST_BUTTON_CLASS}
              onClick={onOpenAiRoutingDrawer}
              disabled={adminLocked || isSaving}
            >
              {t('settings.aiRoutingDrawerOpen')}
            </Button>
          </div>
        </div>
        {selectorReadinessMismatch ? (
          <p className="mt-2 rounded-lg border border-[hsl(var(--accent-warning-hsl)/0.4)] bg-[hsl(var(--accent-warning-hsl)/0.12)] px-3 py-2 text-xs text-[hsl(var(--accent-warning-hsl))]">
            {t('settings.aiGatewaySelectorMismatchWarning')}
          </p>
        ) : null}
        <div className="mt-3 space-y-2" data-testid="ai-effective-summary">
          {aiRouteRows.map((routeRow) => (
            <div
              key={routeRow.key}
              data-testid={`ai-task-row-${routeRow.key}`}
              className={routeRow.highlighted
                ? 'flex items-start gap-3 rounded-2xl border border-[var(--border-strong)] bg-[var(--pill-active-bg)]/35 px-3 py-3'
                : 'flex items-start gap-3 rounded-2xl border border-border/50 bg-base/40 px-3 py-3'}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">{routeRow.title}</p>
                  <span className={GHOST_TAG_CLASS}>
                    {routeRow.routeMode}
                  </span>
                </div>
                <p className="mt-2 break-words text-sm font-semibold text-foreground">{routeRow.route}</p>
                {routeRow.backup ? (
                  <p className="mt-1 break-words text-xs text-secondary-text">
                    {t('settings.aiBackupRoute')}: {routeRow.backup}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-secondary-text">{routeRow.summary}</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="settings-secondary"
                className={CONTROL_GHOST_BUTTON_CLASS}
                onClick={onOpenAiRoutingDrawer}
                disabled={adminLocked || isSaving}
              >
                {routeRow.actionLabel}
              </Button>
            </div>
          ))}
          <div className="px-1 pt-1 text-xs text-secondary-text">
            {t('settings.aiConfiguredProviders')}: {configuredProvidersText}
          </div>
          <div className="px-1 text-xs text-secondary-text">
            {t('settings.aiRouteStatusLabel')}: {routeStatus}
          </div>
        </div>
        {aiRoutingError ? (
          <p className="mt-2 rounded-lg border border-[hsl(var(--accent-warning-hsl)/0.4)] bg-[hsl(var(--accent-warning-hsl)/0.12)] px-3 py-2 text-xs text-[hsl(var(--accent-warning-hsl))]">
            {aiRoutingError}
          </p>
        ) : null}
      </div>

      <div className="settings-surface rounded-xl border settings-border px-4 py-4" data-testid="ai-provider-quick-section">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-secondary-text">{t('settings.aiHierarchyProviderTitle')}</p>
        <p className="mt-1 text-sm font-semibold text-foreground">{t('settings.aiDirectProviderTitle')}</p>
        <div className="mt-3 grid grid-cols-1 items-start gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {providerCards.map((provider) => (
            <div
              key={provider.key}
              className="h-fit rounded-xl bg-white/[0.02] px-3 py-3"
              data-testid={`ai-provider-card-${provider.key}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">{provider.label}</p>
                <span className={GHOST_TAG_CLASS} data-ready={provider.isReady ? 'true' : 'false'}>
                  {provider.isReady ? t('settings.aiProviderReady') : t('settings.aiProviderMissingCredential')}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-text">
                {t('settings.aiPresetModels')}: {provider.presetCount}
              </p>
              <p className="mt-1 text-[11px] text-secondary-text">
                {t('settings.aiProviderQuickApiStatusLabel')}: {provider.quickApiConfigured ? t('settings.enabledState') : t('settings.disabledState')}
                {' · '}
                {t('settings.aiProviderAdvancedChannelCountLabel')}: {provider.advancedChannelCount}
              </p>
              <p className="mt-1 text-[11px] text-muted-text">
                {t('settings.aiProviderTestModelLabel')}: {provider.suggestedTestModel || t('settings.aiProviderTestModelMissing')}
              </p>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="settings-secondary"
                  className={CONTROL_GHOST_BUTTON_CLASS}
                  onClick={() => onOpenQuickProviderDrawer(provider.key)}
                  disabled={adminLocked || isSaving}
                >
                  {t('settings.aiProviderQuickSetupOpen')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="settings-secondary"
                  className={CONTROL_GHOST_BUTTON_CLASS}
                  onClick={() => onJumpToProviderAdvancedConfig(provider.key)}
                  disabled={adminLocked || isSaving}
                >
                  {t('settings.aiDirectProviderAdvancedEntryForProvider', { provider: provider.label })}
                </Button>
              </div>
              {provider.quickTestStatus !== 'idle' ? (
                <p className={provider.quickTestStatus === 'success'
                  ? 'mt-2 text-xs text-[hsl(var(--accent-positive-hsl))]'
                  : provider.quickTestStatus === 'error'
                    ? 'mt-2 text-xs text-[hsl(var(--accent-warning-hsl))]'
                    : 'mt-2 text-xs text-muted-text'}
                >
                  {provider.quickTestText}
                </p>
              ) : null}
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="settings-primary"
            onClick={onSaveDirectProviderKeys}
            disabled={adminLocked || isSaving}
          >
            {t('settings.aiDirectProviderSave')}
          </Button>
        </div>
      </div>

      <div ref={aiChannelConfigRef} className="rounded-[var(--theme-panel-radius-md)] border border-border/40 bg-muted/10 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-text">{t('settings.aiHierarchyAdvancedTitle')}</p>
            <p className="mt-1 text-sm font-semibold text-secondary-text">{t('settings.aiAdvancedChannelLayerTitle')}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="settings-secondary"
            className={CONTROL_GHOST_BUTTON_CLASS}
            onClick={onJumpToAiChannelConfig}
            disabled={adminLocked || isSaving}
          >
            {t('settings.aiAdvancedJump')}
          </Button>
        </div>
      </div>
    </div>
  </SettingsSectionCard>
);

export default AIProviderConfig;
