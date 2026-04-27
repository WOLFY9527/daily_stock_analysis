import type React from 'react';
import { AuthGuardPlaceholder } from '../components/access/AuthGuardPlaceholder';
import UserScannerPage from './UserScannerPage';
import { useI18n } from '../contexts/UiLanguageContext';
import { useProductSurface } from '../hooks/useProductSurface';

const ScannerSurfacePage: React.FC = () => {
  const { isGuest } = useProductSurface();
  const { language } = useI18n();

  if (isGuest) {
    return <AuthGuardPlaceholder moduleName={language === 'en' ? 'Market Scanner' : '全市场扫描仪'} />;
  }

  return <UserScannerPage />;
};

export default ScannerSurfacePage;
