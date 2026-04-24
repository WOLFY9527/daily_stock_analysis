import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GuestHomePage from '../GuestHomePage';

const { previewMock, languageState, translationKeyCalls } = vi.hoisted(() => ({
  previewMock: vi.fn(),
  languageState: { value: 'zh' as 'zh' | 'en' },
  translationKeyCalls: [] as string[],
}));

const guestHomeMessages = {
  zh: {
    'guestHome.documentTitle': '游客预览 - WolfyStock',
    'guestHome.eyebrow': '游客预览',
    'guestHome.title': '游客预览模式',
    'guestHome.description': '先看一份简版分析，再决定是否登录继续。游客预览不会保存历史，也不会创建个人数据。',
    'guestHome.previewSubtitle': '受限价值',
    'guestHome.inputLabel': '输入标的',
    'guestHome.inputPlaceholder': '输入股票代码或名称，如 600519、贵州茅台、AAPL',
    'guestHome.submit': '生成简版判断',
    'guestHome.submitting': '生成中...',
    'guestHome.helper': '游客可以先查看一份简版分析；完整报告、后续交流、回测、持仓和历史记录需要登录后使用。',
    'guestHome.previewTitle': '即时分析预览',
    'guestHome.previewNote': '该结果仅用于游客预览，不写入历史记录，也不开放后续交流。',
    'guestHome.decisionSnapshot': '决策快照',
    'guestHome.unlockTitle': '登录后继续完整功能',
    'guestHome.unlockSubtitle': '继续深入',
    'guestHome.unlockBody': '登录后，你的分析结果、交流记录、持仓、回测和历史都会保存在你自己的账户下。',
    'guestHome.decision': '动作建议',
    'guestHome.trend': '趋势判断',
    'guestHome.score': '情绪分数',
    'guestHome.entry': '理想介入',
    'guestHome.stopLoss': '止损位',
    'guestHome.target': '目标位',
    'guestHome.noValue': '待生成',
    'guestHome.signIn': '登录解锁',
    'guestHome.createAccount': '创建账户',
    'guestHome.unlockPrimary': '登录后继续完整使用',
    'guestHome.unlockSecondary': '创建账户后，完整报告、问股、观察名单、回测与持仓都会按你的身份保存。',
    'guestHome.lockedLabel': '已锁定',
    'guestHome.cards.fullReports.title': '完整分析报告',
    'guestHome.cards.fullReports.body': '登录后查看完整报告层级、证据链、图表与执行计划。',
    'guestHome.cards.followUp.title': '后续交流',
    'guestHome.cards.followUp.body': '从已保存报告继续交流，并把会话记录保存在你自己的账户下。',
    'guestHome.cards.portfolio.title': '持仓',
    'guestHome.cards.portfolio.body': '将交易、仓位、资金流水与风险分析绑定到你的个人账户。',
    'guestHome.cards.backtests.title': '回测',
    'guestHome.cards.backtests.body': '运行确定性回测与规则回测，并将结果保存到你自己的账户中。',
    'guestHome.cards.history.title': '历史与复盘',
    'guestHome.cards.history.body': '查看你自己的分析历史、扫描记录与后续复盘，不会和其他账户混在一起。',
    'guestHome.cards.history.cta': '查看扫描器预告',
    'guestHome.limits.title': '游客限制',
    'guestHome.limits.subtitle': '游客权限保持受限',
    'guestHome.limits.accountIsolation': '游客预览不会创建账户记录，也不会解锁跨页面保存的功能。',
    'guestHome.limits.persistence': '持仓、扫描器、回测、问股与历史等持久化流程仍然严格绑定到已认证用户身份。',
    'guestHome.limits.admin': '系统配置、调度、通知通道与管理员日志仍然保留在游客页面之外。',
  },
  en: {
    'guestHome.documentTitle': 'Guest Preview - WolfyStock',
    'guestHome.eyebrow': 'Guest Preview',
    'guestHome.title': 'Guest Preview Mode',
    'guestHome.description': 'Start with a lightweight analysis snapshot, then sign in if you want to keep going. Guest previews are never saved to an account.',
    'guestHome.previewSubtitle': 'Limited Value',
    'guestHome.inputLabel': 'Enter a symbol',
    'guestHome.inputPlaceholder': 'Enter a stock code or company name, for example 600519, Kweichow Moutai, AAPL',
    'guestHome.submit': 'Generate snapshot',
    'guestHome.submitting': 'Generating...',
    'guestHome.helper': 'Guests can generate one lightweight analysis snapshot. Full reports, follow-up chat, backtests, portfolio tools, and saved history unlock after sign-in.',
    'guestHome.previewTitle': 'Instant Analysis Snapshot',
    'guestHome.previewNote': 'This preview is intentionally limited. It is not saved and does not unlock follow-up chat.',
    'guestHome.decisionSnapshot': 'Decision Snapshot',
    'guestHome.unlockTitle': 'Sign in for the full app',
    'guestHome.unlockSubtitle': 'Next Step',
    'guestHome.unlockBody': 'Once you sign in, your analysis, chat history, portfolio, backtests, and saved history stay attached to your own account.',
    'guestHome.decision': 'Action',
    'guestHome.trend': 'Trend',
    'guestHome.score': 'Sentiment',
    'guestHome.entry': 'Entry',
    'guestHome.stopLoss': 'Stop loss',
    'guestHome.target': 'Target',
    'guestHome.noValue': 'Waiting',
    'guestHome.signIn': 'Sign in',
    'guestHome.createAccount': 'Create account',
    'guestHome.unlockPrimary': 'Unlock saved reports, chat, portfolio, and backtests',
    'guestHome.unlockSecondary': 'Create an account to save reports, chats, watchlists, backtests, and portfolio data under your own name.',
    'guestHome.lockedLabel': 'Locked',
    'guestHome.cards.fullReports.title': 'Full Analysis Reports',
    'guestHome.cards.fullReports.body': 'Unlock full reports, supporting evidence, charts, and a detailed action plan.',
    'guestHome.cards.followUp.title': 'Follow-up Chat',
    'guestHome.cards.followUp.body': 'Continue from a saved report with follow-up chat and session memory under your own account.',
    'guestHome.cards.portfolio.title': 'Portfolio',
    'guestHome.cards.portfolio.body': 'Connect trades, positions, cash events, and portfolio risk to your own account.',
    'guestHome.cards.backtests.title': 'Backtests',
    'guestHome.cards.backtests.body': 'Run deterministic and rule backtests, then save the results to your own account.',
    'guestHome.cards.history.title': 'Saved History and Reviews',
    'guestHome.cards.history.body': 'Review your own analysis history, scanner runs, and follow-up decisions without mixing with other accounts.',
    'guestHome.cards.history.cta': 'Preview scanner',
    'guestHome.limits.title': 'Guest limits',
    'guestHome.limits.subtitle': 'Guest access stays limited',
    'guestHome.limits.accountIsolation': 'Guest previews do not create an account record and do not unlock saved cross-page features.',
    'guestHome.limits.persistence': 'Portfolio, scanner, backtest, chat, and saved history remain tied to a signed-in account.',
    'guestHome.limits.admin': 'System settings, schedules, notification channels, and admin logs remain outside guest pages.',
  },
};

