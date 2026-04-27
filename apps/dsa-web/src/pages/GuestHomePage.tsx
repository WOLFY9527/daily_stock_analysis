import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getParsedApiError, type ParsedApiError } from '../api/error';
import { publicAnalysisApi } from '../api/publicAnalysis';
import { withFallback } from '../api/withFallback';
import { ApiErrorAlert, GlassCard, Label } from '../components/common';
import { StockAutocomplete } from '../components/StockAutocomplete';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/UiLanguageContext';
import { buildLoginPath, buildRegistrationPath } from '../hooks/useProductSurface';
import type { PublicAnalysisPreviewResponse } from '../types/publicAnalysis';
import { createPublicAnalysisFallbackPreview } from '../utils/publicAnalysisFallback';
import { buildLocalizedPath, parseLocaleFromPathname } from '../utils/localeRouting';

type GuestHomeCopy = {
  documentTitle: string;
  title: string;
  subtitle: string;
  inputPlaceholder: string;
  submitLabel: string;
  submittingLabel: string;
  scoreLabel: string;
  actionLabel: string;
  trendLabel: string;
  summaryLabel: string;
  chartLabel: string;
  chartReasonTitle: string;
  chartReasonBody: string;
  waitingLabel: string;
  lockedCta: string;
  createAccount: string;
};

const COPY: Record<'zh' | 'en', GuestHomeCopy> = {
  zh: {
    documentTitle: '游客预览 - WolfyStock',
    title: 'WolfyStock 决策面板',
    subtitle: '输入股票代码，唤醒 AI 深度分析...',
    inputPlaceholder: '输入股票代码或名称，如 600519、贵州茅台、AAPL',
    submitLabel: '生成简版判断',
    submittingLabel: '生成中...',
    scoreLabel: '评分',
    actionLabel: '动作建议',
    trendLabel: '趋势判断',
    summaryLabel: 'AI 摘要',
    chartLabel: '突破观察',
    chartReasonTitle: 'AI 归因',
    chartReasonBody: '预览图会优先展示箱体震荡后的突破尝试，帮助游客直观看到趋势切换而不是一条失真的直线。',
    waitingLabel: '待生成',
    lockedCta: '登录解锁全部模块',
    createAccount: '创建账户',
  },
  en: {
    documentTitle: 'Guest Preview - WolfyStock',
    title: 'WolfyStock Decision Console',
    subtitle: 'Enter a ticker to wake up the AI analysis flow.',
    inputPlaceholder: 'Enter a stock code or company name, for example 600519, Kweichow Moutai, AAPL',
    submitLabel: 'Generate snapshot',
    submittingLabel: 'Generating...',
    scoreLabel: 'Score',
    actionLabel: 'Action',
    trendLabel: 'Trend',
    summaryLabel: 'AI summary',
    chartLabel: 'Breakout Watch',
    chartReasonTitle: 'AI Why',
    chartReasonBody: 'The preview now shows a range, a pullback, and a breakout attempt so guests see a believable market path instead of a flat synthetic line.',
    waitingLabel: 'Waiting',
    lockedCta: 'Sign in to unlock everything',
    createAccount: 'Create account',
  },
};

function buildChartSeries(score?: number | null) {
  const breakoutStrength = typeof score === 'number' ? Math.max(0, Math.min(1, (score - 55) / 35)) : 0.5;
  const values = [
    116.1,
    117.4,
    116.7,
    117.9,
    116.9,
    117.2,
    116.4,
    118.1,
    119.8 + breakoutStrength * 0.8,
    121.7 + breakoutStrength * 1.5,
    123.3 + breakoutStrength * 2.4,
  ];
  const high = Math.max(...values) + 1.2;
  const low = Math.min(...values) - 1.2;
  const range = high - low || 1;
  return values.map((value, index) => {
    const x = 16 + index * 28.8;
    const y = 112 - ((value - low) / range) * 84;
    return `${x},${y}`;
  }).join(' ');
}

