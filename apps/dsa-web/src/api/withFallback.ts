import { getParsedApiError, type ParsedApiError } from './error';

type WithFallbackOptions<T> = {
  fallback: (error: ParsedApiError) => Promise<T> | T;
  shouldFallback?: (error: ParsedApiError) => boolean;
};

type WithFallbackResult<T> = {
  data: T;
  fallback: boolean;
  error: ParsedApiError | null;
};

const NON_FALLBACK_CATEGORIES = new Set([
  'access_denied',
  'admin_unlock_required',
  'analysis_conflict',
  'auth_required',
  'missing_params',
  'validation_error',
]);

const FALLBACK_MESSAGE_RE = /(rate.?limit|429|all llm models failed|temporar(?:ily)? unavailable|timeout|overloaded)/i;

export function shouldUseLlmFallback(error: ParsedApiError): boolean {
  if (NON_FALLBACK_CATEGORIES.has(error.category)) {
    return false;
  }

  if (
    error.category === 'http_error'
    || error.category === 'unknown'
    || error.category === 'local_connection_failed'
    || error.category === 'upstream_network'
    || error.category === 'upstream_timeout'
    || error.category === 'upstream_unavailable'
  ) {
    return true;
  }

  return FALLBACK_MESSAGE_RE.test(`${error.title} ${error.message} ${error.rawMessage}`);
}

export async function withFallback<T>(
  run: () => Promise<T>,
  options: WithFallbackOptions<T>,
): Promise<WithFallbackResult<T>> {
  try {
    return {
      data: await run(),
      fallback: false,
      error: null,
    };
  } catch (caught) {
    const parsedError = getParsedApiError(caught);
    const shouldFallback = options.shouldFallback ?? shouldUseLlmFallback;
    if (!shouldFallback(parsedError)) {
      throw caught;
    }

    return {
      data: await options.fallback(parsedError),
      fallback: true,
      error: parsedError,
    };
  }
}
