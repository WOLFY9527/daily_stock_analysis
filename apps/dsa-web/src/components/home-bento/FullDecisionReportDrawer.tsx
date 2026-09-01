import type React from 'react';
import { useState } from 'react';
import { Copy, Download, Printer } from 'lucide-react';
import { Drawer } from '../common/Drawer';
import type {
  AnalysisReport,
  StandardReport,
  StandardReportChecklistItem,
  StandardReportField,
} from '../../types/analysis';
import {
  buildInstitutionalReportMarkdown,
  consumerSafeReportPriceContext,
  consumerSafeReportText,
  getCompanyDisplayName,
  getCompanyWithTicker,
  getSymbolDisplay,
  normalizeFullReportBrand,
  readObjectField,
} from '../../utils/homeReportIdentity';

const REPORT_DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

type DashboardPayload = {
  ticker: string;
  decision: {
    company: string;
    heroValue: string;
    heroUnit?: string;
    confidenceValue?: string;
    signalLabel: string;
    scoreValue: string;
    summary: string;
    reasonBody: string;
  };
};

type FullDecisionReportDrawerProps = {
  dashboard: DashboardPayload;
  isOpen: boolean;
  onClose: () => void;
  report: AnalysisReport | null;
  language: 'en' | 'zh';
  t: FullReportTranslate;
};

type FullReportSection = {
  id: string;
  title: string;
  rows?: Array<{ label: string; value: string }>;
  bullets?: string[];
  checklist?: Array<{ label: string; status: string }>;
};

type FullReportTranslate = (key: string, vars?: Record<string, string | number | undefined>) => string;

type ReportIdentity = {
  companyName: string;
  ticker: string;
  companyWithTicker: string;
  generatedAt: string;
  market: string;
  currency: string;
  providers: string;
  horizon: string;
  dataStatus: string;
};

const REPORT_BRAND = 'WolfyStock Research Report';

function TraceBadge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'used' | 'warning' | 'missing' }) {
  const toneClass = tone === 'used'
    ? 'border-[color:var(--state-success-border)] bg-[var(--state-success-bg)] text-[color:var(--state-success-text)]'
    : tone === 'warning'
      ? 'border-amber-300/20 bg-amber-300/10 text-amber-100'
      : tone === 'missing'
        ? 'border-[color:var(--state-danger-border)] bg-[var(--state-danger-bg)] text-[color:var(--state-danger-text)]'
        : 'border-[color:var(--wolfy-divider)] bg-[var(--wolfy-surface-input)] text-[color:var(--wolfy-text-secondary)]';
  return (
    <span className={`inline-flex min-w-0 max-w-full items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${toneClass}`}>
      <span className="truncate">{children}</span>
    </span>
  );
}

function safeReportValue(value: unknown): string {
  const text = String(value ?? '').trim();
  return text && text !== '-' && !/^n\/?a$/i.test(text) ? text : '--';
}

function normalizeDetailKey(value?: string): string {
  return String(value || '').toLowerCase().replace(/[\s/()%+.\-_:]+/g, '');
}

function findStandardField(fields: StandardReportField[] | undefined, aliases: string[]): StandardReportField | undefined {
  const normalizedAliases = aliases.map((alias) => normalizeDetailKey(alias));
  return (fields || []).find((field) => {
    const key = normalizeDetailKey(field.label);
    return normalizedAliases.some((alias) => key.includes(alias) || alias.includes(key));
  });
}

function fieldValue(fields: StandardReportField[] | undefined, aliases: string[]): string {
  const field = findStandardField(fields, aliases);
  return field ? consumerSafeReportText(field.value, '--') : '';
}

function priceFieldValue(fields: StandardReportField[] | undefined, aliases: string[]): string {
  const field = findStandardField(fields, aliases);
  return field ? consumerSafeReportPriceContext(field.value, '--') : '';
}

function getReportSource(report: AnalysisReport | null): StandardReport | undefined {
  return report?.details?.standardReport;
}

function listOrMissing(
  items?: Array<string | undefined | null>,
  fallback = '--',
  mode: 'text' | 'price' = 'text',
): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const raw of items || []) {
    const item = mode === 'price'
      ? consumerSafeReportPriceContext(raw, '')
      : consumerSafeReportText(raw, '');
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(item);
  }
  return values.length ? values : [fallback];
}

