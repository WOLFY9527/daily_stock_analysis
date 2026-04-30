import apiClient from './index';
import { toCamelCase } from './utils';

export interface ExecutionLogEvent {
  id: number;
  eventAt?: string | null;
  level?: string | null;
  phase: string;
  category?: string | null;
  eventName?: string | null;
  step?: string | null;
  action?: string | null;
  outcome?: string | null;
  reason?: string | null;
  target?: string | null;
  status: string;
  truthLevel: string;
  message?: string | null;
  errorCode?: string | null;
  detail?: Record<string, unknown>;
}

export interface ExecutionLogSessionSummary {
  sessionId: string;
  taskId?: string | null;
  queryId?: string | null;
  analysisHistoryId?: number | null;
  code?: string | null;
  name?: string | null;
  overallStatus: string;
  truthLevel: string;
  startedAt?: string | null;
  endedAt?: string | null;
  summary?: Record<string, unknown>;
  readableSummary?: {
    actorUserId?: string | null;
    actorUsername?: string | null;
    actorDisplay?: string | null;
    actorRole?: string | null;
    sessionKind?: string | null;
    subsystem?: string | null;
    actionName?: string | null;
    destructive?: boolean;
    finalAiModel?: string | null;
    aiAttemptsCount?: number;
    aiFallbackUsed?: boolean;
    finalMarketSource?: string | null;
    finalFundamentalSource?: string | null;
    finalNewsSource?: string | null;
    finalSentimentSource?: string | null;
    dataFallbackUsed?: boolean;
    notificationClassification?: string | null;
    topFailureReason?: string | null;
    scannerRunId?: number | null;
    scannerMarket?: string | null;
    scannerProfile?: string | null;
    scannerProfileLabel?: string | null;
    scannerShortlistCount?: number | null;
    scannerFallbackCount?: number | null;
    scannerProviderFailureCount?: number | null;
    scannerProvidersUsed?: string[];
    scannerCoverageSummary?: string | null;
    summaryParagraph?: string | null;
    status?: string;
    operationCategory?: string | null;
    operationType?: string | null;
    operationTarget?: string | null;
    operationStatus?: string | null;
    keyMetric?: string | null;
    logLevel?: string | null;
    logCategory?: string | null;
    eventName?: string | null;
    eventMessage?: string | null;
    requestId?: string | null;
    source?: string | null;
  };
}

export interface ExecutionLogSessionDetail extends ExecutionLogSessionSummary {
  events: ExecutionLogEvent[];
  operationDetail?: {
    operationCategory?: string | null;
    operationType?: string | null;
    target?: string | null;
    status?: string | null;
    keyMetric?: string | null;
    aiCalls?: Array<Record<string, unknown>>;
    dataSourceCalls?: Array<Record<string, unknown>>;
    systemFallbacks?: Array<string | Record<string, unknown>>;
    systemOperation?: Record<string, unknown>;
    finalResult?: string | null;
    timeline?: Array<Record<string, unknown>>;
    diagnostics?: Array<Record<string, unknown>>;
  };
}

export interface ExecutionLogSessionListResponse {
  total: number;
  items: ExecutionLogSessionSummary[];
  summary?: {
    errorCount?: number;
    warningCount?: number;
    dataSourceFailureCount?: number;
    slowRequestCount?: number;
    latestCriticalAt?: string | null;
  };
}

export interface ExecutionStep {
  name: string;
  label: string;
  provider?: string | null;
  apiPath?: string | null;
  status: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  errorType?: string | null;
  errorMessage?: string | null;
  recordId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface BusinessEvent {
  id: string;
  event: string;
  category: string;
  status: string;
  summary: string;
  symbol?: string | null;
  market?: string | null;
  analysisType?: string | null;
  userId?: string | null;
  requestId?: string | null;
  recordId?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  stepCount: number;
  successStepCount: number;
  failedStepCount: number;
  metadata?: Record<string, unknown>;
}

export interface BusinessEventDetail extends BusinessEvent {
  steps: ExecutionStep[];
}

export interface BusinessEventListResponse {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  items: BusinessEvent[];
}

function normalizeSessionSummary(payload: Record<string, unknown>): ExecutionLogSessionSummary {
  const normalized = toCamelCase<ExecutionLogSessionSummary>(payload);
  return {
    ...normalized,
    readableSummary: normalized.readableSummary && typeof normalized.readableSummary === 'object'
      ? normalized.readableSummary
      : {},
  };
}

function normalizeSessionDetail(payload: Record<string, unknown>): ExecutionLogSessionDetail {
  const normalized = toCamelCase<ExecutionLogSessionDetail>(payload);
  return {
    ...normalized,
    readableSummary: normalized.readableSummary && typeof normalized.readableSummary === 'object'
      ? normalized.readableSummary
      : {},
    events: Array.isArray(normalized.events) ? normalized.events : [],
    operationDetail: normalized.operationDetail && typeof normalized.operationDetail === 'object'
      ? normalized.operationDetail
      : {},
  };
}

export const adminLogsApi = {
  listBusinessEvents: async (
    params: {
      category?: string;
      symbol?: string;
      status?: string;
      query?: string;
      since?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<BusinessEventListResponse> => {
    const response = await apiClient.get<Record<string, unknown>>(
      '/api/v1/admin/logs',
      { params },
    );
    const normalized = toCamelCase<BusinessEventListResponse>(response.data);
    return {
      total: Number(normalized.total || 0),
      limit: Number(normalized.limit || params.limit || 50),
      offset: Number(normalized.offset || params.offset || 0),
      hasMore: Boolean(normalized.hasMore),
      items: Array.isArray(normalized.items)
        ? normalized.items.map((item) => toCamelCase<BusinessEvent>(item as unknown as Record<string, unknown>))
        : [],
    };
  },

  getBusinessEventDetail: async (eventId: string): Promise<BusinessEventDetail> => {
    const response = await apiClient.get<Record<string, unknown>>(
      `/api/v1/admin/logs/${encodeURIComponent(eventId)}`,
    );
    const normalized = toCamelCase<BusinessEventDetail>(response.data);
    return {
      ...normalized,
      steps: Array.isArray(normalized.steps) ? normalized.steps : [],
    };
  },

  listSessions: async (
    params: {
      taskId?: string;
      stock?: string;
      status?: string;
      minLevel?: string;
      level?: string;
      category?: string;
      query?: string;
      provider?: string;
      model?: string;
      channel?: string;
      since?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<ExecutionLogSessionListResponse> => {
    const requestParams = {
      ...params,
      min_level: params.minLevel,
      task_id: params.taskId,
    };
    delete requestParams.minLevel;
    delete requestParams.taskId;
    const response = await apiClient.get<Record<string, unknown>>(
      '/api/v1/admin/logs/sessions',
      {
        params: requestParams,
      },
    );
    const normalized = toCamelCase<ExecutionLogSessionListResponse>(response.data);
    return {
      total: Number(normalized.total || 0),
      summary: normalized.summary,
      items: Array.isArray(normalized.items)
        ? normalized.items.map((item) => normalizeSessionSummary(item as unknown as Record<string, unknown>))
        : [],
    };
  },

  getSessionDetail: async (sessionId: string): Promise<ExecutionLogSessionDetail> => {
    const response = await apiClient.get<Record<string, unknown>>(
      `/api/v1/admin/logs/sessions/${encodeURIComponent(sessionId)}`,
    );
    return normalizeSessionDetail(response.data);
  },
};
