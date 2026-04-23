import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pie, PieChart, ResponsiveContainer, Tooltip, Legend, Cell } from 'recharts';
import { portfolioApi } from '../api/portfolio';
import type { ParsedApiError } from '../api/error';
import { getParsedApiError } from '../api/error';
import { ApiErrorAlert, Card, Badge, ConfirmDialog, Disclosure, WorkspacePageHeader } from '../components/common';
import { useI18n } from '../contexts/UiLanguageContext';
import { toDateInputValue } from '../utils/format';
import { getMarketDirectionColor } from '../utils/marketColors';
import type {
  PortfolioAccountItem,
  PortfolioBrokerConnectionItem,
  PortfolioCashDirection,
  PortfolioCashLedgerListItem,
  PortfolioCorporateActionListItem,
  PortfolioCorporateActionType,
  PortfolioCostMethod,
  PortfolioFxRefreshResponse,
  PortfolioImportBrokerItem,
  PortfolioImportCommitResponse,
  PortfolioImportParseResponse,
  PortfolioIbkrSyncResponse,
  PortfolioPositionItem,
  PortfolioRiskResponse,
  PortfolioSide,
  PortfolioSnapshotResponse,
  PortfolioTradeListItem,
} from '../types/portfolio';

const PIE_COLORS = ['#f0f0fa', '#d8d8e2', '#b5b5c1', '#8d8d98', '#6b6b74', '#4c4c53'];
const DEFAULT_PAGE_SIZE = 20;
const FALLBACK_BROKERS: PortfolioImportBrokerItem[] = [
  { broker: 'huatai', aliases: [], displayName: '华泰', fileExtensions: ['csv'] },
  { broker: 'citic', aliases: ['zhongxin'], displayName: '中信', fileExtensions: ['csv'] },
  { broker: 'cmb', aliases: ['cmbchina', 'zhaoshang'], displayName: '招商', fileExtensions: ['csv'] },
  { broker: 'ibkr', aliases: ['interactivebrokers'], displayName: 'Interactive Brokers', fileExtensions: ['xml'] },
];

type AccountOption = 'all' | number;
type EventType = 'trade' | 'cash' | 'corporate';

type FlatPosition = PortfolioPositionItem & {
  accountId: number;
  accountName: string;
};

type PendingDelete =
  | { eventType: 'trade'; id: number; message: string }
  | { eventType: 'cash'; id: number; message: string }
  | { eventType: 'corporate'; id: number; message: string };

type FxRefreshFeedback = {
  tone: 'neutral' | 'success' | 'warning';
  text: string;
};

type FxRefreshContext = {
  viewKey: string;
  requestId: number;
};

type PortfolioLanguage = 'zh' | 'en';

type TranslateFn = (key: string, vars?: Record<string, string | number | undefined>) => string;

function getPortfolioCopy(
  t: TranslateFn,
  language: PortfolioLanguage,
){
  const copy = {
    documentTitle: t('portfolio.documentTitle'),
    eyebrow: t('portfolio.eyebrow'),
    title: t('portfolio.title'),
    description: t('portfolio.description'),
    createAccount: t('portfolio.createAccount'),
    collapseCreate: t('portfolio.collapseCreate'),
    refreshData: t('portfolio.refreshData'),
    refreshingData: t('portfolio.refreshingData'),
    noAccounts: t('portfolio.noAccounts'),
    accountView: t('portfolio.accountView'),
    allAccounts: t('portfolio.allAccounts'),
    costMethod: t('portfolio.costMethod'),
    costFifo: t('portfolio.costFifo'),
    costAvg: t('portfolio.costAvg'),
    scopeHint: t('portfolio.scopeHint'),
    fxState: t('portfolio.fxState'),
    refreshFx: t('portfolio.refreshFx'),
    refreshingFx: t('portfolio.refreshingFx'),
    emptyConcentration: t('portfolio.emptyConcentration'),
    noBrokerConnections: t('portfolio.noBrokerConnections'),
    emptyEventsTitle: t('portfolio.emptyEventsTitle'),
    emptyEventsBody: t('portfolio.emptyEventsBody'),
    prevPage: t('portfolio.prevPage'),
    nextPage: t('portfolio.nextPage'),
    pageLabel: t('portfolio.pageLabel'),
    deleteTitle: t('portfolio.deleteTitle'),
    deleteMessage: t('portfolio.deleteMessage'),
    deleteConfirm: t('portfolio.deleteConfirm'),
    deleteInProgress: t('portfolio.deleteInProgress'),
    cancel: t('portfolio.cancel'),
    accountNameRequired: t('portfolio.accountNameRequired'),
    accountCreated: t('portfolio.accountCreated'),
    accountCreateFailed: t('portfolio.accountCreateFailed'),
    riskFallback: t('portfolio.riskFallback'),
    writeRequiresAccount: t('portfolio.writeRequiresAccount'),
    syncRequiresAccount: t('portfolio.syncRequiresAccount'),
    syncRequiresToken: t('portfolio.syncRequiresToken'),
    deleteRequiresAccount: t('portfolio.deleteRequiresAccount'),
    riskDegraded: t('portfolio.riskDegraded'),
    actionHint: t('portfolio.actionHint'),
    createAccountTitle: t('portfolio.createAccountTitle'),
    createAccountHelp: t('portfolio.createAccountHelp'),
    accountNamePlaceholder: t('portfolio.accountNamePlaceholder'),
    brokerPlaceholder: t('portfolio.brokerPlaceholder'),
    baseCurrencyPlaceholder: t('portfolio.baseCurrencyPlaceholder'),
    marketCn: t('portfolio.marketCn'),
    marketHk: t('portfolio.marketHk'),
    marketUs: t('portfolio.marketUs'),
    marketGlobal: t('portfolio.marketGlobal'),
    creatingAccount: t('portfolio.creatingAccount'),
    totalEquity: t('portfolio.totalEquity'),
    totalMarketValue: t('portfolio.totalMarketValue'),
    totalCash: t('portfolio.totalCash'),
    fxFresh: t('portfolio.fxFresh'),
    fxStale: t('portfolio.fxStale'),
    drawdownTitle: t('portfolio.drawdownTitle'),
    maxDrawdown: t('portfolio.maxDrawdown'),
    currentDrawdown: t('portfolio.currentDrawdown'),
    alert: t('portfolio.alert'),
    yes: t('portfolio.yes'),
    no: t('portfolio.no'),
    stopLossTitle: t('portfolio.stopLossTitle'),
    triggeredCount: t('portfolio.triggeredCount'),
    nearCount: t('portfolio.nearCount'),
    snapshotBasisTitle: t('portfolio.snapshotBasisTitle'),
    accountCount: t('portfolio.accountCount'),
    reportingCurrency: t('portfolio.reportingCurrency'),
    costMethodLabel: t('portfolio.costMethodLabel'),
    allAccountsWarning: t('portfolio.allAccountsWarning'),
    positionsTitle: t('portfolio.positionsTitle'),
    positionsCount: (count: number) => t('portfolio.positionsCount', { count }),
    noPositions: t('portfolio.noPositions'),
    positionAccount: t('portfolio.positionAccount'),
    positionCode: t('portfolio.positionCode'),
    positionMarketCurrency: t('portfolio.positionMarketCurrency'),
    positionQuantity: t('portfolio.positionQuantity'),
    positionAvgCost: t('portfolio.positionAvgCost'),
    positionLastPrice: t('portfolio.positionLastPrice'),
    positionMarketValue: t('portfolio.positionMarketValue'),
    positionUnrealized: t('portfolio.positionUnrealized'),
    sectorConcentration: t('portfolio.sectorConcentration'),
    singleNameConcentration: t('portfolio.singleNameConcentration'),
    concentrationHint: t('portfolio.concentrationHint'),
    concentrationScope: t('portfolio.concentrationScope'),
    concentrationScopeSector: t('portfolio.concentrationScopeSector'),
    concentrationScopeFallback: t('portfolio.concentrationScopeFallback'),
    sectorAlert: t('portfolio.sectorAlert'),
    topWeight: t('portfolio.topWeight'),
    dataSyncTitle: t('portfolio.dataSyncTitle'),
    brokerImport: t('portfolio.brokerImport'),
    currentImportAccount: t('portfolio.currentImportAccount'),
    brokerFallbackEmpty: t('portfolio.brokerFallbackEmpty'),
    brokerFallbackUnavailable: t('portfolio.brokerFallbackUnavailable'),
    selectBrokerExport: t('portfolio.selectBrokerExport'),
    selectIbkrExport: t('portfolio.selectIbkrExport'),
    dryRun: t('portfolio.dryRun'),
    parsing: t('portfolio.parsing'),
    parseFile: t('portfolio.parseFile'),
    committing: t('portfolio.committing'),
    commitImport: t('portfolio.commitImport'),
    brokerImportHint: t('portfolio.brokerImportHint'),
    ibkrImportHint: t('portfolio.ibkrImportHint'),
    ibkrReadOnlyTitle: t('portfolio.ibkrReadOnlyTitle'),
    ibkrReadOnlyBody: t('portfolio.ibkrReadOnlyBody'),
    readOnlyBadge: t('portfolio.readOnlyBadge'),
    ibkrApiBasePlaceholder: t('portfolio.ibkrApiBasePlaceholder'),
    ibkrAccountRefPlaceholder: t('portfolio.ibkrAccountRefPlaceholder'),
    ibkrSessionTokenPlaceholder: t('portfolio.ibkrSessionTokenPlaceholder'),
    verifyIbkrSsl: t('portfolio.verifyIbkrSsl'),
    syncing: t('portfolio.syncing'),
    syncIbkr: t('portfolio.syncIbkr'),
    syncResult: t('portfolio.syncResult'),
    positionsCountLabel: t('portfolio.positionsCountLabel'),
    cashCurrenciesLabel: t('portfolio.cashCurrenciesLabel'),
    accountRef: t('portfolio.accountRef'),
    syncedAt: t('portfolio.syncedAt'),
    syncOverlay: t('portfolio.syncOverlay'),
    syncSaved: t('portfolio.syncSaved'),
    parseResult: t('portfolio.parseResult'),
    valid: t('portfolio.valid'),
    cash: t('portfolio.cash'),
    corporateActions: t('portfolio.corporateActions'),
    skipped: t('portfolio.skipped'),
    errors: t('portfolio.errors'),
    accountMapping: t('portfolio.accountMapping'),
    commitResult: t('portfolio.commitResult'),
    inserted: t('portfolio.inserted'),
    duplicates: t('portfolio.duplicates'),
    failed: t('portfolio.failed'),
    duplicateFingerprintHint: t('portfolio.duplicateFingerprintHint'),
    manualAdjustments: t('portfolio.manualAdjustments'),
    manualTrade: t('portfolio.manualTrade'),
    symbolPlaceholder: t('portfolio.symbolPlaceholder'),
    buy: t('portfolio.buy'),
    sell: t('portfolio.sell'),
    quantity: t('portfolio.quantity'),
    price: t('portfolio.price'),
    feeOptional: t('portfolio.feeOptional'),
    taxOptional: t('portfolio.taxOptional'),
    submitTrade: t('portfolio.submitTrade'),
    manualCash: t('portfolio.manualCash'),
    cashIn: t('portfolio.cashIn'),
    cashOut: t('portfolio.cashOut'),
    amount: t('portfolio.amount'),
    currencyOptional: (currency: string) => t('portfolio.currencyOptional', {
      currency: currency || t('portfolio.accountBaseCurrencyFallback'),
    }),
    submitCash: t('portfolio.submitCash'),
    manualCorporate: t('portfolio.manualCorporate'),
    stockCode: t('portfolio.stockCode'),
    cashDividend: t('portfolio.cashDividend'),
    splitAdjustment: t('portfolio.splitAdjustment'),
    dividendPerShare: t('portfolio.dividendPerShare'),
    splitRatio: t('portfolio.splitRatio'),
    submitCorporate: t('portfolio.submitCorporate'),
    ledgerAudit: t('portfolio.ledgerAudit'),
    tradeLedger: t('portfolio.tradeLedger'),
    cashLedger: t('portfolio.cashLedger'),
    corporateLedger: t('portfolio.corporateLedger'),
    loading: t('portfolio.loading'),
    refreshLedger: t('portfolio.refreshLedger'),
    filterBySymbol: t('portfolio.filterBySymbol'),
    allSides: t('portfolio.allSides'),
    allDirections: t('portfolio.allDirections'),
    allActions: t('portfolio.allActions'),
    deleteHintBlocked: t('portfolio.deleteHintBlocked'),
    deleteHintReady: t('portfolio.deleteHintReady'),
    tradeDeleteMessage: (item: PortfolioTradeListItem) => t('portfolio.tradeDeleteMessage', {
      tradeDate: item.tradeDate,
      sideLabel: formatSideLabel(item.side, language),
      symbol: item.symbol,
      quantity: item.quantity,
      price: item.price,
    }),
    cashDeleteMessage: (item: PortfolioCashLedgerListItem) => t('portfolio.cashDeleteMessage', {
      eventDate: item.eventDate,
      directionLabel: formatCashDirectionLabel(item.direction, language),
      amount: item.amount,
      currency: item.currency,
    }),
    corporateDeleteMessage: (item: PortfolioCorporateActionListItem) => t('portfolio.corporateDeleteMessage', {
      effectiveDate: item.effectiveDate,
      actionLabel: formatCorporateActionLabel(item.actionType, language),
      symbol: item.symbol,
    }),
  };

  return copy;
}

