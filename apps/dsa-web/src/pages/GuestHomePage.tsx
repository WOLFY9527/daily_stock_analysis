import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getParsedApiError, type ParsedApiError } from '../api/error';
import { publicAnalysisApi } from '../api/publicAnalysis';
import { ApiErrorAlert } from '../components/common';
import { StockAutocomplete } from '../components/StockAutocomplete';
import { useI18n } from '../contexts/UiLanguageContext';
import { buildLoginPath, buildRegistrationPath } from '../hooks/useProductSurface';
import type { PublicAnalysisPreviewResponse } from '../types/publicAnalysis';

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
    waitingLabel: 'Waiting',
    lockedCta: 'Sign in to unlock everything',
    createAccount: 'Create account',
  },
};

function buildChartSeries(score?: number | null) {
  const anchor = typeof score === 'number' ? Math.max(22, Math.min(92, score)) : 58;
  const values = [anchor - 18, anchor - 10, anchor - 14, anchor - 2, anchor + 6, anchor + 2];
  return values.map((value, index) => {
    const x = 16 + index * 56;
    const y = 112 - ((Math.max(10, Math.min(95, value)) - 10) / 85) * 84;
    return `${x},${y}`;
  }).join(' ');
}

const GuestHomePage: React.FC = () => {
  const { language } = useI18n();
  const copy = COPY[language];
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<PublicAnalysisPreviewResponse | null>(null);
  const [error, setError] = useState<ParsedApiError | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const loginPath = useMemo(() => buildLoginPath('/'), []);
  const registrationPath = useMemo(() => buildRegistrationPath('/'), []);

  useEffect(() => {
    document.title = copy.documentTitle;
  }, [copy.documentTitle]);

  const handlePreview = async (stockCode?: string, stockName?: string) => {
    const nextCode = (stockCode || query).trim();
    if (!nextCode) {
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await publicAnalysisApi.preview({
        stockCode: nextCode,
        stockName,
        reportType: 'brief',
      });
      setPreview(response);
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
      className="flex flex-1 flex-col items-center justify-center p-6 min-h-[calc(100vh-80px)]"
      data-testid="guest-home-page"
    >
      <div className="flex w-full max-w-3xl flex-col gap-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-2">{copy.title}</h1>
          <p className="text-sm text-white/40">{copy.subtitle}</p>
        </div>

        <section
          className="w-full rounded-[24px] border border-white/5 bg-white/[0.02] p-6 shadow-2xl backdrop-blur-3xl"
          data-testid="guest-home-search-card"
        >
          <div className="flex flex-col gap-3 md:flex-row">
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
          {error ? <div className="mt-4"><ApiErrorAlert error={error} /></div> : null}
        </section>

        <section
          className="w-full rounded-[24px] border border-white/5 bg-white/[0.02] p-6 shadow-2xl backdrop-blur-3xl"
          data-testid="guest-home-preview-card"
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch">
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
                    <p className="text-[11px] uppercase tracking-[0.22em] text-white/36">{copy.actionLabel}</p>
                    <p
                      className={`mt-2 text-base font-medium ${summary?.operationAdvice ? 'text-white' : waitingToneClass}`}
                      data-testid="guest-home-waiting-action"
                    >
                      {summary?.operationAdvice || copy.waitingLabel}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-white/36">{copy.trendLabel}</p>
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
                <p className="text-[11px] uppercase tracking-[0.22em] text-white/36">{copy.summaryLabel}</p>
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

            <div className="lg:w-[320px]">
              <div className="h-full rounded-[26px] border border-white/6 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.22em] text-white/34">
                  <span>{copy.scoreLabel}</span>
                  <span>{preview?.report.meta.stockCode || '--'}</span>
                </div>
                <svg viewBox="0 0 320 136" className="mt-5 h-40 w-full">
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
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
};

export default GuestHomePage;
