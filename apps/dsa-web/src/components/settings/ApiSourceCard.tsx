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
    className="bg-white/[0.02] backdrop-blur-2xl border border-white/5 rounded-2xl p-4"
    data-testid={testId}
  >
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-base font-semibold text-foreground">{label}</p>
        <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-muted-text">{kindLabel}</p>
      </div>
      <span className={validationTone === 'warning'
        ? 'rounded-full border border-[hsl(var(--accent-warning-hsl)/0.35)] bg-[hsl(var(--accent-warning-hsl)/0.12)] px-2.5 py-1 text-[11px] text-[hsl(var(--accent-warning-hsl))]'
        : validationTone === 'success'
          ? 'rounded-full border border-[hsl(var(--accent-positive-hsl)/0.35)] bg-[hsl(var(--accent-positive-hsl)/0.16)] px-2.5 py-1 text-[11px] text-[hsl(var(--accent-positive-hsl))]'
          : 'rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-muted-text'}
      >
        {validationLabel}
      </span>
    </div>
    <div className="mt-2 flex flex-wrap gap-1.5">
      {capabilities.map((capability) => (
        <span
          key={`${testId}-${capability}`}
          className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-secondary-text"
        >
          {capability}
        </span>
      ))}
    </div>
    <p className="mt-3 text-sm text-secondary-text">{statusText}</p>
    <p className="mt-1 text-xs text-secondary-text">{validationMessage}</p>
    <p className="mt-1 text-xs text-secondary-text">{usedByText}</p>
    <div className="mt-3 space-y-1 text-[11px] text-muted-text">
      <p>{endpointText}</p>
      <p>{internalFlagText}</p>
    </div>
    <p className="mt-3 line-clamp-3 text-[11px] text-muted-text">{description}</p>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
      <Button
        type="button"
        size="sm"
        variant="settings-secondary"
        onClick={onManage}
      >
        {manageLabel}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="settings-secondary"
        disabled={validateDisabled}
        onClick={onValidate}
      >
        {validateLabel}
      </Button>
    </div>
  </div>
);
