import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import SystemSettingsPage from '../SystemSettingsPage';

vi.mock('../SettingsPage', () => ({
  default: () => <div>settings-page-core</div>,
}));

describe('SystemSettingsPage', () => {
  it('renders the system settings surface without the legacy top admin jump nav', () => {
    render(
      <MemoryRouter initialEntries={['/settings/system']}>
        <SystemSettingsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('settings-page-core')).toBeInTheDocument();
  });
});
