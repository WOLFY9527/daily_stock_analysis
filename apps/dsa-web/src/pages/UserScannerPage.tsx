import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PanelRightOpen } from 'lucide-react';
import { getParsedApiError, type ParsedApiError } from '../api/error';
import { scannerApi } from '../api/scanner';
import { ApiErrorAlert, Badge, Button, Drawer, Pagination } from '../components/common';
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
    <div className="space-y-2">
      <label className="block">
        <span className="text-[11px] uppercase tracking-[0.18em] text-secondary-text">{label}</span>
        <select
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="sr-only"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`rounded-full border border-white/5 px-3 py-1.5 text-sm transition-colors ${active ? 'bg-white/10 text-white shadow-[0_0_20px_rgba(255,255,255,0.08)]' : 'bg-transparent text-white/40 hover:bg-white/[0.03] hover:text-white/70'}`}
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
  const shortlistCount = runDetail?.shortlist?.length ?? Number.parseInt(shortlistSize, 10);
  const watchlistCards = (runDetail?.shortlist || []).slice(0, 8).map((candidate) => ({
    symbol: candidate.symbol,
    name: candidate.name,
    changeText: `${candidate.score >= 0 ? '+' : ''}${candidate.score.toFixed(1)}%`,
  }));
  const renderedWatchlistCards = watchlistCards.length ? watchlistCards : [
    { symbol: 'NVDA', name: 'NVIDIA', changeText: '+5.2%' },
    { symbol: 'TSLA', name: 'Tesla', changeText: '+4.8%' },
    { symbol: 'META', name: 'Meta', changeText: '+3.9%' },
    { symbol: 'AAPL', name: 'Apple', changeText: '+2.7%' },
  ];

  return (
    <>
      <div data-testid="user-scanner-bento-page" className="h-[calc(100vh-80px)] overflow-hidden bg-[#030303] text-white">
        <div className="workspace-width-wide w-full max-w-[1920px] 2xl:max-w-full mx-auto px-4 md:px-8 xl:px-12 pt-0 pb-4 h-[calc(100vh-64px)] flex flex-col overflow-hidden bg-transparent">
          <header className="shrink-0 flex justify-between items-start mb-3 mt-0">
            <div>
              <h1 className="text-[2rem] tracking-[-0.04em] text-white">{language === 'en' ? 'MARKET SCANNER' : '市场扫描'}</h1>
            </div>
            <button
              type="button"
              className={CARD_BUTTON_CLASS}
              data-testid="user-scanner-bento-drawer-trigger"
              onClick={() => setIsRationaleDrawerOpen(true)}
            >
              <PanelRightOpen className="h-4 w-4" />
              <span>{language === 'en' ? 'Run history' : '历史运行记录'}</span>
            </button>
          </header>

          <section className="shrink-0 grid grid-cols-12 gap-5">
            <div className="col-span-8 flex flex-col gap-3">
              <div className="bg-white/[0.02] rounded-[32px] p-4 border border-white/5 backdrop-blur-2xl">
                <div className="space-y-2">
                  <PillTagGroup label={t('scanner.marketLabel')} value={market} onChange={(next) => handleMarketChange(next as 'cn' | 'us' | 'hk')} options={[{ value: 'cn', label: t('scanner.marketCn') }, { value: 'us', label: t('scanner.marketUs') }, { value: 'hk', label: t('scanner.marketHk') }]} />
                  <PillTagGroup label={t('scanner.profileLabel')} value={profile} onChange={setProfile} options={profileOptions} />
                  <PillTagGroup label={t('scanner.shortlistLabel')} value={shortlistSize} onChange={setShortlistSize} options={[{ value: '5', label: language === 'en' ? 'Top 5' : '前 5' }, { value: '8', label: language === 'en' ? 'Top 8' : '前 8' }, { value: '10', label: language === 'en' ? 'Top 10' : '前 10' }]} />
                  <div className="grid grid-cols-2 gap-2">
                    <PillTagGroup label={t('scanner.universeLabel')} value={universeLimit} onChange={setUniverseLimit} options={universeOptions} />
                    <PillTagGroup label={t('scanner.detailLabel')} value={detailLimit} onChange={setDetailLimit} options={detailOptions} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-secondary-text">{selectedMarketCopy.runHint}</p>
                    <Button type="button" onClick={() => void handleRun()} isLoading={isRunning} loadingText={t('scanner.running')}>{t('scanner.run')}</Button>
                  </div>
                </div>
              </div>

            </div>

            <div className="col-span-4 bg-white/[0.02] backdrop-blur-3xl border border-white/5 rounded-[40px] p-5 flex flex-col items-center justify-center relative overflow-hidden group">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(52,211,153,0.14),transparent_68%)] opacity-80" aria-hidden="true" />
              <p className="relative z-10 text-[11px] uppercase tracking-[0.18em] text-secondary-text">{t('scanner.shortlistLabel')}</p>
              <div className="relative z-10 mt-2 text-[9rem] font-bold text-emerald-400 leading-none drop-shadow-[0_0_60px_rgba(52,211,153,0.8)]">{shortlistCount}</div>
              <p className="relative z-10 mt-2 text-center text-xs leading-4 text-secondary-text">{runDetail?.headline || (language === 'en' ? 'Personal threshold triggered' : '个人阈值触发')}</p>
            </div>
          </section>

          {pageError ? <ApiErrorAlert error={pageError} /> : null}

          <section className="flex-1 min-h-0 flex flex-col mt-3 overflow-hidden">
            <div className="shrink-0">
              <p className="text-[11px] uppercase tracking-[0.18em] text-secondary-text">{language === 'en' ? 'My candidates' : '我的候选'}</p>
            </div>
            <div className="grid grid-cols-1 gap-2 content-start overflow-y-auto no-scrollbar md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8">
              {renderedWatchlistCards.map((candidate) => (
                <div key={`watchlist-${candidate.symbol}`} className="bg-white/[0.02] backdrop-blur-md border border-white/5 rounded-2xl px-3 py-2 flex justify-between items-center hover:bg-white/[0.05] transition cursor-pointer">
                  <div>
                    <p className="text-sm text-white">{candidate.name}</p>
                    <p className="text-white/50 text-[11px] mt-0.5">{candidate.symbol}</p>
                  </div>
                  <span className="text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]">{candidate.changeText}</span>
                </div>
              ))}
            </div>
          </section>

        </div>
      </div>

      <Drawer
        isOpen={isRationaleDrawerOpen}
        onClose={() => setIsRationaleDrawerOpen(false)}
        title={language === 'en' ? 'Run history and ownership' : '历史记录与页面边界'}
        width="max-w-4xl"
      >
        <div data-testid="user-scanner-bento-drawer" className="ml-auto h-full w-full max-w-4xl rounded-l-[40px] border border-white/5 bg-white/[0.02] p-6 text-white backdrop-blur-3xl sm:p-8">
          <div className="grid gap-6">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">{language === 'en' ? 'Run history' : '运行历史'}</p>
              <h2 className="mt-1 text-xl text-white">{language === 'en' ? 'Recent scanner runs' : '近期扫描记录'}</h2>
            </div>

            {historyError ? <ApiErrorAlert error={historyError} /> : null}
            {isLoadingHistory ? <div className="rounded-[28px] border border-white/5 bg-white/[0.02] px-4 py-5 text-sm text-secondary-text backdrop-blur-2xl">{t('scanner.loadingHistory')}</div> : null}
            {!isLoadingHistory && historyItems.length ? (
              <div className="space-y-3">
                {historyItems.map((item) => (
                  <button key={item.id} type="button" onClick={() => void loadRun(item.id)} className={`w-full rounded-[28px] border border-white/5 bg-white/[0.02] px-4 py-3 text-left transition-colors backdrop-blur-2xl ${item.id === selectedRunId ? 'border-white/10 bg-white/[0.05]' : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.035]'}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={marketVariant(item.market)}>{item.market === 'us' ? t('scanner.marketUs') : item.market === 'hk' ? t('scanner.marketHk') : t('scanner.marketCn')}</Badge>
                      <Badge variant={statusVariant(item.status)}>{t(`scanner.status.${item.status}`)}</Badge>
                      {item.watchlistDate ? <Badge variant="history">{formatDateOnly(item.watchlistDate, language)}</Badge> : null}
                    </div>
                    <p className="mt-3 text-sm font-semibold text-foreground">{item.headline || (item.market === 'us' ? t('scanner.currentRunFallbackUs') : item.market === 'hk' ? t('scanner.currentRunFallbackHk') : t('scanner.currentRunFallbackCn'))}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-secondary-text">
                      <span>{`${t('scanner.metricShortlist')}: ${item.shortlistSize}`}</span>
                      <span>{`${t('scanner.metricUniverse')}: ${item.universeSize}`}</span>
                      <span>{formatTimestamp(item.runAt, language)}</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
            {!isLoadingHistory && !historyItems.length ? <div className="rounded-[28px] border border-white/5 bg-white/[0.02] px-4 py-5 text-sm leading-6 text-secondary-text backdrop-blur-2xl">{language === 'en' ? 'No personal scanner history yet.' : '你还没有个人扫描历史。'}</div> : null}
            {totalHistoryPages > 1 ? <div className="pt-2"><Pagination currentPage={historyPage} totalPages={totalHistoryPages} onPageChange={(page) => void fetchHistory(page)} /></div> : null}

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
                    ? 'Run status, system watchlists, schedules, and channel settings stay in admin-only pages.'
                    : '运行状态、系统观察名单、调度和通道配置继续保留在仅管理员可见的管理页面。'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </Drawer>
    </>
  );
};

export default UserScannerPage;
