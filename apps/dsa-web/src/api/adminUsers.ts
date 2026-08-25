import apiClient from './index';
import { toCamelCase } from './utils';
import { parsePortfolioDecimal } from '../utils/portfolioDecimal';
import type { PortfolioDecimal } from '../types/portfolio';

export type AdminPasswordState = 'set' | 'unset' | 'unknown';
export type AdminSessionStatus = 'active' | 'expired' | 'revoked';
export type AdminActivityStatus = 'success' | 'failed' | 'partial' | 'running' | 'skipped' | 'cancelled' | 'unknown';
export type AdminActivityOutcome = 'ok' | 'warning' | 'failed' | 'timeout' | 'partial' | 'unknown';

export interface AdminSessionSummaryCounts {
  activeCount: number;
  expiredCount: number;
  revokedCount: number;
  lastSeenAt?: string | null;
  nextExpiresAt?: string | null;
}

export interface AdminUserRiskBadge {
  code: string;
  label: string;
  severity: 'info' | 'warning' | 'critical';
  reason?: string | null;
  source: 'auth' | 'session' | 'future_activity' | 'future_security' | string;
}

export interface AdminDataLinks {
  self?: string | null;
  adminLogs?: string | null;
  activity?: string | null;
  portfolio?: string | null;
  analysis?: string | null;
  scanner?: string | null;
  backtest?: string | null;
}

export interface AdminUserListItem {
  id: string;
  username: string;
  displayName?: string | null;
  role: string;
  isActive: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  passwordState: AdminPasswordState;
  lastSeenAt?: string | null;
  sessionSummary: AdminSessionSummaryCounts;
  riskBadges: AdminUserRiskBadge[];
  links: AdminDataLinks;
}

