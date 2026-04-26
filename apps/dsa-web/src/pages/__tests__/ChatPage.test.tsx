import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { historyApi } from '../../api/history';
import { translate } from '../../i18n/core';
import type { Message, ProgressStep } from '../../stores/agentChatStore';
import { ShellRailHarness } from '../../test-utils/ShellRailHarness';
import ChatPage from '../ChatPage';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const mockLoadSessions = vi.fn();
const mockLoadInitialSession = vi.fn();
const mockSwitchSession = vi.fn();
const mockStartStream = vi.fn();
const mockClearCompletionBadge = vi.fn();
const mockStartNewChat = vi.fn();
let currentLanguage: 'zh' | 'en' = 'zh';

const mockStoreState: {
  messages: Message[];
  loading: boolean;
  progressSteps: ProgressStep[];
  sessionId: string;
  sessions: Array<{
    session_id: string;
    title: string;
    message_count: number;
    created_at: string;
    last_active: string;
  }>;
  sessionsLoading: boolean;
  sessionLoadError: null;
  chatError: null;
  loadSessions: typeof mockLoadSessions;
  loadInitialSession: typeof mockLoadInitialSession;
  switchSession: typeof mockSwitchSession;
  startStream: typeof mockStartStream;
  clearCompletionBadge: typeof mockClearCompletionBadge;
} = {
  messages: [],
  loading: false,
  progressSteps: [],
  sessionId: 'session-1',
  sessions: [
    {
      session_id: 'session-1',
      title: '请简要分析 600519',
      message_count: 2,
      created_at: '2026-03-15T09:00:00Z',
      last_active: '2026-03-15T09:05:00Z',
    },
  ],
  sessionsLoading: false,
  sessionLoadError: null,
  chatError: null,
  loadSessions: mockLoadSessions,
  loadInitialSession: mockLoadInitialSession,
  switchSession: mockSwitchSession,
  startStream: mockStartStream,
  clearCompletionBadge: mockClearCompletionBadge,
};

const canonicalBullTrendLabel = (language: 'zh' | 'en') => translate(language, 'chat.skills.labels.bull_trend');