const GuestHomePage: React.FC = () => {
  const { loggedIn, isLoading: authLoading } = useAuth();
  const { language } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const copy = COPY[language];
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<PublicAnalysisPreviewResponse | null>(null);
  const [error, setError] = useState<ParsedApiError | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const routeLocale = parseLocaleFromPathname(location.pathname);
  const homePath = routeLocale ? buildLocalizedPath('/', routeLocale) : '/';
  const loginPath = useMemo(() => buildLoginPath('/'), []);
  const registrationPath = useMemo(() => buildRegistrationPath('/'), []);

  useEffect(() => {
    document.title = copy.documentTitle;
  }, [copy.documentTitle]);

  useEffect(() => {
    if (!authLoading && loggedIn) {
      navigate(homePath, { replace: true });
    }
  }, [authLoading, homePath, loggedIn, navigate]);

  const handlePreview = async (stockCode?: string, stockName?: string) => {
    const nextCode = (stockCode || query).trim();
    if (!nextCode) {
      return;
    }

    setIsLoading(true);
    setError(null);
    setFallbackNotice(null);
    try {
      const response = await withFallback(
        () => publicAnalysisApi.preview({
          stockCode: nextCode,
          stockName,
          reportType: 'brief',
        }),
        {
          fallback: () => createPublicAnalysisFallbackPreview(nextCode, language),
        },
      );
      setPreview(response.data);
      if (response.fallback) {
        setFallbackNotice(language === 'en'
          ? 'Live preview is temporarily unavailable. Loaded a local snapshot instead.'
          : '实时预览暂时不可用，已切换到本地快照。');
      }
      setQuery(stockName || nextCode);
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const summary = preview?.report.summary;
  const scoreValue = summary?.sentimentScore != null ? String(summary.sentimentScore) : '--';
  const chartPoints = buildChartSeries(summary?.sentimentScore);
  const chartLastPoint = chartPoints.split(' ').slice(-1)[0];
  const chartLastY = chartLastPoint ? chartLastPoint.split(',')[1] : '52';
  const waitingToneClass = 'text-white/40';

  return (
    <main
      className="w-full min-h-[calc(100vh-80px)] flex flex-col py-8 px-6 md:px-8 xl:px-12 overflow-x-hidden"
      data-testid="guest-home-page"
    >
      <div className="flex w-full flex-col gap-8">
        <div className="w-full">
          <h1 className="text-2xl font-bold text-white mb-2">{copy.title}</h1>
          <p className="text-sm text-white/40">{copy.subtitle}</p>
        </div>

        <section className="w-full">
          <GlassCard className="w-full p-6 shadow-2xl backdrop-blur-3xl" data-testid="guest-home-search-card">
            <div className="flex max-w-3xl flex-col gap-3 md:flex-row">
              <div className="min-w-0 flex-1">
                <StockAutocomplete
                  value={query}
                  onChange={setQuery}
                  onSubmit={(stockCode, stockName) => {
                    void handlePreview(stockCode, stockName);
                  }}
                  placeholder={copy.inputPlaceholder}
                  disabled={isLoading}
                  className="border border-white/10 bg-white/[0.04] text-white placeholder:text-white/30"
                />
              </div>
              <button
                type="button"
                onClick={() => void handlePreview()}
                className="shrink-0 rounded-xl border border-white/10 bg-white/[0.05] px-6 py-3.5 text-white font-medium transition-colors hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isLoading}
              >
                {isLoading ? copy.submittingLabel : copy.submitLabel}
              </button>
            </div>
            {fallbackNotice ? <p className="mt-4 text-xs text-white/50">{fallbackNotice}</p> : null}
            {error ? <div className="mt-4"><ApiErrorAlert error={error} /></div> : null}
          </GlassCard>
        </section>

        <section className="w-full">
          <GlassCard className="w-full p-6 shadow-2xl backdrop-blur-3xl" data-testid="guest-home-preview-card">
          <div className="flex flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)] xl:items-stretch">
            <div className="flex min-w-0 flex-1 flex-col justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/60">
                  <TrendingUp className="h-3.5 w-3.5" />
                  <span>AI Decision</span>
                </div>
                <div className="mt-5 flex items-end gap-3">
                  <span className="text-5xl font-semibold text-white">{scoreValue}</span>
                  <span className="pb-1 text-sm text-white/38">/100</span>
                </div>
                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-3">
                    <Label as="p" size="dense" tone="muted">{copy.actionLabel}</Label>
                    <p
                      className={`mt-2 text-base font-medium ${summary?.operationAdvice ? 'text-white' : waitingToneClass}`}
                      data-testid="guest-home-waiting-action"
                    >
                      {summary?.operationAdvice || copy.waitingLabel}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-3">
                    <Label as="p" size="dense" tone="muted">{copy.trendLabel}</Label>
                    <p
                      className={`mt-2 text-base font-medium ${summary?.trendPrediction ? 'text-white' : waitingToneClass}`}
                      data-testid="guest-home-waiting-trend"
                    >
                      {summary?.trendPrediction || copy.waitingLabel}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-white/6 bg-white/[0.025] px-4 py-4">
                <Label as="p" size="dense" tone="muted">{copy.summaryLabel}</Label>
                <p className="mt-2 text-sm leading-6 text-white/62">
                  {summary?.analysisSummary || copy.subtitle}
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Link to={loginPath} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] px-4 text-sm font-medium text-white transition-colors hover:bg-white/[0.1]">
                    {copy.lockedCta}
                  </Link>
                  <Link to={registrationPath} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-white/10 px-4 text-sm font-medium text-white/78 transition hover:bg-white/[0.05] hover:text-white">
                    {copy.createAccount}
                  </Link>
                </div>
              </div>
            </div>

            <div className="min-w-0">
              <div className="h-full rounded-[26px] border border-white/6 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between">
                  <Label size="dense" tone="muted">{copy.chartLabel}</Label>
                  <Label size="dense" tone="muted">{preview?.report.meta.stockCode || '--'}</Label>
                </div>
                <div className="relative mt-5 rounded-[22px] border border-white/6 bg-black/20 px-4 py-4">
                  <svg viewBox="0 0 320 136" className="h-44 w-full">
                  <defs>
                    <linearGradient id="guest-home-line" x1="0%" x2="100%" y1="0%" y2="0%">
                      <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
                      <stop offset="100%" stopColor="rgba(255,255,255,0.7)" />
                    </linearGradient>
                  </defs>
                  <path d="M16 112 H304" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
                  <path d="M16 84 H304" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                  <path d="M16 56 H304" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                  <polyline
                    fill="none"
                    stroke="url(#guest-home-line)"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={chartPoints}
                  />
                  <circle cx="296" cy={chartLastY} r="5" fill="rgba(255,255,255,0.72)" />
                  </svg>
                  <div className="absolute right-4 top-4 flex items-center gap-1.5 rounded-full border border-indigo-400/25 bg-indigo-400/12 px-3 py-1 text-[10px] font-bold text-white shadow-[0_0_15px_rgba(99,102,241,0.22)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-white/85 animate-pulse" />
                    {copy.chartLabel}
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-white/40">
                  <span
                    className={preview?.report.meta.stockName ? 'text-white/40' : waitingToneClass}
                    data-testid="guest-home-waiting-chart"
                  >
                    {preview?.report.meta.stockName || copy.waitingLabel}
                  </span>
                  <span className={summary?.trendPrediction ? 'text-white/40' : waitingToneClass}>
                    {summary?.trendPrediction || copy.waitingLabel}
                  </span>
                </div>
                <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.03] p-3 flex flex-col gap-1.5">
                  <Label micro as="div">{copy.chartReasonTitle}</Label>
                  <p className="text-xs text-white/80 leading-relaxed">{copy.chartReasonBody}</p>
                </div>
              </div>
            </div>
          </div>
          </GlassCard>
        </section>
      </div>
    </main>
  );
};

export default GuestHomePage;
