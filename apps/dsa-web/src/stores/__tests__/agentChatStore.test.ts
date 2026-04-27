import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentChatStore } from '../agentChatStore';

vi.mock('../../api/agent', () => ({
  agentApi: {
    getChatSessions: vi.fn(async () => []),
    getChatSessionMessages: vi.fn(async () => []),
    chatStream: vi.fn(),
  },
}));

const { agentApi } = await import('../../api/agent');

const encoder = new TextEncoder();

function createStreamResponse(lines: string[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(lines.join('\n')));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    },
  );
}

describe('agentChatStore.startStream', () => {
  beforeEach(() => {
    localStorage.clear();
    useAgentChatStore.setState({
      messages: [],
      loading: false,
      progressSteps: [],
      sessionId: 'session-test',
      sessions: [],
      sessionsLoading: false,
      chatError: null,
      currentRoute: '/chat',
      completionBadge: false,
      hasInitialLoad: true,
      abortController: null,
    });
    vi.clearAllMocks();
  });

  it('appends the user message and final assistant message from the SSE stream', async () => {
    vi.mocked(agentApi.chatStream).mockResolvedValue(
      createStreamResponse([
        'data: {"type":"thinking","step":1,"message":"分析中"}',
        'data: {"type":"tool_done","tool":"quote","display_name":"行情","success":true,"duration":0.3}',
        'data: {"type":"done","success":true,"content":"最终分析结果"}',
      ]),
    );

    await useAgentChatStore
      .getState()
      .startStream({ message: '分析茅台', session_id: 'session-test' }, { skillName: '趋势技能' });

    const state = useAgentChatStore.getState();
    expect(state.loading).toBe(false);
    expect(state.chatError).toBeNull();
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({
      role: 'user',
      content: '分析茅台',
      skillName: '趋势技能',
    });
    expect(state.messages[1]).toMatchObject({
      role: 'assistant',
      content: '最终分析结果',
      skillName: '趋势技能',
    });
    expect(state.messages[1].thinkingSteps).toHaveLength(2);
    expect(state.progressSteps).toEqual([]);
  });

  it('converts Gemini 429 failures into a persisted-looking timeout fallback bubble', async () => {
    vi.mocked(agentApi.chatStream).mockResolvedValue(
      createStreamResponse([
        'data: {"type":"done","success":false,"error":"Gemini 429: rate limit exceeded"}',
      ]),
    );

    await useAgentChatStore
      .getState()
      .startStream({ message: '分析 TSLA', session_id: 'session-test' }, { skillName: '趋势技能' });

    const state = useAgentChatStore.getState();
    expect(state.loading).toBe(false);
    expect(state.chatError).toBeNull();
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]).toMatchObject({
      role: 'assistant',
      content: '当前响应超时，请稍后刷新',
    });
  });

  it('resets chat session state and clears the persisted chat session on logout', () => {
    const abort = vi.fn();
    localStorage.setItem('dsa_chat_session_id', 'session-old');
    useAgentChatStore.setState({
      messages: [{ id: 'm-1', role: 'user', content: '分析 AAPL' }],
      loading: true,
      progressSteps: [{ type: 'thinking', message: '分析中' }],
      sessionId: 'session-old',
      sessions: [
        {
          session_id: 'session-old',
          title: '分析 AAPL',
          message_count: 1,
          created_at: '2026-03-15T09:00:00Z',
          last_active: '2026-03-15T09:05:00Z',
        },
      ],
      sessionsLoading: true,
      sessionLoadError: null,
      chatError: null,
      currentRoute: '/chat',
      completionBadge: true,
      hasInitialLoad: true,
      abortController: { abort } as unknown as AbortController,
    });

    useAgentChatStore.getState().resetSessionState();

    const state = useAgentChatStore.getState();
    expect(abort).toHaveBeenCalled();
    expect(state.messages).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.progressSteps).toEqual([]);
    expect(state.sessions).toEqual([]);
    expect(state.sessionsLoading).toBe(false);
    expect(state.chatError).toBeNull();
    expect(state.completionBadge).toBe(false);
    expect(state.hasInitialLoad).toBe(false);
    expect(state.abortController).toBeNull();
    expect(localStorage.getItem('dsa_chat_session_id')).toBeNull();
    expect(state.sessionId).not.toBe('session-old');
  });

  it('stops the active stream without clearing the current draft conversation', () => {
    const abort = vi.fn();
    useAgentChatStore.setState({
      messages: [{ id: 'm-1', role: 'user', content: '分析 AAPL' }],
      loading: true,
      progressSteps: [{ type: 'thinking', message: '分析中' }],
      abortController: { abort } as unknown as AbortController,
    });

    useAgentChatStore.getState().stopStream();

    const state = useAgentChatStore.getState();
    expect(abort).toHaveBeenCalledTimes(1);
    expect(state.messages).toEqual([{ id: 'm-1', role: 'user', content: '分析 AAPL' }]);
    expect(state.loading).toBe(false);
    expect(state.progressSteps).toEqual([]);
    expect(state.abortController).toBeNull();
  });
});
