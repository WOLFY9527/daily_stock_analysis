export type PortfolioCostMethod = 'fifo' | 'avg' | 'futu_diluted' | 'ths_pnl';
export type PortfolioSide = 'buy' | 'sell';
export type PortfolioCashDirection = 'in' | 'out';
export type PortfolioCorporateActionType = 'cash_dividend' | 'split_adjustment';
export type PortfolioDecimal = string;

export interface PortfolioAccountItem {
  id: number;
  ownerId?: string | null;
  name: string;
  broker?: string | null;
  market: 'cn' | 'hk' | 'us' | 'global';
  baseCurrency: string;
  isActive: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface PortfolioAccountListResponse {
  accounts: PortfolioAccountItem[];
}

export interface PortfolioAccountDeleteResponse {
  ok: boolean;
  deletedAccountId: number;
  deleteMode: 'soft' | 'hard';
  nextAccountId?: number | null;
}

export interface PortfolioAccountCreateRequest {
  name: string;
  broker?: string;
  market: 'cn' | 'hk' | 'us' | 'global';
  baseCurrency: string;
  ownerId?: string;
}

export interface PortfolioBrokerConnectionItem {
  id: number;
  ownerId?: string | null;
  portfolioAccountId: number;
  portfolioAccountName?: string | null;
  brokerType: string;
  brokerName?: string | null;
  connectionName: string;
  brokerAccountRef?: string | null;
  importMode: string;
  status: string;
  lastImportedAt?: string | null;
  lastImportSource?: string | null;
  lastImportFingerprint?: string | null;
  syncMetadata: Record<string, unknown>;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface PortfolioBrokerConnectionListResponse {
  connections: PortfolioBrokerConnectionItem[];
}

export interface PortfolioIbkrSyncRequest {
  accountId: number;
  brokerConnectionId?: number;
  brokerAccountRef?: string;
  sessionToken: string;
  apiBaseUrl?: string;
  verifySsl?: boolean;
}

export interface PortfolioIbkrSyncResponse {
  accountId: number;
  brokerConnectionId: number;
  brokerAccountRef: string;
  connectionName: string;
  snapshotDate: string;
  syncedAt: string;
  baseCurrency: string;
  totalCash: PortfolioDecimal;
  totalMarketValue: PortfolioDecimal;
  totalEquity: PortfolioDecimal;
  realizedPnl: PortfolioDecimal;
  unrealizedPnl: PortfolioDecimal;
  positionCount: number;
  cashBalanceCount: number;
  fxStale: boolean;
  snapshotOverlayActive: boolean;
  usedExistingConnection: boolean;
  apiBaseUrl: string;
  verifySsl: boolean;
  warnings: string[];
}

export interface PortfolioPositionItem {
  symbol: string;
  market: string;
  currency: string;
  quantity: PortfolioDecimal;
  avgCost: PortfolioDecimal;
  totalCost: PortfolioDecimal;
  lastPrice: PortfolioDecimal;
  priceSource?: string | null;
  priceSourceLabel?: string | null;
  priceAsOf?: string | null;
  isPriceFallback?: boolean | null;
  priceFallbackReason?: string | null;
  valuationConfidence?: number | null;
  marketValueBase: PortfolioDecimal | null;
  unrealizedPnlBase: PortfolioDecimal | null;
  valuationCurrency: string;
  costBasisNative?: PortfolioDecimal | null;
  marketValueNative?: PortfolioDecimal | null;
  unrealizedPnlNative?: PortfolioDecimal | null;
  unrealizedPnlPct?: number | null;
  displayMarketValue?: PortfolioDecimal | null;
  displayUnrealizedPnl?: PortfolioDecimal | null;
  displayCurrency?: string | null;
  displayFxStatus?: PortfolioFxStatus | null;
  valuationStatus?: 'available' | 'stale' | 'unavailable' | null;
  valuationUnavailableReason?: string | null;
}

export interface PortfolioAccountSnapshot {
  accountId: number;
  accountName: string;
  ownerId?: string | null;
  broker?: string | null;
  market: string;
  baseCurrency: string;
  asOf: string;
  costMethod: PortfolioCostMethod;
  totalCash: PortfolioDecimal | null;
  totalMarketValue: PortfolioDecimal | null;
  totalEquity: PortfolioDecimal | null;
  realizedPnl: PortfolioDecimal | null;
  unrealizedPnl: PortfolioDecimal | null;
  feeTotal: PortfolioDecimal | null;
  taxTotal: PortfolioDecimal | null;
  fxStale: boolean;
  positions: PortfolioPositionItem[];
}

export interface PortfolioFxRateItem {
  fromCurrency: string;
  toCurrency: string;
  rate?: PortfolioDecimal | null;
  rateDate?: string | null;
  source: string;
  isStale: boolean;
  updatedAt?: string | null;
  sourceDirection: string;
}

export interface PortfolioLiveFxRateResponse {
  baseCurrency: string;
  quoteCurrency: string;
  rate: PortfolioDecimal;
  provider: string;
  fetchedAt: string;
  cacheHit: boolean;
  stale: boolean;
  error?: string | null;
}

export type PortfolioFxStatus = 'live' | 'stale' | 'unavailable';

export interface PortfolioPnlMetric {
  amount: PortfolioDecimal | null;
  amountDisplay?: string | null;
  percent?: number | null;
  currency: string;
  fxStatus: PortfolioFxStatus;
}

export interface PortfolioPnlSummary {
  displayCurrency: string;
  realized: PortfolioPnlMetric;
  unrealized: PortfolioPnlMetric;
  total: PortfolioPnlMetric;
}

export interface PortfolioExposureItem {
  key: string;
  label: string;
  marketValue: PortfolioDecimal | null;
  displayValue: PortfolioDecimal | null;
  displayCurrency: string;
  percent: number | null;
  fxStatus: PortfolioFxStatus;
  nativeValue?: PortfolioDecimal | null;
  nativeCurrency?: string | null;
  accountId?: number | null;
  accountName?: string | null;
  baseCurrency?: string | null;
  currency?: string | null;
  market?: string | null;
  symbol?: string | null;
  sector?: string | null;
  holdingCount?: number | null;
  unrealizedPnl?: PortfolioDecimal | null;
  unrealizedPnlPct?: number | null;
}

export interface PortfolioExposureSummary {
  byAccount: PortfolioExposureItem[];
  byCurrency: PortfolioExposureItem[];
  byMarket: PortfolioExposureItem[];
  bySymbol: PortfolioExposureItem[];
  bySector: PortfolioExposureItem[];
  sectorStatus: 'available' | 'unavailable';
}

export interface PortfolioAnalyticsRiskSummary {
  largestPosition?: PortfolioExposureItem | null;
  largestCurrency?: PortfolioExposureItem | null;
  largestMarket?: PortfolioExposureItem | null;
  holdingCount: number;
  accountCount: number;
  cashPercent?: number | null;
  fxUnavailable: boolean;
  warnings: string[];
}

export interface PortfolioAnalyticsSummary {
  pnl: PortfolioPnlSummary;
  exposure: PortfolioExposureSummary;
  risk: PortfolioAnalyticsRiskSummary;
}

export interface PortfolioEvidenceMetadata {
  source?: string | null;
  sourceLabel?: string | null;
  freshness?: string | null;
  freshnessLabel?: string | null;
  asOf?: string | null;
  isFallback?: boolean | null;
  isStale?: boolean | null;
  isPartial?: boolean | null;
  isUnavailable?: boolean | null;
  coverage?: Record<string, unknown> | null;
  confidenceWeight?: number | null;
  degradationReason?: string | null;
  capReason?: string | null;
  state?: string | null;
  status?: string | null;
}

export interface PortfolioRiskDiagnosticIssue extends PortfolioEvidenceMetadata {
  code?: string | null;
  label?: string | null;
  detail?: string | null;
  accountIds?: number[];
  severity?: string | null;
  [key: string]: unknown;
}

export interface PortfolioRiskEvidenceSection extends PortfolioEvidenceMetadata {
  summary?: string | null;
  issues?: PortfolioRiskDiagnosticIssue[];
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PortfolioRiskConfidenceCap extends PortfolioEvidenceMetadata {
  value?: number | null;
  decisionStatus?: string | null;
  reasonCodes?: string[];
  limitationLabels?: string[];
  disabledClaims?: string[];
  policyVersion?: string | null;
  [key: string]: unknown;
}

export interface PortfolioRiskEvidenceEntity {
  type?: string | null;
  id?: string | null;
  symbol?: string | null;
  market?: string | null;
  displayName?: string | null;
  [key: string]: unknown;
}

export interface PortfolioRiskEvidenceItem extends PortfolioEvidenceMetadata {
  key?: string | null;
  criticality?: string | null;
  valueClass?: string | null;
  sourceRefIds?: string[];
  freshnessClass?: string | null;
  reasonCodes?: string[];
  [key: string]: unknown;
}

export interface PortfolioRiskEvidenceSourceRef extends PortfolioEvidenceMetadata {
  sourceRefId?: string | null;
  provider?: string | null;
  category?: string | null;
  sourceClass?: string | null;
  cacheHit?: boolean | null;
  providerUsageEventIds?: string[];
  sanitizedReasonCode?: string | null;
  rawPayloadStored?: boolean | null;
  [key: string]: unknown;
}

export interface PortfolioRiskExplainableFact {
  factId?: string | null;
  statement?: string | null;
  sourceRefIds?: string[];
  criticality?: string | null;
  confidenceClass?: string | null;
  userVisible?: boolean | null;
  [key: string]: unknown;
}

export interface PortfolioRiskEvidenceFreshness extends PortfolioEvidenceMetadata {
  [key: string]: unknown;
}

export interface PortfolioRiskEvidencePacket {
  source?: string | null;
  sourceLabel?: string | null;
  freshnessLabel?: string | null;
  asOf?: string | null;
  isFallback?: boolean | null;
  isStale?: boolean | null;
  isPartial?: boolean | null;
  isUnavailable?: boolean | null;
  coverage?: Record<string, unknown> | null;
  confidenceWeight?: number | null;
  degradationReason?: string | null;
  capReason?: string | null;
  state?: string | null;
  status?: string | null;
  engine?: string | null;
  entity?: PortfolioRiskEvidenceEntity | null;
  runId?: string | null;
  evidenceVersion?: string | null;
  requiredEvidence?: PortfolioRiskEvidenceItem[];
  optionalEvidence?: PortfolioRiskEvidenceItem[];
  freshness?: PortfolioRiskEvidenceFreshness | null;
  qualityFlags?: string[];
  decisionStatus?: string | null;
  confidenceCap?: PortfolioRiskConfidenceCap | null;
  sourceRefs?: PortfolioRiskEvidenceSourceRef[];
  explainableFacts?: PortfolioRiskExplainableFact[];
  adminDiagnostics?: Record<string, unknown>;
  limitationLabels?: string[];
  [key: string]: unknown;
}

export interface PortfolioRiskDiagnostics extends PortfolioEvidenceMetadata {
  holdingsLineage?: PortfolioRiskEvidenceSection | null;
  cashLedgerCompleteness?: PortfolioRiskEvidenceSection | null;
  transactionLineage?: PortfolioRiskEvidenceSection | null;
  fxFreshness?: PortfolioRiskEvidenceSection | null;
  costBasisCoverage?: PortfolioRiskEvidenceSection | null;
  sourceAuthority?: PortfolioRiskEvidenceSection | null;
  benchmarkFactorMapping?: PortfolioRiskEvidenceSection | null;
  confidenceCap?: PortfolioRiskConfidenceCap | null;
  evidencePacket?: PortfolioRiskEvidencePacket | null;
  [key: string]: unknown;
}

export interface PortfolioRiskDiagnosticsStateFields {
  valuationLineageState?: string | null;
  sourceAuthorityState?: string | null;
  fxFreshnessState?: string | null;
  holdingsLineageState?: string | null;
  cashLedgerCompletenessState?: string | null;
  benchmarkMappingState?: string | null;
  factorMappingState?: string | null;
}

export interface PortfolioRiskDiagnosticsResponseFields extends PortfolioRiskDiagnosticsStateFields {
  riskDiagnostics?: PortfolioRiskDiagnostics | null;
  portfolioRiskEvidence?: PortfolioRiskEvidencePacket | null;
  confidenceCap?: PortfolioRiskConfidenceCap | null;
}

export type PortfolioExposureResearchDominantType = 'position' | 'currency' | 'market' | 'none';

export interface PortfolioExposureResearchDominantExposure {
  type: PortfolioExposureResearchDominantType;
  symbol?: string | null;
  label?: string | null;
  market?: string | null;
  currency?: string | null;
  marketValue?: PortfolioDecimal | null;
  weightPct?: number | null;
  fxStatus?: string | null;
}

export interface PortfolioExposureResearchConcentrationContext {
  state?: string | null;
  topWeightPct?: number | null;
  alert?: boolean | null;
  holdingCount?: number | null;
  accountCount?: number | null;
  dominantType?: string | null;
  dominantLabel?: string | null;
}

export interface PortfolioExposureResearchCurrencyContext {
  state?: string | null;
  baseCurrency?: string | null;
  fxFreshnessState?: string | null;
  largestCurrency?: {
    currency?: string | null;
    label?: string | null;
    weightPct?: number | null;
    fxStatus?: string | null;
  } | null;
  stalePairs?: string[];
}

export interface PortfolioExposureResearchMarketContext {
  state?: string | null;
  largestMarket?: {
    market?: string | null;
    label?: string | null;
    weightPct?: number | null;
  } | null;
  marketBreakdown?: Array<{
    market?: string | null;
    weightPct?: number | null;
    positionCount?: number | null;
  }>;
  benchmarkMappingState?: string | null;
  factorMappingState?: string | null;
  sectorContextState?: string | null;
}

export interface PortfolioExposureResearchStaleInput {
  input: string;
  status?: string | null;
  reason?: string | null;
}

export interface PortfolioExposureResearchObservationBoundary {
  observationOnly?: boolean | null;
  decisionGrade?: boolean | null;
  accountingMutation?: boolean | null;
  portfolioMutation?: boolean | null;
  adviceBoundary?: string | null;
  message?: string | null;
}

export interface PortfolioExposureResearchNextStep {
  topic: string;
  check?: string | null;
}

export interface PortfolioExposureResearchContext {
  dominantExposure: PortfolioExposureResearchDominantExposure;
  concentrationContext: PortfolioExposureResearchConcentrationContext;
  currencyContext: PortfolioExposureResearchCurrencyContext;
  marketContext: PortfolioExposureResearchMarketContext;
  staleInputs: PortfolioExposureResearchStaleInput[];
  evidenceGaps: string[];
  observationBoundary: PortfolioExposureResearchObservationBoundary;
  researchNextSteps: PortfolioExposureResearchNextStep[];
}

export type PortfolioRiskExposureReadinessState =
  | 'available'
  | 'missing'
  | 'stale'
  | 'not_configured'
  | 'broker_disabled'
  | 'manual_only';

export interface PortfolioRiskExposureReadinessItem {
  state: PortfolioRiskExposureReadinessState;
  reason: string;
  blockers: string[];
  asOf?: string | null;
}

export interface PortfolioRiskExposureReadinessCategories {
  sectorExposure: PortfolioRiskExposureReadinessItem;
  singleNameConcentration: PortfolioRiskExposureReadinessItem;
  currencyExposure: PortfolioRiskExposureReadinessItem;
  factorStyleExposure: PortfolioRiskExposureReadinessItem;
  liquidityVolatilityExposure: PortfolioRiskExposureReadinessItem;
  benchmarkComparison: PortfolioRiskExposureReadinessItem;
}

export interface PortfolioRiskExposureReadiness {
  contractVersion: 'portfolio_risk_exposure_readiness_v1';
  observationOnly: true;
  decisionGrade: false;
  noAdviceDisclosure: string;
  freshnessStatus: string;
  holdings: PortfolioRiskExposureReadinessItem;
  exposureCategories: PortfolioRiskExposureReadinessCategories;
  benchmarkAvailability: PortfolioRiskExposureReadinessItem;
  blockers: string[];
}

export type PortfolioTruthState =
  | 'no_account'
  | 'account_no_holdings'
  | 'valuation_unavailable'
  | 'valuation_partial'
  | 'fully_valued_zero'
  | 'fully_valued_nonzero';

export type PortfolioTruthAccountState = 'no_account' | 'no_holdings' | 'holdings_present';
export type PortfolioTruthValuationState = 'not_applicable' | 'unavailable' | 'partial' | 'fully_valued';
export type PortfolioTruthValueSemantics = 'not_applicable' | 'unavailable' | 'covered_subtotal' | 'authoritative_total';

export interface PortfolioTruth {
  state: PortfolioTruthState;
  accountState: PortfolioTruthAccountState;
  valuationState: PortfolioTruthValuationState;
  valueSemantics: PortfolioTruthValueSemantics;
  authoritativeTotal: PortfolioDecimal | null;
  coveredSubtotal: PortfolioDecimal | null;
  accountCount: number;
  positionCount: number;
}

export interface PortfolioSnapshotResponse extends PortfolioEvidenceMetadata, PortfolioRiskDiagnosticsResponseFields {
  asOf: string;
  costMethod: PortfolioCostMethod;
  currency: string;
  accountCount: number;
  totalCash: PortfolioDecimal | null;
  totalMarketValue: PortfolioDecimal | null;
  totalEquity: PortfolioDecimal | null;
  realizedPnl: PortfolioDecimal | null;
  unrealizedPnl: PortfolioDecimal | null;
  feeTotal: PortfolioDecimal | null;
  taxTotal: PortfolioDecimal | null;
  fxStale: boolean;
  portfolioTruth: PortfolioTruth;
  fxRates?: PortfolioFxRateItem[];
  portfolioAttribution?: Record<string, unknown>;
  exposureResearchContext?: PortfolioExposureResearchContext | null;
  riskExposureReadiness?: PortfolioRiskExposureReadiness | null;
  analytics?: PortfolioAnalyticsSummary | null;
  accounts: PortfolioAccountSnapshot[];
}

export interface PortfolioConcentrationItem {
  symbol: string;
  marketValueBase: PortfolioDecimal | null;
  weightPct: number | null;
  isAlert: boolean | null;
}

export interface PortfolioSectorConcentrationItem {
  sector: string;
  marketValueBase: PortfolioDecimal | null;
  weightPct: number | null;
  symbolCount: number;
  isAlert: boolean | null;
}

export interface PortfolioDrawdownBlock {
  seriesPoints: number;
  maxDrawdownPct: number | null;
  currentDrawdownPct: number | null;
  alert: boolean | null;
  fxStale: boolean;
  calculationStatus: 'available' | 'unavailable' | 'not_evaluated';
  unavailableReason?: string | null;
}

export interface PortfolioStopLossItem {
  accountId: number;
  symbol: string;
  avgCost: PortfolioDecimal;
  lastPrice: PortfolioDecimal;
  lossPct: number;
  nearThresholdPct: number;
  isTriggered: boolean;
}

export interface PortfolioRiskResponse extends PortfolioEvidenceMetadata, PortfolioRiskDiagnosticsResponseFields {
  asOf: string;
  accountId?: number | null;
  costMethod: PortfolioCostMethod;
  currency: string;
  portfolioTruth: PortfolioTruth;
  thresholds: Record<string, number>;
  concentration: {
    totalMarketValue: PortfolioDecimal | null;
    topWeightPct: number | null;
    alert: boolean | null;
    topPositions: PortfolioConcentrationItem[];
  };
  sectorConcentration: {
    totalMarketValue: PortfolioDecimal | null;
    topWeightPct: number | null;
    alert: boolean | null;
    topSectors: PortfolioSectorConcentrationItem[];
    coverage: Record<string, number>;
    errors: string[];
  };
  drawdown: PortfolioDrawdownBlock;
  industryAttribution?: Record<string, unknown>;
  accountAttribution?: Record<string, unknown>;
  exposureResearchContext?: PortfolioExposureResearchContext | null;
  riskExposureReadiness?: PortfolioRiskExposureReadiness | null;
  stopLoss: {
    nearAlert: boolean;
    triggeredCount: number;
    nearCount: number;
    items: PortfolioStopLossItem[];
  };
}

export interface PortfolioTradeCreateRequest {
  accountId: number;
  symbol: string;
  tradeDate: string;
  side: PortfolioSide;
  quantity: PortfolioDecimal;
  price: PortfolioDecimal;
  fee?: PortfolioDecimal;
  tax?: PortfolioDecimal;
  market?: 'cn' | 'hk' | 'us';
  currency?: string;
  tradeUid?: string;
  note?: string;
}

export interface PortfolioTradeUpdateRequest {
  accountId?: number;
  symbol?: string;
  tradeDate?: string;
  side?: PortfolioSide;
  quantity?: PortfolioDecimal;
  price?: PortfolioDecimal;
  fee?: PortfolioDecimal;
  tax?: PortfolioDecimal;
  market?: 'cn' | 'hk' | 'us';
  currency?: string;
  note?: string;
}

export interface PortfolioCashLedgerCreateRequest {
  accountId: number;
  eventDate: string;
  direction: PortfolioCashDirection;
  amount: PortfolioDecimal;
  currency?: string;
  note?: string;
}

export interface PortfolioCorporateActionCreateRequest {
  accountId: number;
  symbol: string;
  effectiveDate: string;
  actionType: PortfolioCorporateActionType;
  market?: 'cn' | 'hk' | 'us';
  currency?: string;
  cashDividendPerShare?: PortfolioDecimal;
  splitRatio?: PortfolioDecimal;
  note?: string;
}

export interface PortfolioEventCreatedResponse {
  id: number;
}

export interface PortfolioDeleteResponse {
  deleted: number;
  deleteMode?: 'soft' | 'hard' | null;
}

export interface PortfolioTradeListItem {
  id: number;
  accountId: number;
  tradeUid?: string | null;
  symbol: string;
  market: string;
  currency: string;
  tradeDate: string;
  side: PortfolioSide;
  quantity: PortfolioDecimal;
  price: PortfolioDecimal;
  fee: PortfolioDecimal;
  tax: PortfolioDecimal;
  note?: string | null;
  isActive?: boolean;
  voidedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface PortfolioTradeListResponse {
  items: PortfolioTradeListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PortfolioCashLedgerListItem {
  id: number;
  accountId: number;
  eventDate: string;
  direction: PortfolioCashDirection;
  amount: PortfolioDecimal;
  currency: string;
  note?: string | null;
  createdAt?: string | null;
}

export interface PortfolioCashLedgerListResponse {
  items: PortfolioCashLedgerListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PortfolioCorporateActionListItem {
  id: number;
  accountId: number;
  symbol: string;
  market: string;
  currency: string;
  effectiveDate: string;
  actionType: PortfolioCorporateActionType;
  cashDividendPerShare?: PortfolioDecimal | null;
  splitRatio?: PortfolioDecimal | null;
  note?: string | null;
  createdAt?: string | null;
}

export interface PortfolioCorporateActionListResponse {
  items: PortfolioCorporateActionListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PortfolioImportTradeItem {
  tradeDate: string;
  symbol: string;
  side: PortfolioSide;
  quantity: PortfolioDecimal;
  price: PortfolioDecimal;
  fee: PortfolioDecimal;
  tax: PortfolioDecimal;
  tradeUid?: string | null;
  dedupHash: string;
  market?: string | null;
  currency?: string | null;
  note?: string | null;
}

export interface PortfolioImportCashEntryItem {
  eventDate: string;
  direction: PortfolioCashDirection;
  amount: PortfolioDecimal;
  currency: string;
  note?: string | null;
}

export interface PortfolioImportCorporateActionItem {
  effectiveDate: string;
  symbol: string;
  market: string;
  currency: string;
  actionType: PortfolioCorporateActionType;
  cashDividendPerShare?: PortfolioDecimal | null;
  splitRatio?: PortfolioDecimal | null;
  note?: string | null;
}

export interface PortfolioImportParseResponse {
  broker: string;
  recordCount: number;
  skippedCount: number;
  errorCount: number;
  records: PortfolioImportTradeItem[];
  cashRecordCount: number;
  cashEntries: PortfolioImportCashEntryItem[];
  corporateActionCount: number;
  corporateActions: PortfolioImportCorporateActionItem[];
  warnings: string[];
  metadata: Record<string, unknown>;
  errors: string[];
}

export interface PortfolioImportCommitResponse {
  accountId: number;
  recordCount: number;
  insertedCount: number;
  duplicateCount: number;
  failedCount: number;
  cashRecordCount: number;
  cashInsertedCount: number;
  cashFailedCount: number;
  corporateActionCount: number;
  corporateActionInsertedCount: number;
  corporateActionFailedCount: number;
  dryRun: boolean;
  duplicateImport: boolean;
  brokerConnectionId?: number | null;
  warnings: string[];
  metadata: Record<string, unknown>;
  errors: string[];
  acceptedCount?: number;
  rejectedCount?: number;
  previewOnly?: boolean;
  requiresConfirmation?: boolean;
  duplicateCandidates?: Record<string, unknown>[];
  unknownSymbols?: Record<string, unknown>[];
  currencyIssues?: Record<string, unknown>[];
  accountMapping?: Record<string, unknown>;
  validationChecks?: Record<string, unknown>[];
  recoveryActions?: string[];
}

export interface PortfolioImportBrokerItem {
  broker: string;
  aliases: string[];
  displayName?: string;
  fileExtensions?: string[];
}

export interface PortfolioImportBrokerListResponse {
  brokers: PortfolioImportBrokerItem[];
}

export interface PortfolioFxRefreshResponse {
  asOf: string;
  accountCount: number;
  refreshEnabled?: boolean;
  disabledReason?: string | null;
  pairCount: number;
  updatedCount: number;
  staleCount: number;
  errorCount: number;
}

export interface PortfolioStructureReviewLargestHolding {
  ticker?: string | null;
  percent?: number | null;
}

export interface PortfolioStructureReviewAggregateSummary {
  asOf?: string | null;
  accountCount?: number | null;
  holdingCount?: number | null;
  evaluatedCount?: number | null;
  largestHolding?: PortfolioStructureReviewLargestHolding | null;
}

export interface PortfolioStructureReviewExposureItem {
  key: string;
  label: string;
  marketValue: PortfolioDecimal;
  displayCurrency: string;
  percent: number;
  holdingCount: number;
}

export interface PortfolioStructureReviewEvidenceQuality {
  score?: number | null;
  status?: string | null;
}

export interface PortfolioStructureReviewResearchNotes {
  watchNext: string[];
  needsMoreEvidence: string[];
  riskFlags: string[];
}

export interface PortfolioStructureReviewMissingEvidenceItem {
  kind: string;
  message: string;
}

export interface PortfolioStructureReviewLinkTarget {
  label: string;
  route: string;
  section: string;
  reason: string;
}

export interface PortfolioStructureReviewDegradedLinkage {
  surface: string;
  status: 'degraded' | 'unavailable';
  reason: string;
  message: string;
}

export interface PortfolioStructureReviewHoldingDrilldown {
  ticker: string;
  structureLinks: PortfolioStructureReviewLinkTarget[];
  radarLinks: PortfolioStructureReviewLinkTarget[];
  watchlistLinks: PortfolioStructureReviewLinkTarget[];
  scenarioLinks: PortfolioStructureReviewLinkTarget[];
  evidenceLinkage: 'available' | 'degraded' | 'unavailable';
  degradedLinkage: PortfolioStructureReviewDegradedLinkage[];
}

export interface PortfolioStructureReviewEvidenceLinkage {
  status: 'available' | 'degraded' | 'unavailable';
  availableHoldings: number;
  degradedHoldings: number;
  unavailableHoldings: number;
}

export interface PortfolioStructureReviewResearchLinkage {
  status: 'available' | 'degraded' | 'unavailable';
  holdingDrilldowns: PortfolioStructureReviewHoldingDrilldown[];
  structureLinks: PortfolioStructureReviewLinkTarget[];
  radarLinks: PortfolioStructureReviewLinkTarget[];
  watchlistLinks: PortfolioStructureReviewLinkTarget[];
  scenarioLinks: PortfolioStructureReviewLinkTarget[];
  evidenceLinkage: PortfolioStructureReviewEvidenceLinkage;
  degradedLinkage: PortfolioStructureReviewDegradedLinkage[];
}

export interface PortfolioStructureReviewConsumerIssue {
  label: string;
  message: string;
  severity: string;
  category: string;
}

export interface PortfolioStructureReviewHolding {
  ticker: string;
  structureState: string;
  confidence: 'high' | 'medium' | 'low';
  evidenceQuality: PortfolioStructureReviewEvidenceQuality;
  riskFlags: string[];
  researchNotes: PortfolioStructureReviewResearchNotes;
  missingEvidence: PortfolioStructureReviewMissingEvidenceItem[];
}

export interface PortfolioStructureReviewStateCountMap {
  [state: string]: number;
}

export interface PortfolioStructureReviewStrongestStructureItem {
  ticker?: string | null;
  structureState?: string | null;
  score?: number | null;
}

export interface PortfolioStructureReviewWeakestEvidenceItem {
  ticker?: string | null;
  status?: string | null;
  usableBars?: number | null;
  evidenceQuality?: number | null;
}

export interface PortfolioStructureReviewCommonRiskFlagItem {
  flag?: string | null;
  count?: number | null;
  tickers?: string[];
}

export interface PortfolioStructureReviewDataQuality {
  status?: string | null;
  holdingMetadataStatus?: string | null;
  structureEvidenceStatus?: string | null;
  readOnly?: boolean | null;
  failClosed?: boolean | null;
}

export interface PortfolioStructureReviewResponse {
  schemaVersion: string;
  aggregateSummary: PortfolioStructureReviewAggregateSummary;
  exposureByThemeOrSector: PortfolioStructureReviewExposureItem[];
  countsByStructureState: PortfolioStructureReviewStateCountMap;
  holdingsStructure: PortfolioStructureReviewHolding[];
  strongestStructures: PortfolioStructureReviewStrongestStructureItem[];
  weakestEvidence: PortfolioStructureReviewWeakestEvidenceItem[];
  commonRiskFlags: PortfolioStructureReviewCommonRiskFlagItem[];
  missingEvidence: PortfolioStructureReviewMissingEvidenceItem[];
  researchLinkage: PortfolioStructureReviewResearchLinkage | undefined;
  readOnly: boolean | undefined;
  failClosed: boolean | undefined;
  consumerState: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE' | undefined;
  consumerSummary: string | undefined;
  consumerMessage: string | undefined;
  drilldownSymbols: string[] | undefined;
  dataQuality: PortfolioStructureReviewDataQuality;
  consumerIssues: PortfolioStructureReviewConsumerIssue[] | undefined;
  noAdviceDisclosure: string;
}

export interface PortfolioScenarioRiskPositionInput {
  symbol: string;
  weight?: PortfolioDecimal | null;
  weightPct?: PortfolioDecimal | null;
  marketValueBase?: PortfolioDecimal | null;
  baseCurrency?: string | null;
  bucket?: string | null;
  bucketLabel?: string | null;
  theme?: string | null;
  factor?: string | null;
}

export interface PortfolioScenarioRiskExposureInput {
  symbol: string;
  label: string;
  labelType?: string | null;
  exposure?: PortfolioDecimal | null;
}

export interface PortfolioScenarioRiskShockValueInput {
  shockPct?: PortfolioDecimal | null;
  labelType?: string | null;
}

export interface PortfolioScenarioRiskScenarioInput {
  name: string;
  shocks: Record<string, PortfolioDecimal | PortfolioScenarioRiskShockValueInput>;
}

export interface PortfolioScenarioRiskRequest {
  asOf: string;
  baseCurrency: string;
  positions: PortfolioScenarioRiskPositionInput[];
  exposures: PortfolioScenarioRiskExposureInput[];
  scenarioShocks: PortfolioScenarioRiskScenarioInput[];
}

export interface PortfolioScenarioRiskCoverage {
  totalPositions?: number;
  positionsWithUsableWeight?: number;
  positionsWithMarketValue?: number;
  effectiveWeightSum?: PortfolioDecimal;
  totalMarketValue?: PortfolioDecimal | null;
  explicitExposureRows?: number;
  labelsWithExplicitCoverage?: string[];
}

export interface PortfolioScenarioRiskAppliedShock {
  label: string;
  labelType?: string;
  shockPct?: PortfolioDecimal | null;
  exposure?: PortfolioDecimal | null;
  impactPct?: PortfolioDecimal | null;
  impactAmount?: PortfolioDecimal | null;
}

export interface PortfolioScenarioRiskPositionContribution {
  symbol: string;
  bucket?: string | null;
  weight?: PortfolioDecimal | null;
  marketValue?: PortfolioDecimal | null;
  impactPct?: PortfolioDecimal | null;
  impactAmount?: PortfolioDecimal | null;
  contributionToScenarioLoss?: PortfolioDecimal | null;
  warnings?: string[];
  appliedShocks?: PortfolioScenarioRiskAppliedShock[];
}

export interface PortfolioScenarioRiskBucketContribution {
  bucket: string;
  positionCount?: number;
  impactPct?: PortfolioDecimal | null;
  impactAmount?: PortfolioDecimal | null;
  contributionToScenarioLoss?: PortfolioDecimal | null;
}

export interface PortfolioScenarioRiskMissingCoverage {
  label: string;
  labelType?: string;
  missingSymbols?: string[];
}

export interface PortfolioScenarioRiskScenarioResult {
  name: string;
  portfolioImpactPct?: PortfolioDecimal | null;
  portfolioImpactAmount?: PortfolioDecimal | null;
  coveredWeight?: PortfolioDecimal | null;
  coveredMarketValue?: PortfolioDecimal | null;
  warnings?: string[];
  missingCoverage?: PortfolioScenarioRiskMissingCoverage[];
  positionContributions?: PortfolioScenarioRiskPositionContribution[];
  bucketContributions?: PortfolioScenarioRiskBucketContribution[];
}

export interface PortfolioScenarioRiskMetadata {
  sideEffectFree?: boolean;
  noBrokerSync?: boolean;
  noAccountingMutation?: boolean;
  noOrderPlacement?: boolean;
  notInvestmentAdvice?: boolean;
}

export interface PortfolioScenarioRiskResponse {
  readModelType: string;
  advisoryOnly: boolean;
  accountingMutation: boolean | undefined;
  brokerIntegration: boolean | undefined;
  tradeExecution: boolean | undefined;
  executionReadiness: string | undefined;
  asOf?: string | null;
  baseCurrency: string;
  coverage: PortfolioScenarioRiskCoverage;
  scenarios: PortfolioScenarioRiskScenarioResult[];
  insufficientDataReasons: string[];
  missingDataWarnings: string[];
  metadata: PortfolioScenarioRiskMetadata;
}
