import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { portfolioApi } from '../api/portfolio';
import type { ParsedApiError } from '../api/error';
import { getParsedApiError } from '../api/error';
import { ApiErrorAlert, Button, Checkbox, ConfirmDialog, Input, PillBadge, SectionShell, SegmentedControl, Select } from '../components/common';
import { useI18n } from '../contexts/UiLanguageContext';
import { translate } from '../i18n/core';
import { toDateInputValue } from '../utils/format';
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
  PortfolioIbkrSyncResponse,
  PortfolioPositionItem,
  PortfolioSide,
  PortfolioSnapshotResponse,
  PortfolioTradeListItem,
} from '../types/portfolio';

const HERO_PNL_POSITIVE_GLOW = '0 0 30px rgba(52, 211, 153, 0.4)';
const PORTFOLIO_INPUT_CLASS = 'h-10 rounded-xl';
const PORTFOLIO_SELECT_CLASS = 'w-full';
const PORTFOLIO_BUTTON_CLASS = 'theme-panel-subtle border-[var(--theme-panel-subtle-border)] bg-[var(--surface-2)]/72 px-3 py-1.5 text-sm text-foreground hover:bg-[var(--overlay-hover)]';
const PORTFOLIO_PRIMARY_BUTTON_CLASS = 'border-white/12 bg-white text-black hover:border-white/30 hover:bg-white/92';
const PORTFOLIO_GHOST_BUTTON_CLASS = 'border-transparent bg-transparent px-0 py-0 text-xs text-secondary-text hover:text-foreground';
const CASH_CURRENCY_OPTIONS = ['CNY', 'HKD', 'USD'] as const;

const DEFAULT_PAGE_SIZE = 20;
const FALLBACK_BROKERS: PortfolioImportBrokerItem[] = [
  { broker: 'huatai', aliases: [], displayName: translate('zh', 'portfolio.brokerName.huatai'), fileExtensions: ['csv'] },
  { broker: 'citic', aliases: ['zhongxin'], displayName: translate('zh', 'portfolio.brokerName.citic'), fileExtensions: ['csv'] },
  { broker: 'cmb', aliases: ['cmbchina', 'zhaoshang'], displayName: translate('zh', 'portfolio.brokerName.cmb'), fileExtensions: ['csv'] },
  { broker: 'ibkr', aliases: ['interactivebrokers'], displayName: translate('zh', 'portfolio.brokerName.ibkr'), fileExtensions: ['xml'] },
];

type AccountOption = 'all' | number;
type EventType = 'trade' | 'cash' | 'corporate';
type TradeFormType = 'stock' | 'fund' | 'corporate';

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
    tradeUidPlaceholder: language === 'en' ? 'Trade reference (optional)' : '交易引用 (可选)',
    notePlaceholder: language === 'en' ? 'Note (optional)' : '备注 (可选)',
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

function formatSideLabel(value: PortfolioSide, language: PortfolioLanguage): string {
  return translate(language, `portfolio.side.${value}`);
}

function formatCashDirectionLabel(value: PortfolioCashDirection, language: PortfolioLanguage): string {
  return translate(language, `portfolio.cashDirection.${value}`);
}

function formatCorporateActionLabel(value: PortfolioCorporateActionType, language: PortfolioLanguage): string {
  return translate(language, `portfolio.corporateAction.${value}`);
}

function formatBrokerLabel(value: string, displayName: string | undefined, language: PortfolioLanguage): string {
  const knownName = translate(language, `portfolio.brokerName.${value}`);
  if (knownName !== `portfolio.brokerName.${value}`) {
    return translate(language, 'portfolio.labelWithKnownName', { value, name: knownName });
  }
  if (displayName && displayName.trim()) {
    return translate(language, 'portfolio.labelWithKnownName', { value, name: displayName.trim() });
  }
  return value;
}

function formatAccountMarketLabel(value: string, language: PortfolioLanguage): string {
  const normalized = value === 'global' || value === 'hk' || value === 'us' ? value : 'cn';
  return translate(language, `portfolio.marketLabel.${normalized}`);
}

function formatPositionContext(market: string, currency: string, language: PortfolioLanguage): string {
  const marketLabel = formatAccountMarketLabel(market, language);
  return translate(language, 'portfolio.positionContext', {
    market: marketLabel,
    currency: currency || '--',
  });
}

