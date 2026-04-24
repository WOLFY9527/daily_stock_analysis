import type React from 'react';
import { cn } from '../../utils/cn';
import { BENTO_GRID_ROOT_CLASS } from './theme';

type BentoGridProps = {
  children: React.ReactNode;
  className?: string;
  testId?: string;
};

export const BentoGrid: React.FC<BentoGridProps> = ({ children, className, testId }) => (
  <div
    data-testid={testId}
    data-bento-grid="true"
    className={cn(
      BENTO_GRID_ROOT_CLASS,
      'grid grid-cols-1 gap-4 xl:grid-cols-12 auto-rows-[minmax(220px,auto)]',
      className,
    )}
  >
    {children}
  </div>
);