export interface AdminUserListResponse {
  items: AdminUserListItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface AdminSessionSummary {
  sessionHandle: string;
  status: AdminSessionStatus;
  createdAt?: string | null;
  lastSeenAt?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
}

export interface AdminUserDetailResponse {
  user: AdminUserListItem;
  sessions: AdminSessionSummary[];
  dataLinks: AdminDataLinks;
  limitations: string[];
}

export interface AdminActivityActor {
  type: 'admin' | 'user' | 'guest' | 'anonymous' | 'system' | 'unknown' | string;
  userId?: string | null;
  label?: string | null;
  role?: string | null;
  sessionIdHash?: string | null;
  requestIdHash?: string | null;
}

export interface AdminActivityEntity {
  type: string;
  idHash?: string | null;
  label?: string | null;
  symbol?: string | null;
  market?: string | null;
  sourceTable?: string | null;
}

export interface AdminActivitySource {
  kind: string;
  table?: string | null;
  confidence?: 'confirmed' | 'inferred' | 'unknown' | string;
}

export interface AdminActivityEvent {
  id: string;
  timestamp: string;
  actor: AdminActivityActor;
  targetUser: {
    id?: string | null;
    label?: string | null;
  };
  family: string;
  action: string;
  entity: AdminActivityEntity;
  status: AdminActivityStatus;
  outcome: AdminActivityOutcome;
  requestIdHash?: string | null;
  sessionIdHash?: string | null;
  source: AdminActivitySource;
  redactedMetadata: Record<string, unknown>;
  logLinks: Array<{
    kind: string;
    idHash?: string | null;
  }>;
}

export interface AdminActivityResponse {
  items: AdminActivityEvent[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  window: {
    from: string;
    to: string;
    maxDays: number;
  };
  limitations: string[];
}

export interface AdminMoneyAmount {
  amount: PortfolioDecimal | null;
  currency?: string | null;
}

export interface AdminPortfolioAccountItem {
  id: number;
  name: string;
  broker?: string | null;
  market?: string | null;
  baseCurrency?: string | null;
  isActive: boolean;
  brokerAccountHandle?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface AdminBrokerSyncSummary {
  connections: number;
  statuses: Record<string, number>;
  lastSyncAt?: string | null;
  fxStale?: boolean | null;
  fxFreshnessState?: string | null;
}

export interface AdminLedgerCounts {
  trades: number;
  cashEvents: number;
  corporateActions: number;
}

export interface AdminPortfolioSummaryResponse {
  userId: string;
  asOf?: string | null;
  costMethod?: string | null;
  accountCount: number;
  activeAccountCount: number;
  valuationScope: string;
  valuationAccountCount: number;
  baseCurrencies: string[];
  accounts: AdminPortfolioAccountItem[];
  totalCash: AdminMoneyAmount | null;
  totalMarketValue: AdminMoneyAmount | null;
  totalEquity: AdminMoneyAmount | null;
  realizedPnl: AdminMoneyAmount | null;
  unrealizedPnl: AdminMoneyAmount | null;
  ledgerCounts: AdminLedgerCounts;
  brokerSyncSummary: AdminBrokerSyncSummary;
  valuationCurrency?: string | null;
  portfolioTruth: Record<string, unknown>;
  valuation: Record<string, unknown>;
  availability: Record<string, unknown>;
  fxLineage: Record<string, unknown>;
  valuationSnapshotLineage: Record<string, unknown>;
  valuationLineage: Record<string, unknown>;
  dataStatus?: string | null;
  calculationStatus?: string | null;
  fxStale: boolean;
  fxFreshnessState?: string | null;
  valuationLineageState?: string | null;
  unvaluedHoldingCount: number;
  limitations: string[];
}

export interface AdminHoldingItem {
  accountId: number;
  accountName: string;
  broker?: string | null;
  brokerAccountHandle?: string | null;
  symbol: string;
  market?: string | null;
  currency?: string | null;
  quantity: PortfolioDecimal | null;
  avgCost: PortfolioDecimal | null;
  lastPrice: PortfolioDecimal | null;
  marketValueBase: PortfolioDecimal | null;
  unrealizedPnlBase: PortfolioDecimal | null;
  valuationCurrency?: string | null;
  fxStatus: string;
  valuationStatus: string;
  valuationUnavailableReason?: string | null;
  displayMarketValue?: PortfolioDecimal | null;
  displayUnrealizedPnl?: PortfolioDecimal | null;
  updatedAt?: string | null;
}

export interface AdminHoldingListResponse {
  items: AdminHoldingItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  asOf?: string | null;
  costMethod?: string | null;
  valuationCurrency?: string | null;
  portfolioTruth: Record<string, unknown>;
  valuation: Record<string, unknown>;
  availability: Record<string, unknown>;
  fxLineage: Record<string, unknown>;
  valuationSnapshotLineage: Record<string, unknown>;
  valuationLineage: Record<string, unknown>;
  dataStatus?: string | null;
  calculationStatus?: string | null;
  fxStale: boolean;
  fxFreshnessState?: string | null;
  valuationLineageState?: string | null;
  unvaluedHoldingCount: number;
  limitations: string[];
}

export interface AdminPortfolioActivityItem {
  idHash: string;
  type: string;
  accountId: number;
  accountName: string;
  eventDate: string;
  symbol?: string | null;
  market?: string | null;
  currency?: string | null;
  side?: string | null;
  direction?: string | null;
  actionType?: string | null;
  quantity?: number | null;
  price?: number | null;
  amount?: number | null;
  createdAt?: string | null;
}

export interface AdminPortfolioActivityResponse {
  items: AdminPortfolioActivityItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  summary: AdminLedgerCounts;
  limitations: string[];
}

export interface AdminPortfolioParams {
  asOf?: string;
  currency?: string;
  includeInactive?: boolean;
  accountId?: number | string;
  symbol?: string;
  market?: string;
  includeZero?: boolean;
  limit?: number;
  offset?: number;
  costMethod?: string;
}

export interface AdminSecurityActionRequest {
  reason: string;
  confirm: string;
  revokeSessions?: boolean;
  scope?: 'all';
}

export interface AdminSecurityActionResponse {
  targetUserId: string;
  action: 'disable' | 'enable' | 'revoke_sessions';
  status: 'completed' | 'blocked' | 'failed';
  changed: boolean;
  sessionsRevoked: number;
  auditEventId?: string | null;
  message: string;
}

export interface AdminUserListParams {
  q?: string;
  role?: string;
  status?: string;
  active?: boolean;
  createdFrom?: string;
  createdTo?: string;
  lastSeenFrom?: string;
  lastSeenTo?: string;
  limit?: number;
  offset?: number;
  sort?: string;
}

export interface AdminUserDetailParams {
  includeSessions?: boolean;
  sessionLimit?: number;
  sessionStatus?: string;
}

export interface AdminActivityParams {
  from?: string;
  to?: string;
  family?: string;
  category?: string;
  status?: string;
  entityType?: string;
  actorType?: string;
  targetUser?: string;
  q?: string;
  includeSystem?: boolean;
  includeAdmin?: boolean;
  limit?: number;
  offset?: number;
}

const PARAM_ALIASES: Record<string, string> = {
  createdFrom: 'created_from',
  createdTo: 'created_to',
  lastSeenFrom: 'last_seen_from',
  lastSeenTo: 'last_seen_to',
  includeSessions: 'include_sessions',
  sessionLimit: 'session_limit',
  sessionStatus: 'session_status',
  entityType: 'entity_type',
  actorType: 'actor_type',
  targetUser: 'target_user',
  includeSystem: 'include_system',
  includeAdmin: 'include_admin',
  includeInactive: 'include_inactive',
  includeZero: 'include_zero',
  accountId: 'account_id',
  asOf: 'as_of',
  costMethod: 'cost_method',
  revokeSessions: 'revoke_sessions',
};

function toQueryParams(params: Record<string, unknown>): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    query[PARAM_ALIASES[key] || key] = value;
  });
  return query;
}

