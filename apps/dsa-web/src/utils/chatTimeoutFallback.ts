import type { ParsedApiError } from '../api/error';

export const CHAT_TIMEOUT_FALLBACK_TEXT = '当前响应超时，请稍后刷新';

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function normalizeMatchText(parts: Array<unknown>): string {
  return parts
    .map((part) => (typeof part === 'string' ? part : ''))
    .filter(Boolean)
    .join(' | ')
    .toLowerCase();
}

function looksLikeGemini429Timeout(matchText: string, status?: number): boolean {
  const hasGeminiHint = includesAny(matchText, ['gemini', 'google', 'generativelanguage']);
  const hasRateLimitHint = includesAny(matchText, [
    '429',
    'rate limit',
    'too many requests',
    'quota',
    'model overloaded',
    'service unavailable',
    'timeout',
    'timed out',
  ]);
  return hasGeminiHint && (status === 429 || hasRateLimitHint);
}

export function shouldUseChatTimeoutFallback(error: ParsedApiError | string): boolean {
  if (typeof error === 'string') {
    const matchText = normalizeMatchText([error]);
    return looksLikeGemini429Timeout(matchText);
  }

  const matchText = normalizeMatchText([
    error.title,
    error.message,
    error.rawMessage,
    error.category,
  ]);
  if (looksLikeGemini429Timeout(matchText, error.status)) {
    return true;
  }
  return error.category === 'upstream_timeout' && includesAny(matchText, ['gemini', 'google', 'generativelanguage']);
}

export function normalizeAssistantMessageContent(content: string): string {
  const normalized = String(content || '');
  if (!normalized.startsWith('[分析失败]')) {
    return normalized;
  }
  return shouldUseChatTimeoutFallback(normalized) ? CHAT_TIMEOUT_FALLBACK_TEXT : normalized;
}