function normalizeChecklistStatus(item: StandardReportChecklistItem | string, t: FullReportTranslate): { label: string; status: string } {
  if (typeof item === 'string') {
    return { label: consumerSafeReportText(item, t('home.fullReport.fallbacks.checklistReview')), status: t('home.fullReport.status.unknown') };
  }
  const status = String(item.status || '').toLowerCase();
  const normalized = status === 'pass'
    ? 'PASS'
    : status === 'fail'
      ? 'FAIL'
      : status === 'warn'
      ? 'WARN'
      : status === 'na'
        ? 'N/A'
          : t('home.fullReport.status.unknown');
  return { label: consumerSafeReportText(item.text, t('home.fullReport.fallbacks.checklistReview')), status: normalized };
}

function formatReportDateTime(value: string | undefined, locale: 'en' | 'zh'): string {
  const text = String(value || '').trim();
  if (!text) {
    return '--';
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return text;
  }
  if (locale === 'zh') {
    return REPORT_DATE_FORMATTER.format(date);
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function reportStatusLabel(value: unknown, t: FullReportTranslate): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'used' || normalized === 'available' || normalized === 'ready') return t('home.fullReport.status.available');
  if (normalized === 'fallback' || normalized === 'stale' || normalized === 'cached') return t('home.fullReport.status.recentData');
  if (normalized === 'partial' || normalized === 'degraded') return t('home.fullReport.status.partialData');
  if (normalized === 'missing' || normalized === 'error' || normalized === 'unavailable') return t('home.fullReport.status.insufficientData');
  return t('home.fullReport.status.unconfirmed');
}

function buildReportIdentity(report: AnalysisReport | null, dashboard: DashboardPayload | undefined, t: FullReportTranslate, locale: 'en' | 'zh', override?: Partial<ReportIdentity>): ReportIdentity {
  const ticker = override?.ticker || getSymbolDisplay(report) || dashboard?.ticker || '--';
  const companyName = override?.companyName || getCompanyDisplayName(report) || dashboard?.decision.company || ticker;
  const generatedAt = override?.generatedAt
    || report?.meta.reportGeneratedAt
    || report?.meta.createdAt
    || report?.decisionTrace?.generatedAt
    || '';
  const dataSources = report?.decisionTrace?.dataSources || [];
  const providerSeen = new Set<string>();
  const providerParts: string[] = [];
  for (const source of dataSources) {
    const provider = String(source.provider || source.name || '').trim();
    if (!provider) continue;
    const key = provider.toLowerCase();
    if (providerSeen.has(key)) continue;
    providerSeen.add(key);
    providerParts.push(provider);
  }
  const providers = providerParts.join(', ');
  const statuses = dataSources.flatMap((source) => source.status ? [source.status] : []);
  const sourceStatus = statuses.length
    ? statuses.map((status) => {
      return reportStatusLabel(status, t);
    }).join(' / ')
    : t('home.fullReport.fallbacks.coverageUnconfirmed');

  return {
    companyName,
    ticker,
    companyWithTicker: getCompanyWithTicker(report || { companyName, symbol: ticker }),
    generatedAt: formatReportDateTime(generatedAt, locale),
    market: override?.market || report?.decisionTrace?.market || '--',
    currency: override?.currency || safeReportValue(readObjectField(report, ['details', 'standardReport', 'summaryPanel', 'currency']) || readObjectField(report, ['details', 'standardReport', 'market', 'currency'])),
    providers: override?.providers || providers || '--',
    horizon: override?.horizon || safeReportValue(report?.details?.standardReport?.summaryPanel?.timeSensitivity || report?.details?.standardReport?.decisionPanel?.marketStructure || t('home.fullReport.fallbacks.horizon')),
    dataStatus: override?.dataStatus || sourceStatus || '--',
  };
}

