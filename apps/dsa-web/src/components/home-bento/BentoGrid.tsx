import type React from 'react';
import { cn } from '../../utils/cn';

type BentoGridProps = {
  children: React.ReactNode;
  className?: string;
  testId?: string;
};

export const BentoGrid: React.FC<BentoGridProps> = ({ children, className, testId }) => (
  <div
    data-testid={testId}
    className={cn(
      'grid grid-cols-1 gap-4 xl:grid-cols-12 auto-rows-[minmax(220px,auto)]',
      className,
    )}
  >
    {children}
  </div>
);

