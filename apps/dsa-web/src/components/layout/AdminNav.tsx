import type React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useI18n } from '../../contexts/UiLanguageContext';
import { useProductSurface } from '../../hooks/useProductSurface';
import { buildLocalizedPath, parseLocaleFromPathname } from '../../utils/localeRouting';
import { cn } from '../../utils/cn';

type AdminNavProps = {
  className?: string;
};

export const AdminNav: React.FC<AdminNavProps> = ({ className = '' }) => {
  const location = useLocation();
  const { t } = useI18n();
  const { isAdmin } = useProductSurface();

  if (!isAdmin) {
    return null;
  }

  const locale = parseLocaleFromPathname(location.pathname);
  const localizePath = (path: string) => (locale ? buildLocalizedPath(path, locale) : path);

  return (
    <section className={cn('theme-panel-solid rounded-[var(--theme-panel-radius-lg)] p-4 md:p-5', className)} data-testid="admin-nav">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-secondary-text">{t('adminNav.eyebrow')}</p>
          <h2 className="text-[1.05rem] font-medium tracking-[-0.02em] text-foreground">{t('adminNav.title')}</h2>
          <p className="text-sm leading-6 text-muted-text">{t('adminNav.description')}</p>
        </div>
        <nav className="flex flex-wrap gap-2" aria-label={t('adminNav.title')}>
          <NavLink
            to={localizePath('/settings/system')}
            end
            className={({ isActive }) => cn(
              'inline-flex min-h-[38px] items-center justify-center rounded-[var(--theme-button-radius)] border px-3 text-[0.75rem] transition-colors',
              isActive
                ? 'border-[var(--border-strong)] bg-[var(--pill-active-bg)] text-foreground'
                : 'border-[var(--border-muted)] bg-[var(--pill-bg)] text-secondary-text hover:border-[var(--border-strong)] hover:text-foreground',
            )}
          >
            {t('nav.independentConsole')}
          </NavLink>
          <NavLink
            to={localizePath('/admin/logs')}
            className={({ isActive }) => cn(
              'inline-flex min-h-[38px] items-center justify-center rounded-[var(--theme-button-radius)] border px-3 text-[0.75rem] transition-colors',
              isActive
                ? 'border-[var(--border-strong)] bg-[var(--pill-active-bg)] text-foreground'
                : 'border-[var(--border-muted)] bg-[var(--pill-bg)] text-secondary-text hover:border-[var(--border-strong)] hover:text-foreground',
            )}
          >
            {t('adminNav.logs')}
          </NavLink>
        </nav>
      </div>
    </section>
  );
};
