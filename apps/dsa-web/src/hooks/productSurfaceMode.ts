export type AdminSurfaceMode = 'user' | 'admin';

export const ADMIN_SURFACE_MODE_STORAGE_KEY = 'dsa-admin-surface-mode';

let adminSurfaceModeSnapshot: AdminSurfaceMode = 'user';
const adminSurfaceModeListeners = new Set<() => void>();

export function getAdminSurfaceModeSnapshot(): AdminSurfaceMode {
  return adminSurfaceModeSnapshot;
}

export function getAdminSurfaceModeServerSnapshot(): AdminSurfaceMode {
  return 'user';
}

export function subscribeAdminSurfaceMode(listener: () => void): () => void {
  adminSurfaceModeListeners.add(listener);
  return () => {
    adminSurfaceModeListeners.delete(listener);
  };
}

function readStoredAdminSurfaceMode(): AdminSurfaceMode {
  if (typeof window === 'undefined') {
    return 'user';
  }
  const stored = window.sessionStorage.getItem(ADMIN_SURFACE_MODE_STORAGE_KEY);
  return stored === 'admin' ? 'admin' : 'user';
}

function notifyAdminSurfaceModeListeners(): void {
  adminSurfaceModeListeners.forEach((listener) => listener());
}

function publishAdminSurfaceMode(nextMode: AdminSurfaceMode): void {
  adminSurfaceModeSnapshot = nextMode;
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem(ADMIN_SURFACE_MODE_STORAGE_KEY, nextMode);
  }
  notifyAdminSurfaceModeListeners();
}

export function setAdminSurfaceMode(mode: AdminSurfaceMode): void {
  const normalizedMode: AdminSurfaceMode = mode === 'admin' ? 'admin' : 'user';
  if (normalizedMode === adminSurfaceModeSnapshot) {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(ADMIN_SURFACE_MODE_STORAGE_KEY, normalizedMode);
    }
    return;
  }
  publishAdminSurfaceMode(normalizedMode);
}

export function resetAdminSurfaceMode(): void {
  adminSurfaceModeSnapshot = 'user';
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(ADMIN_SURFACE_MODE_STORAGE_KEY);
  }
  notifyAdminSurfaceModeListeners();
}

export function syncAdminSurfaceModeFromStorage(newValue: string | null): void {
  adminSurfaceModeSnapshot = newValue === 'admin' ? 'admin' : 'user';
  notifyAdminSurfaceModeListeners();
}

if (typeof window !== 'undefined') {
  adminSurfaceModeSnapshot = readStoredAdminSurfaceMode();
}
