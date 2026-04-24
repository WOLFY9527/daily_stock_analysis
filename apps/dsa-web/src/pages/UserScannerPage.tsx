import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PanelRightOpen } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { analysisApi, DuplicateTaskError } from '../api/analysis';
import { getParsedApiError, type ParsedApiError } from '../api/error';
import { scannerApi } from '../api/scanner';
import { ApiErrorAlert, Badge, Button, Card, Drawer, Pagination, Select } from '../components/common';
import { CARD_BUTTON_CLASS, PageChrome, type BentoHeroItem } from '../components/home-bento';
import { useI18n } from '../contexts/UiLanguageContext';
import type { ScannerCandidate, ScannerRunDetail, ScannerRunHistoryItem } from '../types/scanner';
import {
  getScannerDetailOptions,
  getScannerProfileOptions,
  getScannerUniverseOptions,
  SCANNER_PROFILE_DEFAULTS,
} from './scannerPageShared';

const HISTORY_PAGE_SIZE = 8;

function formatTimestamp(value?: string | null, language: 'zh' | 'en' = 'zh'): string {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatDateOnly(value?: string | null, language: 'zh' | 'en' = 'zh'): string {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function statusVariant(status?: string | null): 'success' | 'warning' | 'danger' | 'history' {
  if (status === 'completed') return 'success';
  if (status === 'empty') return 'warning';
  if (status === 'failed') return 'danger';
  return 'history';
}

function marketVariant(market?: string | null): 'success' | 'info' | 'warning' | 'history' {
  if (market === 'us') return 'success';
  if (market === 'hk') return 'warning';
  if (market === 'cn') return 'info';
  return 'history';
}

function formatPercent(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return '--';
  return `${value.toFixed(1)}%`;
}

function CandidateActionRow({
  candidate,
  onAnalyze,
}: {
  candidate: ScannerCandidate;
  onAnalyze: (candidate: ScannerCandidate) => void;
}) {
  const navigate = useNavigate();
  const { t } = useI18n();

  return (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      <Button size="sm" className="w-full sm:w-auto" onClick={() => onAnalyze(candidate)}>
        {t('scanner.actionAnalyze')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="w-full sm:w-auto"
        onClick={() => navigate(`/chat?stock=${encodeURIComponent(candidate.symbol)}&name=${encodeURIComponent(candidate.name)}`)}
      >
        {t('scanner.actionAsk')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="w-full sm:w-auto"
        onClick={() => navigate('/backtest', { state: { prefillCode: candidate.symbol, prefillName: candidate.name } })}
      >
        {t('scanner.actionBacktest')}
      </Button>
    </div>
  );
}

const UserScannerPage: React.FC = () => {
  const navigate = useNavigate();
  const { t, language } = useI18n();
  const [market, setMarket] = useState<'cn' | 'us' | 'hk'>('cn');
  const [profile, setProfile] = useState('cn_preopen_v1');
  const [shortlistSize, setShortlistSize] = useState('5');
  const [universeLimit, setUniverseLimit] = useState('300');
  const [detailLimit, setDetailLimit] = useState('60');
  const [runDetail, setRunDetail] = useState<ScannerRunDetail | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [historyItems, setHistoryItems] = useState<ScannerRunHistoryItem[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isLoadingRun, setIsLoadingRun] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [pageError, setPageError] = useState<ParsedApiError | null>(null);
  const [historyError, setHistoryError] = useState<ParsedApiError | null>(null);
  const [isRationaleDrawerOpen, setIsRationaleDrawerOpen] = useState(false);

  useEffect(() => {
    document.title = t('scanner.documentTitle');
  }, [t]);

  const profileOptions = useMemo(() => getScannerProfileOptions(market, t), [market, t]);
  const universeOptions = useMemo(() => getScannerUniverseOptions(market, language), [language, market]);
  const detailOptions = useMemo(() => getScannerDetailOptions(market, language), [language, market]);

  const selectedMarketCopy = useMemo(() => (
    market === 'us'
      ? {
        subtitle: language === 'en'
          ? 'Run manual scanner sessions in your own account. System watchlists and schedules stay in admin-only pages.'
          : '以你的个人账户执行手动扫描。系统观察名单和调度仍只在管理员页面中可见。',
        runHint: t('scanner.runHintUs'),
        currentRunFallback: t('scanner.currentRunFallbackUs'),
      }
      : market === 'hk'
        ? {
          subtitle: language === 'en'
            ? 'Run personal Hong Kong scanner sessions in your own account. System watchlists and schedules remain admin-only.'
            : '以你的个人账户执行港股手动扫描。系统观察名单和调度继续保留在仅管理员可见的页面中。',
          runHint: t('scanner.runHintHk'),
          currentRunFallback: t('scanner.currentRunFallbackHk'),
        }
      : {
        subtitle: language === 'en'
          ? 'Generate personal scanner runs and keep your shortlist history in your own account.'
          : '生成个人扫描结果，并将候选名单历史限制在你自己的账户范围内。',
        runHint: t('scanner.runHintCn'),
        currentRunFallback: t('scanner.currentRunFallbackCn'),
      }
  ), [language, market, t]);

  const handleMarketChange = useCallback((nextMarket: string) => {
    const normalizedMarket = nextMarket === 'us' ? 'us' : nextMarket === 'hk' ? 'hk' : 'cn';
    const defaults = SCANNER_PROFILE_DEFAULTS[normalizedMarket];
    setMarket(normalizedMarket);
    setProfile(defaults.profile);
    setShortlistSize(defaults.shortlistSize);
    setUniverseLimit(defaults.universeLimit);
    setDetailLimit(defaults.detailLimit);
  }, []);

  const loadRun = useCallback(async (runId: number) => {
    setIsLoadingRun(true);
    try {
      const response = await scannerApi.getRun(runId);
      setRunDetail(response);
      setSelectedRunId(response.id);
      setPageError(null);
    } catch (error) {
      setPageError(getParsedApiError(error));
    } finally {
      setIsLoadingRun(false);
    }
  }, []);

  const fetchHistory = useCallback(async (page = 1, preferredRunId?: number | null) => {
    setIsLoadingHistory(true);
    try {
      const response = await scannerApi.getRuns({
        market,
        profile,
        page,
        limit: HISTORY_PAGE_SIZE,
      });
      setHistoryItems(response.items);
      setHistoryTotal(response.total);
      setHistoryPage(response.page);
      setHistoryError(null);

      const targetRunId = preferredRunId
        || (selectedRunId && response.items.some((item) => item.id === selectedRunId) ? selectedRunId : null)
        || response.items[0]?.id
        || null;
      if (targetRunId && targetRunId !== selectedRunId) {
        void loadRun(targetRunId);
      }
      if (!targetRunId) {
        setRunDetail(null);
        setSelectedRunId(null);
      }
    } catch (error) {
      setHistoryError(getParsedApiError(error));
    } finally {
      setIsLoadingHistory(false);
    }
  }, [loadRun, market, profile, selectedRunId]);

  useEffect(() => {
    setRunDetail(null);
    setSelectedRunId(null);
  }, [market, profile]);

  useEffect(() => {
    void fetchHistory(1);
  }, [fetchHistory]);

  const handleRun = useCallback(async () => {
    setIsRunning(true);
    try {
      const response = await scannerApi.run({
        market,
        profile,
        shortlistSize: Number.parseInt(shortlistSize, 10),
        universeLimit: Number.parseInt(universeLimit, 10),
        detailLimit: Number.parseInt(detailLimit, 10),
      });
      setRunDetail(response);
      setSelectedRunId(response.id);
      setPageError(null);
      await fetchHistory(1, response.id);
    } catch (error) {
      setPageError(getParsedApiError(error));
    } finally {
      setIsRunning(false);
    }
  }, [detailLimit, fetchHistory, market, profile, shortlistSize, universeLimit]);

  const handleStartAnalysis = useCallback(async (candidate: ScannerCandidate) => {
    try {
      await analysisApi.analyzeAsync({
        stockCode: candidate.symbol,
        stockName: candidate.name,
        originalQuery: candidate.symbol,
        selectionSource: 'manual',
      });
      navigate('/');
    } catch (error) {
      if (error instanceof DuplicateTaskError) {
        navigate('/');
        return;
      }
      setPageError(getParsedApiError(error));
    }
  }, [navigate]);

  const totalHistoryPages = useMemo(
    () => Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE)),
    [historyTotal],
  );
  const currentRunTone = runDetail?.status === 'completed'
    ? 'bullish'
    : runDetail?.status === 'failed'
      ? 'bearish'
      : 'neutral';
  const currentProfileLabel = profileOptions.find((option) => option.value === profile)?.label || profile;
  const currentMarketLabel = market === 'us' ? t('scanner.marketUs') : market === 'hk' ? t('scanner.marketHk') : t('scanner.marketCn');
  const heroItems: BentoHeroItem[] = [
    {
      label: t('scanner.marketLabel'),
      value: currentMarketLabel,
      detail: language === 'en' ? 'Account-scoped scanner' : '账户范围扫描器',
      testId: 'user-scanner-bento-hero-market',
      valueTestId: 'user-scanner-bento-hero-market-value',
    },
    {
      label: t('scanner.profileLabel'),
      value: currentProfileLabel,
      detail: selectedMarketCopy.runHint,
      testId: 'user-scanner-bento-hero-profile',
    },
    {
      label: t('scanner.shortlistLabel'),
      value: runDetail ? `${runDetail.shortlistSize}` : shortlistSize,
      detail: language === 'en' ? 'Personal shortlist output' : '个人候选输出',
      tone: runDetail?.shortlistSize ? 'bullish' : 'neutral',
      testId: 'user-scanner-bento-hero-shortlist',
      valueTestId: 'user-scanner-bento-hero-shortlist-value',
      valueClassName: 'text-7xl sm:text-7xl tracking-[-0.05em]',
    },
    {
      label: language === 'en' ? 'Current run' : '当前运行',
      value: runDetail ? t(`scanner.status.${runDetail.status}`) : '--',
      detail: runDetail?.headline || selectedMarketCopy.currentRunFallback,
      tone: currentRunTone,
      testId: 'user-scanner-bento-hero-run',
      valueTestId: 'user-scanner-bento-hero-run-value',
    },
  ];

  return (
    <>
      <PageChrome
        pageTestId="user-scanner-bento-page"
        pageClassName="workspace-page workspace-page--scanner gemini-bento-page--scanner gemini-bento-page--scanner-user space-y-6"
        eyebrow={t('scanner.eyebrow')}
        title={language === 'en' ? 'MARKET SCANNER' : '市场扫描'}
        description={selectedMarketCopy.subtitle}
        actions={(
          <button
            type="button"
            className={CARD_BUTTON_CLASS}
            data-testid="user-scanner-bento-drawer-trigger"
            onClick={() => setIsRationaleDrawerOpen(true)}
          >
            <PanelRightOpen className="h-4 w-4" />
            <span>{language === 'en' ? 'Open rationale' : '查看解释'}</span>
          </button>
        )}
        heroItems={heroItems}
        heroTestId="user-scanner-bento-hero"
        headerChildren={(
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(22rem,0.92fr)]">
          <Card title={t('scanner.runPanelTitle')} subtitle={language === 'en' ? 'My scanner run' : '我的扫描运行'}>
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Select
                  label={t('scanner.marketLabel')}
                  value={market}
                  onChange={handleMarketChange}
                  options={[
                    { value: 'cn', label: t('scanner.marketCn') },
                    { value: 'us', label: t('scanner.marketUs') },
                    { value: 'hk', label: t('scanner.marketHk') },
                  ]}
                />
                <Select
                  label={t('scanner.profileLabel')}
                  value={profile}
                  onChange={setProfile}
                  options={profileOptions}
                />
                <Select
                  label={t('scanner.shortlistLabel')}
                  value={shortlistSize}
                  onChange={setShortlistSize}
                  options={[
                    { value: '5', label: language === 'en' ? 'Top 5' : '前 5' },
                    { value: '8', label: language === 'en' ? 'Top 8' : '前 8' },
                    { value: '10', label: language === 'en' ? 'Top 10' : '前 10' },
                  ]}
                />
                <Select
                  label={t('scanner.universeLabel')}
                  value={universeLimit}
                  onChange={setUniverseLimit}
                  options={universeOptions}
                />
                <Select
                  label={t('scanner.detailLabel')}
                  value={detailLimit}
                  onChange={setDetailLimit}
                  options={detailOptions}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-secondary-text">{selectedMarketCopy.runHint}</p>
                <Button type="button" onClick={() => void handleRun()} isLoading={isRunning} loadingText={t('scanner.running')}>
                  {t('scanner.run')}
                </Button>
              </div>
            </div>
          </Card>

          <Card
            title={language === 'en' ? 'Current personal run' : '当前个人运行'}
            subtitle={language === 'en' ? 'Your run details' : '个人范围详情'}
          >
            {runDetail ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={marketVariant(runDetail.market)}>
                    {runDetail.market === 'us' ? t('scanner.marketUs') : runDetail.market === 'hk' ? t('scanner.marketHk') : t('scanner.marketCn')}
                  </Badge>
                  <Badge variant="info">{runDetail.profileLabel || runDetail.profile}</Badge>
                  <Badge variant={statusVariant(runDetail.status)}>{t(`scanner.status.${runDetail.status}`)}</Badge>
                  {runDetail.watchlistDate ? <Badge variant="history">{formatDateOnly(runDetail.watchlistDate, language)}</Badge> : null}
                  {runDetail.runAt ? <Badge variant="history">{formatTimestamp(runDetail.runAt, language)}</Badge> : null}
                </div>
                <div>
                  <h2 className="text-[1.05rem] text-foreground md:text-[1.15rem]">
                    {runDetail.headline || selectedMarketCopy.currentRunFallback}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-secondary-text">
                    {runDetail.sourceSummary || (language === 'en'
                      ? 'Manual scanner results for the current signed-in account.'
                      : '手动扫描结果已限制在当前登录用户范围内。')}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[28px] border border-white/5 bg-white/[0.02] px-3 py-3 backdrop-blur-2xl">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-secondary-text">{t('scanner.metricUniverse')}</p>
                    <p className="mt-1 text-foreground">{runDetail.universeSize}</p>
                  </div>
                  <div className="rounded-[28px] border border-white/5 bg-white/[0.02] px-3 py-3 backdrop-blur-2xl">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-secondary-text">{t('scanner.metricShortlist')}</p>
                    <p className="mt-1 text-foreground">{runDetail.shortlistSize}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-[28px] border border-white/5 bg-white/[0.015] px-4 py-5 text-sm leading-6 text-secondary-text backdrop-blur-2xl">
                {language === 'en'
                  ? 'No personal scanner run yet. Run the scanner to create your shortlist.'
                  : '你还没有个人扫描结果。运行扫描后即可生成仅属于你账户的候选名单。'}
              </div>
            )}
          </Card>
        </div>
        )}
      >

      {pageError ? <ApiErrorAlert error={pageError} /> : null}

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.18fr)_minmax(23rem,0.82fr)]">
        <section className="space-y-4">
          <Card title={t('scanner.shortlistTitle')} subtitle={language === 'en' ? 'My candidates' : '我的候选'}>
            {isLoadingRun ? (
              <div className="rounded-[28px] border border-white/5 bg-white/[0.015] px-4 py-5 text-sm text-secondary-text backdrop-blur-2xl">
                {t('scanner.loading')}
              </div>
            ) : null}

            {!isLoadingRun && runDetail?.shortlist?.length ? (
              <div className="grid gap-4 xl:grid-cols-2">
                {runDetail.shortlist.map((candidate) => (
                  <Card key={`${candidate.symbol}-${candidate.rank}`} variant="bordered" padding="md" className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="info">#{candidate.rank}</Badge>
                          <Badge variant="history">{candidate.symbol}</Badge>
                          <Badge variant="success">{candidate.score.toFixed(1)}</Badge>
                        </div>
                        <div>
                          <h3 className="text-base font-semibold text-foreground">{candidate.name}</h3>
                          <p className="mt-1 text-sm text-secondary-text">{candidate.reasonSummary || '--'}</p>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[28px] border border-white/5 bg-white/[0.02] px-3 py-3 backdrop-blur-2xl">
                        <p className="text-[11px] uppercase tracking-[0.14em] text-secondary-text">{t('scanner.reviewMetricReturn')}</p>
                        <p className="mt-1 text-foreground">{formatPercent(candidate.realizedOutcome.reviewWindowReturnPct)}</p>
                      </div>
                      <div className="rounded-[28px] border border-white/5 bg-white/[0.02] px-3 py-3 backdrop-blur-2xl">
                        <p className="text-[11px] uppercase tracking-[0.14em] text-secondary-text">{t('scanner.aiTitle')}</p>
                        <p className="mt-1 text-foreground">{candidate.aiInterpretation.summary || candidate.aiInterpretation.message || '--'}</p>
                      </div>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-2">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.14em] text-secondary-text">{t('scanner.riskTitle')}</p>
                        <div className="mt-2 space-y-2">
                          {(candidate.riskNotes.length ? candidate.riskNotes.slice(0, 2) : ['--']).map((note) => (
                            <div key={`${candidate.symbol}-${note}`} className="rounded-[24px] border border-white/5 bg-white/[0.02] px-3 py-2 text-sm leading-6 text-secondary-text backdrop-blur-2xl">
                              {note}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.14em] text-secondary-text">{t('scanner.watchTitle')}</p>
                        <div className="mt-2 space-y-2">
                          {(candidate.watchContext.length ? candidate.watchContext.slice(0, 2) : [{ label: '--', value: '--' }]).map((item) => (
                            <div key={`${candidate.symbol}-${item.label}-${item.value}`} className="rounded-[24px] border border-white/5 bg-white/[0.02] px-3 py-2 text-sm leading-6 text-secondary-text backdrop-blur-2xl">
                              <span className="text-foreground">{item.label}</span>
                              <span className="mx-2 text-muted-text">·</span>
                              <span>{item.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <CandidateActionRow candidate={candidate} onAnalyze={(item) => void handleStartAnalysis(item)} />
                  </Card>
                ))}
              </div>
            ) : null}

            {!isLoadingRun && !runDetail?.shortlist?.length ? (
              <div className="rounded-[28px] border border-white/5 bg-white/[0.015] px-4 py-6 text-sm leading-6 text-secondary-text backdrop-blur-2xl">
                <p className="text-base text-foreground">{language === 'en' ? t('scanner.emptyTitle') : '准备生成今日候选名单'}</p>
                <p className="mt-2">
                  {language === 'en'
                    ? 'Run a manual scan to generate a shortlist for your account.'
                    : '运行一次手动扫描，生成只属于你自己账户的候选名单。'}
                </p>
              </div>
            ) : null}
          </Card>
        </section>

        <section className="space-y-4">
          <Card title={language === 'en' ? 'My recent runs' : '我的近期运行'} subtitle={language === 'en' ? 'Your run history' : '个人范围历史'}>
            {historyError ? <ApiErrorAlert error={historyError} /> : null}
            {isLoadingHistory ? (
              <div className="rounded-[28px] border border-white/5 bg-white/[0.015] px-4 py-5 text-sm text-secondary-text backdrop-blur-2xl">
                {t('scanner.loadingHistory')}
              </div>
            ) : null}

            {!isLoadingHistory && historyItems.length ? (
              <div className="space-y-3">
                {historyItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void loadRun(item.id)}
                    className={`w-full rounded-[28px] border border-white/5 bg-white/[0.02] px-4 py-3 text-left transition-colors backdrop-blur-2xl ${
                      item.id === selectedRunId
                        ? 'border-white/10 bg-white/[0.05]'
                        : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.035]'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={marketVariant(item.market)}>
                        {item.market === 'us' ? t('scanner.marketUs') : item.market === 'hk' ? t('scanner.marketHk') : t('scanner.marketCn')}
                      </Badge>
                      <Badge variant={statusVariant(item.status)}>{t(`scanner.status.${item.status}`)}</Badge>
                      {item.watchlistDate ? <Badge variant="history">{formatDateOnly(item.watchlistDate, language)}</Badge> : null}
                    </div>
                    <p className="mt-3 text-sm font-semibold text-foreground">
                      {item.headline || (item.market === 'us'
                        ? t('scanner.currentRunFallbackUs')
                        : item.market === 'hk'
                          ? t('scanner.currentRunFallbackHk')
                          : t('scanner.currentRunFallbackCn'))}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-secondary-text">
                      <span>{`${t('scanner.metricShortlist')}: ${item.shortlistSize}`}</span>
                      <span>{`${t('scanner.metricUniverse')}: ${item.universeSize}`}</span>
                      <span>{formatTimestamp(item.runAt, language)}</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}

            {!isLoadingHistory && !historyItems.length ? (
              <div className="rounded-[28px] border border-white/5 bg-white/[0.015] px-4 py-5 text-sm leading-6 text-secondary-text backdrop-blur-2xl">
                {language === 'en'
                  ? 'No personal scanner history yet.'
                  : '你还没有个人扫描历史。'}
              </div>
            ) : null}

            {totalHistoryPages > 1 ? (
              <div className="pt-2">
                <Pagination
                  currentPage={historyPage}
                  totalPages={totalHistoryPages}
                  onPageChange={(page) => void fetchHistory(page)}
                />
              </div>
            ) : null}
          </Card>

          <Card title={language === 'en' ? 'Why this page is different' : '为什么用户界面与管理员不同'} subtitle={language === 'en' ? 'User and admin views' : '界面分层'}>
            <div className="space-y-3 text-sm leading-6 text-secondary-text">
              <p>
                {language === 'en'
                  ? 'This page focuses on manual runs, shortlist details, and links into other signed-in product features.'
                  : '这个页面只保留手动运行、候选名单详情和登录后功能跳转，面向普通登录用户。'}
              </p>
              <p>
                {language === 'en'
                  ? 'Run status, system watchlists, schedules, and channel settings stay in admin-only pages.'
                  : '运行状态、系统观察名单、调度和通道配置继续保留在仅管理员可见的管理页面。'}
              </p>
            </div>
          </Card>
        </section>
      </div>
      </PageChrome>

      <Drawer
        isOpen={isRationaleDrawerOpen}
        onClose={() => setIsRationaleDrawerOpen(false)}
        title={language === 'en' ? 'Scanner surface rationale' : '扫描器页面说明'}
        width="max-w-2xl"
      >
        <div data-testid="user-scanner-bento-drawer" className="rounded-[28px] border border-white/5 bg-white/[0.02] p-5 text-white backdrop-blur-2xl sm:p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[24px] border border-white/5 bg-white/[0.02] px-4 py-4 backdrop-blur-2xl">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">{language === 'en' ? 'User scope' : '用户范围'}</p>
              <p className="mt-3 text-sm leading-6 text-white/70">
                {language === 'en'
                  ? 'This surface keeps manual runs, shortlist review, and downstream actions inside the signed-in user account.'
                  : '这个页面把手动运行、候选复核和后续动作都限制在当前登录用户自己的账户范围内。'}
              </p>
            </div>
            <div className="rounded-[24px] border border-white/5 bg-white/[0.02] px-4 py-4 backdrop-blur-2xl">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">{language === 'en' ? 'Admin boundary' : '管理员边界'}</p>
              <p className="mt-3 text-sm leading-6 text-white/70">
                {language === 'en'
                  ? 'System watchlists, schedules, and global run controls stay in admin-only pages instead of leaking into the user workflow.'
                  : '系统观察名单、调度和全局运行控制继续保留在管理员页面，不混进用户工作流。'}
              </p>
            </div>
          </div>
        </div>
      </Drawer>
    </>
  );
};

export default UserScannerPage;