function getTodayIso(): string {
  return toDateInputValue(new Date());
}

function formatMoney(value: number | undefined | null, currency = 'CNY'): string {
  if (value == null || Number.isNaN(value)) return '--';
  return `${currency} ${Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPct(value: number | undefined | null): string {
  if (value == null || Number.isNaN(value)) return '--';
  return `${value.toFixed(2)}%`;
}

function formatSideLabel(value: PortfolioSide, language: PortfolioLanguage): string {
  if (language === 'en') {
    return value === 'buy' ? 'Buy' : 'Sell';
  }
  return value === 'buy' ? '买入' : '卖出';
}

function formatCashDirectionLabel(value: PortfolioCashDirection, language: PortfolioLanguage): string {
  if (language === 'en') {
    return value === 'in' ? 'Cash in' : 'Cash out';
  }
  return value === 'in' ? '流入' : '流出';
}

function formatCorporateActionLabel(value: PortfolioCorporateActionType, language: PortfolioLanguage): string {
  if (language === 'en') {
    return value === 'cash_dividend' ? 'Cash dividend' : 'Split adjustment';
  }
  return value === 'cash_dividend' ? '现金分红' : '拆并股调整';
}

function formatBrokerLabel(value: string, displayName: string | undefined, language: PortfolioLanguage): string {
  const englishKnownName = value === 'huatai'
    ? 'Huatai'
    : value === 'citic'
      ? 'Citic'
      : value === 'cmb'
        ? 'CMB'
        : value === 'ibkr'
          ? 'Interactive Brokers'
          : null;
  if (language === 'en' && englishKnownName) {
    return `${value} (${englishKnownName})`;
  }
  if (displayName && displayName.trim()) {
    return language === 'en' ? `${value} (${displayName.trim()})` : `${value}（${displayName.trim()}）`;
  }
  if (value === 'huatai') return language === 'en' ? 'huatai (Huatai)' : 'huatai（华泰）';
  if (value === 'citic') return language === 'en' ? 'citic (Citic)' : 'citic（中信）';
  if (value === 'cmb') return language === 'en' ? 'cmb (CMB)' : 'cmb（招商）';
  if (value === 'ibkr') return language === 'en' ? 'ibkr (Interactive Brokers)' : 'ibkr（Interactive Brokers）';
  return value;
}

function formatAccountMarketLabel(value: string, language: PortfolioLanguage): string {
  if (language === 'en') {
    if (value === 'global') return 'Global';
    if (value === 'hk') return 'Hong Kong';
    if (value === 'us') return 'US';
    return 'A-share';
  }
  if (value === 'global') return '全球市场';
  if (value === 'hk') return '港股';
  if (value === 'us') return '美股';
  return 'A 股';
}

function formatBrokerConnectionStatus(value: string, language: PortfolioLanguage): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (language === 'en') {
    if (normalized === 'active') return 'Active';
    if (normalized === 'inactive') return 'Inactive';
    if (normalized === 'disabled') return 'Disabled';
    if (normalized === 'error') return 'Error';
    return value || '--';
  }
  if (normalized === 'active') return '已连接';
  if (normalized === 'inactive') return '未启用';
  if (normalized === 'disabled') return '已停用';
  if (normalized === 'error') return '异常';
  return value || '--';
}

function formatPositionContext(market: string, currency: string): string {
  const marketLabel = market === 'hk' ? 'HK' : market === 'us' ? 'US' : market === 'cn' ? 'CN' : market.toUpperCase();
  return `${marketLabel} / ${currency || '--'}`;
}

function extractIbkrSyncConfig(connection?: PortfolioBrokerConnectionItem | null): {
  apiBaseUrl?: string;
  verifySsl?: boolean;
  brokerAccountRef?: string;
  lastSyncAt?: string;
} {
  const metadata = connection?.syncMetadata;
  if (!metadata || typeof metadata !== 'object') {
    return {};
  }
  const nested = (metadata as Record<string, unknown>).ibkrApi;
  if (!nested || typeof nested !== 'object') {
    return {};
  }
  const record = nested as Record<string, unknown>;
  return {
    apiBaseUrl: typeof record.apiBaseUrl === 'string' ? record.apiBaseUrl : undefined,
    verifySsl: typeof record.verifySsl === 'boolean' ? record.verifySsl : undefined,
    brokerAccountRef: typeof record.brokerAccountRef === 'string' ? record.brokerAccountRef : undefined,
    lastSyncAt: typeof (metadata as Record<string, unknown>).lastSyncAt === 'string'
      ? ((metadata as Record<string, unknown>).lastSyncAt as string)
      : undefined,
  };
}

function buildFxRefreshFeedback(data: PortfolioFxRefreshResponse, language: PortfolioLanguage): FxRefreshFeedback {
  const isEnglish = language === 'en';
  const pairLabel = (count: number) => `${count} FX ${count === 1 ? 'pair' : 'pairs'}`;
  if (data.refreshEnabled === false) {
    return {
      tone: 'neutral',
      text: isEnglish ? 'Online FX refresh is disabled.' : '汇率在线刷新已被禁用。',
    };
  }

  if (data.pairCount === 0) {
    return {
      tone: 'neutral',
      text: isEnglish ? 'No FX pairs are refreshable in the current scope.' : '当前范围无可刷新的汇率对。',
    };
  }

  if (data.updatedCount > 0 && data.staleCount === 0 && data.errorCount === 0) {
    return {
      tone: 'success',
      text: isEnglish ? `FX refresh completed. Updated ${pairLabel(data.updatedCount)}.` : `汇率已刷新，共更新 ${data.updatedCount} 对。`,
    };
  }

  const summary = isEnglish
    ? `Updated ${pairLabel(data.updatedCount)}, still stale ${pairLabel(data.staleCount)}, failed ${pairLabel(data.errorCount)}.`
    : `更新 ${data.updatedCount} 对，仍过期 ${data.staleCount} 对，失败 ${data.errorCount} 对。`;
  if (data.staleCount > 0) {
    return {
      tone: 'warning',
      text: isEnglish
        ? `Refresh finished with stale or fallback FX pairs still in use. ${summary}`
        : `已尝试刷新，但仍有部分货币对使用旧汇率或备用汇率。${summary}`,
    };
  }

  return {
    tone: 'warning',
    text: isEnglish ? `FX refresh did not fully succeed. ${summary}` : `在线刷新未完全成功。${summary}`,
  };
}

const PortfolioPage: React.FC = () => {
  const { language, t } = useI18n();
  const copy = useMemo(() => getPortfolioCopy(t, language), [language, t]);

  useEffect(() => {
    document.title = copy.documentTitle;
  }, [copy.documentTitle]);

  const [accounts, setAccounts] = useState<PortfolioAccountItem[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<AccountOption>('all');
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  const [accountCreating, setAccountCreating] = useState(false);
  const [accountCreateError, setAccountCreateError] = useState<string | null>(null);
  const [accountCreateSuccess, setAccountCreateSuccess] = useState<string | null>(null);
  const [accountForm, setAccountForm] = useState({
    name: '',
    broker: 'Demo',
    market: 'cn' as 'cn' | 'hk' | 'us' | 'global',
    baseCurrency: 'CNY',
  });
  const [costMethod, setCostMethod] = useState<PortfolioCostMethod>('fifo');
  const [snapshot, setSnapshot] = useState<PortfolioSnapshotResponse | null>(null);
  const [risk, setRisk] = useState<PortfolioRiskResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [fxRefreshing, setFxRefreshing] = useState(false);
  const [fxRefreshFeedback, setFxRefreshFeedback] = useState<FxRefreshFeedback | null>(null);
  const [error, setError] = useState<ParsedApiError | null>(null);
  const [riskWarning, setRiskWarning] = useState<string | null>(null);
  const [writeWarning, setWriteWarning] = useState<string | null>(null);

  const [brokers, setBrokers] = useState<PortfolioImportBrokerItem[]>([]);
  const [brokerConnections, setBrokerConnections] = useState<PortfolioBrokerConnectionItem[]>([]);
  const [selectedBroker, setSelectedBroker] = useState('huatai');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvDryRun, setCsvDryRun] = useState(true);
  const [csvParsing, setCsvParsing] = useState(false);
  const [csvCommitting, setCsvCommitting] = useState(false);
  const [csvParseResult, setCsvParseResult] = useState<PortfolioImportParseResponse | null>(null);
  const [csvCommitResult, setCsvCommitResult] = useState<PortfolioImportCommitResponse | null>(null);
  const [brokerLoadWarning, setBrokerLoadWarning] = useState<string | null>(null);
  const [ibkrApiBaseUrl, setIbkrApiBaseUrl] = useState('https://localhost:5000/v1/api');
  const [ibkrVerifySsl, setIbkrVerifySsl] = useState(false);
  const [ibkrSessionToken, setIbkrSessionToken] = useState('');
  const [ibkrBrokerAccountRef, setIbkrBrokerAccountRef] = useState('');
  const [ibkrSyncing, setIbkrSyncing] = useState(false);
  const [ibkrSyncResult, setIbkrSyncResult] = useState<PortfolioIbkrSyncResponse | null>(null);

  const [eventType, setEventType] = useState<EventType>('trade');
  const [eventDateFrom, setEventDateFrom] = useState('');
  const [eventDateTo, setEventDateTo] = useState('');
  const [eventSymbol, setEventSymbol] = useState('');
  const [eventSide, setEventSide] = useState<'' | PortfolioSide>('');
  const [eventDirection, setEventDirection] = useState<'' | PortfolioCashDirection>('');
  const [eventActionType, setEventActionType] = useState<'' | PortfolioCorporateActionType>('');
  const [eventPage, setEventPage] = useState(1);
  const [eventTotal, setEventTotal] = useState(0);
  const [eventLoading, setEventLoading] = useState(false);
  const [tradeEvents, setTradeEvents] = useState<PortfolioTradeListItem[]>([]);
  const [cashEvents, setCashEvents] = useState<PortfolioCashLedgerListItem[]>([]);
  const [corporateEvents, setCorporateEvents] = useState<PortfolioCorporateActionListItem[]>([]);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [tradeForm, setTradeForm] = useState({
    symbol: '',
    tradeDate: getTodayIso(),
    side: 'buy' as PortfolioSide,
    quantity: '',
    price: '',
    fee: '',
    tax: '',
    tradeUid: '',
    note: '',
  });
  const [cashForm, setCashForm] = useState({
    eventDate: getTodayIso(),
    direction: 'in' as PortfolioCashDirection,
    amount: '',
    currency: '',
    note: '',
  });
  const [corpForm, setCorpForm] = useState({
    symbol: '',
    effectiveDate: getTodayIso(),
    actionType: 'cash_dividend' as PortfolioCorporateActionType,
    cashDividendPerShare: '',
    splitRatio: '',
    note: '',
  });

  const queryAccountId = selectedAccount === 'all' ? undefined : selectedAccount;
  const refreshViewKey = `${selectedAccount === 'all' ? 'all' : `account:${selectedAccount}`}:cost:${costMethod}`;
  const refreshContextRef = useRef<FxRefreshContext>({ viewKey: refreshViewKey, requestId: 0 });
  const hasAccounts = accounts.length > 0;
  const writableAccount = selectedAccount === 'all' ? undefined : accounts.find((item) => item.id === selectedAccount);
  const writableAccountId = writableAccount?.id;
  const writeBlocked = !writableAccountId;
  const selectedBrokerSpec = useMemo(
    () => brokers.find((item) => item.broker === selectedBroker) || FALLBACK_BROKERS.find((item) => item.broker === selectedBroker),
    [brokers, selectedBroker],
  );
  const ibkrConnection = useMemo(
    () => brokerConnections.find((item) => item.brokerType === 'ibkr') || null,
    [brokerConnections],
  );
  const importFileAccept = useMemo(() => {
    const extensions = selectedBrokerSpec?.fileExtensions?.length ? selectedBrokerSpec.fileExtensions : ['csv'];
    return extensions.map((item) => `.${item.replace(/^\./, '')}`).join(',');
  }, [selectedBrokerSpec]);
  const totalEventPages = Math.max(1, Math.ceil(eventTotal / DEFAULT_PAGE_SIZE));
  const currentEventCount = eventType === 'trade'
    ? tradeEvents.length
    : eventType === 'cash'
      ? cashEvents.length
      : corporateEvents.length;

  const isActiveRefreshContext = (requestedViewKey: string, requestedRequestId: number) => {
    return (
      refreshContextRef.current.viewKey === requestedViewKey
      && refreshContextRef.current.requestId === requestedRequestId
    );
  };

  const loadAccounts = useCallback(async () => {
    try {
      const response = await portfolioApi.getAccounts(false);
      const items = response.accounts || [];
      setAccounts(items);
      setSelectedAccount((prev) => {
        if (items.length === 0) return 'all';
        if (prev !== 'all' && !items.some((item) => item.id === prev)) return items[0].id;
        return prev;
      });
      if (items.length === 0) setShowCreateAccount(true);
    } catch (err) {
      setError(getParsedApiError(err));
    }
  }, [copy.brokerFallbackEmpty, copy.brokerFallbackUnavailable]);

  const loadBrokers = useCallback(async () => {
    try {
      const response = await portfolioApi.listImportBrokers();
      const brokerItems = response.brokers || [];
      if (brokerItems.length === 0) {
        setBrokers(FALLBACK_BROKERS);
        setBrokerLoadWarning(copy.brokerFallbackEmpty);
        setSelectedBroker((prev) => (
          FALLBACK_BROKERS.some((item) => item.broker === prev)
            ? prev
            : FALLBACK_BROKERS[0].broker
        ));
        return;
      }
      setBrokers(brokerItems);
      setBrokerLoadWarning(null);
      setSelectedBroker((prev) => (
        brokerItems.some((item) => item.broker === prev)
          ? prev
          : brokerItems[0].broker
      ));
    } catch {
      setBrokers(FALLBACK_BROKERS);
      setBrokerLoadWarning(copy.brokerFallbackUnavailable);
      setSelectedBroker((prev) => (
        FALLBACK_BROKERS.some((item) => item.broker === prev)
          ? prev
          : FALLBACK_BROKERS[0].broker
      ));
    }
  }, []);

  const loadBrokerConnections = useCallback(async (accountId?: number) => {
    if (!accountId) {
      setBrokerConnections([]);
      return;
    }
    try {
      const response = await portfolioApi.listBrokerConnections(accountId);
      setBrokerConnections(response.connections || []);
    } catch {
      setBrokerConnections([]);
    }
  }, []);

  const loadSnapshotAndRisk = useCallback(async () => {
    setIsLoading(true);
    setRiskWarning(null);
    try {
      const snapshotData = await portfolioApi.getSnapshot({
        accountId: queryAccountId,
        costMethod,
      });
      setSnapshot(snapshotData);
      setError(null);

      try {
        const riskData = await portfolioApi.getRisk({
          accountId: queryAccountId,
          costMethod,
        });
        setRisk(riskData);
      } catch (riskErr) {
        setRisk(null);
        const parsed = getParsedApiError(riskErr);
        setRiskWarning(parsed.message || copy.riskFallback);
      }
    } catch (err) {
      setSnapshot(null);
      setRisk(null);
      setError(getParsedApiError(err));
    } finally {
      setIsLoading(false);
    }
  }, [copy.riskFallback, costMethod, queryAccountId]);

  const loadEventsPage = useCallback(async (page: number) => {
    setEventLoading(true);
    try {
      if (eventType === 'trade') {
        const response = await portfolioApi.listTrades({
          accountId: queryAccountId,
          dateFrom: eventDateFrom || undefined,
          dateTo: eventDateTo || undefined,
          symbol: eventSymbol || undefined,
          side: eventSide || undefined,
          page,
          pageSize: DEFAULT_PAGE_SIZE,
        });
        setTradeEvents(response.items || []);
        setEventTotal(response.total || 0);
      } else if (eventType === 'cash') {
        const response = await portfolioApi.listCashLedger({
          accountId: queryAccountId,
          dateFrom: eventDateFrom || undefined,
          dateTo: eventDateTo || undefined,
          direction: eventDirection || undefined,
          page,
          pageSize: DEFAULT_PAGE_SIZE,
        });
        setCashEvents(response.items || []);
        setEventTotal(response.total || 0);
      } else {
        const response = await portfolioApi.listCorporateActions({
          accountId: queryAccountId,
          dateFrom: eventDateFrom || undefined,
          dateTo: eventDateTo || undefined,
          symbol: eventSymbol || undefined,
          actionType: eventActionType || undefined,
          page,
          pageSize: DEFAULT_PAGE_SIZE,
        });
        setCorporateEvents(response.items || []);
        setEventTotal(response.total || 0);
      }
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setEventLoading(false);
    }
  }, [
    eventActionType,
    eventDateFrom,
    eventDateTo,
    eventDirection,
    eventSide,
    eventSymbol,
    eventType,
    queryAccountId,
  ]);

  const loadEvents = useCallback(async () => {
    await loadEventsPage(eventPage);
  }, [eventPage, loadEventsPage]);

  const refreshPortfolioData = useCallback(async (page = eventPage) => {
    await Promise.all([loadSnapshotAndRisk(), loadEventsPage(page)]);
  }, [eventPage, loadEventsPage, loadSnapshotAndRisk]);

  useEffect(() => {
    void loadAccounts();
    void loadBrokers();
  }, [loadAccounts, loadBrokers]);

  useEffect(() => {
    void loadBrokerConnections(writableAccountId);
  }, [loadBrokerConnections, writableAccountId]);

  useEffect(() => {
    const config = extractIbkrSyncConfig(ibkrConnection);
    setIbkrApiBaseUrl(config.apiBaseUrl || 'https://localhost:5000/v1/api');
    setIbkrVerifySsl(config.verifySsl ?? false);
    setIbkrBrokerAccountRef(config.brokerAccountRef || ibkrConnection?.brokerAccountRef || '');
  }, [ibkrConnection, writableAccountId]);

  useEffect(() => {
    setIbkrSyncResult(null);
    if (selectedBroker !== 'ibkr') {
      setIbkrSessionToken('');
    }
  }, [selectedBroker, writableAccountId]);

  useEffect(() => {
    void loadSnapshotAndRisk();
  }, [loadSnapshotAndRisk]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    refreshContextRef.current = {
      viewKey: refreshViewKey,
      requestId: refreshContextRef.current.requestId + 1,
    };
    setFxRefreshing(false);
    setFxRefreshFeedback(null);
  }, [refreshViewKey]);

  useEffect(() => {
    setEventPage(1);
  }, [eventType, queryAccountId, eventDateFrom, eventDateTo, eventSymbol, eventSide, eventDirection, eventActionType]);

  useEffect(() => {
    if (!writeBlocked) {
      setWriteWarning(null);
    }
  }, [writeBlocked]);

  const positionRows: FlatPosition[] = useMemo(() => {
    if (!snapshot) return [];
    const rows: FlatPosition[] = [];
    for (const account of snapshot.accounts || []) {
      for (const position of account.positions || []) {
        rows.push({
          ...position,
          accountId: account.accountId,
          accountName: account.accountName,
        });
      }
    }
    rows.sort((a, b) => Number(b.marketValueBase || 0) - Number(a.marketValueBase || 0));
    return rows;
  }, [snapshot]);

  const sectorPieData = useMemo(() => {
    const sectors = risk?.sectorConcentration?.topSectors || [];
    return sectors
      .slice(0, 6)
      .map((item) => ({
        name: item.sector,
        value: Number(item.weightPct || 0),
      }))
      .filter((item) => item.value > 0);
  }, [risk]);

  const positionFallbackPieData = useMemo(() => {
    if (!risk?.concentration?.topPositions?.length) {
      return [];
    }
    return risk.concentration.topPositions
      .slice(0, 6)
      .map((item) => ({
        name: item.symbol,
        value: Number(item.weightPct || 0),
      }))
      .filter((item) => item.value > 0);
  }, [risk]);

  const concentrationPieData = sectorPieData.length > 0 ? sectorPieData : positionFallbackPieData;
  const concentrationMode = sectorPieData.length > 0 ? 'sector' : 'position';

  const handleTradeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!writableAccountId) {
      setWriteWarning(copy.writeRequiresAccount);
      return;
    }
    try {
      setWriteWarning(null);
      await portfolioApi.createTrade({
        accountId: writableAccountId,
        symbol: tradeForm.symbol,
        tradeDate: tradeForm.tradeDate,
        side: tradeForm.side,
        quantity: Number(tradeForm.quantity),
        price: Number(tradeForm.price),
        fee: Number(tradeForm.fee || 0),
        tax: Number(tradeForm.tax || 0),
        tradeUid: tradeForm.tradeUid || undefined,
        note: tradeForm.note || undefined,
      });
      await refreshPortfolioData();
      setTradeForm((prev) => ({ ...prev, symbol: '', tradeUid: '', note: '' }));
    } catch (err) {
      setError(getParsedApiError(err));
    }
  };

  const handleCashSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!writableAccountId) {
      setWriteWarning(copy.writeRequiresAccount);
      return;
    }
    try {
      setWriteWarning(null);
      await portfolioApi.createCashLedger({
        accountId: writableAccountId,
        eventDate: cashForm.eventDate,
        direction: cashForm.direction,
        amount: Number(cashForm.amount),
        currency: cashForm.currency || undefined,
        note: cashForm.note || undefined,
      });
      await refreshPortfolioData();
      setCashForm((prev) => ({ ...prev, note: '' }));
    } catch (err) {
      setError(getParsedApiError(err));
    }
  };

  const handleCorporateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!writableAccountId) {
      setWriteWarning(copy.writeRequiresAccount);
      return;
    }
    try {
      setWriteWarning(null);
      await portfolioApi.createCorporateAction({
        accountId: writableAccountId,
        symbol: corpForm.symbol,
        effectiveDate: corpForm.effectiveDate,
        actionType: corpForm.actionType,
        cashDividendPerShare: corpForm.cashDividendPerShare ? Number(corpForm.cashDividendPerShare) : undefined,
        splitRatio: corpForm.splitRatio ? Number(corpForm.splitRatio) : undefined,
        note: corpForm.note || undefined,
      });
      await refreshPortfolioData();
      setCorpForm((prev) => ({ ...prev, symbol: '', note: '' }));
    } catch (err) {
      setError(getParsedApiError(err));
    }
  };

  const handleParseCsv = async () => {
    if (!csvFile) return;
    try {
      setCsvParsing(true);
      const parsed = await portfolioApi.parseCsvImport(selectedBroker, csvFile);
      setCsvParseResult(parsed);
      setCsvCommitResult(null);
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setCsvParsing(false);
    }
  };

  const handleCommitCsv = async () => {
    if (!csvFile) return;
    if (!writableAccountId) {
      setWriteWarning(copy.writeRequiresAccount);
      return;
    }
    try {
      setWriteWarning(null);
      setCsvCommitting(true);
      const committed = await portfolioApi.commitCsvImport(writableAccountId, selectedBroker, csvFile, csvDryRun);
      setCsvCommitResult(committed);
      await loadBrokerConnections(writableAccountId);
      if (!csvDryRun) {
        await refreshPortfolioData();
      }
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setCsvCommitting(false);
    }
  };

  const handleSyncIbkr = async () => {
    if (!writableAccountId) {
      setWriteWarning(copy.syncRequiresAccount);
      return;
    }
    if (!ibkrSessionToken.trim()) {
      setWriteWarning(copy.syncRequiresToken);
      return;
    }
    try {
      setWriteWarning(null);
      setIbkrSyncing(true);
      const result = await portfolioApi.syncIbkrReadOnly({
        accountId: writableAccountId,
        brokerConnectionId: ibkrConnection?.id,
        brokerAccountRef: ibkrBrokerAccountRef.trim() || undefined,
        sessionToken: ibkrSessionToken.trim(),
        apiBaseUrl: ibkrApiBaseUrl.trim() || undefined,
        verifySsl: ibkrVerifySsl,
      });
      setIbkrSyncResult(result);
      setIbkrSessionToken('');
      await loadBrokerConnections(writableAccountId);
      await refreshPortfolioData();
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setIbkrSyncing(false);
    }
  };

  const openDeleteDialog = (item: PendingDelete) => {
    if (!writableAccountId) {
      setWriteWarning(copy.deleteRequiresAccount);
      return;
    }
    setPendingDelete(item);
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete || deleteLoading) return;
    if (!writableAccountId) {
      setWriteWarning(copy.deleteRequiresAccount);
      setPendingDelete(null);
      return;
    }

    const nextPage = currentEventCount === 1 && eventPage > 1 ? eventPage - 1 : eventPage;
    try {
      setDeleteLoading(true);
      setWriteWarning(null);
      if (pendingDelete.eventType === 'trade') {
        await portfolioApi.deleteTrade(pendingDelete.id);
      } else if (pendingDelete.eventType === 'cash') {
        await portfolioApi.deleteCashLedger(pendingDelete.id);
      } else {
        await portfolioApi.deleteCorporateAction(pendingDelete.id);
      }
      setPendingDelete(null);
      if (nextPage !== eventPage) {
        setEventPage(nextPage);
      }
      await refreshPortfolioData(nextPage);
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = accountForm.name.trim();
    if (!name) {
      setAccountCreateError(copy.accountNameRequired);
      setAccountCreateSuccess(null);
      return;
    }
    try {
      setAccountCreating(true);
      setAccountCreateError(null);
      setAccountCreateSuccess(null);
      const created = await portfolioApi.createAccount({
        name,
        broker: accountForm.broker.trim() || undefined,
        market: accountForm.market,
        baseCurrency: accountForm.baseCurrency.trim() || 'CNY',
      });
      await loadAccounts();
      setSelectedAccount(created.id);
      setShowCreateAccount(false);
      setWriteWarning(null);
      setAccountForm({
        name: '',
        broker: 'Demo',
        market: accountForm.market,
        baseCurrency: accountForm.baseCurrency,
      });
      setAccountCreateSuccess(copy.accountCreated);
    } catch (err) {
      const parsed = getParsedApiError(err);
      setAccountCreateError(parsed.message || copy.accountCreateFailed);
      setAccountCreateSuccess(null);
    } finally {
      setAccountCreating(false);
    }
  };

  const handleRefresh = async () => {
    await Promise.all([loadAccounts(), loadSnapshotAndRisk(), loadEvents(), loadBrokers(), loadBrokerConnections(writableAccountId)]);
  };

  const reloadSnapshotAndRiskForScope = useCallback(async (
    requestedViewKey: string,
    requestedRequestId: number,
    requestedAccountId: number | undefined,
    requestedCostMethod: PortfolioCostMethod,
  ): Promise<boolean> => {
    if (!isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
      return false;
    }

    setRiskWarning(null);

    try {
      const snapshotData = await portfolioApi.getSnapshot({
        accountId: requestedAccountId,
        costMethod: requestedCostMethod,
      });
      if (!isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
        return false;
      }
      setSnapshot(snapshotData);
      setError(null);

      try {
        const riskData = await portfolioApi.getRisk({
          accountId: requestedAccountId,
          costMethod: requestedCostMethod,
        });
        if (!isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
          return false;
        }
        setRisk(riskData);
        setRiskWarning(null);
      } catch (riskErr) {
        if (!isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
          return false;
        }
        setRisk(null);
        const parsed = getParsedApiError(riskErr);
        setRiskWarning(parsed.message || copy.riskFallback);
      }
      return true;
    } catch (err) {
      if (!isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
        return false;
      }
      setSnapshot(null);
      setRisk(null);
      setError(getParsedApiError(err));
      return false;
    }
  }, []);

  const handleRefreshFx = async () => {
    if (!hasAccounts || isLoading || fxRefreshing) {
      return;
    }

    const requestedViewKey = refreshViewKey;
    const requestedAccountId = queryAccountId;
    const requestedCostMethod = costMethod;
    const requestedRequestId = refreshContextRef.current.requestId + 1;
    refreshContextRef.current = {
      viewKey: requestedViewKey,
      requestId: requestedRequestId,
    };

    try {
      setFxRefreshing(true);
      setFxRefreshFeedback(null);
      const result = await portfolioApi.refreshFx({
        accountId: requestedAccountId,
      });
      if (!isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
        return;
      }
      const reloaded = await reloadSnapshotAndRiskForScope(
        requestedViewKey,
        requestedRequestId,
        requestedAccountId,
        requestedCostMethod,
      );
      if (!reloaded || !isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
        return;
      }
      setFxRefreshFeedback(buildFxRefreshFeedback(result, language));
    } catch (err) {
      if (!isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
        return;
      }
      setError(getParsedApiError(err));
    } finally {
      if (isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
        setFxRefreshing(false);
      }
    }
  };
  const showEventAuditDisclosureByDefault = eventLoading
    || currentEventCount > 0
    || Boolean(eventDateFrom)
    || Boolean(eventDateTo)
    || Boolean(eventSymbol)
    || Boolean(eventSide)
    || Boolean(eventDirection)
    || Boolean(eventActionType);

  return (
    <div className="workspace-page workspace-page--portfolio">
      <WorkspacePageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description}
        actions={hasAccounts ? (
          <>
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={() => {
                setShowCreateAccount((prev) => !prev);
                setAccountCreateError(null);
                setAccountCreateSuccess(null);
              }}
            >
              {showCreateAccount ? copy.collapseCreate : copy.createAccount}
            </button>
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={isLoading || fxRefreshing}
              className="btn-secondary text-sm"
            >
              {isLoading ? copy.refreshingData : copy.refreshData}
            </button>
          </>
        ) : (
          <p className="workspace-header-actions-note">
            {copy.noAccounts}
          </p>
        )}
      >
        {hasAccounts ? (
          <div className="workspace-surface-muted p-3.5">
            <div className="grid grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_220px_minmax(0,260px)] xl:items-end">
              <div>
                <p className="mb-1 text-xs text-secondary">{copy.accountView}</p>
                <select
                  value={String(selectedAccount)}
                  onChange={(e) => setSelectedAccount(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  className="input-terminal w-full text-sm"
                >
                  <option value="all">{copy.allAccounts}</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} · {formatAccountMarketLabel(account.market, language)} · {account.baseCurrency} (#{account.id})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <p className="mb-1 text-xs text-secondary">{copy.costMethod}</p>
                <select
                  value={costMethod}
                  onChange={(e) => setCostMethod(e.target.value as PortfolioCostMethod)}
                  className="input-terminal w-full text-sm"
                >
                  <option value="fifo">{copy.costFifo}</option>
                  <option value="avg">{copy.costAvg}</option>
                </select>
              </div>
              <p className="workspace-header-actions-note xl:text-right">
                {copy.scopeHint}
              </p>
            </div>
          </div>
        ) : null}
      </WorkspacePageHeader>

      {error ? <ApiErrorAlert error={error} onDismiss={() => setError(null)} /> : null}
      {riskWarning ? (
        <div className="rounded-xl border border-[hsl(var(--accent-warning-hsl)/0.35)] bg-[hsl(var(--accent-warning-hsl)/0.1)] px-4 py-3 text-[hsl(var(--accent-warning-hsl))] text-sm">
          {copy.riskDegraded}: {riskWarning}
        </div>
      ) : null}
      {writeWarning ? (
        <div className="rounded-xl border border-[hsl(var(--accent-warning-hsl)/0.35)] bg-[hsl(var(--accent-warning-hsl)/0.1)] px-4 py-3 text-[hsl(var(--accent-warning-hsl))] text-sm">
          {copy.actionHint}: {writeWarning}
        </div>
      ) : null}

      {(showCreateAccount || !hasAccounts) ? (
        <Card padding="md">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">{copy.createAccountTitle}</h2>
            {hasAccounts ? (
              <button
                type="button"
                className="btn-secondary text-xs px-3 py-1"
                onClick={() => {
                  setShowCreateAccount(false);
                  setAccountCreateError(null);
                  setAccountCreateSuccess(null);
                }}
              >
                {copy.collapseCreate}
              </button>
            ) : (
              <span className="text-xs text-secondary">{copy.createAccountHelp}</span>
            )}
          </div>
          {accountCreateError ? (
            <div className="mt-2 text-xs text-danger rounded-lg border border-[hsl(var(--accent-danger-hsl)/0.3)] bg-[hsl(var(--accent-danger-hsl)/0.12)] px-2 py-1">
              {accountCreateError}
            </div>
          ) : null}
          {accountCreateSuccess ? (
            <div className="mt-2 text-xs text-success rounded-lg border border-[hsl(var(--accent-positive-hsl)/0.3)] bg-[hsl(var(--accent-positive-hsl)/0.12)] px-2 py-1">
              {accountCreateSuccess}
            </div>
          ) : null}
          <form className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2" onSubmit={handleCreateAccount}>
            <input
              className="input-terminal text-sm md:col-span-2"
              placeholder={copy.accountNamePlaceholder}
              value={accountForm.name}
              onChange={(e) => setAccountForm((prev) => ({ ...prev, name: e.target.value }))}
            />
            <input
              className="input-terminal text-sm"
              placeholder={copy.brokerPlaceholder}
              value={accountForm.broker}
              onChange={(e) => setAccountForm((prev) => ({ ...prev, broker: e.target.value }))}
            />
            <input
              className="input-terminal text-sm"
              placeholder={copy.baseCurrencyPlaceholder}
              value={accountForm.baseCurrency}
              onChange={(e) => setAccountForm((prev) => ({ ...prev, baseCurrency: e.target.value.toUpperCase() }))}
            />
            <select
              className="input-terminal text-sm"
              value={accountForm.market}
              onChange={(e) => setAccountForm((prev) => ({ ...prev, market: e.target.value as 'cn' | 'hk' | 'us' | 'global' }))}
            >
              <option value="cn">{copy.marketCn}</option>
              <option value="hk">{copy.marketHk}</option>
              <option value="us">{copy.marketUs}</option>
              <option value="global">{copy.marketGlobal}</option>
            </select>
            <button type="submit" className="btn-secondary text-sm" disabled={accountCreating}>
              {accountCreating ? copy.creatingAccount : copy.createAccount}
            </button>
          </form>
        </Card>
      ) : null}

      <div className="space-y-3">
        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <Card variant="gradient" padding="md">
            <p className="text-[11px] uppercase tracking-[0.14em] text-secondary-text">{copy.totalEquity}</p>
            <p className="mt-1 text-xl font-semibold text-foreground">{formatMoney(snapshot?.totalEquity, snapshot?.currency || 'CNY')}</p>
          </Card>
          <Card variant="gradient" padding="md">
            <p className="text-[11px] uppercase tracking-[0.14em] text-secondary-text">{copy.totalMarketValue}</p>
            <p className="mt-1 text-xl font-semibold text-foreground">{formatMoney(snapshot?.totalMarketValue, snapshot?.currency || 'CNY')}</p>
          </Card>
          <Card variant="gradient" padding="md">
            <p className="text-[11px] uppercase tracking-[0.14em] text-secondary-text">{copy.totalCash}</p>
            <p className="mt-1 text-xl font-semibold text-foreground">{formatMoney(snapshot?.totalCash, snapshot?.currency || 'CNY')}</p>
          </Card>
          <Card variant="gradient" padding="md">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[11px] uppercase tracking-[0.14em] text-secondary-text">{copy.fxState}</p>
              <button
                type="button"
                className="btn-secondary !px-3 !py-1 !text-[11px] uppercase tracking-widest shrink-0"
                onClick={() => void handleRefreshFx()}
                disabled={!hasAccounts || isLoading || fxRefreshing}
              >
                {fxRefreshing ? copy.refreshingFx : copy.refreshFx}
              </button>
            </div>
            <div className="mt-2">{snapshot?.fxStale ? <Badge variant="warning">{copy.fxStale}</Badge> : <Badge variant="success">{copy.fxFresh}</Badge>}</div>
            {fxRefreshFeedback ? (
              <p
                className={`mt-2 text-xs ${
                  fxRefreshFeedback.tone === 'success'
                    ? 'text-success'
                    : fxRefreshFeedback.tone === 'warning'
                      ? 'text-[hsl(var(--accent-warning-hsl))]'
                      : 'text-secondary'
                }`}
              >
                {fxRefreshFeedback.text}
              </p>
            ) : null}
          </Card>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card padding="md">
            <h3 className="text-[11px] uppercase tracking-[0.14em] text-secondary-text mb-3">{copy.drawdownTitle}</h3>
            <div className="text-xs text-secondary space-y-1.5">
              <div className="flex justify-between"><span>{copy.maxDrawdown}:</span> <span className="text-foreground font-mono">{formatPct(risk?.drawdown?.maxDrawdownPct)}</span></div>
              <div className="flex justify-between"><span>{copy.currentDrawdown}:</span> <span className="text-foreground font-mono">{formatPct(risk?.drawdown?.currentDrawdownPct)}</span></div>
              <div className="flex justify-between"><span>{copy.alert}:</span> <span className={risk?.drawdown?.alert ? 'text-danger font-medium' : 'text-success font-medium'}>{risk?.drawdown?.alert ? copy.yes : copy.no}</span></div>
            </div>
          </Card>
          <Card padding="md">
            <h3 className="text-[11px] uppercase tracking-[0.14em] text-secondary-text mb-3">{copy.stopLossTitle}</h3>
            <div className="text-xs text-secondary space-y-1.5">
              <div className="flex justify-between"><span>{copy.triggeredCount}:</span> <span className="text-foreground font-mono">{risk?.stopLoss?.triggeredCount ?? 0}</span></div>
              <div className="flex justify-between"><span>{copy.nearCount}:</span> <span className="text-foreground font-mono">{risk?.stopLoss?.nearCount ?? 0}</span></div>
              <div className="flex justify-between"><span>{copy.alert}:</span> <span className={risk?.stopLoss?.nearAlert ? 'text-warning font-medium' : 'text-success font-medium'}>{risk?.stopLoss?.nearAlert ? copy.yes : copy.no}</span></div>
            </div>
          </Card>
          <Card padding="md">
            <h3 className="text-[11px] uppercase tracking-[0.14em] text-secondary-text mb-3">{copy.snapshotBasisTitle}</h3>
            <div className="text-xs text-secondary space-y-1.5">
              <div className="flex justify-between"><span>{copy.accountCount}:</span> <span className="text-foreground font-mono">{snapshot?.accountCount ?? 0}</span></div>
              <div className="flex justify-between"><span>{copy.reportingCurrency}:</span> <span className="text-foreground font-mono">{snapshot?.currency || 'CNY'}</span></div>
              <div className="flex justify-between"><span>{copy.costMethodLabel}:</span> <span className="text-foreground font-mono">{(snapshot?.costMethod || costMethod).toUpperCase()}</span></div>
            </div>
          </Card>
        </section>

        {writeBlocked && hasAccounts ? (
          <div className="text-xs text-[hsl(var(--accent-warning-hsl))] rounded-lg border border-[hsl(var(--accent-warning-hsl)/0.3)] bg-[hsl(var(--accent-warning-hsl)/0.12)] px-3 py-2">
            {copy.allAccountsWarning}
          </div>
        ) : null}

        <section className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          <Card className="xl:col-span-2" padding="md">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[11px] uppercase tracking-[0.14em] text-secondary-text">{copy.positionsTitle}</h2>
              <span className="text-[11px] uppercase tracking-widest text-secondary">{copy.positionsCount(positionRows.length)}</span>
            </div>
            {positionRows.length === 0 ? (
              <p className="text-sm text-muted py-6 text-center">{copy.noPositions}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-[0.14em] text-secondary border-b border-[var(--border-muted)]">
                    <tr>
                      <th className="text-left py-2 pr-2 font-medium">{copy.positionAccount}</th>
                      <th className="text-left py-2 pr-2 font-medium">{copy.positionCode}</th>
                      <th className="text-left py-2 pr-2 font-medium">{copy.positionMarketCurrency}</th>
                      <th className="text-right py-2 pr-2 font-medium">{copy.positionQuantity}</th>
                      <th className="text-right py-2 pr-2 font-medium">{copy.positionAvgCost}</th>
                      <th className="text-right py-2 pr-2 font-medium">{copy.positionLastPrice}</th>
                      <th className="text-right py-2 pr-2 font-medium">{copy.positionMarketValue}</th>
                      <th className="text-right py-2 font-medium">{copy.positionUnrealized}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positionRows.map((row) => (
                      <tr key={`${row.accountId}-${row.symbol}-${row.market}`} className="border-b border-[var(--border-muted)] hover:bg-[var(--overlay-hover)] transition-colors">
                        <td className="py-2.5 pr-2 text-secondary-text text-xs">{row.accountName}</td>
                        <td className="py-2.5 pr-2 font-mono text-foreground text-xs">{row.symbol}</td>
                        <td className="py-2.5 pr-2 text-secondary-text text-xs">{formatPositionContext(row.market, row.currency)}</td>
                        <td className="py-2.5 pr-2 text-right font-mono text-secondary-text text-xs">{row.quantity.toFixed(2)}</td>
                        <td className="py-2.5 pr-2 text-right font-mono text-secondary-text text-xs">{row.avgCost.toFixed(4)}</td>
                        <td className="py-2.5 pr-2 text-right font-mono text-secondary-text text-xs">{row.lastPrice.toFixed(4)}</td>
                        <td className="py-2.5 pr-2 text-right font-mono text-foreground text-xs">{formatMoney(row.marketValueBase, row.valuationCurrency)}</td>
                        <td
                          className="py-2.5 text-right font-mono text-xs"
                          style={{ color: getMarketDirectionColor(row.unrealizedPnlBase) }}
                        >
                          {formatMoney(row.unrealizedPnlBase, row.valuationCurrency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card padding="md">
            <h2 className="text-[11px] uppercase tracking-[0.14em] text-secondary-text mb-3">{concentrationMode === 'sector' ? copy.sectorConcentration : copy.singleNameConcentration}</h2>
            {concentrationPieData.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={concentrationPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}>
                      {concentrationPieData.map((entry, index) => (
                        <Cell key={`cell-${entry.name}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => `${Number(value).toFixed(2)}%`} contentStyle={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--border-muted)' }} />
                    <Legend wrapperStyle={{ fontSize: '11px', color: 'var(--text-secondary)' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-[var(--border-muted)] bg-[var(--surface-1)] px-4 py-8 text-center h-64 flex flex-col items-center justify-center">
                <p className="text-[11px] uppercase tracking-widest text-foreground">{copy.emptyConcentration}</p>
                <p className="mt-2 text-xs leading-5 text-muted-text max-w-[20ch]">
                  {copy.concentrationHint}
                </p>
              </div>
            )}
            <div className="mt-3 text-xs text-secondary space-y-1.5 border-t border-[var(--border-muted)] pt-3">
              <div className="flex justify-between"><span>{copy.concentrationScope}:</span> <span className="text-foreground">{concentrationMode === 'sector' ? copy.concentrationScopeSector : copy.concentrationScopeFallback}</span></div>
              <div className="flex justify-between"><span>{copy.sectorAlert}:</span> <span className={risk?.sectorConcentration?.alert ? 'text-warning font-medium' : 'text-success font-medium'}>{risk?.sectorConcentration?.alert ? copy.yes : copy.no}</span></div>
              <div className="flex justify-between"><span>{copy.topWeight}:</span> <span className="text-foreground font-mono">{formatPct(risk?.sectorConcentration?.topWeightPct ?? risk?.concentration?.topWeightPct)}</span></div>
            </div>
          </Card>
        </section>

        <section>
          <Card padding="md" className="border-[var(--border-strong)] bg-[var(--surface-2)] shadow-[var(--glow-soft)]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[11px] uppercase tracking-[0.14em] text-foreground">{copy.dataSyncTitle}</h3>
              <span className="text-[10px] uppercase tracking-widest text-muted-text hidden sm:inline">{copy.brokerImport}</span>
            </div>
            
            <div className="space-y-4">
              {brokerLoadWarning ? (
                <div className="text-xs text-[hsl(var(--accent-warning-hsl))] rounded-md border border-[hsl(var(--accent-warning-hsl)/0.3)] bg-[hsl(var(--accent-warning-hsl)/0.12)] px-3 py-2">
                  {brokerLoadWarning}
                </div>
              ) : null}

              {writableAccount ? (
                <div className="rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-1)] px-3 py-2.5 text-xs text-secondary-text">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground">{copy.currentImportAccount}</span>
                    <span>{writableAccount.name}</span>
                    <Badge>{formatAccountMarketLabel(writableAccount.market, language)}</Badge>
                    <Badge>{writableAccount.baseCurrency}</Badge>
                  </div>
                  {brokerConnections.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {brokerConnections.map((connection) => (
                        <span
                          key={connection.id}
                          className="inline-flex items-center gap-1 rounded-full border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-2)] px-2 py-1 text-[11px]"
                        >
                          <span className="font-mono text-foreground">{connection.connectionName}</span>
                          {connection.brokerAccountRef ? <span>{connection.brokerAccountRef}</span> : null}
                          <span className="text-muted-text">{formatBrokerConnectionStatus(connection.status, language)}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-[11px] text-muted-text">{copy.noBrokerConnections}</p>
                  )}
                </div>
              ) : null}
              
              <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
                <select className="input-terminal text-sm md:w-[160px] h-[2.6rem]" value={selectedBroker} onChange={(e) => setSelectedBroker(e.target.value)}>
                  {brokers.length > 0 ? (
                    brokers.map((item) => <option key={item.broker} value={item.broker}>{formatBrokerLabel(item.broker, item.displayName, language)}</option>)
                  ) : (
                    <option value="huatai">{formatBrokerLabel('huatai', undefined, language)}</option>
                  )}
                </select>
                
                <label className="input-terminal text-sm flex-1 flex items-center justify-center cursor-pointer border-dashed hover:border-[var(--border-strong)] bg-[var(--surface-1)] transition-colors min-h-[2.6rem]">
                  <span className="truncate text-secondary-text">
                    {csvFile ? csvFile.name : selectedBroker === 'ibkr' ? copy.selectIbkrExport : copy.selectBrokerExport}
                  </span>
                  <input type="file" accept={importFileAccept} className="hidden"
                    onChange={(e) => setCsvFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)} />
                </label>

                <div className="flex items-center justify-center gap-2 px-3 py-2 border border-[var(--input-border)] rounded-[var(--theme-control-radius)] bg-[var(--surface-1)] h-[2.6rem]">
                  <input id="csv-dry-run" type="checkbox" className="theme-checkbox" checked={csvDryRun} onChange={(e) => setCsvDryRun(e.target.checked)} />
                  <label htmlFor="csv-dry-run" className="text-xs text-secondary-text cursor-pointer whitespace-nowrap">{copy.dryRun}</label>
                </div>

                <div className="flex gap-2">
                  <button type="button" className="btn-secondary h-[2.6rem] px-4 whitespace-nowrap text-xs" disabled={!csvFile || csvParsing} onClick={() => void handleParseCsv()}>
                    {csvParsing ? copy.parsing : copy.parseFile}
                  </button>
                  <button type="button" className="btn-primary h-[2.6rem] px-4 whitespace-nowrap text-xs shadow-[var(--glow-soft)]" disabled={!csvFile || !writableAccountId || csvCommitting} onClick={() => void handleCommitCsv()}>
                    {csvCommitting ? copy.committing : copy.commitImport}
                  </button>
                </div>
              </div>

              <p className="text-[11px] text-muted-text">
                {selectedBroker === 'ibkr' ? copy.ibkrImportHint : copy.brokerImportHint}
              </p>

              {selectedBroker === 'ibkr' ? (
                <div className="rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-1)] px-3 py-3 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.14em] text-foreground">{copy.ibkrReadOnlyTitle}</p>
                      <p className="mt-1 text-[11px] text-muted-text">
                        {copy.ibkrReadOnlyBody}
                      </p>
                    </div>
                    <Badge>{copy.readOnlyBadge}</Badge>
                  </div>
                  <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_180px] gap-2">
                    <input
                      className="input-terminal text-sm"
                      placeholder={copy.ibkrApiBasePlaceholder}
                      value={ibkrApiBaseUrl}
                      onChange={(e) => setIbkrApiBaseUrl(e.target.value)}
                    />
                    <input
                      className="input-terminal text-sm"
                      placeholder={copy.ibkrAccountRefPlaceholder}
                      value={ibkrBrokerAccountRef}
                      onChange={(e) => setIbkrBrokerAccountRef(e.target.value.toUpperCase())}
                    />
                    <input
                      className="input-terminal text-sm xl:col-span-2"
                      type="password"
                      placeholder={copy.ibkrSessionTokenPlaceholder}
                      value={ibkrSessionToken}
                      onChange={(e) => setIbkrSessionToken(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <label className="inline-flex items-center gap-2 text-xs text-secondary-text">
                      <input
                        type="checkbox"
                        className="theme-checkbox"
                        checked={ibkrVerifySsl}
                        onChange={(e) => setIbkrVerifySsl(e.target.checked)}
                      />
                      <span>{copy.verifyIbkrSsl}</span>
                    </label>
                    <button
                      type="button"
                      className="btn-secondary h-[2.5rem] px-4 text-xs whitespace-nowrap"
                      disabled={!writableAccountId || !ibkrSessionToken.trim() || ibkrSyncing}
                      onClick={() => void handleSyncIbkr()}
                    >
                      {ibkrSyncing ? copy.syncing : copy.syncIbkr}
                    </button>
                  </div>
                  {ibkrSyncResult ? (
                    <div className="text-[11px] tracking-wide text-secondary-text rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-2)] px-3 py-2.5">
                      <span className="font-semibold text-foreground uppercase tracking-[0.14em] mr-2">{copy.syncResult}</span>
                      {copy.positionsCountLabel} <span className="text-foreground font-mono">{ibkrSyncResult.positionCount}</span> ·
                      {copy.cashCurrenciesLabel} <span className="text-foreground font-mono">{ibkrSyncResult.cashBalanceCount}</span> ·
                      {copy.totalEquity} <span className="text-success font-mono">{formatMoney(ibkrSyncResult.totalEquity, ibkrSyncResult.baseCurrency)}</span>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-text">
                        <span>{copy.accountRef}: <span className="font-mono text-foreground">{ibkrSyncResult.brokerAccountRef}</span></span>
                        <span>{copy.syncedAt}: <span className="text-foreground">{ibkrSyncResult.syncedAt.replace('T', ' ')}</span></span>
                        <span>{ibkrSyncResult.snapshotOverlayActive ? copy.syncOverlay : copy.syncSaved}</span>
                      </div>
                      {ibkrSyncResult.warnings.length > 0 ? (
                        <div className="mt-2 rounded-[var(--theme-panel-radius-md)] border border-[hsl(var(--accent-warning-hsl)/0.28)] bg-[hsl(var(--accent-warning-hsl)/0.08)] px-2.5 py-2 text-[11px] text-[hsl(var(--accent-warning-hsl))]">
                          {ibkrSyncResult.warnings.map((warning) => (
                            <p key={warning} className="leading-5">
                              {warning}
                            </p>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {csvParseResult || csvCommitResult ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                  {csvParseResult ? (
                    <div className="text-[11px] tracking-wide text-secondary-text rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-1)] px-3 py-2.5">
                      <span className="font-semibold text-foreground uppercase tracking-[0.14em] mr-2">{copy.parseResult}</span>
                      {copy.valid} <span className="text-success font-mono">{csvParseResult.recordCount}</span> ·
                      {copy.cash} <span className="text-foreground font-mono">{csvParseResult.cashRecordCount ?? 0}</span> ·
                      {copy.corporateActions} <span className="text-foreground font-mono">{csvParseResult.corporateActionCount ?? 0}</span> ·
                      {copy.skipped} <span className="text-warning font-mono">{csvParseResult.skippedCount}</span> ·
                      {copy.errors} <span className="text-danger font-mono">{csvParseResult.errorCount}</span>
                      {csvParseResult.metadata?.brokerAccountRef ? (
                        <div className="mt-2 text-[11px] text-muted-text">
                          {copy.accountMapping}: <span className="font-mono text-foreground">{String(csvParseResult.metadata.brokerAccountRef)}</span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {csvCommitResult ? (
                    <div className="text-[11px] tracking-wide text-secondary-text rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-1)] px-3 py-2.5">
                      <span className="font-semibold text-foreground uppercase tracking-[0.14em] mr-2">{copy.commitResult}</span>
                      {copy.inserted} <span className="text-success font-mono">{csvCommitResult.insertedCount}</span> ·
                      {copy.cash} <span className="text-foreground font-mono">{csvCommitResult.cashInsertedCount ?? 0}</span> ·
                      {copy.corporateActions} <span className="text-foreground font-mono">{csvCommitResult.corporateActionInsertedCount ?? 0}</span> ·
                      {copy.duplicates} <span className="text-warning font-mono">{csvCommitResult.duplicateCount}</span> ·
                      {copy.failed} <span className="text-danger font-mono">{csvCommitResult.failedCount}</span>
                      {csvCommitResult.duplicateImport ? (
                        <div className="mt-2 text-[11px] text-[hsl(var(--accent-warning-hsl))]">
                          {copy.duplicateFingerprintHint}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {csvParseResult?.warnings?.length ? (
                <div className="rounded-[var(--theme-panel-radius-md)] border border-[hsl(var(--accent-warning-hsl)/0.25)] bg-[hsl(var(--accent-warning-hsl)/0.08)] px-3 py-2 text-[11px] text-[hsl(var(--accent-warning-hsl))]">
                  {csvParseResult.warnings[0]}
                </div>
              ) : null}
            </div>
          </Card>
        </section>

        <section className="space-y-3">
          <Disclosure summary={copy.manualAdjustments} defaultOpen={false}>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
              <Card padding="md">
                <h3 className="text-[11px] uppercase tracking-[0.14em] text-secondary-text mb-3">{copy.manualTrade}</h3>
                <form className="space-y-2" onSubmit={handleTradeSubmit}>
                  <input className="input-terminal w-full text-sm" placeholder={copy.symbolPlaceholder} value={tradeForm.symbol}
                    onChange={(e) => setTradeForm((prev) => ({ ...prev, symbol: e.target.value }))} required />
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input className="input-terminal text-sm" type="date" value={tradeForm.tradeDate}
                      onChange={(e) => setTradeForm((prev) => ({ ...prev, tradeDate: e.target.value }))} required />
                    <select className="input-terminal text-sm" value={tradeForm.side}
                      onChange={(e) => setTradeForm((prev) => ({ ...prev, side: e.target.value as PortfolioSide }))}>
                      <option value="buy">{copy.buy}</option>
                      <option value="sell">{copy.sell}</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input className="input-terminal text-sm" type="number" min="0" step="0.0001" placeholder={copy.quantity} value={tradeForm.quantity}
                      onChange={(e) => setTradeForm((prev) => ({ ...prev, quantity: e.target.value }))} required />
                    <input className="input-terminal text-sm" type="number" min="0" step="0.0001" placeholder={copy.price} value={tradeForm.price}
                      onChange={(e) => setTradeForm((prev) => ({ ...prev, price: e.target.value }))} required />
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input className="input-terminal text-sm" type="number" min="0" step="0.0001" placeholder={copy.feeOptional} value={tradeForm.fee}
                      onChange={(e) => setTradeForm((prev) => ({ ...prev, fee: e.target.value }))} />
                    <input className="input-terminal text-sm" type="number" min="0" step="0.0001" placeholder={copy.taxOptional} value={tradeForm.tax}
                      onChange={(e) => setTradeForm((prev) => ({ ...prev, tax: e.target.value }))} />
                  </div>
                  <button type="submit" className="btn-secondary w-full mt-2 text-[11px]" disabled={!writableAccountId}>{copy.submitTrade}</button>
                </form>
              </Card>

              <Card padding="md">
                <h3 className="text-[11px] uppercase tracking-[0.14em] text-secondary-text mb-3">{copy.manualCash}</h3>
                <form className="space-y-2" onSubmit={handleCashSubmit}>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input className="input-terminal text-sm" type="date" value={cashForm.eventDate}
                      onChange={(e) => setCashForm((prev) => ({ ...prev, eventDate: e.target.value }))} required />
                    <select className="input-terminal text-sm" value={cashForm.direction}
                      onChange={(e) => setCashForm((prev) => ({ ...prev, direction: e.target.value as PortfolioCashDirection }))}>
                      <option value="in">{copy.cashIn}</option>
                      <option value="out">{copy.cashOut}</option>
                    </select>
                  </div>
                  <input className="input-terminal w-full text-sm" type="number" min="0" step="0.0001" placeholder={copy.amount}
                    value={cashForm.amount} onChange={(e) => setCashForm((prev) => ({ ...prev, amount: e.target.value }))} required />
                  <input className="input-terminal w-full text-sm" placeholder={copy.currencyOptional(writableAccount?.baseCurrency || '')} value={cashForm.currency}
                    onChange={(e) => setCashForm((prev) => ({ ...prev, currency: e.target.value }))} />
                  <button type="submit" className="btn-secondary w-full mt-2 text-[11px]" disabled={!writableAccountId}>{copy.submitCash}</button>
                </form>
              </Card>

              <Card padding="md">
                <h3 className="text-[11px] uppercase tracking-[0.14em] text-secondary-text mb-3">{copy.manualCorporate}</h3>
                <form className="space-y-2" onSubmit={handleCorporateSubmit}>
                  <input className="input-terminal w-full text-sm" placeholder={copy.stockCode} value={corpForm.symbol}
                    onChange={(e) => setCorpForm((prev) => ({ ...prev, symbol: e.target.value }))} required />
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input className="input-terminal text-sm" type="date" value={corpForm.effectiveDate}
                      onChange={(e) => setCorpForm((prev) => ({ ...prev, effectiveDate: e.target.value }))} required />
                    <select className="input-terminal text-sm" value={corpForm.actionType}
                      onChange={(e) => setCorpForm((prev) => ({ ...prev, actionType: e.target.value as PortfolioCorporateActionType }))}>
                      <option value="cash_dividend">{copy.cashDividend}</option>
                      <option value="split_adjustment">{copy.splitAdjustment}</option>
                    </select>
                  </div>
                  {corpForm.actionType === 'cash_dividend' ? (
                    <input className="input-terminal w-full text-sm" type="number" min="0" step="0.000001" placeholder={copy.dividendPerShare}
                      value={corpForm.cashDividendPerShare}
                      onChange={(e) => setCorpForm((prev) => ({ ...prev, cashDividendPerShare: e.target.value, splitRatio: '' }))} required />
                  ) : (
                    <input className="input-terminal w-full text-sm" type="number" min="0" step="0.000001" placeholder={copy.splitRatio}
                      value={corpForm.splitRatio}
                      onChange={(e) => setCorpForm((prev) => ({ ...prev, splitRatio: e.target.value, cashDividendPerShare: '' }))} required />
                  )}
                  <button type="submit" className="btn-secondary w-full mt-2 text-[11px]" disabled={!writableAccountId}>{copy.submitCorporate}</button>
                </form>
              </Card>
            </div>
          </Disclosure>

          <Disclosure summary={copy.ledgerAudit} defaultOpen={showEventAuditDisclosureByDefault}>
            <Card padding="md" className="border-0 bg-transparent">
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <select className="input-terminal text-sm" value={eventType} onChange={(e) => setEventType(e.target.value as EventType)}>
                    <option value="trade">{copy.tradeLedger}</option>
                    <option value="cash">{copy.cashLedger}</option>
                    <option value="corporate">{copy.corporateLedger}</option>
                  </select>
                  <button type="button" className="btn-secondary text-[11px] uppercase tracking-widest" onClick={() => void loadEvents()} disabled={eventLoading}>
                    {eventLoading ? copy.loading : copy.refreshLedger}
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input className="input-terminal text-sm" type="date" value={eventDateFrom} onChange={(e) => setEventDateFrom(e.target.value)} />
                  <input className="input-terminal text-sm" type="date" value={eventDateTo} onChange={(e) => setEventDateTo(e.target.value)} />
                </div>
                {(eventType === 'trade' || eventType === 'corporate') ? (
                  <input className="input-terminal text-sm w-full" placeholder={copy.filterBySymbol} value={eventSymbol}
                    onChange={(e) => setEventSymbol(e.target.value)} />
                ) : null}
                {eventType === 'trade' ? (
                  <select className="input-terminal text-sm w-full" value={eventSide} onChange={(e) => setEventSide(e.target.value as '' | PortfolioSide)}>
                    <option value="">{copy.allSides}</option>
                    <option value="buy">{copy.buy}</option>
                    <option value="sell">{copy.sell}</option>
                  </select>
                ) : null}
                {eventType === 'cash' ? (
                  <select className="input-terminal text-sm w-full" value={eventDirection}
                    onChange={(e) => setEventDirection(e.target.value as '' | PortfolioCashDirection)}>
                    <option value="">{copy.allDirections}</option>
                    <option value="in">{copy.cashIn}</option>
                    <option value="out">{copy.cashOut}</option>
                  </select>
                ) : null}
                {eventType === 'corporate' ? (
                  <select className="input-terminal text-sm w-full" value={eventActionType}
                    onChange={(e) => setEventActionType(e.target.value as '' | PortfolioCorporateActionType)}>
                    <option value="">{copy.allActions}</option>
                    <option value="cash_dividend">{copy.cashDividend}</option>
                    <option value="split_adjustment">{copy.splitAdjustment}</option>
                  </select>
                ) : null}
                <div className="text-[11px] text-secondary-text">
                  {writeBlocked ? copy.deleteHintBlocked : copy.deleteHintReady}
                </div>
                <div className="rounded-md border border-[var(--border-muted)] bg-[var(--surface-1)] p-2 max-h-none overflow-visible lg:max-h-[400px] lg:overflow-auto">
                  {eventType === 'trade' && tradeEvents.map((item) => (
                    <div key={`t-${item.id}`} className="flex items-center justify-between gap-3 border-b border-[var(--border-muted)] py-2.5 text-xs text-secondary-text last:border-0 hover:bg-[var(--overlay-hover)] transition-colors px-2">
                      <div className="min-w-0 font-mono flex-1 flex flex-wrap gap-x-4 gap-y-1">
                        <span className="text-muted-text">{item.tradeDate}</span>
                        <span className={item.side === 'buy' ? 'text-success' : 'text-warning'}>{formatSideLabel(item.side, language)}</span>
                        <span className="text-foreground font-semibold">{item.symbol}</span>
                        <span>{copy.quantity} <span className="text-foreground">{item.quantity}</span></span>
                        <span>{copy.price} <span className="text-foreground">{item.price}</span></span>
                      </div>
                      {!writeBlocked ? (
                        <button
                          type="button"
                          className="btn-secondary shrink-0 !px-3 !py-1 !text-[11px]"
                          onClick={() => openDeleteDialog({
                            eventType: 'trade',
                            id: item.id,
                            message: copy.tradeDeleteMessage(item),
                          })}
                        >
                          {copy.deleteConfirm}
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {eventType === 'cash' && cashEvents.map((item) => (
                    <div key={`c-${item.id}`} className="flex items-center justify-between gap-3 border-b border-[var(--border-muted)] py-2.5 text-xs text-secondary-text last:border-0 hover:bg-[var(--overlay-hover)] transition-colors px-2">
                      <div className="min-w-0 font-mono flex-1 flex flex-wrap gap-x-4 gap-y-1">
                        <span className="text-muted-text">{item.eventDate}</span>
                        <span className={item.direction === 'in' ? 'text-success' : 'text-warning'}>{formatCashDirectionLabel(item.direction, language)}</span>
                        <span className="text-foreground">{item.amount}</span>
                        <span className="text-foreground font-semibold">{item.currency}</span>
                      </div>
                      {!writeBlocked ? (
                        <button
                          type="button"
                          className="btn-secondary shrink-0 !px-3 !py-1 !text-[11px]"
                          onClick={() => openDeleteDialog({
                            eventType: 'cash',
                            id: item.id,
                            message: copy.cashDeleteMessage(item),
                          })}
                        >
                          {copy.deleteConfirm}
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {eventType === 'corporate' && corporateEvents.map((item) => (
                    <div key={`ca-${item.id}`} className="flex items-center justify-between gap-3 border-b border-[var(--border-muted)] py-2.5 text-xs text-secondary-text last:border-0 hover:bg-[var(--overlay-hover)] transition-colors px-2">
                      <div className="min-w-0 font-mono flex-1 flex flex-wrap gap-x-4 gap-y-1">
                        <span className="text-muted-text">{item.effectiveDate}</span>
                        <span className="text-info">{formatCorporateActionLabel(item.actionType, language)}</span>
                        <span className="text-foreground font-semibold">{item.symbol}</span>
                      </div>
                      {!writeBlocked ? (
                        <button
                          type="button"
                          className="btn-secondary shrink-0 !px-3 !py-1 !text-[11px]"
                          onClick={() => openDeleteDialog({
                            eventType: 'corporate',
                            id: item.id,
                            message: copy.corporateDeleteMessage(item),
                          })}
                        >
                          {copy.deleteConfirm}
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {!eventLoading
                    && ((eventType === 'trade' && tradeEvents.length === 0)
                      || (eventType === 'cash' && cashEvents.length === 0)
                      || (eventType === 'corporate' && corporateEvents.length === 0)) ? (
                        <div className="px-2 py-6 text-center">
                          <p className="text-[11px] uppercase tracking-widest text-foreground">{copy.emptyEventsTitle}</p>
                          <p className="mt-1 text-xs leading-5 text-muted-text">
                            {copy.emptyEventsBody}
                          </p>
                        </div>
                      ) : null}
                </div>
                <div className="flex flex-col gap-2 text-[11px] uppercase tracking-widest text-secondary-text sm:flex-row sm:items-center sm:justify-between px-1">
                  <span>{copy.pageLabel} {eventPage} / {totalEventPages}</span>
                  <div className="flex gap-2">
                    <button type="button" className="btn-secondary text-[11px] px-4 py-1" disabled={eventPage <= 1}
                      onClick={() => setEventPage((prev) => Math.max(1, prev - 1))}>
                      {copy.prevPage}
                    </button>
                    <button type="button" className="btn-secondary text-[11px] px-4 py-1" disabled={eventPage >= totalEventPages}
                      onClick={() => setEventPage((prev) => Math.min(totalEventPages, prev + 1))}>
                      {copy.nextPage}
                    </button>
                  </div>
                </div>
              </div>
            </Card>
          </Disclosure>
        </section>
      </div>
      <ConfirmDialog
        isOpen={Boolean(pendingDelete)}
        title={copy.deleteTitle}
        message={pendingDelete?.message || copy.deleteMessage}
        confirmText={deleteLoading ? copy.deleteInProgress : copy.deleteConfirm}
        cancelText={copy.cancel}
        isDanger
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => {
          if (!deleteLoading) {
            setPendingDelete(null);
          }
        }}
      />
    </div>
  );
};

export default PortfolioPage;
