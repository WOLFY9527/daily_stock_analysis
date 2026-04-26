import type React from 'react';
import { cn } from '../../utils/cn';

interface MetricCardProps {
  label: React.ReactNode;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: 'default' | 'positive' | 'warning' | 'danger';
  className?: string;
}

const TONE_CLASS: Record<NonNullable<MetricCardProps['tone']>, string> = {
  default: 'text-foreground',
  positive: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

export const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  detail,
  tone = 'default',
  className,
}) => (
  <div className={cn('theme-panel-subtle rounded-[var(--theme-panel-radius-md)] px-3.5 py-3', className)}>
    <p className="label-uppercase text-secondary-text">{label}</p>
    <p className={cn('mt-2 text-base font-medium tracking-[-0.02em]', TONE_CLASS[tone])}>{value}</p>
    {detail ? <p className="mt-2 text-sm leading-5 text-muted-text">{detail}</p> : null}
  </div>
);