vi.mock('../../api/agent', () => ({
  agentApi: {
    getSkills: vi.fn().mockResolvedValue({
      skills: [
        { id: 'bull_trend', name: '趋势分析', description: '测试技能' },
      ],
      default_skill_id: 'bull_trend',
    }),
    deleteChatSession: vi.fn().mockResolvedValue(undefined),
    sendChat: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock('../../api/history', () => ({
  historyApi: {
    getDetail: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../stores/agentChatStore', () => {
  const useAgentChatStore = (
    selector?: (state: typeof mockStoreState) => unknown
  ) => (typeof selector === 'function' ? selector(mockStoreState) : mockStoreState);

  useAgentChatStore.getState = () => ({
    startNewChat: mockStartNewChat,
  });

  return { useAgentChatStore };
});

vi.mock('../../contexts/UiLanguageContext', async () => {
  const actual = await vi.importActual<typeof import('../../i18n/core')>('../../i18n/core');
  return {
    useI18n: () => ({
      language: currentLanguage,
      t: (key: string, vars?: Record<string, string | number | undefined>) => actual.translate(currentLanguage, key, vars),
      setLanguage: vi.fn(),
      toggleLanguage: vi.fn(),
    }),
  };
});

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  Object.defineProperty(window, 'requestAnimationFrame', {
    writable: true,
    value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0),
  });

  Object.defineProperty(window, 'cancelAnimationFrame', {
    writable: true,
    value: (handle: number) => window.clearTimeout(handle),
  });

  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    writable: true,
    value: vi.fn(),
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  currentLanguage = 'zh';
  mockStoreState.messages = [];
  mockStoreState.loading = false;
  mockStoreState.progressSteps = [];
  mockStoreState.sessionId = 'session-1';
  mockStoreState.sessions = [
    {
      session_id: 'session-1',
      title: '请简要分析 600519',
      message_count: 2,
      created_at: '2026-03-15T09:00:00Z',
      last_active: '2026-03-15T09:05:00Z',
    },
  ];
  mockStoreState.sessionsLoading = false;
  mockStoreState.sessionLoadError = null;
  mockStoreState.chatError = null;
});

describe('ChatPage', () => {
  it('renders a locked-height chat shell with a dedicated message viewport and docked composer', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/chat']}>
        <ShellRailHarness>
          <ChatPage />
        </ShellRailHarness>
      </MemoryRouter>
    );

    expect(await screen.findByTestId('chat-bento-page')).toHaveAttribute('data-bento-surface', 'true');
    expect(screen.getByTestId('chat-bento-page')).toHaveClass('bento-surface-root');
    expect(screen.getByTestId('chat-bento-page')).toHaveClass('flex', 'flex-col', 'bg-black', 'workspace-page--chat');
    expect(screen.getByTestId('chat-bento-page')).not.toHaveClass('h-full', 'min-h-full', 'overflow-hidden');
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(await screen.findByTestId('chat-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('chat-workspace')).toHaveClass('relative', 'h-[calc(100vh-80px)]', 'w-full', 'flex', 'flex-col', 'overflow-hidden', 'bg-transparent');
    expect(screen.getByTestId('chat-status-strip')).toHaveClass('rounded-full', 'border-white/10', 'bg-black/45', 'backdrop-blur-2xl');
    expect(screen.getByTestId('chat-main').tagName).toBe('MAIN');
    expect(screen.getByTestId('chat-main')).toHaveClass('flex-1', 'overflow-y-auto', 'no-scrollbar', 'w-full', 'flex', 'flex-col', 'items-center');
    expect(screen.queryByTestId('chat-status-sidebar')).not.toBeInTheDocument();
    expect((await screen.findAllByTestId('chat-bento-hero-skill')).length).toBeGreaterThan(0);
    const skillValues = await screen.findAllByTestId('chat-bento-hero-skill-value');
    expect(skillValues[0]).toHaveTextContent(canonicalBullTrendLabel('zh'));
    expect(screen.getByTestId('chat-session-list-scroll')).toBeInTheDocument();
    expect(screen.getByTestId('chat-message-stream')).toHaveClass('h-full', 'w-full', 'max-w-5xl', 'flex-col', 'px-4', 'pt-12', 'pb-48');
    expect(screen.getByTestId('chat-input-shell')).toHaveClass('absolute', 'bottom-0', 'left-0', 'w-full', 'bg-gradient-to-t', 'from-[#050505]', 'via-[#050505]/90', 'to-transparent');
    expect(screen.getByTestId('chat-skill-toolbar')).toHaveClass('flex', 'items-center', 'gap-3', 'overflow-x-auto', 'no-scrollbar');
    expect(screen.getByTestId('chat-composer-omnibar')).toHaveClass(
      'relative',
      'rounded-[24px]',
      'border-white/10',
      'bg-white/[0.03]',
      'backdrop-blur-2xl',
      'focus-within:border-white/30',
    );
    expect(mockLoadInitialSession).toHaveBeenCalled();
    expect(mockClearCompletionBadge).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('chat-bento-drawer-trigger'));
    expect(await screen.findByTestId('chat-bento-drawer')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: translate('zh', 'chat.title') })).toBeInTheDocument();
  });

  it('keeps the empty state anchored instead of auto-scrolling to the footer on first paint', async () => {
    render(
      <MemoryRouter initialEntries={['/chat']}>
        <ShellRailHarness>
          <ChatPage />
        </ShellRailHarness>
      </MemoryRouter>
    );

    expect(await screen.findByText(translate('zh', 'chat.emptyTitle'))).toBeInTheDocument();
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('shows research-focused starter cards in the empty state', async () => {
    render(
      <MemoryRouter initialEntries={['/chat']}>
        <ShellRailHarness>
          <ChatPage />
        </ShellRailHarness>
      </MemoryRouter>
    );

    expect(await screen.findByText(translate('zh', 'chat.emptyTitle'))).toBeInTheDocument();
    expect(screen.getByTestId('chat-empty-state')).toHaveClass('min-h-full', 'items-center', 'justify-center');
    const entryDecisionCard = screen.getByTestId('chat-starter-card-entryDecision');
    expect(entryDecisionCard).toHaveClass('rounded-[28px]', 'border-white/8', 'bg-white/[0.03]', 'hover:bg-white/[0.05]', 'backdrop-blur-2xl');
    expect(screen.getByText(translate('zh', 'chat.starterCards.entryDecision.title'))).toBeInTheDocument();
    expect(screen.getByText(translate('zh', 'chat.starterCards.positionReview.title'))).toBeInTheDocument();
    expect(screen.getByText(translate('zh', 'chat.starterCards.eventFollowUp.title'))).toBeInTheDocument();
    expect(screen.getByText(translate('zh', 'chat.emptyBody'))).toBeInTheDocument();
  });

  it('animates only a newly appended latest assistant reply with the typewriter effect', async () => {
    vi.useFakeTimers();
    mockStoreState.messages = [
      {
        id: 'assistant-history',
        role: 'assistant',
        content: '历史回复保持完整显示',
        skillName: canonicalBullTrendLabel('zh'),
      },
    ];

    const view = render(
      <MemoryRouter initialEntries={['/chat']}>
        <ShellRailHarness>
          <ChatPage />
        </ShellRailHarness>
      </MemoryRouter>
    );

    expect(screen.getByTestId('chat-main').textContent).toContain('历史回复保持完整显示');
    expect(screen.queryByTestId('chat-typewriter-assistant-history')).not.toBeInTheDocument();

    mockStoreState.messages = [
      ...mockStoreState.messages,
      {
        id: 'assistant-latest',
        role: 'assistant',
        content: '最新回复正在涌现',
        skillName: canonicalBullTrendLabel('zh'),
      },
    ];

    await act(async () => {
      view.rerender(
        <MemoryRouter initialEntries={['/chat']}>
          <ShellRailHarness>
            <ChatPage />
          </ShellRailHarness>
        </MemoryRouter>
      );
    });

    const streamingNode = screen.getByTestId('chat-typewriter-assistant-latest');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(90);
    });

    expect(streamingNode.textContent?.length ?? 0).toBeGreaterThan(0);
    expect(streamingNode.textContent?.length ?? 0).toBeLessThan('最新回复正在涌现'.length);
    expect(screen.getByTestId('chat-main').textContent).toContain('历史回复保持完整显示');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(streamingNode).toHaveTextContent('最新回复正在涌现');
    vi.useRealTimers();
  });

  it('switches session when clicking anywhere on the session card', async () => {
    render(
      <MemoryRouter initialEntries={['/chat']}>
        <ShellRailHarness>
          <ChatPage />
        </ShellRailHarness>
      </MemoryRouter>
    );

    const sessionCard = await screen.findByRole('button', {
      name: translate('zh', 'chat.switchToConversation', { title: '请简要分析 600519' }),
    });

    fireEvent.click(sessionCard);
    expect(mockSwitchSession).toHaveBeenCalledWith('session-1');
  });

  it('allows sending with base follow-up context before report hydration completes', async () => {
    const deferred = createDeferred<Awaited<ReturnType<typeof historyApi.getDetail>>>();

    vi.mocked(historyApi.getDetail).mockImplementation(() => deferred.promise);

    render(
      <MemoryRouter initialEntries={['/chat?stock=600519&name=%E8%B4%B5%E5%B7%9E%E8%8C%85%E5%8F%B0&recordId=1']}>
        <ShellRailHarness>
          <ChatPage />
        </ShellRailHarness>
      </MemoryRouter>
    );

    expect(await screen.findByDisplayValue('请深入分析 贵州茅台(600519)')).toBeInTheDocument();

    const sendButton = screen.getByRole('button', {
      name: new RegExp(`${translate('zh', 'chat.notifyAction')}|${translate('zh', 'chat.notifySending').replace(/\./g, '\\.')}`),
    });
    expect(sendButton).not.toBeDisabled();
    expect(screen.getByText(translate('zh', 'chat.followUpContextLoading'))).toBeInTheDocument();

    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockStartStream).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '请深入分析 贵州茅台(600519)',
          context: {
            stock_code: '600519',
            stock_name: '贵州茅台',
          },
          skills: ['bull_trend'],
        }),
        expect.objectContaining({
          skillName: canonicalBullTrendLabel('zh'),
        }),
      );
    });

    deferred.resolve({
      meta: {
        id: 1,
        queryId: 'q-1',
        stockCode: '600519',
        stockName: '贵州茅台',
        reportType: 'detailed',
        createdAt: '2026-03-18T08:00:00Z',
        currentPrice: 1523.6,
        changePct: 1.8,
      },
      summary: {
        analysisSummary: '趋势延续',
        operationAdvice: '继续观察',
        trendPrediction: '高位震荡',
        sentimentScore: 78,
      },
      strategy: {
        stopLoss: '1450',
      },
    });

    await waitFor(() => {
      expect(screen.queryByText(translate('zh', 'chat.followUpContextLoading'))).not.toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(translate('zh', 'chat.inputPlaceholder')), {
      target: { value: '继续分析成交量' },
    });
    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'chat.notifyAction') }));

    await waitFor(() => {
      expect(mockStartStream).toHaveBeenLastCalledWith(
        expect.objectContaining({
          message: '继续分析成交量',
          context: undefined,
        }),
        expect.objectContaining({
          skillName: canonicalBullTrendLabel('zh'),
        }),
      );
    });
  });

  it('uses hydrated report context when it finishes before sending', async () => {
    vi.mocked(historyApi.getDetail).mockResolvedValue({
      meta: {
        id: 1,
        queryId: 'q-1',
        stockCode: '600519',
        stockName: '贵州茅台',
        reportType: 'detailed',
        createdAt: '2026-03-18T08:00:00Z',
        currentPrice: 1523.6,
        changePct: 1.8,
      },
      summary: {
        analysisSummary: '趋势延续',
        operationAdvice: '继续观察',
        trendPrediction: '高位震荡',
        sentimentScore: 78,
      },
      strategy: {
        stopLoss: '1450',
      },
    });

    render(
      <MemoryRouter initialEntries={['/chat?stock=600519&name=%E8%B4%B5%E5%B7%9E%E8%8C%85%E5%8F%B0&recordId=1']}>
        <ShellRailHarness>
          <ChatPage />
        </ShellRailHarness>
      </MemoryRouter>
    );

    expect(await screen.findByDisplayValue('请深入分析 贵州茅台(600519)')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText(translate('zh', 'chat.followUpContextLoading'))).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'chat.notifyAction') }));

    await waitFor(() => {
      expect(mockStartStream).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '请深入分析 贵州茅台(600519)',
          context: expect.objectContaining({
            stock_code: '600519',
            stock_name: '贵州茅台',
            previous_price: 1523.6,
            previous_change_pct: 1.8,
            previous_strategy: expect.objectContaining({
              stopLoss: '1450',
            }),
          }),
        }),
        expect.objectContaining({
          skillName: canonicalBullTrendLabel('zh'),
        }),
      );
    });
  });

  it('falls back to base stock context when recordId is missing', async () => {
    render(
      <MemoryRouter initialEntries={['/chat?stock=AAPL']}>
        <ShellRailHarness>
          <ChatPage />
        </ShellRailHarness>
      </MemoryRouter>
    );

    expect(await screen.findByDisplayValue('请深入分析 AAPL')).toBeInTheDocument();
    await screen.findByRole('button', { name: canonicalBullTrendLabel('zh') });

    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'chat.notifyAction') }));

    await waitFor(() => {
      expect(mockStartStream).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '请深入分析 AAPL',
          context: {
            stock_code: 'AAPL',
            stock_name: null,
          },
        }),
        expect.objectContaining({
          skillName: canonicalBullTrendLabel('zh'),
        }),
      );
    });
    expect(historyApi.getDetail).not.toHaveBeenCalled();
  });

  it('reprocesses follow-up query params when navigating to the same chat route again', async () => {
    const firstDeferred = createDeferred<Awaited<ReturnType<typeof historyApi.getDetail>>>();
    const secondDeferred = createDeferred<Awaited<ReturnType<typeof historyApi.getDetail>>>();

    vi.mocked(historyApi.getDetail)
      .mockImplementationOnce(() => firstDeferred.promise)
      .mockImplementationOnce(() => secondDeferred.promise);

    const router = createMemoryRouter(
      [{ path: '/chat', element: <ShellRailHarness><ChatPage /></ShellRailHarness> }],
      {
        initialEntries: ['/chat?stock=600519&name=%E8%B4%B5%E5%B7%9E%E8%8C%85%E5%8F%B0&recordId=1'],
      },
    );

    render(<RouterProvider router={router} />);

    expect(await screen.findByDisplayValue('请深入分析 贵州茅台(600519)')).toBeInTheDocument();
    expect(screen.getByText(translate('zh', 'chat.followUpContextLoading'))).toBeInTheDocument();

    await router.navigate('/chat?stock=AAPL&name=Apple&recordId=2');

    expect(await screen.findByDisplayValue('请深入分析 Apple(AAPL)')).toBeInTheDocument();

    firstDeferred.resolve({
      meta: {
        id: 1,
        queryId: 'q-1',
        stockCode: '600519',
        stockName: '贵州茅台',
        reportType: 'detailed',
        createdAt: '2026-03-18T08:00:00Z',
        currentPrice: 1523.6,
        changePct: 1.8,
      },
      summary: {
        analysisSummary: '趋势延续',
        operationAdvice: '继续观察',
        trendPrediction: '高位震荡',
        sentimentScore: 78,
      },
      strategy: {
        stopLoss: '1450',
      },
    });

    secondDeferred.resolve({
      meta: {
        id: 2,
        queryId: 'q-2',
        stockCode: 'AAPL',
        stockName: 'Apple',
        reportType: 'detailed',
        createdAt: '2026-03-18T09:00:00Z',
        currentPrice: 211.5,
        changePct: 2.4,
      },
      summary: {
        analysisSummary: '趋势走强',
        operationAdvice: '继续持有',
        trendPrediction: '短线偏强',
        sentimentScore: 81,
      },
      strategy: {
        stopLoss: '205',
      },
    });

    await waitFor(() => {
      expect(screen.queryByText(translate('zh', 'chat.followUpContextLoading'))).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'chat.notifyAction') }));

    await waitFor(() => {
      expect(mockStartStream).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '请深入分析 Apple(AAPL)',
          context: expect.objectContaining({
            stock_code: 'AAPL',
            stock_name: 'Apple',
            previous_price: 211.5,
            previous_change_pct: 2.4,
            previous_strategy: expect.objectContaining({
              stopLoss: '205',
            }),
          }),
        }),
        expect.objectContaining({
          skillName: canonicalBullTrendLabel('zh'),
        }),
      );
    });
  });

  it('updates document title when language is english', async () => {
    currentLanguage = 'en';
    render(
      <MemoryRouter initialEntries={['/chat']}>
        <ShellRailHarness>
          <ChatPage />
        </ShellRailHarness>
      </MemoryRouter>
    );

    expect(await screen.findByTestId('chat-workspace')).toBeInTheDocument();
    expect(document.title).toBe('Ask Stock - WolfyStock');
  });

  it('updates hero and input copy immediately when language switches to english', async () => {
    currentLanguage = 'en';
    render(
      <MemoryRouter initialEntries={['/chat']}>
        <ShellRailHarness>
          <ChatPage />
        </ShellRailHarness>
      </MemoryRouter>
    );

    expect(await screen.findByTestId('chat-workspace')).toBeInTheDocument();
    expect(screen.getByText('Start with a concrete question')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Example: Is 600519 / Kweichow Moutai a buy right now? (Enter to send, Shift+Enter for newline)')).toBeInTheDocument();
  });

  it('localizes session actions in english mode', async () => {
    currentLanguage = 'en';
    render(
      <MemoryRouter initialEntries={['/chat']}>
        <ShellRailHarness>
          <ChatPage />
        </ShellRailHarness>
      </MemoryRouter>
    );

    expect(await screen.findByText(translate('en', 'chat.historyTitle'))).toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: translate('en', 'chat.switchToConversation', { title: '请简要分析 600519' }),
    })).toBeInTheDocument();
    expect(screen.getByTitle(translate('en', 'chat.deleteConversationAction'))).toBeInTheDocument();
    expect(screen.getByText(translate('en', 'chat.messageCount', { count: 2 }))).toBeInTheDocument();
  });

  it('localizes assistant thinking labels in english mode', async () => {
    currentLanguage = 'en';
    mockStoreState.messages = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Here is the analysis.',
        skillName: canonicalBullTrendLabel('zh'),
        thinkingSteps: [
          { type: 'thinking', step: 1, message: 'Reviewing the setup' },
          { type: 'tool_done', tool: 'quote_fetch', display_name: 'Quote fetch', duration: 1.2, success: true },
        ],
      },
    ];

    render(
      <MemoryRouter initialEntries={['/chat']}>
        <ShellRailHarness>
          <ChatPage />
        </ShellRailHarness>
      </MemoryRouter>
    );

    expect(await screen.findByRole('button', { name: /Thinking process/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Thinking process/i }));

    expect(screen.getByText('Reviewing the setup')).toBeInTheDocument();
    expect(screen.getByText('Quote fetch (1.2s)')).toBeInTheDocument();
  });
});