function normalizeTicker(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

function hasReportIdentityMismatch(report: AnalysisReport | null, dashboard: DashboardPayload): boolean {
  const dashboardTicker = normalizeTicker(dashboard.ticker);
  const reportTicker = normalizeTicker(getSymbolDisplay(report));
  return Boolean(report && dashboardTicker && reportTicker && dashboardTicker !== reportTicker);
}

function buildFullReportSections(report: AnalysisReport | null, dashboard: DashboardPayload, t: FullReportTranslate): FullReportSection[] {
  const standardReport = getReportSource(report);
  const summaryPanel = standardReport?.summaryPanel;
  const decisionPanel = standardReport?.decisionPanel;
  const reasonLayer = standardReport?.reasonLayer;
  const highlights = standardReport?.highlights;
  const market = standardReport?.market;
  const marketFields = [
    ...(market?.displayFields || []),
    ...(market?.regularFields || []),
    ...(market?.extendedFields || []),
  ];
  const technicalFields = standardReport?.technicalFields || standardReport?.tableSections?.technical?.fields || [];
  const fundamentalFields = standardReport?.fundamentalFields || standardReport?.tableSections?.fundamental?.fields || [];
  const earningsFields = standardReport?.earningsFields || standardReport?.tableSections?.earnings?.fields || [];
  const sentimentFields = standardReport?.sentimentFields || [];
  const battleFields = standardReport?.battleFields || [];
  const coverageNotes = standardReport?.coverageNotes;
  const checklistItems = (standardReport?.checklistItems || standardReport?.checklist || []).map((item) => normalizeChecklistStatus(item, t));
  const battleCards = standardReport?.battlePlanCompact?.cards || [];
  const battleNotes = standardReport?.battlePlanCompact?.notes || [];

  return [
    {
      id: 'summary',
      title: t('home.fullReport.sections.summary'),
      rows: [
        { label: t('home.fullReport.fields.observe'), value: consumerSafeReportText(summaryPanel?.operationAdvice || report?.summary.operationAdvice || dashboard.decision.signalLabel, t('home.fullReport.fallbacks.observe')) },
        { label: t('home.fullReport.fields.score'), value: safeReportValue(summaryPanel?.score ?? dashboard.decision.heroValue) },
        { label: t('home.fullReport.fields.scenarioReference'), value: consumerSafeReportText(decisionPanel?.marketStructure || summaryPanel?.trendPrediction || report?.summary.trendPrediction || dashboard.decision.scoreValue, t('home.fullReport.fallbacks.scenarioReference')) },
        { label: t('home.fullReport.fields.researchSummary'), value: consumerSafeReportText(summaryPanel?.oneSentence || report?.summary.analysisSummary || dashboard.decision.summary, t('home.fullReport.fallbacks.researchSummary')) },
        { label: t('home.fullReport.fields.keyReason'), value: consumerSafeReportText(reasonLayer?.coreReasons?.[0] || reasonLayer?.latestKeyUpdate || dashboard.decision.reasonBody, t('home.fullReport.fallbacks.keyReason')) },
      ],
    },
    {
      id: 'important-brief',
      title: t('home.fullReport.sections.importantBrief'),
      rows: [
        { label: t('home.fullReport.fields.sentiment'), value: consumerSafeReportText(highlights?.sentimentSummary || reasonLayer?.sentimentSummary || fieldValue(sentimentFields, ['sentiment', '舆情', '情绪']) || report?.summary.sentimentLabel, t('home.fullReport.fallbacks.insufficientData')) },
        { label: t('home.fullReport.fields.earningsOutlook'), value: consumerSafeReportText(highlights?.earningsOutlook || fieldValue(earningsFields, ['earnings', '业绩', 'eps']), t('home.fullReport.fallbacks.insufficientData')) },
        { label: t('home.fullReport.fields.latestUpdate'), value: consumerSafeReportText(reasonLayer?.latestKeyUpdate || highlights?.latestNews?.[0], t('home.fullReport.fallbacks.insufficientData')) },
      ],
      bullets: listOrMissing(highlights?.latestNews, t('home.fullReport.fallbacks.latestNews')),
    },
    {
      id: 'risks',
      title: t('home.fullReport.sections.risks'),
      bullets: listOrMissing([
        reasonLayer?.topRisk,
        ...(highlights?.riskAlerts || []),
        ...(highlights?.bearishFactors || []),
      ], t('home.fullReport.fallbacks.risks'), 'price'),
    },
    {
      id: 'catalysts',
      title: t('home.fullReport.sections.catalysts'),
      bullets: listOrMissing([
        reasonLayer?.topCatalyst,
        ...(highlights?.positiveCatalysts || []),
        ...(highlights?.bullishFactors || []),
      ], t('home.fullReport.fallbacks.catalysts')),
    },
    {
      id: 'market',
      title: t('home.fullReport.sections.market'),
      rows: [
        { label: t('home.fullReport.fields.open'), value: fieldValue(marketFields, ['open', '开盘']) || safeReportValue(market?.regularMetrics?.open) },
        { label: t('home.fullReport.fields.high'), value: fieldValue(marketFields, ['high', '最高']) || safeReportValue(market?.regularMetrics?.high) },
        { label: t('home.fullReport.fields.low'), value: fieldValue(marketFields, ['low', '最低']) || safeReportValue(market?.regularMetrics?.low) },
        { label: t('home.fullReport.fields.close'), value: fieldValue(marketFields, ['close', '收盘', 'current']) || safeReportValue(summaryPanel?.currentPrice || market?.regularMetrics?.close) },
        { label: t('home.fullReport.fields.changePct'), value: fieldValue(marketFields, ['change pct', 'change%', '涨跌幅']) || safeReportValue(summaryPanel?.changePct || market?.regularMetrics?.changePct) },
        { label: t('home.fullReport.fields.volume'), value: fieldValue(marketFields, ['volume', '成交量']) || safeReportValue(market?.regularMetrics?.volume) },
        { label: t('home.fullReport.fields.turnover'), value: fieldValue(marketFields, ['turnover', 'amount', '成交额']) || safeReportValue(market?.regularMetrics?.amount) },
        { label: t('home.fullReport.fields.priceContext'), value: consumerSafeReportText(summaryPanel?.priceContextNote || summaryPanel?.priceBasis || summaryPanel?.priceBasisDetail, t('home.fullReport.fallbacks.insufficientData')) },
      ],
    },
    {
      id: 'data-lens',
      title: t('home.fullReport.sections.dataLens'),
      rows: [
        { label: 'MA alignment', value: fieldValue(technicalFields, ['MA ALIGNMENT', 'Moving Averages', '均线']) },
        { label: t('home.fullReport.fields.currentPrice'), value: safeReportValue(summaryPanel?.currentPrice || decisionPanel?.analysisPrice) },
        { label: 'MA5', value: fieldValue(technicalFields, ['MA5', '5日']) },
        { label: 'MA10', value: fieldValue(technicalFields, ['MA10', '10日']) },
        { label: 'MA20', value: fieldValue(technicalFields, ['MA20', '20日']) },
        { label: 'MA60', value: fieldValue(technicalFields, ['MA60', '60日']) },
        { label: t('home.fullReport.fields.keyPriceRange'), value: consumerSafeReportPriceContext(decisionPanel?.support || decisionPanel?.idealEntry || report?.strategy?.idealBuy, t('home.fullReport.fallbacks.insufficientData')) },
        { label: t('home.fullReport.fields.upperWatch'), value: consumerSafeReportPriceContext(decisionPanel?.resistance || decisionPanel?.target || decisionPanel?.targetZone || report?.strategy?.takeProfit, t('home.fullReport.fallbacks.insufficientData')) },
        { label: 'Volume / turnover', value: fieldValue(technicalFields, ['VOLUME DYNAMICS', 'Volume', '量价', '成交量']) || fieldValue(marketFields, ['volume', 'turnover', 'amount', '成交']) },
        { label: t('home.fullReport.fields.chipObservation'), value: consumerSafeReportText(fieldValue(technicalFields, ['chip', '筹码']) || standardReport?.decisionContext?.compositeView, t('home.fullReport.fallbacks.insufficientData')) },
      ],
    },
    {
      id: 'technical',
      title: t('home.fullReport.sections.technical'),
      rows: [
        { label: t('home.fullReport.fields.movingAverageArrangement'), value: fieldValue(technicalFields, ['MA ALIGNMENT', 'Moving Averages', '均线']) },
        { label: 'RSI', value: fieldValue(technicalFields, ['RSI-14', 'RSI14', 'RSI']) },
        { label: 'MACD', value: fieldValue(technicalFields, ['MACD']) },
        { label: t('home.fullReport.fields.keyPriceRange'), value: consumerSafeReportPriceContext(decisionPanel?.support || decisionPanel?.idealEntry || report?.strategy?.idealBuy, t('home.fullReport.fallbacks.insufficientData')) },
        { label: t('home.fullReport.fields.upperWatch'), value: consumerSafeReportPriceContext(decisionPanel?.resistance || decisionPanel?.target || report?.strategy?.takeProfit, t('home.fullReport.fallbacks.insufficientData')) },
        { label: t('home.fullReport.fields.volumePrice'), value: fieldValue(technicalFields, ['VOLUME DYNAMICS', 'Volume', '量价', '成交量']) },
      ],
    },
    {
      id: 'fundamentals',
      title: t('home.fullReport.sections.fundamentals'),
      rows: [
        { label: t('home.fullReport.fields.revenue'), value: fieldValue(fundamentalFields, ['Revenue', 'Revenue Growth', '收入', '营收']) || '--' },
        { label: 'ROE', value: fieldValue(fundamentalFields, ['ROE']) || '--' },
        { label: t('home.fullReport.fields.margin'), value: fieldValue(fundamentalFields, ['Margin', 'EBITDA MARGIN', '毛利率', '利润率']) || '--' },
        { label: 'EPS', value: fieldValue(fundamentalFields, ['EPS', 'LATEST EPS']) || '--' },
        { label: t('home.fullReport.fields.valuation'), value: fieldValue(fundamentalFields, ['PE', 'Forward PE', '市盈率', '估值']) || '--' },
      ],
    },
    {
      id: 'observation-plan',
      title: t('home.fullReport.sections.observationPlan'),
      rows: [
        { label: t('home.fullReport.fields.keyPriceRange'), value: consumerSafeReportPriceContext(decisionPanel?.idealEntry || report?.strategy?.idealBuy || priceFieldValue(battleFields, ['ideal', '理想']), t('home.fullReport.fallbacks.insufficientData')) },
        { label: t('home.fullReport.fields.referenceRange'), value: consumerSafeReportPriceContext(decisionPanel?.backupEntry || report?.strategy?.secondaryBuy || priceFieldValue(battleFields, ['secondary', '次级']), t('home.fullReport.fallbacks.insufficientData')) },
        { label: t('home.fullReport.fields.riskBoundary'), value: consumerSafeReportPriceContext(decisionPanel?.stopLoss || report?.strategy?.stopLoss || priceFieldValue(battleFields, ['stop', '止损']), t('home.fullReport.fallbacks.insufficientData')) },
        { label: t('home.fullReport.fields.upperWatch'), value: consumerSafeReportPriceContext(decisionPanel?.target || decisionPanel?.targetZone || report?.strategy?.takeProfit || priceFieldValue(battleFields, ['target', '目标']), t('home.fullReport.fallbacks.insufficientData')) },
        { label: t('home.fullReport.fields.riskBoundaryNote'), value: consumerSafeReportText(decisionPanel?.positionSizing || battleCards.find((item) => /position|仓位/i.test(item.label))?.value, t('home.fullReport.fallbacks.riskBoundaryNote')) },
        { label: t('home.fullReport.fields.observe'), value: consumerSafeReportText(decisionPanel?.buildStrategy || battleNotes.find((item) => /entry|建仓|入场/i.test(item.label))?.value, t('home.fullReport.fallbacks.observeWait')) },
        { label: t('home.fullReport.fields.riskBoundary'), value: consumerSafeReportText(decisionPanel?.riskControlStrategy || decisionPanel?.stopReason, t('home.fullReport.fallbacks.riskBoundaryContext')) },
        { label: t('home.fullReport.fields.insufficientData'), value: consumerSafeReportText(decisionPanel?.noPositionAdvice, t('home.fullReport.fallbacks.insufficientObserve')) },
        { label: t('home.fullReport.fields.observeDescription'), value: consumerSafeReportText(decisionPanel?.holderAdvice, t('home.fullReport.fallbacks.observeDescription')) },
      ],
      bullets: listOrMissing(decisionPanel?.executionReminders, t('home.fullReport.fallbacks.reminders')),
    },
    {
      id: 'checklist',
      title: t('home.fullReport.sections.checklist'),
      checklist: checklistItems.length ? checklistItems : [
        { label: t('home.fullReport.checklist.review'), status: t('home.fullReport.status.unknown') },
        { label: t('home.fullReport.checklist.priceContext'), status: t('home.fullReport.status.unknown') },
        { label: t('home.fullReport.checklist.riskBoundary'), status: t('home.fullReport.status.unknown') },
        { label: t('home.fullReport.checklist.coverage'), status: t('home.fullReport.status.unknown') },
        { label: t('home.fullReport.checklist.conflicts'), status: t('home.fullReport.status.unknown') },
      ],
    },
    {
      id: 'data-notes',
      title: t('home.fullReport.sections.dataNotes'),
      bullets: [
        ...listOrMissing(coverageNotes?.coverageGaps || coverageNotes?.missingFieldNotes, t('home.fullReport.fallbacks.missingFields')),
        ...listOrMissing(coverageNotes?.conflictNotes, t('home.fullReport.fallbacks.conflicts')),
        ...listOrMissing(coverageNotes?.methodNotes, t('home.fullReport.fallbacks.methodNote')),
      ],
    },
  ];
}

const FullDecisionReportDrawer: React.FC<FullDecisionReportDrawerProps> = ({
  dashboard,
  isOpen,
  onClose,
  report,
  language,
  t,
}) => {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const identityMismatch = hasReportIdentityMismatch(report, dashboard);
  if (identityMismatch) {
    const currentTicker = normalizeTicker(dashboard.ticker) || '--';
    return (
      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        title={t('home.fullReport.title')}
        width="max-w-[min(100vw,65rem)]"
        zIndex={90}
        bodyClassName="overflow-x-hidden"
      >
        <article
          className="min-w-0 space-y-4 rounded-l-[28px] border border-[color:var(--wolfy-market-warn)]/30 bg-[var(--wolfy-surface-panel)] p-4 text-[color:var(--wolfy-text-primary)] shadow-[var(--wolfy-shadow-panel)] sm:p-7"
          data-testid="home-bento-full-report-drawer"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-100/60">{t('home.fullReport.unavailableEyebrow')}</p>
          <h2 className="break-words text-2xl font-semibold tracking-[0] text-[color:var(--wolfy-text-primary)]">{t('home.fullReport.unavailableTitle')}</h2>
          <p className="max-w-2xl break-words text-sm leading-6 text-[color:var(--wolfy-text-secondary)]">
            {t('home.fullReport.unavailableBody', { ticker: currentTicker })}
          </p>
          <p className="rounded-xl border border-amber-300/18 bg-amber-300/8 px-3 py-2 text-sm text-amber-50/82">
            {t('home.fullReport.unavailableAction')}
          </p>
        </article>
      </Drawer>
    );
  }
  const sections = buildFullReportSections(report, dashboard, t);
  const identity = buildReportIdentity(report, dashboard, t, language);
  const markdown = normalizeFullReportBrand(buildInstitutionalReportMarkdown(report));
  const summarySection = sections.find((section) => section.id === 'summary');
  const riskSection = sections.find((section) => section.id === 'risks');
  const observationSection = sections.find((section) => section.id === 'observation-plan');
  const primaryReportSections = [riskSection, observationSection].filter((section): section is FullReportSection => Boolean(section));
  const technicalSections = sections.filter((section) => !['summary', 'risks', 'observation-plan'].includes(section.id));
  const summaryLine = summarySection?.rows?.find((row) => row.label === t('home.fullReport.fields.researchSummary'))?.value
    || consumerSafeReportText(dashboard.decision.summary, t('home.fullReport.fallbacks.researchSummary'))
    || '--';
  const observationLine = summarySection?.rows?.find((row) => row.label === t('home.fullReport.fields.observe'))?.value
    || consumerSafeReportText(dashboard.decision.signalLabel, t('home.fullReport.fallbacks.observe'))
    || '--';
  const confidenceLine = dashboard.decision.confidenceValue || '--';
  const riskLine = riskSection?.bullets?.find((item) => item && item !== '--')
    || observationSection?.rows?.find((row) => row.label === t('home.fullReport.fields.riskBoundary') || row.label === t('home.fullReport.fields.riskBoundaryNote'))?.value
    || '--';
  const headerSignalLabel = consumerSafeReportText(dashboard.decision.signalLabel, t('home.fullReport.fallbacks.observe')) || t('home.fullReport.fallbacks.observe');

  const handleCopyReport = async () => {
    if (!navigator.clipboard?.writeText) {
      setCopyState('failed');
      return;
    }
    const copyError = await navigator.clipboard.writeText(markdown)
      .then(() => null)
      .catch((error) => error);
    if (copyError) {
      setCopyState('failed');
      return;
    }
    setCopyState('copied');
  };

  const buildExportFileName = (extension: 'md'): string => {
    const safeCompany = identity.companyName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'Report';
    const safeDate = identity.generatedAt.replace(/\D/g, '').slice(0, 8) || 'latest';
    return `WolfyStock_${safeCompany}_${identity.ticker}_${safeDate}.${extension}`;
  };

  const handleMarkdownExport = () => {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildExportFileName('md');
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handlePrintReport = () => {
    const printWindow = window.open('', '_blank', 'width=960,height=1200');
    if (!printWindow) {
      window.print();
      return;
    }
    printWindow.opener = null;
    printWindow.document.open();
    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title></title>
          <style>
            body { margin: 0; background: #fff; color: #111827; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
            main { max-width: 820px; margin: 0 auto; padding: 40px 34px; }
            pre { white-space: pre-wrap; word-break: break-word; font-family: inherit; line-height: 1.58; font-size: 13px; }
            @media print { main { padding: 0; } }
          </style>
        </head>
        <body><main><pre id="wolfystock-print-report"></pre></main></body>
      </html>
    `);
    printWindow.document.title = `${identity.companyWithTicker} - ${REPORT_BRAND}`;
    const reportNode = printWindow.document.getElementById('wolfystock-print-report');
    if (reportNode) {
      reportNode.textContent = markdown;
    }
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 80);
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={t('home.fullReport.title')}
      width="max-w-[min(100vw,65rem)]"
      zIndex={90}
      bodyClassName="overflow-x-hidden"
    >
      <article
        className="min-w-0 space-y-5 rounded-l-[28px] border border-[color:var(--wolfy-divider)] bg-[var(--wolfy-surface-panel)] p-4 text-[color:var(--wolfy-text-primary)] shadow-[var(--wolfy-shadow-panel)] sm:p-7"
        data-testid="home-bento-full-report-drawer"
      >
        <header className="min-w-0 border-b border-[color:var(--wolfy-divider)] pb-5">
          <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--wolfy-text-muted)]">WOLFYSTOCK RESEARCH REPORT</p>
              <h2 className="mt-2 break-words text-2xl font-semibold tracking-[0] text-[color:var(--wolfy-text-primary)] md:text-3xl">
                {identity.companyWithTicker}
              </h2>
              <div className="mt-4 grid min-w-0 grid-cols-1 gap-2 text-sm text-[color:var(--wolfy-text-secondary)] sm:grid-cols-2">
                <span>{t('home.fullReport.fields.researchStatus')}：{headerSignalLabel}</span>
                <span>{t('home.fullReport.fields.score')}：{dashboard.decision.heroValue}{dashboard.decision.heroUnit || ''}</span>
                <span>{t('home.fullReport.fields.confidence')}：{dashboard.decision.confidenceValue || '--'}</span>
                <span>{t('home.fullReport.fields.generatedAt')}：{identity.generatedAt}</span>
                <span className="sm:col-span-2">{t('home.fullReport.fields.coverageStatus')}：{identity.dataStatus}</span>
              </div>
            </div>
            <div className="flex min-w-0 flex-wrap gap-2">
              <button
                type="button"
                onClick={handleMarkdownExport}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-[color:var(--wolfy-divider)] bg-[var(--wolfy-surface-input)] px-4 text-sm font-semibold text-[color:var(--wolfy-text-secondary)] transition-colors hover:border-[color:var(--wolfy-border-focus)] hover:bg-[var(--wolfy-surface-inset)] hover:text-[color:var(--wolfy-text-primary)]"
              >
                <Download className="size-4" />
                {t('home.fullReport.actions.exportMarkdown')}
              </button>
              <button
                type="button"
                onClick={handlePrintReport}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-[color:var(--wolfy-divider)] bg-[var(--wolfy-surface-input)] px-4 text-sm font-semibold text-[color:var(--wolfy-text-secondary)] transition-colors hover:border-[color:var(--wolfy-border-focus)] hover:bg-[var(--wolfy-surface-inset)] hover:text-[color:var(--wolfy-text-primary)]"
              >
                <Printer className="size-4" />
                {t('home.fullReport.actions.exportPdf')}
              </button>
              <button
                type="button"
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-[color:var(--wolfy-divider)] bg-[var(--wolfy-surface-input)] px-4 text-sm font-semibold text-[color:var(--wolfy-text-secondary)] transition-colors hover:border-[color:var(--wolfy-border-focus)] hover:bg-[var(--wolfy-surface-inset)] hover:text-[color:var(--wolfy-text-primary)]"
                onClick={() => { void handleCopyReport(); }}
              >
                <Copy className="size-4" />
                {copyState === 'copied' ? t('home.fullReport.actions.copied') : copyState === 'failed' ? t('home.fullReport.actions.copyFailed') : t('home.fullReport.actions.copyReport')}
              </button>
            </div>
          </div>
          <div className="mt-4 grid min-w-0 grid-cols-2 gap-2 rounded-2xl border border-[color:var(--wolfy-divider)] bg-[var(--wolfy-surface-input)] p-3 text-xs text-[color:var(--wolfy-text-muted)] md:grid-cols-4">
            <span>{t('home.fullReport.fields.market')}：{identity.market}</span>
            <span>{t('home.fullReport.fields.currency')}：{identity.currency}</span>
            <span className="min-w-0 truncate">{t('home.fullReport.fields.coverageStatus')}：{identity.dataStatus}</span>
            <span>{t('home.fullReport.fields.horizon')}：{identity.horizon}</span>
          </div>
          <p className="mt-4 rounded-xl border border-amber-300/18 bg-amber-300/8 px-3 py-2 text-sm text-amber-50/82">
            {t('home.fullReport.advisory')}
          </p>
        </header>

        <section
          className="min-w-0 rounded-3xl border border-[color:var(--wolfy-divider)] bg-[var(--wolfy-surface-input)] p-4 sm:p-5"
          data-testid="home-bento-report-executive-summary"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--wolfy-text-muted)]">RESEARCH SUMMARY</p>
          <h3 className="mt-2 text-xl font-semibold tracking-[0] text-[color:var(--wolfy-text-primary)]">{t('home.fullReport.sections.summary')}</h3>
          <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-semibold tracking-[0.08em] text-[color:var(--wolfy-text-muted)]">
            {[t('home.fullReport.fields.observe'), t('home.fullReport.fields.referenceRange'), t('home.fullReport.fields.riskBoundary'), t('home.fullReport.fields.upperWatch')].map((label) => (
              <span key={label} className="rounded-full border border-[color:var(--wolfy-divider)] bg-[var(--wolfy-surface-inset)] px-2 py-1">{label}</span>
            ))}
          </div>
          <p className="mt-3 break-words text-sm leading-6 text-[color:var(--wolfy-text-secondary)]">{summaryLine}</p>
          <div className="mt-4 grid min-w-0 grid-cols-1 gap-2 md:grid-cols-3">
            {[
              { label: t('home.fullReport.fields.researchStatus'), value: observationLine },
              { label: t('home.fullReport.fields.confidence'), value: confidenceLine },
              { label: t('home.fullReport.fields.riskBoundary'), value: riskLine },
            ].map((item) => (
              <div key={item.label} className="min-w-0 rounded-2xl border border-[color:var(--wolfy-divider)] bg-[var(--wolfy-surface-inset)] p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--wolfy-text-muted)]">{item.label}</p>
                <p className="mt-1.5 break-words text-sm leading-6 text-[color:var(--wolfy-text-secondary)]">{item.value}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
          {primaryReportSections.map((section) => (
            <section key={section.id} className="min-w-0 rounded-2xl border border-[color:var(--wolfy-divider)] bg-[var(--wolfy-surface-input)] p-4 sm:p-5" data-testid={`home-bento-full-report-section-${section.id}`}>
              <h3 className="text-base font-semibold tracking-[0] text-[color:var(--wolfy-text-primary)]">{section.title}</h3>
              {section.rows ? (
                <div className="mt-4 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                  {section.rows.map((row, index) => (
                    <div key={`${section.id}-${row.label}-${index}`} className="min-w-0 rounded-xl border border-[color:var(--wolfy-divider)] bg-[var(--wolfy-surface-inset)] px-3 py-2">
                      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--wolfy-text-muted)]">{row.label}</p>
                      <p className="mt-1 break-words text-sm leading-6 text-[color:var(--wolfy-text-secondary)]">{row.value}</p>
                    </div>
                  ))}
                </div>
              ) : null}
              {section.bullets ? (
                <ul className="mt-4 space-y-2 text-sm leading-6 text-[color:var(--wolfy-text-secondary)]">
                  {section.bullets.map((item) => (
                    <li key={`${section.id}-${item}`} className="break-words border-l border-[color:var(--wolfy-divider)] pl-3">{item}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>

        <details
          className="min-w-0 rounded-2xl border border-[color:var(--wolfy-divider)] bg-[var(--wolfy-surface-input)] p-4 sm:p-5"
          data-testid="home-bento-full-report-technical-details"
        >
          <summary className="cursor-pointer list-none text-sm font-semibold tracking-[0] text-[color:var(--wolfy-text-primary)]">
            {t('home.fullReport.technicalDetails')}
          </summary>
          <div className="mt-4 grid min-w-0 grid-cols-1 gap-4">
            {technicalSections.map((section) => (
              <section key={section.id} className="min-w-0 rounded-2xl border border-[color:var(--wolfy-divider)] bg-[var(--wolfy-surface-inset)] p-4" data-testid={`home-bento-full-report-section-${section.id}`}>
                <h3 className="text-base font-semibold tracking-[0] text-[color:var(--wolfy-text-primary)]">{section.title}</h3>
                {section.rows ? (
                  <div className="mt-4 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                    {section.rows.map((row, index) => (
                      <div key={`${section.id}-${row.label}-${index}`} className="min-w-0 rounded-xl border border-[color:var(--wolfy-divider)] bg-[var(--wolfy-surface-inset)] px-3 py-2">
                        <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--wolfy-text-muted)]">{row.label}</p>
                        <p className="mt-1 break-words text-sm leading-6 text-[color:var(--wolfy-text-secondary)]">{row.value}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
                {section.bullets ? (
                  <ul className="mt-4 space-y-2 text-sm leading-6 text-[color:var(--wolfy-text-secondary)]">
                    {section.bullets.map((item) => (
                      <li key={`${section.id}-${item}`} className="break-words border-l border-[color:var(--wolfy-divider)] pl-3">{item}</li>
                    ))}
                  </ul>
                ) : null}
                {section.checklist ? (
                  <div className="mt-4 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                    {section.checklist.map((item, index) => (
                      <div key={`${section.id}-${item.label}-${index}`} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-[color:var(--wolfy-divider)] bg-[var(--wolfy-surface-inset)] px-3 py-2 text-sm">
                        <span className="min-w-0 break-words text-[color:var(--wolfy-text-secondary)]">{item.label}</span>
                        <TraceBadge tone={item.status === 'PASS' ? 'used' : item.status === 'FAIL' ? 'missing' : item.status === 'WARN' ? 'warning' : 'neutral'}>{item.status}</TraceBadge>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            ))}
          </div>
        </details>
      </article>
    </Drawer>
  );
};

export default FullDecisionReportDrawer;
