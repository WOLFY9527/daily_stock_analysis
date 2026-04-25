import { stripLocalePrefix } from './localeRouting';

export function isPreviewRoutePath(pathname: string): boolean {
  return stripLocalePrefix(pathname).startsWith('/__preview/');
}
