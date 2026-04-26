import type React from 'react';
import { Badge } from './Badge';
import { cn } from '../../utils/cn';

interface PillBadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'history';
  className?: string;
}

export const PillBadge: React.FC<PillBadgeProps> = ({
  children,
  variant = 'default',
  className,
}) => (
  <Badge variant={variant} className={cn('uppercase tracking-[0.12em]', className)}>
    {children}
  </Badge>
);
