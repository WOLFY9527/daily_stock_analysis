import type React from 'react';
import GuestScannerPage from './GuestScannerPage';
import UserScannerPage from './UserScannerPage';
import { useProductSurface } from '../hooks/useProductSurface';

const ScannerSurfacePage: React.FC = () => {
  const { isGuest } = useProductSurface();

  if (isGuest) {
    return <GuestScannerPage />;
  }

  return <UserScannerPage />;
};

export default ScannerSurfacePage;
