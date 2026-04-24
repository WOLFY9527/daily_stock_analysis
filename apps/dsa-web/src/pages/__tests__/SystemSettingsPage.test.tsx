import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import SystemSettingsPage from '../SystemSettingsPage';

vi.mock('../../components/layout/AdminNav', () => ({
  AdminNav: () => <div>admin-nav</div>,
}));

vi.mock('../SettingsPage', () => ({
  default: () => <div>settings-page-core</div>,
}));

describe('SystemSettingsPage', () => {
  it('renders the admin navigation above the system settings surface', () => {
    render(
      <MemoryRouter initialEntries={['/settings/system']}>
        <SystemSettingsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('admin-nav')).toBeInTheDocument();
    expect(screen.getByText('settings-page-core')).toBeInTheDocument();
  });
});
