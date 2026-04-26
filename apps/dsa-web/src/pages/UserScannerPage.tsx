import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PanelRightOpen } from 'lucide-react';
import { getParsedApiError, type ParsedApiError } from '../api/error';
import { scannerApi } from '../api/scanner';
import { ApiErrorAlert, Button, Drawer, Pagination, PillBadge, SectionShell } from '../components/common';
import { CARD_BUTTON_CLASS } from '../components/home-bento';
import { useI18n } from '../contexts/UiLanguageContext';
import type { ScannerRunDetail, ScannerRunHistoryItem } from '../types/scanner';
import {
  getScannerDetailOptions,
  getScannerProfileOptions,
  getScannerUniverseOptions,
  SCANNER_PROFILE_DEFAULTS,
} from './scannerPageShared';

const HISTORY_PAGE_SIZE = 8;


type PillOption = { value: string; label: string };

const FALLBACK_WATCHLIST_CARDS = [
  { symbol: 'NVDA', name: 'NVIDIA', changeText: '+4.8%' },
  { symbol: 'TSLA', name: 'Tesla', changeText: '+3.1%' },
  { symbol: 'META', name: 'Meta', changeText: '+2.7%' },
  { symbol: 'AAPL', name: 'Apple', changeText: '+1.9%' },
  { symbol: 'MSFT', name: 'Microsoft', changeText: '+1.5%' },
  { symbol: 'AMD', name: 'AMD', changeText: '+5.2%' },
] as const;

function PillTagGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: PillOption[];
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs uppercase tracking-widest text-white/40">{label}</span>
      <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
        {options.map((option) => {
          const isActive = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => onChange(option.value)}
              className={isActive
                ? 'rounded-full border border-white/10 bg-white/10 px-4 py-1.5 text-sm text-white transition-colors'
                : 'rounded-full border border-white/5 bg-transparent px-4 py-1.5 text-sm text-white/50 transition-colors hover:bg-white/[0.05]'}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

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

const UserScannerPage: React.FC = () => {
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
    try {
      const response = await scannerApi.getRun(runId);
      setRunDetail(response);
      setSelectedRunId(response.id);
      setPageError(null);
    } catch (error) {
      setPageError(getParsedApiError(error));
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

  const totalHistoryPages = useMemo(
    () => Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE)),
    [historyTotal],
  );
  const shortlistCount = runDetail?.shortlist?.length ?? 0;
  const watchlistCards = runDetail
    ? runDetail.shortlist.slice(0, 8).map((candidate) => ({
      symbol: candidate.symbol,
      name: candidate.name,
      changeText: `${candidate.score >= 0 ? '+' : ''}${candidate.score.toFixed(1)}%`,
    }))
    : pageError
      ? []
      : [...FALLBACK_WATCHLIST_CARDS];
  const watchlistTitle = market === 'us'
    ? (language === 'en' ? 'US pre-market candidates' : '美股盘前候选名单')
    : market === 'hk'
      ? (language === 'en' ? 'Hong Kong pre-open candidates' : '港股盘前候选名单')
      : (language === 'en' ? 'A-share pre-open candidates' : 'A股盘前候选名单');

  return (
    <>
      <div
        data-testid="user-scanner-bento-page"
        data-bento-surface="true"
        className="bento-surface-root h-[calc(100vh-80px)] overflow-hidden bg-transparent text-foreground"
      >
        <div className="workspace-width-wide w-full max-w-[1920px] 2xl:max-w-full mx-auto px-4 md:px-8 xl:px-12 pt-0 pb-4 h-[calc(100vh-64px)] flex flex-col overflow-hidden bg-transparent">
          <header className="shrink-0 flex justify-between items-start mb-3 mt-0">
            <div>
              <h1 className="text-[2rem] tracking-[-0.04em] text-foreground">{language === 'en' ? 'MARKET SCANNER' : '市场扫描'}</h1>
            </div>
            <Button
              type="button"
              variant="secondary"
              className={CARD_BUTTON_CLASS}
              data-testid="user-scanner-bento-drawer-trigger"
              onClick={() => setIsRationaleDrawerOpen(true)}
            >
              <PanelRightOpen className="h-4 w-4" />
              <span>{language === 'en' ? 'Run history' : '历史运行记录'}</span>
            </Button>
          </header>

          <section className="shrink-0 grid grid-cols-12 gap-5">
            <div className="col-span-8 flex flex-col gap-3">
              <SectionShell className="rounded-[32px] p-4">
                <div className="flex flex-col gap-6">
                  <PillTagGroup label={t('scanner.marketLabel')} value={market} onChange={(next) => handleMarketChange(next as 'cn' | 'us' | 'hk')} options={[{ value: 'cn', label: t('scanner.marketCn') }, { value: 'us', label: t('scanner.marketUs') }, { value: 'hk', label: t('scanner.marketHk') }]} />
                  <PillTagGroup label={t('scanner.profileLabel')} value={profile} onChange={setProfile} options={profileOptions} />
                  <PillTagGroup label={t('scanner.shortlistLabel')} value={shortlistSize} onChange={setShortlistSize} options={[{ value: '5', label: language === 'en' ? 'Top 5' : '前 5' }, { value: '8', label: language === 'en' ? 'Top 8' : '前 8' }, { value: '10', label: language === 'en' ? 'Top 10' : '前 10' }]} />
                  <PillTagGroup label={t('scanner.universeLabel')} value={universeLimit} onChange={setUniverseLimit} options={universeOptions} />
                  <PillTagGroup label={t('scanner.detailLabel')} value={detailLimit} onChange={setDetailLimit} options={detailOptions} />
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-secondary-text">{selectedMarketCopy.runHint}</p>
                    <Button type="button" onClick={() => void handleRun()} isLoading={isRunning} loadingText={t('scanner.running')}>{t('scanner.run')}</Button>
                  </div>
                </div>
              </SectionShell>

            </div>

            <div
              data-testid="user-scanner-bento-hero"
              className="theme-panel-glass col-span-4 rounded-[40px] p-5 flex flex-col items-center justify-center relative overflow-hidden group"
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(52,211,153,0.14),transparent_68%)] opacity-80" aria-hidden="true" />
              <p className="relative z-10 text-[11px] uppercase tracking-[0.18em] text-secondary-text">{t('scanner.shortlistLabel')}</p>
              <div
                data-testid="user-scanner-bento-hero-shortlist-value"
                className="relative z-10 mt-2 text-[9rem] font-bold text-emerald-400 leading-none drop-shadow-[0_0_60px_rgba(52,211,153,0.8)]"
              >
                {shortlistCount}
              </div>
              <p className="relative z-10 mt-2 text-center text-xs leading-4 text-secondary-text">{runDetail?.headline || (language === 'en' ? 'Personal threshold triggered' : '个人阈值触发')}</p>
            </div>
          </section>

          {pageError ? <ApiErrorAlert error={pageError} /> : null}

          <section className="flex-1 min-h-0 flex flex-col mt-3 overflow-hidden">
            <div className="shrink-0">
              <p className="text-[11px] uppercase tracking-[0.18em] text-secondary-text">{language === 'en' ? 'My candidates' : '我的候选'}</p>
              <h2 className="mt-2 text-lg text-foreground">{watchlistTitle}</h2>
            </div>
            {watchlistCards.length ? (
              <div className="mt-4 grid grid-cols-2 gap-4 content-start overflow-y-auto no-scrollbar md:grid-cols-4 xl:grid-cols-6">
                {watchlistCards.map((candidate) => (
                  <div key={`watchlist-${candidate.symbol}`} className="theme-panel-subtle rounded-2xl px-3 py-2 flex justify-between items-center hover:bg-[var(--overlay-hover)] transition cursor-pointer">
                    <div>
                      <p className="text-sm text-foreground">{candidate.name}</p>
                      <p className="text-muted-text text-[11px] mt-0.5">{candidate.symbol}</p>
                    </div>
                    <span className="text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]">{candidate.changeText}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="theme-panel-subtle rounded-[28px] px-4 py-5 text-sm text-secondary-text">
                {pageError?.message || selectedMarketCopy.currentRunFallback}
              </div>
            )}
          </section>

        </div>
      </div>

      <Drawer
        isOpen={isRationaleDrawerOpen}
        onClose={() => setIsRationaleDrawerOpen(false)}
        title={language === 'en' ? 'Run history and ownership' : '历史记录与页面边界'}
        width="max-w-4xl"
      >
        <div data-testid="user-scanner-bento-drawer" className="theme-panel-glass ml-auto h-full w-full max-w-4xl rounded-l-[40px] p-6 text-foreground sm:p-8">
          <div className="grid gap-6">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-text">{language === 'en' ? 'Run history' : '运行历史'}</p>
              <h2 className="mt-1 text-xl text-foreground">{language === 'en' ? 'Recent scanner runs' : '近期扫描记录'}</h2>
            </div>

            {historyError ? <ApiErrorAlert error={historyError} /> : null}
            {isLoadingHistory ? <div className="theme-panel-subtle rounded-[28px] px-4 py-5 text-sm text-secondary-text">{t('scanner.loadingHistory')}</div> : null}
            {!isLoadingHistory && historyItems.length ? (
              <div className="space-y-3">
                {historyItems.map((item) => (
                  <Button
                    key={item.id}
                    type="button"
                    variant={item.id === selectedRunId ? 'secondary' : 'ghost'}
                    onClick={() => void loadRun(item.id)}
                    className={`theme-panel-subtle h-auto w-full rounded-[28px] px-4 py-3 text-left ${item.id === selectedRunId ? 'border-[var(--border-strong)] bg-[var(--surface-2)]/88' : 'hover:bg-[var(--overlay-hover)]'}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <PillBadge variant={marketVariant(item.market)}>{item.market === 'us' ? t('scanner.marketUs') : item.market === 'hk' ? t('scanner.marketHk') : t('scanner.marketCn')}</PillBadge>
                      <PillBadge variant={statusVariant(item.status)}>{t(`scanner.status.${item.status}`)}</PillBadge>
                      {item.watchlistDate ? <PillBadge variant="history">{formatDateOnly(item.watchlistDate, language)}</PillBadge> : null}
                    </div>
                    <p className="mt-3 text-sm font-semibold text-foreground">{item.headline || (item.market === 'us' ? t('scanner.currentRunFallbackUs') : item.market === 'hk' ? t('scanner.currentRunFallbackHk') : t('scanner.currentRunFallbackCn'))}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-secondary-text">
                      <span>{`${t('scanner.metricShortlist')}: ${item.shortlistSize}`}</span>
                      <span>{`${t('scanner.metricUniverse')}: ${item.universeSize}`}</span>
                      <span>{formatTimestamp(item.runAt, language)}</span>
                    </div>
                  </Button>
                ))}
              </div>
            ) : null}
            {!isLoadingHistory && !historyItems.length ? <div className="theme-panel-subtle rounded-[28px] px-4 py-5 text-sm leading-6 text-secondary-text">{language === 'en' ? 'No personal scanner history yet.' : '你还没有个人扫描历史。'}</div> : null}
            {totalHistoryPages > 1 ? <div className="pt-2"><Pagination currentPage={historyPage} totalPages={totalHistoryPages} onPageChange={(page) => void fetchHistory(page)} /></div> : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <SectionShell className="rounded-[24px] px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-text">{language === 'en' ? 'User scope' : '用户范围'}</p>
                <p className="mt-3 text-sm leading-6 text-secondary-text">
                  {language === 'en'
                    ? 'This surface keeps manual runs, shortlist review, and downstream actions inside the signed-in user account.'
                    : '这个页面把手动运行、候选复核和后续动作都限制在当前登录用户自己的账户范围内。'}
                </p>
              </SectionShell>
              <SectionShell className="rounded-[24px] px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-text">{language === 'en' ? 'Admin boundary' : '管理员边界'}</p>
                <p className="mt-3 text-sm leading-6 text-secondary-text">
                  {language === 'en'
                    ? 'Run status, system watchlists, schedules, and channel settings stay in admin-only pages.'
                    : '运行状态、系统观察名单、调度和通道配置继续保留在仅管理员可见的管理页面。'}
                </p>
              </SectionShell>
            </div>
          </div>
        </div>
      </Drawer>
    </>
  );
};

export default UserScannerPage;
