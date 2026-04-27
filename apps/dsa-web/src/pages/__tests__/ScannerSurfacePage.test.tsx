import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ScannerSurfacePage from '../ScannerSurfacePage';

const { useProductSurfaceMock } = vi.hoisted(() => ({
  useProductSurfaceMock: vi.fn(),
}));

vi.mock('../../hooks/useProductSurface', () => ({
  useProductSurface: () => useProductSurfaceMock(),
}));

vi.mock('../../components/auth/AuthGuardOverlay', () => ({
  AuthGuardOverlay: ({ moduleName }: { moduleName: string }) => <div>{`auth-guard:${moduleName}`}</div>,
}));

vi.mock('../UserScannerPage', () => ({
  default: () => <div>user scanner page</div>,
}));

describe('ScannerSurfacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the auth guard placeholder for guests on scanner', () => {
    useProductSurfaceMock.mockReturnValue({ isGuest: true, isAdminMode: false });
    render(<ScannerSurfacePage />);
    expect(screen.getByText('auth-guard:全市场扫描仪')).toBeInTheDocument();
  });

  it('renders user scanner surface for normal signed-in users', () => {
    useProductSurfaceMock.mockReturnValue({ isGuest: false, isAdminMode: false });
    render(<ScannerSurfacePage />);
    expect(screen.getByText('user scanner page')).toBeInTheDocument();
  });

  it('renders the normal user scanner surface for admin accounts too', () => {
    useProductSurfaceMock.mockReturnValue({ isGuest: false, isAdmin: true });
    render(<ScannerSurfacePage />);
    expect(screen.getByText('user scanner page')).toBeInTheDocument();
  });
});
