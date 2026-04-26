import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { BarChart3, BriefcaseBusiness, History, LockKeyhole, MessageSquareText, PanelRightOpen, TestTubeDiagonal } from 'lucide-react';
import { Link } from 'react-router-dom';
import { publicAnalysisApi } from '../api/publicAnalysis';
import { ApiErrorAlert, Button, MetricCard, PillBadge, SectionShell } from '../components/common';
import { StockAutocomplete } from '../components/StockAutocomplete';
import { LockedFeatureCard } from '../components/access/LockedFeatureCard';
import { getParsedApiError, type ParsedApiError } from '../api/error';
import {
  BentoCard,
  CARD_BUTTON_CLASS,
  PageBriefDrawer,
  PageChrome,
  type BentoHeroItem,
} from '../components/home-bento';
import { useI18n } from '../contexts/UiLanguageContext';
import { buildLoginPath, buildRegistrationPath } from '../hooks/useProductSurface';
import type { PublicAnalysisPreviewResponse } from '../types/publicAnalysis';

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
      tone: previewSummary?.operationAdvice ? 'bullish' : 'neutral',
      testId: 'guest-home-bento-hero-decision',
      valueTestId: 'guest-home-bento-hero-decision-value',
    },
    {
      label: t('guestHome.unlockTitle'),
      value: language === 'en' ? '4 modules' : '4 个模块',
      detail: t('guestHome.unlockPrimary'),
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
            className={CARD_BUTTON_CLASS}
            data-testid="guest-home-bento-drawer-trigger"
            onClick={() => setIsBriefDrawerOpen(true)}
          >
            <PanelRightOpen className="h-4 w-4" />
            <span>{language === 'en' ? 'Preview guide' : '查看预览说明'}</span>
          </Button>
          <Link to={loginPath} className={CARD_BUTTON_CLASS}>
            {t('guestHome.signIn')}
          </Link>
        </div>
      )}
      heroItems={heroItems}
      heroTestId="guest-home-bento-hero"
      headerChildren={(
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.18fr)_minmax(22rem,0.82fr)]">
          <BentoCard
            eyebrow={t('guestHome.previewSubtitle')}
            title={t('guestHome.previewTitle')}
            subtitle={t('guestHome.helper')}
            testId="guest-home-preview-card"
          >
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
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => void handlePreview()}
                    disabled={!query.trim() || isLoading}
                    className="bg-[var(--pill-active-bg)] text-foreground hover:border-[var(--border-strong)]"
                  >
                    {isLoading ? t('guestHome.submitting') : t('guestHome.submit')}
                  </Button>
                </div>
              </label>

              {error ? <ApiErrorAlert error={error} /> : null}

              <SectionShell className="rounded-[var(--theme-panel-radius-md)] px-4 py-4" contentClassName="space-y-4">
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
                  <PillBadge variant="warning">
                    {t('guestHome.eyebrow')}
                  </PillBadge>
                </div>

                <p className="mt-4 text-sm leading-6 text-secondary-text">
                  {previewSummary?.analysisSummary || t('guestHome.previewNote')}
                </p>

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <MetricCard label={t('guestHome.decision')} value={previewSummary?.operationAdvice || t('guestHome.noValue')} />
                  <MetricCard label={t('guestHome.trend')} value={previewSummary?.trendPrediction || t('guestHome.noValue')} />
                  <MetricCard label={t('guestHome.score')} value={previewSummary?.sentimentScore != null ? `${previewSummary.sentimentScore}` : t('guestHome.noValue')} />
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <MetricCard label={t('guestHome.entry')} value={previewStrategy?.idealBuy || t('guestHome.noValue')} className="border border-dashed border-[var(--theme-panel-subtle-border)]" />
                  <MetricCard label={t('guestHome.stopLoss')} value={previewStrategy?.stopLoss || t('guestHome.noValue')} className="border border-dashed border-[var(--theme-panel-subtle-border)]" />
                  <MetricCard label={t('guestHome.target')} value={previewStrategy?.takeProfit || t('guestHome.noValue')} className="border border-dashed border-[var(--theme-panel-subtle-border)]" />
                </div>

                <p className="mt-4 text-xs leading-5 text-muted-text">{t('guestHome.previewNote')}</p>
              </SectionShell>
            </div>
          </BentoCard>

          <BentoCard
            eyebrow={t('guestHome.unlockSubtitle')}
            title={t('guestHome.unlockTitle')}
            subtitle={t('guestHome.unlockBody')}
            testId="guest-home-unlock-card"
          >
            <div className="space-y-4">
              <SectionShell className="rounded-[var(--theme-panel-radius-md)] px-4 py-4">
                <div className="flex items-start gap-3">
                  <div className="theme-panel-subtle flex h-10 w-10 items-center justify-center rounded-full text-foreground">
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
                  <Link to={loginPath} className={CARD_BUTTON_CLASS}>
                    {t('guestHome.signIn')}
                  </Link>
                  <Link
                    to={registrationPath}
                    className={CARD_BUTTON_CLASS}
                  >
                    {t('guestHome.createAccount')}
                  </Link>
                </div>
              </SectionShell>
            </div>
          </BentoCard>
        </div>
      )}
    >

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

      <BentoCard
        eyebrow={t('guestHome.limits.subtitle')}
        title={t('guestHome.limits.title')}
        subtitle={t('guestHome.previewNote')}
        testId="guest-home-limits-card"
      >
        <div className="grid gap-3 md:grid-cols-3">
          <MetricCard label={t('guestHome.limits.title')} value={t('guestHome.limits.accountIsolation')} />
          <MetricCard label={t('guestHome.unlockTitle')} value={t('guestHome.limits.persistence')} />
          <MetricCard label={t('guestHome.lockedLabel')} value={t('guestHome.limits.admin')} />
        </div>
      </BentoCard>
      <PageBriefDrawer
        isOpen={isBriefDrawerOpen}
        onClose={() => setIsBriefDrawerOpen(false)}
        title={t('guestHome.title')}
        testId="guest-home-bento-drawer"
        summary={language === 'en'
          ? 'This guest surface is a lightweight Bento preview: one analysis snapshot, clear product boundaries, and direct sign-in handoff without shared saved state.'
          : '这个游客页是轻量 Bento 预览：只开放一次分析快照、明确产品边界，并把后续动作直接交给登录流程。'}
        metrics={[
          {
            label: t('guestHome.previewTitle'),
            value: previewMeta?.stockCode || '--',
            tone: previewMeta?.stockCode ? 'bullish' : 'neutral',
          },
          {
            label: t('guestHome.decision'),
            value: previewSummary?.operationAdvice || t('guestHome.noValue'),
            tone: previewSummary?.operationAdvice ? 'bullish' : 'neutral',
          },
          {
            label: t('guestHome.unlockTitle'),
            value: language === 'en' ? '4 modules' : '4 个模块',
            tone: 'bullish',
          },
          {
            label: t('guestHome.limits.title'),
            value: language === 'en' ? 'Guest only' : '游客模式',
            tone: 'bearish',
          },
        ]}
        bullets={[
          language === 'en'
            ? 'The hero strip surfaces preview result, decision snapshot, unlock scope, and guest boundary before you scroll into detail.'
            : 'Hero strip 先把预览结果、判断快照、解锁范围和游客边界抬出来，再进入详细内容。',
          language === 'en'
            ? 'Feature cards stay locked by design, so the page explains the product instead of faking saved data.'
            : '功能卡本来就是锁定态，因此页面是在解释产品，而不是伪造保存数据。',
          language === 'en'
            ? 'This pass changes layout and smoke hooks only.'
            : '这次只调整布局和 smoke 钩子。',
        ]}
        footnote={language === 'en' ? 'Guest mode remains read-only.' : '游客模式继续保持只读。'}
      />
    </PageChrome>
  );
};

export default GuestHomePage;
