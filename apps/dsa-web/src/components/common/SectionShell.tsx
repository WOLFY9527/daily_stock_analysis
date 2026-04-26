import type React from 'react';
import { cn } from '../../utils/cn';

interface SectionShellProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  headerClassName?: string;
}

export const SectionShell: React.FC<SectionShellProps> = ({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
  headerClassName,
}) => (
  <section className={cn('theme-panel-glass theme-card-surface rounded-[var(--theme-panel-radius-lg)] px-4 py-4 md:px-5 md:py-5', className)}>
    {(title || description || actions) ? (
      <div className={cn('mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', headerClassName)}>
        <div className="min-w-0 space-y-1.5">
          {title ? <h2 className="text-[1.05rem] font-normal tracking-[-0.02em] text-foreground md:text-[1.15rem]">{title}</h2> : null}
          {description ? <p className="text-sm leading-6 text-muted-text">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div> : null}
      </div>
    ) : null}
    <div className={cn('space-y-4', contentClassName)}>{children}</div>
  </section>
);
