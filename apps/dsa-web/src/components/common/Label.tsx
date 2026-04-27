import React from 'react';
import { cn } from '../../utils/cn';

type LabelTone = 'default' | 'muted';
type LabelSize = 'default' | 'micro' | 'dense';
type LabelProps = React.HTMLAttributes<HTMLElement> & {
  as?: React.ElementType;
  children: React.ReactNode;
  micro?: boolean;
  size?: LabelSize;
  tone?: LabelTone;
};

const SIZE_CLASS: Record<LabelSize, string> = {
  default: 'label-uppercase',
  micro: 'text-[10px] font-semibold uppercase tracking-widest',
  dense: 'text-[11px] font-semibold uppercase tracking-[0.22em]',
};

const TONE_CLASS: Record<LabelTone, string> = {
  default: 'text-foreground',
  muted: 'text-white/40',
};

export const Label: React.FC<LabelProps> = ({
  as: Component = 'span',
  children,
  className,
  micro = false,
  size = 'default',
  tone = 'default',
  ...props
}) => {
  const resolvedSize = micro ? 'micro' : size;
  const resolvedTone = micro && tone === 'default' ? 'muted' : tone;
  return React.createElement(
    Component,
    {
      ...props,
      className: cn(SIZE_CLASS[resolvedSize], TONE_CLASS[resolvedTone], className),
    },
    children,
  );
};
