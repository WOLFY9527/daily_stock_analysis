import type React from 'react';
import { cn } from '../../utils/cn';

export const BRAND_WORDMARK_CLASSNAME =
  'text-gray-400 bg-gradient-to-b from-gray-300 to-gray-600 text-transparent bg-clip-text drop-shadow-[0_0_8px_rgba(255,255,255,0.4)]';

type BrandLogoProps = {
  className?: string;
  alt?: string;
};

export const BrandLogo: React.FC<BrandLogoProps> = ({
  className,
  alt = 'WolfyStock logo',
}) => (
  <img
    src="/wolfystock-logo-mark.svg"
    alt={alt}
    className={cn('block h-8 w-8 shrink-0 object-contain brightness-0 invert', className)}
  />
);
