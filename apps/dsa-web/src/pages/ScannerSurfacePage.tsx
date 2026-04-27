import type React from 'react';
import { AuthGuardOverlay } from '../components/auth/AuthGuardOverlay';
import UserScannerPage from './UserScannerPage';
import { useI18n } from '../contexts/UiLanguageContext';
import { useProductSurface } from '../hooks/useProductSurface';

const ScannerSurfacePage: React.FC = () => {
  const { isGuest } = useProductSurface();
  const { language } = useI18n();

  if (isGuest) {
    return (
      <main className="flex-1 flex flex-col relative w-full h-full">
        <AuthGuardOverlay moduleName={language === 'en' ? 'Market Scanner' : '全市场扫描仪'} />
      </main>
    );
  }

  return <UserScannerPage />;
};

export default ScannerSurfacePage;
