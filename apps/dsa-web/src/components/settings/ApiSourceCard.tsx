import type React from 'react';
import { Button } from '../common';

type ApiSourceCardProps = {
  testId: string;
  label: string;
  kindLabel: string;
  validationLabel: string;
  validationTone: 'default' | 'success' | 'warning';
  capabilities: string[];
  statusText: string;
  validationMessage: string;
  usedByText: string;
  description: string;
  endpointText: string;
  internalFlagText: string;
  manageLabel: string;
  validateLabel: string;
  validateDisabled?: boolean;
  onManage: () => void;
  onValidate: () => void;
};

const CONTROL_GHOST_BUTTON_CLASS = 'px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/10 hover:bg-white/10 text-xs transition-colors';
const GHOST_TAG_CLASS = 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] uppercase tracking-widest font-bold bg-white/5 text-white/40 border border-white/5';

export const ApiSourceCard: React.FC<ApiSourceCardProps> = ({
  testId,
  label,
  kindLabel,
  validationLabel,
  validationTone,
  capabilities,
  statusText,
  validationMessage,
  usedByText,
  description,
  endpointText,
  internalFlagText,
  manageLabel,
  validateLabel,
  validateDisabled = false,
  onManage,
  onValidate,
}) => (
  <div
    className="h-fit rounded-xl bg-white/[0.015] p-3"
    data-testid={testId}
  >
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-white/5 pb-2.5">
      <div className="min-w-0">
        <p className="text-base font-semibold text-foreground">{label}</p>
        <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-muted-text">{kindLabel}</p>
      </div>
      <span className={GHOST_TAG_CLASS} data-tone={validationTone}>
        {validationLabel}
      </span>
    </div>
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {capabilities.map((capability) => (
        <span
          key={`${testId}-${capability}`}
          className={GHOST_TAG_CLASS}
        >
          {capability}
        </span>
      ))}
    </div>
    <div className="mt-2.5 space-y-1 text-sm text-secondary-text">
      <p>{statusText}</p>
      <p className="text-xs">{validationMessage}</p>
      <p className="text-xs">{usedByText}</p>
    </div>
    <div className="mt-2.5 space-y-1 border-t border-white/5 pt-2.5 text-[11px] text-muted-text">
      <p>{endpointText}</p>
      <p>{internalFlagText}</p>
    </div>
    <p className="mt-2.5 line-clamp-2 border-t border-white/5 pt-2.5 text-[11px] text-muted-text">{description}</p>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-2.5">
      <Button
        type="button"
        size="sm"
        variant="settings-secondary"
        className={CONTROL_GHOST_BUTTON_CLASS}
        onClick={onManage}
      >
        {manageLabel}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="settings-secondary"
        className={CONTROL_GHOST_BUTTON_CLASS}
        disabled={validateDisabled}
        onClick={onValidate}
      >
        {validateLabel}
      </Button>
    </div>
  </div>
);