function normalizeList(payload: Record<string, unknown>): AdminUserListResponse {
  const normalized = toCamelCase<AdminUserListResponse>(payload);
  return {
    items: Array.isArray(normalized.items) ? normalized.items : [],
    total: Number(normalized.total || 0),
    limit: Number(normalized.limit || 50),
    offset: Number(normalized.offset || 0),
    hasMore: Boolean(normalized.hasMore),
  };
}

function normalizeDetail(payload: Record<string, unknown>): AdminUserDetailResponse {
  const normalized = toCamelCase<AdminUserDetailResponse>(payload);
  return {
    user: normalized.user,
    sessions: Array.isArray(normalized.sessions) ? normalized.sessions : [],
    dataLinks: normalized.dataLinks || {},
    limitations: Array.isArray(normalized.limitations) ? normalized.limitations : [],
  };
}

function normalizeActivity(payload: Record<string, unknown>): AdminActivityResponse {
  const normalized = toCamelCase<AdminActivityResponse>(payload);
  return {
    items: Array.isArray(normalized.items) ? normalized.items : [],
    total: Number(normalized.total || 0),
    limit: Number(normalized.limit || 50),
    offset: Number(normalized.offset || 0),
    hasMore: Boolean(normalized.hasMore),
    window: normalized.window || { from: '', to: '', maxDays: 0 },
    limitations: Array.isArray(normalized.limitations) ? normalized.limitations : [],
  };
}

const emptyLedger = (): AdminLedgerCounts => ({ trades: 0, cashEvents: 0, corporateActions: 0 });

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAdminDecimal(value: unknown): PortfolioDecimal | null {
  if (value === null || value === undefined) return null;
  return parsePortfolioDecimal(value) || null;
}

function normalizeMoney(value: unknown): AdminMoneyAmount | null {
  if (!isRecord(value)) return null;
  return {
    amount: normalizeAdminDecimal(value.amount),
    currency: typeof value.currency === 'string' ? value.currency : null,
  };
}

