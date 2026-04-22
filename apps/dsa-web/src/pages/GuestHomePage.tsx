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

type GuestHomeCopy = {
  title: string;
  description: string;
  inputLabel: string;
  inputPlaceholder: string;
  submit: string;
  submitting: string;
  helper: string;
  previewTitle: string;
  previewNote: string;
  unlockTitle: string;
  unlockBody: string;
  decision: string;
  trend: string;
  score: string;
  entry: string;
  stopLoss: string;
  target: string;
  noValue: string;
  signIn: string;
  createAccount: string;
  unlockPrimary: string;
};

const COPY: Record<'zh' | 'en', GuestHomeCopy> = {
  zh: {
    title: '游客预览模式',
    description: '先体验简版分析摘要，再决定是否注册解锁完整功能。游客预览不会保存历史，也不会创建用户数据。',
    inputLabel: '输入标的',
    inputPlaceholder: '输入股票代码或名称，如 600519、贵州茅台、AAPL',
    submit: '生成简版判断',
    submitting: '生成中...',
    helper: '游客可获取一次简版决策摘要；完整报告、问股、回测、持仓与历史需要登录后解锁。',
    previewTitle: '即时分析预览',
    previewNote: '该结果仅用于游客模式预览，不写入历史记录，也不开放深度问答。',
    unlockTitle: '登录后继续完整功能',
    unlockBody: '进入账户后，你的分析、问股、持仓、回测与历史都会绑定到个人身份，不再走共享游客状态。',
    decision: '动作建议',
    trend: '趋势判断',
    score: '情绪分数',
    entry: '理想介入',
    stopLoss: '止损位',
    target: '目标位',
    noValue: '待生成',
    signIn: '登录解锁',
    createAccount: '创建账户',
    unlockPrimary: '登录后解锁完整功能',
  },
  en: {
    title: 'Guest Preview Mode',
    description: 'Try a lightweight analysis snapshot first, then sign in for saved reports, Ask Stock, portfolio, and backtests. Guest previews are never saved to an account.',
    inputLabel: 'Enter a symbol',
    inputPlaceholder: 'Enter a stock code or company name, for example 600519, Kweichow Moutai, AAPL',
    submit: 'Generate snapshot',
    submitting: 'Generating...',
    helper: 'Guests can generate a lightweight decision snapshot. Full reports, Ask Stock, backtests, portfolio tools, and saved history unlock after sign-in.',
    previewTitle: 'Instant Analysis Snapshot',
    previewNote: 'This preview is intentionally limited. It is not persisted and does not unlock deep follow-up flows.',
    unlockTitle: 'Sign in for the full app',
    unlockBody: 'Once you sign in, your analysis, chats, portfolio, backtests, and saved history stay attached to your own account.',
    decision: 'Action',
    trend: 'Trend',
    score: 'Sentiment',
    entry: 'Entry',
    stopLoss: 'Stop loss',
    target: 'Target',
    noValue: 'Waiting',
    signIn: 'Sign in',
    createAccount: 'Create account',
    unlockPrimary: 'Unlock saved reports, chat, portfolio, and backtests',
  },
};

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
    document.title = language === 'en' ? 'Guest Preview - WolfyStock' : '游客预览 - WolfyStock';
  }, [language]);

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
        eyebrow={language === 'en' ? 'Guest Preview' : '游客预览'}
        title={copy.title}
        description={copy.description}
        actions={(
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to={loginPath}
              className="inline-flex min-h-[40px] items-center justify-center rounded-[var(--theme-button-radius)] border border-transparent bg-[var(--pill-active-bg)] px-4 text-[0.75rem] text-foreground transition-colors hover:border-[var(--border-strong)]"
            >
              {copy.signIn}
            </Link>
          </div>
        )}
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.18fr)_minmax(22rem,0.82fr)]">
          <Card title={copy.previewTitle} subtitle={language === 'en' ? 'Limited Value' : '受限价值'}>
            <div className="space-y-4">
              <label className="block">
                <span className="theme-field-label">{copy.inputLabel}</span>
                <div className="mt-2 flex flex-col gap-3 md:flex-row">
                  <div className="min-w-0 flex-1">
                    <StockAutocomplete
                      value={query}
                      onChange={setQuery}
                      onSubmit={(stockCode, stockName) => {
                        void handlePreview(stockCode, stockName);
                      }}
                      placeholder={copy.inputPlaceholder}
                      disabled={isLoading}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void handlePreview()}
                    disabled={!query.trim() || isLoading}
                    className="inline-flex min-h-[40px] items-center justify-center rounded-[var(--theme-button-radius)] border border-transparent bg-[var(--pill-active-bg)] px-4 text-[0.75rem] text-foreground transition-colors hover:border-[var(--border-strong)] disabled:pointer-events-none disabled:opacity-50"
                  >
                    {isLoading ? copy.submitting : copy.submit}
                  </button>
                </div>
              </label>

              <p className="text-sm leading-6 text-secondary-text">{copy.helper}</p>

              {error ? <ApiErrorAlert error={error} /> : null}

              <div className="rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-2)]/45 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-secondary-text">
                      {language === 'en' ? 'Decision Snapshot' : '决策快照'}
                    </p>
                    <h2 className="mt-1 text-lg font-semibold text-foreground">
                      {previewMeta?.stockName || preview?.stockName || copy.previewTitle}
                      {previewMeta?.stockCode ? (
                        <span className="ml-2 font-mono text-sm text-muted-text">{previewMeta.stockCode}</span>
                      ) : null}
                    </h2>
                  </div>
                  <span className="rounded-full border border-[hsl(var(--accent-warning-hsl)/0.32)] bg-[hsl(var(--accent-warning-hsl)/0.14)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--accent-warning-hsl))]">
                    {language === 'en' ? 'Guest Preview' : '游客预览'}
                  </span>
                </div>

                <p className="mt-4 text-sm leading-6 text-secondary-text">
                  {previewSummary?.analysisSummary || copy.previewNote}
                </p>

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-1)]/65 px-3 py-3">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-secondary-text">{copy.decision}</p>
                    <p className="mt-2 text-base font-semibold text-foreground">{previewSummary?.operationAdvice || copy.noValue}</p>
                  </div>
                  <div className="rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-1)]/65 px-3 py-3">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-secondary-text">{copy.trend}</p>
                    <p className="mt-2 text-base font-semibold text-foreground">{previewSummary?.trendPrediction || copy.noValue}</p>
                  </div>
                  <div className="rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-1)]/65 px-3 py-3">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-secondary-text">{copy.score}</p>
                    <p className="mt-2 text-base font-semibold text-foreground">
                      {previewSummary?.sentimentScore != null ? `${previewSummary.sentimentScore}` : copy.noValue}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-[var(--theme-panel-radius-md)] border border-dashed border-[var(--theme-panel-subtle-border)] px-3 py-3">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-secondary-text">{copy.entry}</p>
                    <p className="mt-2 text-sm text-foreground">{previewStrategy?.idealBuy || copy.noValue}</p>
                  </div>
                  <div className="rounded-[var(--theme-panel-radius-md)] border border-dashed border-[var(--theme-panel-subtle-border)] px-3 py-3">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-secondary-text">{copy.stopLoss}</p>
                    <p className="mt-2 text-sm text-foreground">{previewStrategy?.stopLoss || copy.noValue}</p>
                  </div>
                  <div className="rounded-[var(--theme-panel-radius-md)] border border-dashed border-[var(--theme-panel-subtle-border)] px-3 py-3">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-secondary-text">{copy.target}</p>
                    <p className="mt-2 text-sm text-foreground">{previewStrategy?.takeProfit || copy.noValue}</p>
                  </div>
                </div>

                <p className="mt-4 text-xs leading-5 text-muted-text">{copy.previewNote}</p>
              </div>
            </div>
          </Card>

          <Card title={copy.unlockTitle} subtitle={language === 'en' ? 'Next Step' : '继续深入'}>
            <div className="space-y-4">
              <p className="text-sm leading-6 text-secondary-text">{copy.unlockBody}</p>
              <div className="rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-2)]/45 px-4 py-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/6 text-foreground">
                    <LockKeyhole className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{copy.unlockPrimary}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-text">
                      {language === 'en'
                        ? 'Create an account to save reports, chats, watchlists, backtests, and portfolio data under your own name.'
                        : '创建账户后，完整报告、问股、观察名单、回测与持仓都会按你的身份保存。'}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Link
                    to={loginPath}
                    className="inline-flex min-h-[40px] items-center justify-center rounded-[var(--theme-button-radius)] border border-transparent bg-[var(--pill-active-bg)] px-4 text-[0.75rem] text-foreground transition-colors hover:border-[var(--border-strong)]"
                  >
                    {copy.signIn}
                  </Link>
                  <Link
                    to={registrationPath}
                    className="inline-flex min-h-[40px] items-center justify-center rounded-[var(--theme-button-radius)] border border-[var(--border-muted)] bg-[var(--pill-bg)] px-4 text-[0.75rem] text-secondary-text transition-colors hover:border-[var(--border-strong)] hover:text-foreground"
                  >
                    {copy.createAccount}
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
          title={language === 'en' ? 'Full Research Reports' : '完整研究报告'}
          body={language === 'en' ? 'Unlock full reports, supporting evidence, charts, and a detailed action plan.' : '登录后查看完整报告层级、证据链、图表与执行计划。'}
          lockedLabel={language === 'en' ? 'Locked' : '已锁定'}
          ctaLabel={copy.signIn}
          ctaTo={loginPath}
        />
        <LockedFeatureCard
          icon={MessageSquareText}
          title={language === 'en' ? 'Ask Stock Follow-up' : '问股追问'}
          body={language === 'en' ? 'Continue from a saved report into account-aware follow-up chat and session memory.' : '从已保存报告继续进入带会话记忆的问股追问。'}
          lockedLabel={language === 'en' ? 'Locked' : '已锁定'}
          ctaLabel={copy.signIn}
          ctaTo={loginPath}
        />
        <LockedFeatureCard
          icon={BriefcaseBusiness}
          title={language === 'en' ? 'Portfolio' : '持仓'}
          body={language === 'en' ? 'Connect trades, positions, cash events, and portfolio risk to your own account.' : '将交易、仓位、资金流水与风险分析绑定到你的个人账户。'}
          lockedLabel={language === 'en' ? 'Locked' : '已锁定'}
          ctaLabel={copy.signIn}
          ctaTo={loginPath}
        />
        <LockedFeatureCard
          icon={TestTubeDiagonal}
          title={language === 'en' ? 'Backtests' : '回测'}
          body={language === 'en' ? 'Run deterministic and rule backtests, then save the results to your own account.' : '运行确定性回测与规则回测，并将结果保存到你自己的账户中。'}
          lockedLabel={language === 'en' ? 'Locked' : '已锁定'}
          ctaLabel={copy.signIn}
          ctaTo={loginPath}
        />
        <LockedFeatureCard
          icon={History}
          title={language === 'en' ? 'Saved History and Reviews' : '历史与复盘'}
          body={language === 'en' ? 'Review your own analysis history, scanner runs, and follow-up decisions without mixing with other accounts.' : '查看你自己的分析历史、扫描记录与后续复盘，不会和其他账户混在一起。'}
          lockedLabel={language === 'en' ? 'Locked' : '已锁定'}
          ctaLabel={language === 'en' ? 'Preview scanner' : '查看扫描器预告'}
          ctaTo="/scanner"
        />
      </div>

      <Card title={language === 'en' ? 'Guest boundaries' : '游客边界'} subtitle={language === 'en' ? 'Guest access stays limited' : '安全边界保持后端优先'}>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-2)]/45 px-4 py-4 text-sm leading-6 text-secondary-text">
            {language === 'en'
              ? 'Guest previews do not create an account record and do not unlock saved cross-page features.'
              : '游客预览不会创建账户记录，也不会解锁跨页面保存的功能。'}
          </div>
          <div className="rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-2)]/45 px-4 py-4 text-sm leading-6 text-secondary-text">
            {language === 'en'
              ? 'Portfolio, scanner, backtest, chat, and saved history remain tied to a signed-in account.'
              : '持仓、扫描器、回测、问股与历史等持久化流程仍然严格绑定到已认证用户身份。'}
          </div>
          <div className="rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-2)]/45 px-4 py-4 text-sm leading-6 text-secondary-text">
            {language === 'en'
              ? 'System settings, schedules, notification channels, and admin logs remain outside guest pages.'
              : '系统配置、调度、通知通道与管理员日志仍然保留在游客页面之外。'}
          </div>
        </div>
      </Card>
    </div>
  );
};

export default GuestHomePage;
