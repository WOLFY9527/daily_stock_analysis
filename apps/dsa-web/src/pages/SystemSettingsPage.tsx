import type React from 'react';
import { AdminNav } from '../components/layout/AdminNav';
import SettingsPage from './SettingsPage';

const SystemSettingsPage: React.FC = () => {
  return (
    <div className="space-y-6">
      <AdminNav />
      <SettingsPage />
    </div>
  );
};

export default SystemSettingsPage;