function normalizePortfolioSummary(payload: Record<string, unknown>): AdminPortfolioSummaryResponse {
  const normalized = toCamelCase<AdminPortfolioSummaryResponse>(payload);
  return {
    userId: String(normalized.userId || ''),
    asOf: normalized.asOf || null,
    costMethod: normalized.costMethod || null,
    accountCount: Number(normalized.accountCount || 0),
    activeAccountCount: Number(normalized.activeAccountCount || 0),
    valuationScope: typeof normalized.valuationScope === 'string' ? normalized.valuationScope.trim() : '',
    valuationAccountCount: Number(normalized.valuationAccountCount || 0),
    baseCurrencies: Array.isArray(normalized.baseCurrencies) ? normalized.baseCurrencies : [],
    accounts: Array.isArray(normalized.accounts) ? normalized.accounts : [],
    totalCash: normalizeMoney(normalized.totalCash),
    totalMarketValue: normalizeMoney(normalized.totalMarketValue),
    totalEquity: normalizeMoney(normalized.totalEquity),
    realizedPnl: normalizeMoney(normalized.realizedPnl),
    unrealizedPnl: normalizeMoney(normalized.unrealizedPnl),
    ledgerCounts: normalized.ledgerCounts || emptyLedger(),
    brokerSyncSummary: normalized.brokerSyncSummary || {
      connections: 0,
      statuses: {},
      lastSyncAt: null,
      fxStale: null,
      fxFreshnessState: null,
    },
    valuationCurrency: normalized.valuationCurrency || null,
    portfolioTruth: normalized.portfolioTruth || {},
    valuation: normalized.valuation || {},
    availability: normalized.availability || {},
    fxLineage: normalized.fxLineage || {},
    valuationSnapshotLineage: normalized.valuationSnapshotLineage || {},
    valuationLineage: normalized.valuationLineage || {},
    dataStatus: normalized.dataStatus || null,
    calculationStatus: normalized.calculationStatus || null,
    fxStale: Boolean(normalized.fxStale),
    fxFreshnessState: normalized.fxFreshnessState || null,
    valuationLineageState: normalized.valuationLineageState || null,
    unvaluedHoldingCount: Number(normalized.unvaluedHoldingCount || 0),
    limitations: Array.isArray(normalized.limitations) ? normalized.limitations : [],
  };
}

function normalizeHoldings(payload: Record<string, unknown>): AdminHoldingListResponse {
  const normalized = toCamelCase<AdminHoldingListResponse>(payload);
  return {
    items: Array.isArray(normalized.items) ? normalized.items.map((item) => ({
      ...item,
      quantity: normalizeAdminDecimal(item.quantity),
      avgCost: normalizeAdminDecimal(item.avgCost),
      lastPrice: normalizeAdminDecimal(item.lastPrice),
      marketValueBase: normalizeAdminDecimal(item.marketValueBase),
      unrealizedPnlBase: normalizeAdminDecimal(item.unrealizedPnlBase),
      displayMarketValue: normalizeAdminDecimal(item.displayMarketValue),
      displayUnrealizedPnl: normalizeAdminDecimal(item.displayUnrealizedPnl),
    })) : [],
    total: Number(normalized.total || 0),
    limit: Number(normalized.limit || 50),
    offset: Number(normalized.offset || 0),
    hasMore: Boolean(normalized.hasMore),
    asOf: normalized.asOf || null,
    costMethod: normalized.costMethod || null,
    valuationCurrency: normalized.valuationCurrency || null,
    portfolioTruth: normalized.portfolioTruth || {},
    valuation: normalized.valuation || {},
    availability: normalized.availability || {},
    fxLineage: normalized.fxLineage || {},
    valuationSnapshotLineage: normalized.valuationSnapshotLineage || {},
    valuationLineage: normalized.valuationLineage || {},
    dataStatus: normalized.dataStatus || null,
    calculationStatus: normalized.calculationStatus || null,
    fxStale: Boolean(normalized.fxStale),
    fxFreshnessState: normalized.fxFreshnessState || null,
    valuationLineageState: normalized.valuationLineageState || null,
    unvaluedHoldingCount: Number(normalized.unvaluedHoldingCount || 0),
    limitations: Array.isArray(normalized.limitations) ? normalized.limitations : [],
  };
}

function normalizePortfolioActivity(payload: Record<string, unknown>): AdminPortfolioActivityResponse {
  const normalized = toCamelCase<AdminPortfolioActivityResponse>(payload);
  return {
    items: Array.isArray(normalized.items) ? normalized.items : [],
    total: Number(normalized.total || 0),
    limit: Number(normalized.limit || 30),
    offset: Number(normalized.offset || 0),
    hasMore: Boolean(normalized.hasMore),
    summary: normalized.summary || emptyLedger(),
    limitations: Array.isArray(normalized.limitations) ? normalized.limitations : [],
  };
}

function normalizeSecurityAction(payload: Record<string, unknown>): AdminSecurityActionResponse {
  const normalized = toCamelCase<AdminSecurityActionResponse>(payload);
  return {
    targetUserId: String(normalized.targetUserId || ''),
    action: normalized.action,
    status: normalized.status,
    changed: Boolean(normalized.changed),
    sessionsRevoked: Number(normalized.sessionsRevoked || 0),
    auditEventId: normalized.auditEventId || null,
    message: String(normalized.message || ''),
  };
}

