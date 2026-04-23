import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { BarChart3, BriefcaseBusiness, History, LockKeyhole, MessageSquareText, TestTubeDiagonal } from 'lucide-react';
import { Link } from 'react-router-dom';
import { publicAnalysisApi } from '../api/publicAnalysis';
import { ApiErrorAlert, Card, WorkspacePageHeader } from '../components/common';
import { StockAutocomplete } from '../components/StockAutocomplete';
import { LockedFeatureCard } from '../components/access/LockedFeatureCard';
import { getParsedApiError, type ParsedApiError } from '../api/error';
import { useI18n } from '../contexts/UiLanguageContext';
import { buildLoginPath, buildRegistrationPath } from '../hooks/useProductSurface';
import type { PublicAnalysisPreviewResponse } from '../types/publicAnalysis';

const GuestHomePage: React.FC = () => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<PublicAnalysisPreviewResponse | null>(null);
  const [error, setError] = useState<ParsedApiError | null>(null);
  const [isLoading, setIsLoading] = useState(false);
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

  return (
    <div className="space-y-6">
      <WorkspacePageHeader
        eyebrow={t('guestHome.eyebrow')}
        title={t('guestHome.title')}
        description={t('guestHome.description')}
        actions={(
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to={loginPath}
              className="inline-flex min-h-[40px] items-center justify-center rounded-[var(--theme-button-radius)] border border-transparent bg-[var(--pill-active-bg)] px-4 text-[0.75rem] text-foreground transition-colors hover:border-[var(--border-strong)]"
            >
              {t('guestHome.signIn')}
            </Link>
          </div>
        )}
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.18fr)_minmax(22rem,0.82fr)]">
          <Card title={t('guestHome.previewTitle')} subtitle={t('guestHome.previewSubtitle')}>
            <div className="space-y-4">
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
                  <button
                    type="button"
                    onClick={() => void handlePreview()}
                    disabled={!query.trim() || isLoading}
                    className="inline-flex min-h-[40px] items-center justify-center rounded-[var(--theme-button-radius)] border border-transparent bg-[var(--pill-active-bg)] px-4 text-[0.75rem] text-foreground transition-colors hover:border-[var(--border-strong)] disabled:pointer-events-none disabled:opacity-50"
                  >
                    {isLoading ? t('guestHome.submitting') : t('guestHome.submit')}
                  </button>
                </div>
              </label>

              <p className="text-sm leading-6 text-secondary-text">{t('guestHome.helper')}</p>

              {error ? <ApiErrorAlert error={error} /> : null}

              <div className="rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-2)]/45 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-secondary-text">
                      {t('guestHome.decisionSnapshot')}
                    </p>
                    <h2 className="mt-1 text-lg font-semibold text-foreground">
                      {previewMeta?.stockName || preview?.stockName || t('guestHome.previewTitle')}
                      {previewMeta?.stockCode ? (
                        <span className="ml-2 font-mono text-sm text-muted-text">{previewMeta.stockCode}</span>
                      ) : null}
                    </h2>
                  </div>
                  <span className="rounded-full border border-[hsl(var(--accent-warning-hsl)/0.32)] bg-[hsl(var(--accent-warning-hsl)/0.14)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--accent-warning-hsl))]">
                    {t('guestHome.eyebrow')}
                  </span>
                </div>

                <p className="mt-4 text-sm leading-6 text-secondary-text">
                  {previewSummary?.analysisSummary || t('guestHome.previewNote')}
                </p>

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-1)]/65 px-3 py-3">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-secondary-text">{t('guestHome.decision')}</p>
                    <p className="mt-2 text-base font-semibold text-foreground">{previewSummary?.operationAdvice || t('guestHome.noValue')}</p>
                  </div>
                  <div className="rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-1)]/65 px-3 py-3">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-secondary-text">{t('guestHome.trend')}</p>
                    <p className="mt-2 text-base font-semibold text-foreground">{previewSummary?.trendPrediction || t('guestHome.noValue')}</p>
                  </div>
                  <div className="rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-1)]/65 px-3 py-3">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-secondary-text">{t('guestHome.score')}</p>
                    <p className="mt-2 text-base font-semibold text-foreground">
                      {previewSummary?.sentimentScore != null ? `${previewSummary.sentimentScore}` : t('guestHome.noValue')}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-[var(--theme-panel-radius-md)] border border-dashed border-[var(--theme-panel-subtle-border)] px-3 py-3">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-secondary-text">{t('guestHome.entry')}</p>
                    <p className="mt-2 text-sm text-foreground">{previewStrategy?.idealBuy || t('guestHome.noValue')}</p>
                  </div>
                  <div className="rounded-[var(--theme-panel-radius-md)] border border-dashed border-[var(--theme-panel-subtle-border)] px-3 py-3">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-secondary-text">{t('guestHome.stopLoss')}</p>
                    <p className="mt-2 text-sm text-foreground">{previewStrategy?.stopLoss || t('guestHome.noValue')}</p>
                  </div>
                  <div className="rounded-[var(--theme-panel-radius-md)] border border-dashed border-[var(--theme-panel-subtle-border)] px-3 py-3">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-secondary-text">{t('guestHome.target')}</p>
                    <p className="mt-2 text-sm text-foreground">{previewStrategy?.takeProfit || t('guestHome.noValue')}</p>
                  </div>
                </div>

                <p className="mt-4 text-xs leading-5 text-muted-text">{t('guestHome.previewNote')}</p>
              </div>
            </div>
          </Card>

          <Card title={t('guestHome.unlockTitle')} subtitle={t('guestHome.unlockSubtitle')}>
            <div className="space-y-4">
              <p className="text-sm leading-6 text-secondary-text">{t('guestHome.unlockBody')}</p>
              <div className="rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-2)]/45 px-4 py-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/6 text-foreground">
                    <LockKeyhole className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{t('guestHome.unlockPrimary')}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-text">
                      {t('guestHome.unlockSecondary')}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Link
                    to={loginPath}
                    className="inline-flex min-h-[40px] items-center justify-center rounded-[var(--theme-button-radius)] border border-transparent bg-[var(--pill-active-bg)] px-4 text-[0.75rem] text-foreground transition-colors hover:border-[var(--border-strong)]"
                  >
                    {t('guestHome.signIn')}
                  </Link>
                  <Link
                    to={registrationPath}
                    className="inline-flex min-h-[40px] items-center justify-center rounded-[var(--theme-button-radius)] border border-[var(--border-muted)] bg-[var(--pill-bg)] px-4 text-[0.75rem] text-secondary-text transition-colors hover:border-[var(--border-strong)] hover:text-foreground"
                  >
                    {t('guestHome.createAccount')}
                  </Link>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </WorkspacePageHeader>

      <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-5">
        <LockedFeatureCard
          icon={BarChart3}
          title={t('guestHome.cards.fullReports.title')}
          body={t('guestHome.cards.fullReports.body')}
          lockedLabel={t('guestHome.lockedLabel')}
          ctaLabel={t('guestHome.signIn')}
          ctaTo={loginPath}
        />
        <LockedFeatureCard
          icon={MessageSquareText}
          title={t('guestHome.cards.followUp.title')}
          body={t('guestHome.cards.followUp.body')}
          lockedLabel={t('guestHome.lockedLabel')}
          ctaLabel={t('guestHome.signIn')}
          ctaTo={loginPath}
        />
        <LockedFeatureCard
          icon={BriefcaseBusiness}
          title={t('guestHome.cards.portfolio.title')}
          body={t('guestHome.cards.portfolio.body')}
          lockedLabel={t('guestHome.lockedLabel')}
          ctaLabel={t('guestHome.signIn')}
          ctaTo={loginPath}
        />
        <LockedFeatureCard
          icon={TestTubeDiagonal}
          title={t('guestHome.cards.backtests.title')}
          body={t('guestHome.cards.backtests.body')}
          lockedLabel={t('guestHome.lockedLabel')}
          ctaLabel={t('guestHome.signIn')}
          ctaTo={loginPath}
        />
        <LockedFeatureCard
          icon={History}
          title={t('guestHome.cards.history.title')}
          body={t('guestHome.cards.history.body')}
          lockedLabel={t('guestHome.lockedLabel')}
          ctaLabel={t('guestHome.cards.history.cta')}
          ctaTo="/scanner"
        />
      </div>

      <Card title={t('guestHome.limits.title')} subtitle={t('guestHome.limits.subtitle')}>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-2)]/45 px-4 py-4 text-sm leading-6 text-secondary-text">
            {t('guestHome.limits.accountIsolation')}
          </div>
          <div className="rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-2)]/45 px-4 py-4 text-sm leading-6 text-secondary-text">
            {t('guestHome.limits.persistence')}
          </div>
          <div className="rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-2)]/45 px-4 py-4 text-sm leading-6 text-secondary-text">
            {t('guestHome.limits.admin')}
          </div>
        </div>
      </Card>
    </div>
  );
};

export default GuestHomePage;