function formatSignedMoney(value: number, currency: string): string {
  const formatted = formatMoney(Math.abs(value), currency);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
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
  if (data.refreshEnabled === false) {
    return {
      tone: 'neutral',
      text: translate(language, 'portfolio.fxRefreshDisabled'),
    };
  }

  if (data.pairCount === 0) {
    return {
      tone: 'neutral',
      text: translate(language, 'portfolio.fxRefreshNoPairs'),
    };
  }

  if (data.updatedCount > 0 && data.staleCount === 0 && data.errorCount === 0) {
    return {
      tone: 'success',
      text: translate(language, 'portfolio.fxRefreshUpdated', { count: data.updatedCount }),
    };
  }

  if (data.staleCount > 0) {
    return {
      tone: 'warning',
      text: translate(language, 'portfolio.fxRefreshFallbackWarning', {
        updatedCount: data.updatedCount,
        staleCount: data.staleCount,
        errorCount: data.errorCount,
      }),
    };
  }

  return {
    tone: 'warning',
    text: translate(language, 'portfolio.fxRefreshPartialFailure', {
      updatedCount: data.updatedCount,
      staleCount: data.staleCount,
      errorCount: data.errorCount,
    }),
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
  const [isLoading, setIsLoading] = useState(false);
  const [fxRefreshing, setFxRefreshing] = useState(false);
  const [fxRefreshFeedback, setFxRefreshFeedback] = useState<FxRefreshFeedback | null>(null);
  const [error, setError] = useState<ParsedApiError | null>(null);
  const [riskWarning, setRiskWarning] = useState<string | null>(null);
  const [writeWarning, setWriteWarning] = useState<string | null>(null);

  const [brokers, setBrokers] = useState<PortfolioImportBrokerItem[]>([]);
  const [brokerConnections, setBrokerConnections] = useState<PortfolioBrokerConnectionItem[]>([]);
  const [selectedBroker, setSelectedBroker] = useState('huatai');
  const [ibkrApiBaseUrl, setIbkrApiBaseUrl] = useState('https://localhost:5000/v1/api');
  const [ibkrVerifySsl, setIbkrVerifySsl] = useState(false);
  const [ibkrSessionToken, setIbkrSessionToken] = useState('');
  const [ibkrBrokerAccountRef, setIbkrBrokerAccountRef] = useState('');
  const [ibkrSyncing, setIbkrSyncing] = useState(false);
  const [ibkrSyncResult, setIbkrSyncResult] = useState<PortfolioIbkrSyncResponse | null>(null);

  const [leftTab, setLeftTab] = useState<'trade' | 'account' | 'sync'>('trade');
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);
  const [isXlViewport, setIsXlViewport] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= 1280));
  const [eventType, setEventType] = useState<EventType>('trade');
  const [eventDateFrom] = useState('');
  const [eventDateTo] = useState('');
  const [eventSymbol] = useState('');
  const [eventSide] = useState<'' | PortfolioSide>('');
  const [eventDirection] = useState<'' | PortfolioCashDirection>('');
  const [eventActionType] = useState<'' | PortfolioCorporateActionType>('');
  const [eventPage, setEventPage] = useState(1);
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
  const [tradeType, setTradeType] = useState<TradeFormType>('stock');
  const queryAccountId = selectedAccount === 'all' ? undefined : selectedAccount;
  const refreshViewKey = `${selectedAccount === 'all' ? 'all' : `account:${selectedAccount}`}:cost:${costMethod}`;
  const refreshContextRef = useRef<FxRefreshContext>({ viewKey: refreshViewKey, requestId: 0 });
  const hasAccounts = accounts.length > 0;
  const writableAccount = selectedAccount === 'all' ? undefined : accounts.find((item) => item.id === selectedAccount);
  const writableAccountId = writableAccount?.id;
  const writeBlocked = !writableAccountId;
  const ibkrConnection = useMemo(
    () => brokerConnections.find((item) => item.brokerType === 'ibkr') || null,
    [brokerConnections],
  );
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
  }, []);

  const loadBrokers = useCallback(async () => {
    try {
      const response = await portfolioApi.listImportBrokers();
      const brokerItems = response.brokers || [];
      if (brokerItems.length === 0) {
        setBrokers(FALLBACK_BROKERS);
        setSelectedBroker((prev) => (
          FALLBACK_BROKERS.some((item) => item.broker === prev)
            ? prev
            : FALLBACK_BROKERS[0].broker
        ));
        return;
      }
      setBrokers(brokerItems);
      setSelectedBroker((prev) => (
        brokerItems.some((item) => item.broker === prev)
          ? prev
          : brokerItems[0].broker
      ));
    } catch {
      setBrokers(FALLBACK_BROKERS);
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
        await portfolioApi.getRisk({
          accountId: queryAccountId,
          costMethod,
        });
      } catch (riskErr) {
        const parsed = getParsedApiError(riskErr);
        setRiskWarning(parsed.message || copy.riskFallback);
      }
    } catch (err) {
      setSnapshot(null);
      setError(getParsedApiError(err));
    } finally {
      setIsLoading(false);
    }
  }, [copy.riskFallback, costMethod, queryAccountId]);

  const loadEventsPage = useCallback(async (page: number) => {

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
      }
    } catch (err) {
      setError(getParsedApiError(err));
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
      setCashForm((prev) => ({ ...prev, amount: '', note: '' }));
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
      setCorpForm((prev) => ({ ...prev, symbol: '', cashDividendPerShare: '', splitRatio: '', note: '' }));
    } catch (err) {
      setError(getParsedApiError(err));
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
        await portfolioApi.getRisk({
          accountId: requestedAccountId,
          costMethod: requestedCostMethod,
        });
        if (!isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
          return false;
        }
        setRiskWarning(null);
      } catch (riskErr) {
        if (!isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
          return false;
        }
        const parsed = getParsedApiError(riskErr);
        setRiskWarning(parsed.message || copy.riskFallback);
      }
      return true;
    } catch (err) {
      if (!isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
        return false;
      }
      setSnapshot(null);
      setError(getParsedApiError(err));
      return false;
    }
  }, [copy.riskFallback]);

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

  const snapshotCurrency = snapshot?.currency || 'CNY';
  const totalEquity = snapshot?.totalEquity ?? 0;
  const totalCash = snapshot?.totalCash ?? 0;
  const totalMarketValue = snapshot?.totalMarketValue ?? 0;
  const totalUnrealizedPnl = positionRows.reduce((sum, row) => sum + row.unrealizedPnlBase, 0);
  const historyHasNextPage = currentEventCount >= DEFAULT_PAGE_SIZE;
  const totalAssetsTitle = '总资产 Total Assets';
  const historyDrawerLabel = language === 'en' ? 'History ↗' : '历史记录 ↗';
  const historyDrawerTitle = language === 'en' ? 'Order History' : '历史记录';

  useEffect(() => {
    if (!isHistoryDrawerOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsHistoryDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isHistoryDrawerOpen]);

  useEffect(() => {
    const syncViewport = () => {
      setIsXlViewport(window.innerWidth >= 1280);
    };

    syncViewport();
    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, []);

  const historyPanelContent = (
    <div className="flex h-full min-h-0 flex-col bg-[var(--surface-1)] xl:bg-transparent">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--theme-panel-subtle-border)] px-5 py-4">
        <div>
          <h2 className="text-xs text-muted-text uppercase tracking-widest">{historyDrawerTitle}</h2>
          <p className="mt-2 text-sm text-secondary-text">{copy.pageLabel} {eventPage}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" className={PORTFOLIO_BUTTON_CLASS} onClick={() => void loadEvents()}>{copy.refreshLedger}</Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setIsHistoryDrawerOpen(false)}
            className="h-9 w-9 rounded-full border border-[var(--theme-panel-subtle-border)] text-secondary-text hover:bg-[var(--overlay-hover)] hover:text-foreground xl:hidden"
            aria-label={language === 'en' ? 'Close order history' : '关闭历史记录'}
          >
            <span aria-hidden="true">×</span>
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar p-5">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl
              value={eventType}
              onChange={(next) => setEventType(next as EventType)}
              options={[
                { value: 'trade', label: copy.tradeLedger },
                { value: 'cash', label: copy.cashLedger },
                { value: 'corporate', label: copy.corporateLedger },
              ]}
              listClassName="w-auto"
              buttonClassName="flex-none text-xs"
            />
            <div className="flex items-center gap-2 text-xs text-secondary-text">
              <Button type="button" variant="secondary" className={PORTFOLIO_BUTTON_CLASS} disabled={eventPage <= 1} onClick={() => setEventPage((prev) => Math.max(1, prev - 1))}>{copy.prevPage}</Button>
              <span>{copy.pageLabel} {eventPage}</span>
              <Button type="button" variant="secondary" className={PORTFOLIO_BUTTON_CLASS} disabled={!historyHasNextPage} onClick={() => setEventPage((prev) => prev + 1)}>{copy.nextPage}</Button>
            </div>
          </div>

          {eventType === 'trade' ? (
            tradeEvents.length === 0 ? (
              <div className="theme-panel-subtle rounded-[24px] px-5 py-6 text-sm text-secondary-text">{copy.emptyEventsBody}</div>
            ) : (
              tradeEvents.map((item) => (
                <div key={`trade-${item.id}`} className="theme-panel-subtle rounded-[24px] px-5 py-4 transition-colors hover:bg-[var(--overlay-hover)]">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-foreground">{item.symbol} <span className="text-xs text-muted-text">{formatSideLabel(item.side, language)}</span></div>
                      <div className="mt-1 text-xs text-muted-text">{item.tradeDate} · {item.quantity} @ {item.price}</div>
                    </div>
                    <Button type="button" variant="ghost" className={PORTFOLIO_GHOST_BUTTON_CLASS} onClick={() => setPendingDelete({ eventType: 'trade', id: item.id, message: copy.tradeDeleteMessage(item) })}>
                      {copy.deleteConfirm}
                    </Button>
                  </div>
                </div>
              ))
            )
          ) : null}

          {eventType === 'cash' ? (
            cashEvents.length === 0 ? (
              <div className="theme-panel-subtle rounded-[24px] px-5 py-6 text-sm text-secondary-text">{copy.emptyEventsBody}</div>
            ) : (
              cashEvents.map((item) => (
                <div key={`cash-${item.id}`} className="theme-panel-subtle rounded-[24px] px-5 py-4 transition-colors hover:bg-[var(--overlay-hover)]">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-foreground">{formatCashDirectionLabel(item.direction, language)} <span className="text-xs text-muted-text">{item.currency}</span></div>
                      <div className="mt-1 text-xs text-muted-text">{item.eventDate} · {formatMoney(item.amount, item.currency)}</div>
                    </div>
                    <Button type="button" variant="ghost" className={PORTFOLIO_GHOST_BUTTON_CLASS} onClick={() => setPendingDelete({ eventType: 'cash', id: item.id, message: copy.cashDeleteMessage(item) })}>
                      {copy.deleteConfirm}
                    </Button>
                  </div>
                </div>
              ))
            )
          ) : null}

          {eventType === 'corporate' ? (
            corporateEvents.length === 0 ? (
              <div className="theme-panel-subtle rounded-[24px] px-5 py-6 text-sm text-secondary-text">{copy.emptyEventsBody}</div>
            ) : (
              corporateEvents.map((item) => (
                <div key={`corporate-${item.id}`} className="theme-panel-subtle rounded-[24px] px-5 py-4 transition-colors hover:bg-[var(--overlay-hover)]">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-foreground">{item.symbol} <span className="text-xs text-muted-text">{formatCorporateActionLabel(item.actionType, language)}</span></div>
                      <div className="mt-1 text-xs text-muted-text">
                        {item.effectiveDate}
                        {item.cashDividendPerShare != null ? ` · ${copy.dividendPerShare} ${item.cashDividendPerShare}` : ''}
                        {item.splitRatio != null ? ` · ${copy.splitRatio} ${item.splitRatio}` : ''}
                      </div>
                    </div>
                    <Button type="button" variant="ghost" className={PORTFOLIO_GHOST_BUTTON_CLASS} onClick={() => setPendingDelete({ eventType: 'corporate', id: item.id, message: copy.corporateDeleteMessage(item) })}>
                      {copy.deleteConfirm}
                    </Button>
                  </div>
                </div>
              ))
            )
          ) : null}
        </div>
      </div>
    </div>
  );

  return (
    <>
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

      <div
        data-testid="portfolio-bento-page"
        data-bento-surface="true"
        className="flex h-full min-h-0 w-full flex-1 min-w-0 flex-col overflow-hidden bg-transparent px-6 py-8 text-white/72 md:px-8 xl:px-12"
      >
        <section className="grid w-full flex-1 min-h-0 grid-cols-1 gap-4 lg:grid-cols-12 xl:grid-cols-10">
          <section className="theme-panel-glass lg:col-span-4 xl:col-span-2 h-full flex flex-col rounded-[18px] overflow-hidden">
            <div className="shrink-0 px-4 pt-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm text-muted-text uppercase tracking-widest">Trade Station</h2>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="shrink-0 whitespace-nowrap rounded-md border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-2)]/72 px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-[var(--overlay-hover)]"
                  onClick={() => void handleRefreshFx()}
                  disabled={!hasAccounts || isLoading || fxRefreshing}
                >
                  {fxRefreshing ? copy.refreshingFx : copy.refreshFx}
                </Button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                <Select
                  value={String(selectedAccount)}
                  onChange={(value) => setSelectedAccount(value === 'all' ? 'all' : Number(value))}
                  options={[
                    { value: 'all', label: copy.allAccounts },
                    ...accounts.map((account) => ({ value: String(account.id), label: account.name })),
                  ]}
                  className={PORTFOLIO_SELECT_CLASS}
                />
                <Select
                  value={costMethod}
                  onChange={(value) => setCostMethod(value as PortfolioCostMethod)}
                  options={[
                    { value: 'fifo', label: copy.costFifo },
                    { value: 'avg', label: copy.costAvg },
                  ]}
                  className={PORTFOLIO_SELECT_CLASS}
                />
              </div>
              <div data-testid="portfolio-trade-station-summary" className="mt-3 flex flex-col gap-1 border-y border-[var(--theme-panel-subtle-border)] py-2">
                <div className="flex justify-between text-xs"><span className="text-muted-text">{copy.totalCash}</span><span className="text-foreground">{formatMoney(totalCash, snapshotCurrency)}</span></div>
                <div className="flex justify-between text-xs"><span className="text-muted-text">{copy.totalMarketValue}</span><span className="text-foreground">{formatMoney(totalMarketValue, snapshotCurrency)}</span></div>
                <div className="flex justify-between text-xs"><span className="text-muted-text">{copy.fxState}</span><span data-testid="portfolio-bento-hero-fx-value" className={snapshot?.fxStale ? 'text-amber-300' : 'text-emerald-400'}>{snapshot?.fxStale ? copy.fxStale : copy.fxFresh}</span></div>
              </div>
              {fxRefreshFeedback ? (
                <p className={`mt-2 text-xs ${
                  fxRefreshFeedback.tone === 'success'
                    ? 'text-emerald-300'
                    : fxRefreshFeedback.tone === 'warning'
                      ? 'text-amber-200'
                      : 'text-secondary-text'
                }`}>
                  {fxRefreshFeedback.text}
                </p>
              ) : null}
            </div>

            <div className="shrink-0 border-b border-[var(--theme-panel-subtle-border)] px-4 pt-1">
              <SegmentedControl
                value={leftTab}
                onChange={(value) => setLeftTab(value as 'trade' | 'account' | 'sync')}
                options={[
                  { value: 'trade', label: language === 'en' ? 'Trade' : '交易' },
                  { value: 'account', label: language === 'en' ? 'Account' : '账户' },
                  { value: 'sync', label: language === 'en' ? 'Sync' : '同步' },
                ]}
                listClassName="w-full justify-start rounded-none border-0 bg-transparent p-0"
                buttonClassName="flex-none rounded-none border-b-2 border-transparent px-0 py-2 text-xs uppercase tracking-[0.14em]"
                activeButtonClassName="border-b-[var(--border-strong)] bg-transparent shadow-none"
                inactiveButtonClassName="bg-transparent shadow-none"
              />
            </div>

            <div
              data-testid="portfolio-trade-station-scroll"
              className="flex-1 min-h-0 overflow-y-auto no-scrollbar p-3.5"
            >
              {leftTab === 'trade' ? (
                <div className="flex flex-col gap-2">
                  <div
                    data-testid="portfolio-trade-type-switcher"
                    className="mb-3"
                  >
                    <SegmentedControl
                      value={tradeType}
                      onChange={(value) => setTradeType(value as TradeFormType)}
                      options={[
                        { value: 'stock', label: language === 'en' ? 'Stock Trade' : '股票买卖' },
                        { value: 'fund', label: language === 'en' ? 'Cash Transfer' : '资金划转' },
                        { value: 'corporate', label: language === 'en' ? 'Corporate Action' : '公司行为' },
                      ]}
                      listClassName="w-full"
                      buttonClassName="text-xs"
                    />
                  </div>
                  {tradeType === 'stock' ? (
                    <div className="space-y-1.5">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-text">{copy.manualTrade}</p>
                      <form className="space-y-1.5" onSubmit={handleTradeSubmit}>
                        <div className="grid grid-cols-2 gap-3">
                          <Input className={PORTFOLIO_INPUT_CLASS} placeholder={copy.symbolPlaceholder} value={tradeForm.symbol} onChange={(e) => setTradeForm((prev) => ({ ...prev, symbol: e.target.value }))} required />
                          <Input className={PORTFOLIO_INPUT_CLASS} type="date" value={tradeForm.tradeDate} onChange={(e) => setTradeForm((prev) => ({ ...prev, tradeDate: e.target.value }))} required />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <Select className={PORTFOLIO_SELECT_CLASS} value={tradeForm.side} onChange={(value) => setTradeForm((prev) => ({ ...prev, side: value as PortfolioSide }))} options={[{ value: 'buy', label: copy.buy }, { value: 'sell', label: copy.sell }]} />
                          <Input className={PORTFOLIO_INPUT_CLASS} type="text" placeholder={copy.tradeUidPlaceholder} value={tradeForm.tradeUid} onChange={(e) => setTradeForm((prev) => ({ ...prev, tradeUid: e.target.value }))} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <Input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.0001" placeholder={copy.quantity} value={tradeForm.quantity} onChange={(e) => setTradeForm((prev) => ({ ...prev, quantity: e.target.value }))} required />
                          <Input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.0001" placeholder={copy.price} value={tradeForm.price} onChange={(e) => setTradeForm((prev) => ({ ...prev, price: e.target.value }))} required />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <Input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.0001" placeholder={copy.feeOptional} value={tradeForm.fee} onChange={(e) => setTradeForm((prev) => ({ ...prev, fee: e.target.value }))} />
                          <Input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.0001" placeholder={copy.taxOptional} value={tradeForm.tax} onChange={(e) => setTradeForm((prev) => ({ ...prev, tax: e.target.value }))} />
                        </div>
                        <Input className={PORTFOLIO_INPUT_CLASS} placeholder={copy.notePlaceholder} value={tradeForm.note} onChange={(e) => setTradeForm((prev) => ({ ...prev, note: e.target.value }))} />
                        <Button type="submit" variant="primary" className={`${PORTFOLIO_PRIMARY_BUTTON_CLASS} w-full`} disabled={!writableAccountId}>{copy.submitTrade}</Button>
                      </form>
                    </div>
                  ) : null}

                  {tradeType === 'fund' ? (
                    <SectionShell className="rounded-[18px] p-3" contentClassName="space-y-1.5">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-text">{copy.manualCash}</p>
                      <form className="space-y-1.5" onSubmit={handleCashSubmit}>
                        <div className="grid grid-cols-2 gap-3">
                          <Input className={PORTFOLIO_INPUT_CLASS} type="date" value={cashForm.eventDate} onChange={(e) => setCashForm((prev) => ({ ...prev, eventDate: e.target.value }))} required />
                          <Select className={PORTFOLIO_SELECT_CLASS} value={cashForm.direction} onChange={(value) => setCashForm((prev) => ({ ...prev, direction: value as PortfolioCashDirection }))} options={[{ value: 'in', label: copy.cashIn }, { value: 'out', label: copy.cashOut }]} />
                        </div>
                        <div data-testid="portfolio-cash-amount-currency-grid" className="grid grid-cols-2 gap-3">
                          <Input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.01" placeholder={copy.amount} value={cashForm.amount} onChange={(e) => setCashForm((prev) => ({ ...prev, amount: e.target.value }))} required />
                          <Select
                            data-testid="portfolio-cash-currency-select"
                            className={PORTFOLIO_SELECT_CLASS}
                            value={cashForm.currency}
                            onChange={(value) => setCashForm((prev) => ({ ...prev, currency: value }))}
                            options={CASH_CURRENCY_OPTIONS.map((currency) => ({ value: currency, label: currency }))}
                            placeholder={copy.currencyOptional(snapshotCurrency)}
                          />
                        </div>
                        <Input className={PORTFOLIO_INPUT_CLASS} placeholder={copy.notePlaceholder} value={cashForm.note} onChange={(e) => setCashForm((prev) => ({ ...prev, note: e.target.value }))} />
                        <Button type="submit" variant="primary" className={`${PORTFOLIO_PRIMARY_BUTTON_CLASS} w-full`} disabled={!writableAccountId}>{copy.submitCash}</Button>
                      </form>
                    </SectionShell>
                  ) : null}

                  {tradeType === 'corporate' ? (
                    <SectionShell className="rounded-[18px] p-3" contentClassName="space-y-1.5">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-text">{copy.manualCorporate}</p>
                      <form className="space-y-1.5" onSubmit={handleCorporateSubmit}>
                        <div className="grid grid-cols-2 gap-3">
                          <Input className={PORTFOLIO_INPUT_CLASS} placeholder={copy.stockCode} value={corpForm.symbol} onChange={(e) => setCorpForm((prev) => ({ ...prev, symbol: e.target.value }))} required />
                          <Input className={PORTFOLIO_INPUT_CLASS} type="date" value={corpForm.effectiveDate} onChange={(e) => setCorpForm((prev) => ({ ...prev, effectiveDate: e.target.value }))} required />
                        </div>
                        <Select className={PORTFOLIO_SELECT_CLASS} value={corpForm.actionType} onChange={(value) => setCorpForm((prev) => ({ ...prev, actionType: value as PortfolioCorporateActionType }))} options={[{ value: 'cash_dividend', label: copy.cashDividend }, { value: 'split_adjustment', label: copy.splitAdjustment }]} />
                        <div className="grid grid-cols-2 gap-3">
                          <Input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.0001" placeholder={copy.dividendPerShare} value={corpForm.cashDividendPerShare} onChange={(e) => setCorpForm((prev) => ({ ...prev, cashDividendPerShare: e.target.value }))} />
                          <Input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.0001" placeholder={copy.splitRatio} value={corpForm.splitRatio} onChange={(e) => setCorpForm((prev) => ({ ...prev, splitRatio: e.target.value }))} />
                        </div>
                        <Input className={PORTFOLIO_INPUT_CLASS} placeholder={copy.notePlaceholder} value={corpForm.note} onChange={(e) => setCorpForm((prev) => ({ ...prev, note: e.target.value }))} />
                        <Button type="submit" variant="primary" className={`${PORTFOLIO_PRIMARY_BUTTON_CLASS} w-full`} disabled={!writableAccountId}>{copy.submitCorporate}</Button>
                      </form>
                    </SectionShell>
                  ) : null}
                </div>
              ) : null}

              {leftTab === 'account' ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-text">{copy.createAccountTitle}</p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        className={PORTFOLIO_BUTTON_CLASS}
                        onClick={() => {
                          setShowCreateAccount((prev) => !prev);
                          setAccountCreateError(null);
                          setAccountCreateSuccess(null);
                        }}
                      >
                        {showCreateAccount ? copy.collapseCreate : copy.createAccount}
                      </Button>
                      <Button type="button" variant="secondary" className={PORTFOLIO_BUTTON_CLASS} onClick={() => void handleRefresh()} disabled={isLoading}>
                        {isLoading ? copy.refreshingData : copy.refreshData}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {accounts.map((account) => (
                      <div key={account.id} className="theme-panel-subtle rounded-[16px] px-4 py-3 text-sm text-secondary-text">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-foreground">{account.name}</span>
                          <span className="text-muted-text">#{account.id}</span>
                        </div>
                        <div className="mt-1 text-xs text-muted-text">{formatAccountMarketLabel(account.market, language)} · {account.baseCurrency} · {account.broker || '--'}</div>
                      </div>
                    ))}
                  </div>
                  {(showCreateAccount || !hasAccounts) ? (
                    <form className="theme-panel-subtle space-y-3 rounded-[18px] p-4" onSubmit={handleCreateAccount}>
                      {accountCreateError ? <div className="text-xs text-danger">{accountCreateError}</div> : null}
                      {accountCreateSuccess ? <div className="text-xs text-success">{accountCreateSuccess}</div> : null}
                      <Input className={PORTFOLIO_INPUT_CLASS} placeholder={copy.accountNamePlaceholder} value={accountForm.name} onChange={(e) => setAccountForm((prev) => ({ ...prev, name: e.target.value }))} />
                      <div className="grid grid-cols-2 gap-4">
                        <Input className={PORTFOLIO_INPUT_CLASS} placeholder={copy.brokerPlaceholder} value={accountForm.broker} onChange={(e) => setAccountForm((prev) => ({ ...prev, broker: e.target.value }))} />
                        <Input className={PORTFOLIO_INPUT_CLASS} placeholder={copy.baseCurrencyPlaceholder} value={accountForm.baseCurrency} onChange={(e) => setAccountForm((prev) => ({ ...prev, baseCurrency: e.target.value.toUpperCase() }))} />
                      </div>
                      <Select className={PORTFOLIO_SELECT_CLASS} value={accountForm.market} onChange={(value) => setAccountForm((prev) => ({ ...prev, market: value as 'cn' | 'hk' | 'us' | 'global' }))} options={[{ value: 'cn', label: copy.marketCn }, { value: 'hk', label: copy.marketHk }, { value: 'us', label: copy.marketUs }, { value: 'global', label: copy.marketGlobal }]} />
                      <Button type="submit" variant="primary" className={`${PORTFOLIO_PRIMARY_BUTTON_CLASS} w-full`} disabled={accountCreating}>{accountCreating ? copy.creatingAccount : copy.createAccount}</Button>
                    </form>
                  ) : null}
                </div>
              ) : null}

              {leftTab === 'sync' ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-text">{copy.dataSyncTitle}</p>
                    <Button type="button" variant="secondary" className={PORTFOLIO_BUTTON_CLASS} onClick={() => void handleRefresh()} disabled={isLoading}>
                      {isLoading ? copy.refreshingData : copy.refreshData}
                    </Button>
                  </div>
                  <div className="text-xs text-secondary-text space-y-1">
                    <p>{copy.currentImportAccount}</p>
                    <p>{writableAccount ? `${writableAccount.name} (#${writableAccount.id})` : copy.brokerFallbackEmpty}</p>
                    <p>{selectedBroker === 'ibkr' ? copy.ibkrImportHint : copy.brokerImportHint}</p>
                  </div>
                  <Select className={PORTFOLIO_SELECT_CLASS} value={selectedBroker} onChange={setSelectedBroker} options={brokers.map((broker) => ({ value: broker.broker, label: formatBrokerLabel(broker.broker, broker.displayName, language) }))} />
                  {selectedBroker === 'ibkr' ? (
                    <SectionShell className="rounded-[18px] p-4" contentClassName="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="space-y-1 text-xs text-secondary-text">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-text">{copy.ibkrReadOnlyTitle}</p>
                          <p>{copy.ibkrReadOnlyBody}</p>
                        </div>
                        <PillBadge variant="info">{copy.readOnlyBadge}</PillBadge>
                      </div>
                      {ibkrConnection ? <p className="text-sm text-foreground">{ibkrConnection.connectionName}</p> : null}
                      <Input className={PORTFOLIO_INPUT_CLASS} placeholder={copy.ibkrApiBasePlaceholder} value={ibkrApiBaseUrl} onChange={(e) => setIbkrApiBaseUrl(e.target.value)} />
                      <Input className={PORTFOLIO_INPUT_CLASS} placeholder={copy.ibkrAccountRefPlaceholder} value={ibkrBrokerAccountRef} onChange={(e) => setIbkrBrokerAccountRef(e.target.value)} />
                      <Input className={PORTFOLIO_INPUT_CLASS} placeholder={copy.ibkrSessionTokenPlaceholder} value={ibkrSessionToken} onChange={(e) => setIbkrSessionToken(e.target.value)} />
                      <Checkbox checked={ibkrVerifySsl} onChange={(e) => setIbkrVerifySsl(e.target.checked)} label={copy.verifyIbkrSsl} containerClassName="text-xs text-secondary-text" />
                      <Button type="button" variant="primary" className={`${PORTFOLIO_PRIMARY_BUTTON_CLASS} w-full`} onClick={() => void handleSyncIbkr()} disabled={!writableAccountId || ibkrSyncing}>
                        {ibkrSyncing ? copy.syncing : copy.syncIbkr}
                      </Button>
                      {ibkrSyncResult ? (
                        <div className="theme-panel-subtle rounded-[16px] px-4 py-3 text-xs text-secondary-text space-y-1">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-text">{copy.syncResult}</p>
                          <div>{copy.positionsCountLabel} <span className="text-foreground">{ibkrSyncResult.positionCount ?? '--'}</span></div>
                          <div>{copy.cashCurrenciesLabel} <span className="text-foreground">{ibkrSyncResult.cashBalanceCount ?? 0}</span></div>
                          <div>{copy.syncedAt}: <span className="text-foreground">{ibkrSyncResult.syncedAt ? ibkrSyncResult.syncedAt.replace('T', ' ') : '--'}</span></div>
                          <div>{copy.totalEquity} <span className="text-foreground">{formatMoney(ibkrSyncResult.totalEquity, ibkrSyncResult.baseCurrency)}</span></div>
                        </div>
                      ) : null}
                    </SectionShell>
                  ) : (
                    <div className="theme-panel-subtle rounded-[18px] px-4 py-4 text-xs text-secondary-text">
                      {copy.brokerImportHint}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </section>

          <section className="lg:col-span-8 xl:col-span-5 h-full flex flex-col gap-4 min-h-0">
            <div
              data-testid="portfolio-total-assets-card"
              className="theme-panel-glass shrink-0 rounded-[18px] p-4 flex justify-between items-end gap-3"
            >
              <div className="min-w-0">
                <h1 className="text-xs text-muted-text uppercase tracking-widest mb-2">{totalAssetsTitle}</h1>
                <div
                  data-testid="portfolio-total-assets-value"
                  className="text-[3rem] md:text-[4rem] font-bold text-foreground leading-none tracking-tight tabular-nums"
                  style={{ textShadow: HERO_PNL_POSITIVE_GLOW }}
                >
                  {formatMoney(totalEquity, snapshotCurrency)}
                </div>
              </div>
              <div
                className={`text-2xl tabular-nums pb-2 ${
                  totalUnrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {totalUnrealizedPnl >= 0 ? '+ ' : '- '}
                {formatMoney(Math.abs(totalUnrealizedPnl), snapshotCurrency)}
              </div>
            </div>

            <div
              data-testid="portfolio-current-holdings-panel"
              className="theme-panel-glass flex-1 min-h-0 flex flex-col rounded-[18px] overflow-hidden"
            >
              <div className="shrink-0 p-4 border-b border-[var(--theme-panel-subtle-border)] flex justify-between items-center gap-3">
                <h2 className="min-w-0 text-xs text-muted-text uppercase tracking-widest">
                  Current Holdings ({positionRows.length === 0 ? '共 0 项' : `共 ${positionRows.length} 项`})
                </h2>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsHistoryDrawerOpen(true)}
                  data-testid="portfolio-history-drawer-trigger"
                  className="shrink-0 rounded-full border border-[var(--theme-panel-subtle-border)] px-3 py-1.5 text-xs text-secondary-text hover:bg-[var(--overlay-hover)] hover:text-foreground xl:hidden"
                >
                  {historyDrawerLabel}
                </Button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar p-4">
                <div className="flex flex-col gap-2">
                  {positionRows.length === 0 ? (
                    <div className="theme-panel-subtle px-6 py-5 rounded-3xl text-sm text-secondary-text">{copy.noPositions}</div>
                  ) : (
                    positionRows.map((row) => (
                      <div
                        key={`${row.accountId}-${row.symbol}-${row.market}`}
                        className="theme-panel-subtle flex items-center justify-between gap-4 px-4 py-3 rounded-[18px] hover:bg-[var(--overlay-hover)] transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="text-lg text-foreground font-medium truncate">{row.symbol}</div>
                          <div className="text-xs text-muted-text">{row.accountName} · {formatPositionContext(row.market, row.currency, language)}</div>
                        </div>
                        <div className="flex items-center gap-6">
                          <div className="text-right">
                            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-text">{copy.positionMarketValue}</div>
                            <div className="text-foreground tabular-nums">{formatMoney(row.marketValueBase, row.valuationCurrency)}</div>
                          </div>
                          <div className={`text-lg tabular-nums ${row.unrealizedPnlBase >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {formatSignedMoney(row.unrealizedPnlBase, row.valuationCurrency)}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>

          {isXlViewport ? (
            <section className="hidden xl:flex xl:col-span-3 xl:min-h-0">
            <div className="theme-panel-glass flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[18px]">
              {historyPanelContent}
            </div>
            </section>
          ) : null}
        </section>
      </div>

      {isHistoryDrawerOpen ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label={language === 'en' ? 'Close history drawer' : '关闭历史抽屉'}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setIsHistoryDrawerOpen(false)}
          />
          <aside
            data-testid="portfolio-history-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={historyDrawerTitle}
            className="absolute inset-y-0 right-0 flex w-full justify-end"
          >
            <div className="flex h-full w-full max-w-md flex-col border-l border-[var(--theme-panel-subtle-border)] shadow-2xl">
              {historyPanelContent}
            </div>
          </aside>
        </div>
      ) : null}

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
    </>
  );
};

export default PortfolioPage;