vi.mock('../../api/publicAnalysis', () => ({
  publicAnalysisApi: {
    preview: (...args: unknown[]) => previewMock(...args),
  },
}));

vi.mock('../../contexts/UiLanguageContext', () => ({
  useI18n: () => ({
    language: languageState.value,
    t: (key: string) => {
      translationKeyCalls.push(key);
      return guestHomeMessages[languageState.value][key as keyof typeof guestHomeMessages.zh] ?? key;
    },
  }),
}));

vi.mock('../../components/StockAutocomplete', () => ({
  StockAutocomplete: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
  }) => (
    <input
      aria-label="guest-stock-input"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
    />
  ),
}));

describe('GuestHomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    languageState.value = 'zh';
    translationKeyCalls.length = 0;
    window.history.replaceState(window.history.state, '', '/zh');
  });

  it('renders simplified guest guidance and generates a guest preview snapshot', async () => {
    previewMock.mockResolvedValue({
      queryId: 'preview-q1',
      stockCode: 'AAPL',
      stockName: 'Apple',
      previewScope: 'guest',
      report: {
        meta: {
          queryId: 'preview-q1',
          stockCode: 'AAPL',
          stockName: 'Apple',
          reportType: 'brief',
          createdAt: '2026-04-14T10:00:00Z',
        },
        summary: {
          analysisSummary: '趋势延续但需要等待更好的介入点。',
          operationAdvice: '等待回踩',
          trendPrediction: '偏强震荡',
          sentimentScore: 72,
        },
        strategy: {
          idealBuy: '184-186',
          stopLoss: '179',
          takeProfit: '196',
        },
      },
    });

    render(
      <MemoryRouter>
        <GuestHomePage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('guest-home-bento-page')).toHaveAttribute('data-bento-surface', 'true');
    expect(screen.getByTestId('guest-home-bento-page')).toHaveClass('bento-surface-root');
    expect(screen.getByTestId('guest-home-bento-hero')).toBeInTheDocument();
    expect(screen.getByTestId('guest-home-bento-hero-unlock-value')).toHaveStyle({ textShadow: '0 0 30px rgba(52, 211, 153, 0.4)' });
    expect(screen.getByTestId('guest-home-preview-card')).toBeInTheDocument();
    expect(screen.getByText('完整分析报告')).toBeInTheDocument();
    expect(screen.getByText('后续交流')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '创建账户' })).toHaveAttribute('href', '/zh/login?mode=create&redirect=%2Fzh');

    fireEvent.change(screen.getByLabelText('guest-stock-input'), { target: { value: 'AAPL' } });
    fireEvent.click(screen.getByRole('button', { name: '生成简版判断' }));

    await waitFor(() => {
      expect(previewMock).toHaveBeenCalledWith({
        stockCode: 'AAPL',
        stockName: undefined,
        reportType: 'brief',
      });
    });

    expect(await screen.findByText('趋势延续但需要等待更好的介入点。')).toBeInTheDocument();
    expect(screen.getAllByText('等待回踩').length).toBeGreaterThan(0);
    expect(screen.getAllByText('偏强震荡').length).toBeGreaterThan(0);
    expect(screen.getByText('184-186')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('guest-home-bento-drawer-trigger'));
    expect(await screen.findByTestId('guest-home-bento-drawer')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '游客预览模式' })).toBeInTheDocument();
  });

  it('renders the English guest preview copy and feature unlock messaging', () => {
    languageState.value = 'en';
    window.history.replaceState(window.history.state, '', '/en');

    render(
      <MemoryRouter>
        <GuestHomePage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('guest-home-bento-page')).toBeInTheDocument();
    expect(screen.getByTestId('guest-home-bento-hero')).toBeInTheDocument();
    expect(screen.getAllByText('Guest Preview').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Guest Preview Mode' })).toBeInTheDocument();
    expect(screen.getByText('Start with a lightweight analysis snapshot, then sign in if you want to keep going. Guest previews are never saved to an account.')).toBeInTheDocument();
    expect(screen.getAllByText('Instant Analysis Snapshot').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Guests can generate one lightweight analysis snapshot. Full reports, follow-up chat, backtests, portfolio tools, and saved history unlock after sign-in.').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Create account' })).toHaveAttribute('href', '/en/login?mode=create&redirect=%2Fen');
    expect(screen.getAllByText('Sign in for the full app').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unlock saved reports, chat, portfolio, and backtests').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Guest limits').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Guest previews do not create an account record and do not unlock saved cross-page features.').length).toBeGreaterThan(0);
  });

  it('keeps static guest shell copy on the canonical guestHome namespace', () => {
    render(
      <MemoryRouter>
        <GuestHomePage />
      </MemoryRouter>,
    );

    expect(translationKeyCalls.length).toBeGreaterThan(0);
    expect([...new Set(translationKeyCalls)].every((key) => key.startsWith('guestHome.'))).toBe(true);
  });
});
