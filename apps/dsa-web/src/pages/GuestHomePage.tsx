import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { LockKeyhole, PanelRightOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { publicAnalysisApi } from '../api/publicAnalysis';
import { getParsedApiError, type ParsedApiError } from '../api/error';
import { ApiErrorAlert, Button, SectionShell } from '../components/common';
import {
  BentoGrid,
  DecisionCard,
  FundamentalsCard,
  PageBriefDrawer,
  PageChrome,
  StrategyCard,
  TechCard,
  type BentoHeroItem,
} from '../components/home-bento';
import { StockAutocomplete } from '../components/StockAutocomplete';
import { useI18n } from '../contexts/UiLanguageContext';
import { buildLoginPath, buildRegistrationPath } from '../hooks/useProductSurface';
import type { PublicAnalysisPreviewResponse } from '../types/publicAnalysis';

function resolveSignalTone(score: number | null | undefined): 'bullish' | 'bearish' | 'neutral' {
  if (typeof score !== 'number') {
    return 'neutral';
  }
  if (score >= 60) {
    return 'bullish';
  }
  if (score <= 40) {
    return 'bearish';
  }
  return 'neutral';
}

const GuestHomePage: React.FC = () => {
  const { language, t } = useI18n();
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<PublicAnalysisPreviewResponse | null>(null);
  const [error, setError] = useState<ParsedApiError | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isBriefDrawerOpen, setIsBriefDrawerOpen] = useState(false);
  const loginPath = useMemo(() => buildLoginPath('/'), []);
  const registrationPath = useMemo(() => buildRegistrationPath('/'), []);

  useEffect(() => {
    document.title = t('guestHome.documentTitle');
  }, [t]);

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

  const previewSummary = preview?.report.summary;
  const previewStrategy = preview?.report.strategy;
  const previewMeta = preview?.report.meta;
  const signalTone = resolveSignalTone(previewSummary?.sentimentScore);

  const heroItems = useMemo<BentoHeroItem[]>(() => [
    {
      label: t('guestHome.previewTitle'),
      value: previewMeta?.stockCode || '--',
      detail: previewMeta?.stockName || t('guestHome.previewNote'),
      tone: previewMeta?.stockCode ? 'bullish' : 'neutral',
      testId: 'guest-home-bento-hero-preview',
      valueTestId: 'guest-home-bento-hero-preview-value',
    },
    {
      label: t('guestHome.decision'),
      value: previewSummary?.operationAdvice || t('guestHome.noValue'),
      detail: previewSummary?.trendPrediction || t('guestHome.helper'),
      tone: signalTone,
      testId: 'guest-home-bento-hero-decision',
      valueTestId: 'guest-home-bento-hero-decision-value',
    },
    {
      label: t('guestHome.unlockTitle'),
      value: language === 'en' ? '3 locked modules' : '3 个锁定模块',
      detail: t('guestHome.frostedLockBody'),
      tone: 'bullish',
      testId: 'guest-home-bento-hero-unlock',
      valueTestId: 'guest-home-bento-hero-unlock-value',
    },
    {
      label: t('guestHome.limits.title'),
      value: language === 'en' ? 'Guest only' : '游客模式',
      detail: t('guestHome.limits.accountIsolation'),
      tone: 'bearish',
      testId: 'guest-home-bento-hero-limits',
      valueTestId: 'guest-home-bento-hero-limits-value',
    },
  ], [
    language,
    previewMeta?.stockCode,
    previewMeta?.stockName,
    previewSummary?.operationAdvice,
    previewSummary?.trendPrediction,
    signalTone,
    t,
  ]);

  return (
    <PageChrome
      pageTestId="guest-home-bento-page"
      pageClassName="gemini-bento-page--home gemini-bento-page--guest-home space-y-6"
      eyebrow={t('guestHome.eyebrow')}
      title={t('guestHome.title')}
      description={t('guestHome.description')}
      actions={(
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            data-testid="guest-home-bento-drawer-trigger"
            onClick={() => setIsBriefDrawerOpen(true)}
          >
            <PanelRightOpen className="h-4 w-4" />
            <span>{language === 'en' ? 'Preview guide' : '查看预览说明'}</span>
          </Button>
          <Link to={loginPath} className="btn-primary">
            {t('guestHome.signIn')}
          </Link>
        </div>
      )}
      heroItems={heroItems}
      heroTestId="guest-home-bento-hero"
      headerChildren={(
        <SectionShell
          title={t('guestHome.previewSubtitle')}
          description={t('guestHome.helper')}
          className="rounded-[28px] border-white/[0.08] bg-white/[0.02]"
          contentClassName="space-y-4"
        >
          <label className="block">
            <span className="theme-field-label">{t('guestHome.inputLabel')}</span>
            <div className="mt-2 flex flex-col gap-3 md:flex-row">
              <div className="min-w-0 flex-1">
                <StockAutocomplete
                  value={query}
                  onChange={setQuery}
                  onSubmit={(stockCode, stockName) => {
                    void handlePreview(stockCode, stockName);
                  }}
                  placeholder={t('guestHome.inputPlaceholder')}
                  disabled={isLoading}
                />
              </div>
              <Button
                type="button"
                variant="primary"
                onClick={() => void handlePreview()}
                disabled={!query.trim() || isLoading}
              >
                {isLoading ? t('guestHome.submitting') : t('guestHome.submit')}
              </Button>
            </div>
          </label>

          {error ? <ApiErrorAlert error={error} /> : null}
        </SectionShell>
      )}
    >
      <main className="flex-1 min-h-0 overflow-auto" data-testid="guest-home-main">
        <BentoGrid testId="guest-home-grid" className="auto-rows-fr">
          <DecisionCard
            eyebrow={t('guestHome.decisionPanelEyebrow')}
            company={previewMeta?.stockName || preview?.stockName || t('guestHome.previewTitle')}
            ticker={previewMeta?.stockCode || '--'}
            heroValue={previewSummary?.sentimentScore != null ? `${previewSummary.sentimentScore}` : '--'}
            heroUnit={previewSummary?.sentimentScore != null ? '/100' : ''}
            heroLabel={t('guestHome.score')}
            signalLabel={previewSummary?.operationAdvice || t('guestHome.noValue')}
            signalTone={signalTone}
            scoreLabel={t('guestHome.trend')}
            scoreValue={previewSummary?.trendPrediction || t('guestHome.previewNote')}
            badge={previewSummary?.operationAdvice || t('guestHome.eyebrow')}
            chartLabel={previewSummary?.trendPrediction || t('guestHome.lockedLabel')}
            summary={previewSummary?.analysisSummary || t('guestHome.previewNote')}
            detailLabel={t('guestHome.previewDrawerAction')}
            onOpenDetails={() => setIsBriefDrawerOpen(true)}
          />

          <div
            data-testid="guest-home-frosted-lock"
            className="relative overflow-hidden rounded-[36px] xl:col-span-6"
          >
            <div className="grid h-full grid-cols-1 gap-4 self-stretch blur-[8px] opacity-60 select-none pointer-events-none md:grid-cols-2 xl:grid-cols-3">
              <StrategyCard
                title={t('guestHome.strategyPanelTitle')}
                metrics={[
                  { label: t('guestHome.entry'), value: previewStrategy?.idealBuy || '118.40 - 121.00', tone: 'neutral' },
                  { label: t('guestHome.target'), value: previewStrategy?.takeProfit || '136.00', tone: 'bullish' },
                  { label: t('guestHome.stopLoss'), value: previewStrategy?.stopLoss || '111.80', tone: 'bearish' },
                ]}
                positionLabel={t('guestHome.strategyPositionLabel')}
                positionBody={t('guestHome.strategyPositionBody')}
                detailLabel={t('guestHome.lockedLabel')}
                onOpenDetails={() => undefined}
              />
              <TechCard
                title={t('guestHome.techPanelTitle')}
                signals={[
                  { label: 'MACD', value: t('guestHome.techSignalMacd'), tone: 'bullish' },
                  { label: language === 'en' ? 'Moving Averages' : '均线结构', value: t('guestHome.techSignalMa'), tone: 'bullish' },
                  { label: language === 'en' ? 'Volume' : '量价配合', value: t('guestHome.techSignalVolume'), tone: 'bullish' },
                  { label: 'RSI', value: '65.4', tone: 'neutral' },
                ]}
                detailLabel={t('guestHome.lockedLabel')}
                onOpenDetails={() => undefined}
              />
              <FundamentalsCard
                title={t('guestHome.fundamentalsPanelTitle')}
                metrics={[
                  { label: t('guestHome.fundamentalMetricGrowth'), value: '+18.2%', tone: 'bullish' },
                  { label: t('guestHome.fundamentalMetricCashFlow'), value: '$16.4B', tone: 'bullish' },
                  { label: t('guestHome.fundamentalMetricMargin'), value: '74.1%', tone: 'neutral' },
                  { label: 'ROE', value: '31.8%', tone: 'bullish' },
                ]}
                detailLabel={t('guestHome.lockedLabel')}
                onOpenDetails={() => undefined}
              />
            </div>

            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/20 p-6 backdrop-blur-md">
              <div className="max-w-sm rounded-2xl border border-white/10 bg-white/[0.05] p-6 text-center backdrop-blur-2xl">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/20">
                  <LockKeyhole className="h-6 w-6 text-emerald-400" />
                </div>
                <h3 className="mb-2 text-lg font-bold text-white">{t('guestHome.frostedLockTitle')}</h3>
                <p className="mb-6 text-sm text-white/60">{t('guestHome.frostedLockBody')}</p>
                <div className="flex flex-col gap-3">
                  <Link
                    to={loginPath}
                    className="inline-flex w-full items-center justify-center rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-black transition-colors hover:bg-emerald-400"
                  >
                    {t('guestHome.frostedLockCta')}
                  </Link>
                  <Link
                    to={registrationPath}
                    className="inline-flex w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 font-semibold text-white transition-colors hover:bg-white/[0.08]"
                  >
                    {t('guestHome.createAccount')}
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </BentoGrid>
      </main>

      <PageBriefDrawer
        isOpen={isBriefDrawerOpen}
        onClose={() => setIsBriefDrawerOpen(false)}
        title={t('guestHome.title')}
        testId="guest-home-bento-drawer"
        summary={t('guestHome.drawerSummary')}
        metrics={[
          {
            label: t('guestHome.previewTitle'),
            value: previewMeta?.stockCode || '--',
            tone: previewMeta?.stockCode ? 'bullish' : 'neutral',
          },
          {
            label: t('guestHome.decision'),
            value: previewSummary?.operationAdvice || t('guestHome.noValue'),
            tone: signalTone,
          },
          {
            label: t('guestHome.unlockTitle'),
            value: language === 'en' ? '3 locked modules' : '3 个锁定模块',
            tone: 'bullish',
          },
          {
            label: t('guestHome.limits.title'),
            value: language === 'en' ? 'Guest only' : '游客模式',
            tone: 'bearish',
          },
        ]}
        bullets={[
          t('guestHome.drawerBulletDecision'),
          t('guestHome.drawerBulletLock'),
          t('guestHome.drawerBulletRedirect'),
        ]}
        footnote={language === 'en' ? 'Guest mode remains read-only.' : '游客模式继续保持只读。'}
      />
    </PageChrome>
  );
};

export default GuestHomePage;
