import type React from 'react';
import GuestHomePage from './GuestHomePage';
import HomeBentoDashboardPage from './HomeBentoDashboardPage';
import { useProductSurface } from '../hooks/useProductSurface';

const HomeSurfacePage: React.FC = () => {
  const { isGuest } = useProductSurface();
  return isGuest ? <GuestHomePage /> : <HomeBentoDashboardPage />;
};

export default HomeSurfacePage;
