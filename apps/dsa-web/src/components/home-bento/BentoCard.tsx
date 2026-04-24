import type React from 'react';
import { cn } from '../../utils/cn';
import { CARD_KICKER_CLASS, type SignalTone, getCardGlowClass } from './theme';

type BentoCardProps = {
  eyebrow: string;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  tone?: SignalTone;
  accentGlow?: boolean;
  testId?: string;
};

export const BentoCard: React.FC<BentoCardProps> = ({
  eyebrow,
  title,
  subtitle,
  action,
  children,
  className,
  contentClassName,
  tone = 'neutral',
  accentGlow = false,
  testId,
}) => (
  <section
    data-testid={testId}
    className={cn(
      'group relative overflow-hidden rounded-[36px] border border-white/[0.08] bg-white/[0.02] p-6 backdrop-blur-xl transition-transform duration-200 ease-out hover:-translate-y-[2px] sm:p-8',
      className,
    )}
  >
    {accentGlow && tone !== 'neutral' ? (
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute right-[-3rem] top-[-3rem] h-40 w-40 rounded-full blur-[72px]',
          getCardGlowClass(tone),
        )}
      />
    ) : null}
    <div className={cn('relative z-10 flex h-full flex-col', contentClassName)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={CARD_KICKER_CLASS}>{eyebrow}</p>
          {title ? <h2 className="mt-3 text-lg font-semibold text-white">{title}</h2> : null}
          {subtitle ? <p className="mt-2 text-sm leading-6 text-white/58">{subtitle}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="relative z-10 mt-5 flex-1">{children}</div>
    </div>
  </section>
);
