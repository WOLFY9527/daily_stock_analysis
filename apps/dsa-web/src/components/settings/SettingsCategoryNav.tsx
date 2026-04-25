import type React from 'react';
import { useI18n } from '../../contexts/UiLanguageContext';
import { getCategoryTitle } from '../../utils/systemConfigI18n';
import type { SystemConfigCategorySchema, SystemConfigItem } from '../../types/systemConfig';
import { cn } from '../../utils/cn';

interface SettingsCategoryNavProps {
  categories: SystemConfigCategorySchema[];
  itemsByCategory: Record<string, SystemConfigItem[]>;
  activeCategory: string;
  onSelect: (category: string) => void;
  disabled?: boolean;
  hideHeader?: boolean;
}

export const SettingsCategoryNav: React.FC<SettingsCategoryNavProps> = ({
  categories,
  itemsByCategory,
  activeCategory,
  onSelect,
  disabled = false,
  hideHeader = false,
}) => {
  const { language, t } = useI18n();
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02] backdrop-blur-2xl">
      {!hideHeader ? (
        <div className="border-b border-white/5 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-secondary-text">{t('settings.categoriesTitle')}</p>
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto py-2">
        {categories.map((category) => {
          const isActive = category.category === activeCategory;
          const count = (itemsByCategory[category.category] || []).length;
          const title = getCategoryTitle(language, category.category, category.title);

          return (
            <button
              key={category.category}
              type="button"
              className={cn(
                'mx-2 flex w-[calc(100%-1rem)] items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors',
                isActive
                  ? 'border-emerald-500/30 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(16,185,129,0.08)]'
                  : 'border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]',
                disabled ? 'pointer-events-none opacity-60' : '',
              )}
              onClick={() => {
                if (disabled) {
                  return;
                }
                onSelect(category.category);
              }}
              disabled={disabled}
            >
              <div className="min-w-0 flex-1">
                <p className={cn('text-[12px] font-semibold tracking-wide uppercase', isActive ? 'text-white' : 'text-secondary-text')}>
                  {title}
                </p>
              </div>
              <span className="ml-3 rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] font-mono text-muted-text">
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
