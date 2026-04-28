/**
 * SpaceX live refactor: preserves the shared select API while aligning dropdown
 * controls with the same restrained input surface, uppercase field labels,
 * and minimal accessory treatment used across the updated frontend.
 */
import React, { useId } from 'react';
import { useI18n } from '../../contexts/UiLanguageContext';
import { cn } from '../../utils/cn';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  label?: string;
  labelClassName?: string;
  placeholder?: string;
  className?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
}

export const Select: React.FC<SelectProps> = ({
  id,
  value,
  onChange,
  options,
  label,
  labelClassName,
  placeholder,
  disabled = false,
  className = '',
  ...props
}) => {
  const { t } = useI18n();
  const selectId = useId();
  const resolvedId = id ?? selectId;
  const resolvedPlaceholder = placeholder ?? t('common.selectPlaceholder');

  return (
    <div className={cn('select-field flex flex-col', className)}>
      {label ? <label htmlFor={resolvedId} className={cn('theme-field-label mb-2', labelClassName)}>{label}</label> : null}
      <div className="select-field__control relative">
        <select
          id={resolvedId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          {...props}
          className={cn(
            'select-surface input-surface theme-focus-ring h-10 w-full appearance-none rounded-xl border px-4 py-2 pr-9 text-sm text-foreground',
            'theme-focus-ring transition-all duration-200',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          )}
        >
          {resolvedPlaceholder && (
            <option value="" disabled>
              {resolvedPlaceholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value} className="bg-[var(--surface-2)] text-foreground">
              {option.label}
            </option>
          ))}
        </select>

        {/* Dropdown arrow */}
        <div className="select-field__icon absolute inset-y-0 right-0 flex items-center pr-2.5 pointer-events-none">
          <svg
            className="h-4 w-4 text-secondary-text"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
    </div>
  );
};