export const adminUsersApi = {
  async listUsers(params: AdminUserListParams = {}): Promise<AdminUserListResponse> {
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/admin/users', {
      params: toQueryParams(params as Record<string, unknown>),
    });
    return normalizeList(response.data);
  },

  async getUserDetail(userId: string, params: AdminUserDetailParams = {}): Promise<AdminUserDetailResponse> {
    const response = await apiClient.get<Record<string, unknown>>(`/api/v1/admin/users/${encodeURIComponent(userId)}`, {
      params: toQueryParams(params as Record<string, unknown>),
    });
    return normalizeDetail(response.data);
  },

  async listUserActivity(userId: string, params: AdminActivityParams = {}): Promise<AdminActivityResponse> {
    const response = await apiClient.get<Record<string, unknown>>(`/api/v1/admin/users/${encodeURIComponent(userId)}/activity`, {
      params: toQueryParams(params as Record<string, unknown>),
    });
    return normalizeActivity(response.data);
  },

  async listActivity(params: AdminActivityParams = {}): Promise<AdminActivityResponse> {
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/admin/activity', {
      params: toQueryParams(params as Record<string, unknown>),
    });
    return normalizeActivity(response.data);
  },

  async getAdminUserPortfolioSummary(userId: string, params: AdminPortfolioParams = {}): Promise<AdminPortfolioSummaryResponse> {
    const response = await apiClient.get<Record<string, unknown>>(`/api/v1/admin/users/${encodeURIComponent(userId)}/portfolio-summary`, {
      params: toQueryParams(params as Record<string, unknown>),
    });
    return normalizePortfolioSummary(response.data);
  },

  async getAdminUserHoldings(userId: string, params: AdminPortfolioParams = {}): Promise<AdminHoldingListResponse> {
    const response = await apiClient.get<Record<string, unknown>>(`/api/v1/admin/users/${encodeURIComponent(userId)}/holdings`, {
      params: toQueryParams(params as Record<string, unknown>),
    });
    return normalizeHoldings(response.data);
  },

  async getAdminUserPortfolioActivity(userId: string, params: AdminPortfolioParams = {}): Promise<AdminPortfolioActivityResponse> {
    const response = await apiClient.get<Record<string, unknown>>(`/api/v1/admin/users/${encodeURIComponent(userId)}/portfolio-activity`, {
      params: toQueryParams(params as Record<string, unknown>),
    });
    return normalizePortfolioActivity(response.data);
  },

  async getAdminUserPortfolioAccountDetail(userId: string, accountId: number | string, params: AdminPortfolioParams = {}): Promise<Record<string, unknown>> {
    const response = await apiClient.get<Record<string, unknown>>(`/api/v1/admin/users/${encodeURIComponent(userId)}/portfolio/accounts/${encodeURIComponent(String(accountId))}`, {
      params: toQueryParams(params as Record<string, unknown>),
    });
    return toCamelCase<Record<string, unknown>>(response.data);
  },

  async disableAdminUser(userId: string, request: AdminSecurityActionRequest): Promise<AdminSecurityActionResponse> {
    const response = await apiClient.post<Record<string, unknown>>(`/api/v1/admin/users/${encodeURIComponent(userId)}/disable`, {
      reason: request.reason,
      confirm: request.confirm,
      revoke_sessions: Boolean(request.revokeSessions),
    });
    return normalizeSecurityAction(response.data);
  },

  async enableAdminUser(userId: string, request: AdminSecurityActionRequest): Promise<AdminSecurityActionResponse> {
    const response = await apiClient.post<Record<string, unknown>>(`/api/v1/admin/users/${encodeURIComponent(userId)}/enable`, {
      reason: request.reason,
      confirm: request.confirm,
    });
    return normalizeSecurityAction(response.data);
  },

  async revokeAdminUserSessions(userId: string, request: AdminSecurityActionRequest): Promise<AdminSecurityActionResponse> {
    const response = await apiClient.post<Record<string, unknown>>(`/api/v1/admin/users/${encodeURIComponent(userId)}/revoke-sessions`, {
      reason: request.reason,
      confirm: request.confirm,
      scope: request.scope || 'all',
    });
    return normalizeSecurityAction(response.data);
  },
};
