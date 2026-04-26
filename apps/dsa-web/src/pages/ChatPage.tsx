import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ArrowUp, Download, PanelRightOpen, SendHorizontal } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { agentApi } from '../api/agent';
import { ApiErrorAlert, ConfirmDialog, ScrollArea, TypewriterText } from '../components/common';
import {
  CARD_BUTTON_CLASS,
  PageBriefDrawer,
  type BentoHeroItem,
} from '../components/home-bento';
import { getParsedApiError, type ParsedApiError } from '../api/error';
import type { SkillInfo } from '../api/agent';
import {
  useAgentChatStore,
  type Message,
  type ProgressStep,
} from '../stores/agentChatStore';
import { downloadSession, formatSessionAsMarkdown } from '../utils/chatExport';
import type { ChatFollowUpContext } from '../utils/chatFollowUp';
import { buildFollowUpPrompt, resolveChatFollowUpContext } from '../utils/chatFollowUp';
import { isNearBottom } from '../utils/chatScroll';
import { useShellRail } from '../components/layout/ShellRailContext';
import { useShellRailSlot } from '../components/layout/useShellRailSlot';
import { useI18n } from '../contexts/UiLanguageContext';
import { translate } from '../i18n/core';

const assistantMarkdownComponents = {
  h1: ({ children }: React.PropsWithChildren) => <h1 className="mb-3 mt-5 text-lg font-semibold text-white">{children}</h1>,
  h2: ({ children }: React.PropsWithChildren) => <h2 className="mb-2 mt-4 text-base font-semibold text-white">{children}</h2>,
  h3: ({ children }: React.PropsWithChildren) => <h3 className="mb-2 mt-4 text-sm font-semibold text-white">{children}</h3>,
  p: ({ children }: React.PropsWithChildren) => <p className="mb-3 leading-relaxed last:mb-0">{children}</p>,
  ul: ({ children }: React.PropsWithChildren) => <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }: React.PropsWithChildren) => <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
  li: ({ children }: React.PropsWithChildren) => <li className="break-words leading-relaxed">{children}</li>,
  strong: ({ children }: React.PropsWithChildren) => <strong className="font-semibold text-white">{children}</strong>,
  a: ({ children, href }: React.PropsWithChildren<{ href?: string }>) => (
    <a className="text-[hsl(var(--accent-primary-hsl))] underline-offset-2 hover:underline" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  blockquote: ({ children }: React.PropsWithChildren) => (
    <blockquote className="my-3 text-white/72 first:mt-0 last:mb-0">{children}</blockquote>
  ),
  code: ({ children, className }: React.PropsWithChildren<{ className?: string }>) => {
    if (className) {
      return <code className={className}>{children}</code>;
    }
    return (
      <code className="rounded bg-white/[0.08] px-1.5 py-0.5 text-xs text-[hsl(var(--accent-primary-hsl))] break-all">
        {children}
      </code>
    );
  },
  pre: ({ children }: React.PropsWithChildren) => (
    <pre className="mb-3 overflow-x-auto rounded-xl border border-white/8 bg-black/30 p-3 text-xs leading-6 text-white/88 last:mb-0">
      {children}
    </pre>
  ),
  table: ({ children }: React.PropsWithChildren) => (
    <div className="mb-3 overflow-x-auto last:mb-0">
      <table className="w-full min-w-max border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }: React.PropsWithChildren) => <th className="border border-white/10 bg-white/[0.05] px-3 py-1.5 text-left font-medium text-white">{children}</th>,
  td: ({ children }: React.PropsWithChildren) => <td className="border border-white/10 px-3 py-1.5 align-top">{children}</td>,
  hr: () => <hr className="my-4 border-white/10" />,
} satisfies React.ComponentProps<typeof Markdown>['components'];

type StarterPromptCard = {
  id: string;
  skill: string;
};

type QuickQuestion = {
  id: string;
  skill: string;
};

const STARTER_PROMPT_CARDS: StarterPromptCard[] = [
  { id: 'entryDecision', skill: 'bull_trend' },
  { id: 'positionReview', skill: 'bull_trend' },
  { id: 'eventFollowUp', skill: 'bull_trend' },
];

const QUICK_QUESTIONS: QuickQuestion[] = [
  { id: 'q1', skill: 'chan_theory' },
  { id: 'q2', skill: 'wave_theory' },
  { id: 'q3', skill: 'bull_trend' },
  { id: 'q4', skill: 'box_oscillation' },
  { id: 'q5', skill: 'bull_trend' },
  { id: 'q6', skill: 'emotion_cycle' },
];

const CANONICAL_SKILL_IDS = [
  'bull_trend',
  'ma_cross',
  'volume_breakout',
  'volume_pullback',
  'box_oscillation',
  'bottom_rebound',
  'chan_theory',
  'wave_theory',
  'leader_strategy',
  'emotion_cycle',
  'one_rise_three_fall',
] as const;

const CANONICAL_SKILL_ID_SET = new Set<string>(CANONICAL_SKILL_IDS);

const SKILL_TEXT_ALIAS_TO_ID: Record<string, string> = CANONICAL_SKILL_IDS.reduce(
  (acc, skillId) => {
    acc[translate('zh', `chat.skills.labels.${skillId}`)] = skillId;
    acc[translate('en', `chat.skills.labels.${skillId}`)] = skillId;
    return acc;
  },
  {} as Record<string, string>,
);

function getLocalizedSkillLabel(rawLabel: string, t: (key: string, vars?: Record<string, string | number | undefined>) => string): string {
  const matchedSkillId = SKILL_TEXT_ALIAS_TO_ID[rawLabel];
  if (matchedSkillId) {
    return t(`chat.skills.labels.${matchedSkillId}`);
  }
  return rawLabel;
}

function getLocalizedSkillNameById(
  skillId: string,
  fallbackName: string,
  t: (key: string, vars?: Record<string, string | number | undefined>) => string,
): string {
  if (CANONICAL_SKILL_ID_SET.has(skillId)) return t(`chat.skills.labels.${skillId}`);
  return getLocalizedSkillLabel(fallbackName, t);
}

const ChatPage: React.FC = () => {
  const { language, t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [input, setInput] = useState('');
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<string>('');
  const [showSkillDesc, setShowSkillDesc] = useState<string | null>(null);
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set());
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [isFollowUpContextLoading, setIsFollowUpContextLoading] = useState(false);
  const [sendToast, setSendToast] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [skillsLoadError, setSkillsLoadError] = useState<ParsedApiError | null>(null);
  const [isBriefDrawerOpen, setIsBriefDrawerOpen] = useState(false);
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const isMountedRef = useRef(true);
  const followUpHydrationTokenRef = useRef(0);
  const followUpContextRef = useRef<ChatFollowUpContext | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const pendingScrollBehaviorRef = useRef<ScrollBehavior>('auto');
  const seenAssistantMessageIdsRef = useRef<Set<string>>(new Set());
  const hasHydratedAssistantMessagesRef = useRef(false);
  const { closeMobileRail } = useShellRail();
  const chat = useCallback(
    (key: string, vars?: Record<string, string | number | undefined>) => t(`chat.${key}`, vars),
    [t],
  );

  // Set page title
  useEffect(() => {
    document.title = chat('documentTitle');
  }, [chat]);

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  const {
    messages,
    loading,
    progressSteps,
    sessionId,
    sessions,
    sessionsLoading,
    sessionLoadError,
    chatError,
    loadSessions,
    loadInitialSession,
    switchSession,
    startStream,
    clearCompletionBadge,
  } = useAgentChatStore();

  const syncScrollState = useCallback(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;

    shouldStickToBottomRef.current = isNearBottom({
      scrollTop: viewport.scrollTop,
      clientHeight: viewport.clientHeight,
      scrollHeight: viewport.scrollHeight,
    });
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  const requestScrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    shouldStickToBottomRef.current = true;
    pendingScrollBehaviorRef.current = behavior;
  }, []);

  const handleMessagesScroll = useCallback(() => {
    syncScrollState();
  }, [syncScrollState]);

  useEffect(() => {
    syncScrollState();
  }, [syncScrollState, sessionId]);

  useEffect(() => {
    const behavior = pendingScrollBehaviorRef.current;
    const shouldAutoScroll = shouldStickToBottomRef.current;
    const hasRenderableChatContent = messages.length > 0 || progressSteps.length > 0 || loading;
    if (!shouldAutoScroll || !hasRenderableChatContent) return;

    const frame = window.requestAnimationFrame(() => {
      scrollToBottom(behavior);
      pendingScrollBehaviorRef.current = loading ? 'auto' : 'smooth';
    });

    return () => window.cancelAnimationFrame(frame);
  }, [messages, progressSteps, loading, sessionId, scrollToBottom]);

  useEffect(() => {
    if (!loading) {
      pendingScrollBehaviorRef.current = 'smooth';
    }
  }, [loading]);

  useEffect(() => {
    clearCompletionBadge();
  }, [clearCompletionBadge]);

  useEffect(() => {
    loadInitialSession();
  }, [loadInitialSession]);

  const loadSkills = useCallback(async () => {
    try {
      setSkillsLoadError(null);
      const res = await agentApi.getSkills();
      setSkills(res.skills);
      const defaultId =
        res.default_skill_id ||
        res.skills[0]?.id ||
        '';
      setSelectedSkill(defaultId);
    } catch (error: unknown) {
      setSkillsLoadError(getParsedApiError(error));
      setSkills([]);
      setSelectedSkill('');
    }
  }, []);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const availableSkillIds = new Set(skills.map((skill) => skill.id));
  const selectedSkillLabel = selectedSkill
    ? getLocalizedSkillNameById(
      selectedSkill,
      skills.find((skill) => skill.id === selectedSkill)?.name || selectedSkill,
      t,
    )
    : chat('skills.general');
  const starterPromptCards = STARTER_PROMPT_CARDS.filter(
    (card) => availableSkillIds.size === 0 || availableSkillIds.has(card.skill),
  );
  const quickQuestions = QUICK_QUESTIONS.filter(
    (question) => availableSkillIds.size === 0 || availableSkillIds.has(question.skill),
  );
  const engineSwitcherLabel = language === 'en' ? 'Current engine' : '当前分析引擎';
  const composerDisclaimer = language === 'en'
    ? 'AI insights are for reference only and are not investment advice. Confirm your risk tolerance before trading.'
    : 'AI 洞察仅供参考，不构成实质性投资建议。执行交易前请确认风险承受能力。';

  const handleStartNewChat = useCallback(() => {
    followUpContextRef.current = null;
    requestScrollToBottom('auto');
    useAgentChatStore.getState().startNewChat();
    closeMobileRail();
  }, [closeMobileRail, requestScrollToBottom]);

  const handleSwitchSession = useCallback((targetSessionId: string) => {
    requestScrollToBottom('auto');
    switchSession(targetSessionId);
    closeMobileRail();
  }, [closeMobileRail, requestScrollToBottom, switchSession]);

  const confirmDelete = useCallback(() => {
    if (!deleteConfirmId) return;
    agentApi.deleteChatSession(deleteConfirmId).then(() => {
      loadSessions();
      if (deleteConfirmId === sessionId) {
        handleStartNewChat();
      }
    }).catch(() => {});
    setDeleteConfirmId(null);
  }, [deleteConfirmId, sessionId, loadSessions, handleStartNewChat]);

  // Handle follow-up from report page: ?stock=600519&name=贵州茅台&recordId=xxx
  useEffect(() => {
    const stock = searchParams.get('stock');
    const name = searchParams.get('name');
    const recordId = searchParams.get('recordId');
    if (!stock) {
      return;
    }

    const hydrationToken = ++followUpHydrationTokenRef.current;
    setInput(buildFollowUpPrompt(stock, name));
    followUpContextRef.current = {
      stock_code: stock,
      stock_name: name,
    };
    if (recordId) {
      setIsFollowUpContextLoading(true);
    }
    void resolveChatFollowUpContext({
      stockCode: stock,
      stockName: name,
      recordId: recordId ? Number(recordId) : undefined,
    }).then((context) => {
      if (!isMountedRef.current || followUpHydrationTokenRef.current !== hydrationToken) {
        return;
      }
      followUpContextRef.current = context;
    }).finally(() => {
      if (isMountedRef.current && followUpHydrationTokenRef.current === hydrationToken) {
        setIsFollowUpContextLoading(false);
      }
    });
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleSend = useCallback(
    async (overrideMessage?: string, overrideSkill?: string) => {
      const msgText = overrideMessage || input.trim();
      if (!msgText || loading) return;
      const usedSkill = overrideSkill || selectedSkill;
      const skill = skills.find((s) => s.id === usedSkill);
      const usedSkillName = skill
        ? getLocalizedSkillNameById(skill.id, skill.name, t)
        : (usedSkill ? getLocalizedSkillLabel(usedSkill, t) : chat('skills.general'));

      const payload = {
        message: msgText,
        session_id: sessionId,
        skills: usedSkill ? [usedSkill] : undefined,
        context: followUpContextRef.current ?? undefined,
      };
      followUpHydrationTokenRef.current += 1;
      followUpContextRef.current = null;
      setIsFollowUpContextLoading(false);

      setInput('');
      requestScrollToBottom('smooth');
      await startStream(payload, { skillName: usedSkillName });
    },
    [chat, input, loading, requestScrollToBottom, selectedSkill, skills, sessionId, startStream, t],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickQuestion = (q: QuickQuestion) => {
    setSelectedSkill(q.skill);
    handleSend(chat(`quickQuestions.${q.id}`), q.skill);
  };

  const toggleThinking = (msgId: string) => {
    setExpandedThinking((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  };

  const getCurrentStage = (steps: ProgressStep[]): string => {
    if (steps.length === 0) return chat('stage.connecting');
    const last = steps[steps.length - 1];
    if (last.type === 'thinking') return last.message || chat('stage.thinking');
    if (last.type === 'tool_start')
      return chat('stage.toolRunning', { tool: last.display_name || last.tool });
    if (last.type === 'tool_done')
      return chat('stage.toolDone', { tool: last.display_name || last.tool });
    if (last.type === 'generating')
      return last.message || chat('stage.generating');
    return chat('stage.processing');
  };

  const renderThinkingBlock = (msg: Message) => {
    if (!msg.thinkingSteps || msg.thinkingSteps.length === 0) return null;
    const isExpanded = expandedThinking.has(msg.id);
    const toolSteps = msg.thinkingSteps.filter((s) => s.type === 'tool_done');
    const totalDuration = toolSteps.reduce(
      (sum, s) => sum + (s.duration || 0),
      0,
    );
    const summary = chat('thinking.summary', { count: toolSteps.length, duration: totalDuration.toFixed(1) });

    return (
      <button
        type="button"
        aria-label={chat('thinking.toggleLabel')}
        onClick={() => toggleThinking(msg.id)}
        className="flex items-center gap-2 text-xs text-muted-text hover:text-secondary-text transition-colors mb-2 w-full text-left"
      >
        <svg
          className={`w-3 h-3 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
        <span className="flex items-center gap-1.5">
          <span className="opacity-60">{chat('thinking.toggleLabel')}</span>
          <span className="text-muted-text/50">·</span>
          <span className="opacity-50">{summary}</span>
        </span>
      </button>
    );
  };

  const renderThinkingDetails = (steps: ProgressStep[]) => (
    <div className="mb-3 space-y-0.5 animate-fade-in">
      {steps.map((step, idx) => {
        let icon = '⋯';
        let text = '';
        let colorClass = 'text-muted-text';
        if (step.type === 'thinking') {
          icon = '🤔';
          text = step.message || chat('thinking.stepDefault', { step: step.step });
          colorClass = 'text-secondary-text';
        } else if (step.type === 'tool_start') {
          icon = '⚙️';
          text = chat('stage.toolRunning', { tool: step.display_name || step.tool });
          colorClass = 'text-secondary-text';
        } else if (step.type === 'tool_done') {
          icon = step.success ? '✅' : '❌';
          text = `${step.display_name || step.tool} (${step.duration}s)`;
          colorClass = step.success ? 'text-success' : 'text-danger';
        } else if (step.type === 'generating') {
          icon = '✍️';
          text = step.message || chat('thinking.generatingDefault');
          colorClass = 'text-[hsl(var(--accent-primary-hsl))]';
        }
        return (
          <div
            key={idx}
            className={`flex items-center gap-2 text-xs py-0.5 ${colorClass}`}
          >
            <span className="w-4 flex-shrink-0 text-center">{icon}</span>
            <span className="leading-relaxed">{text}</span>
          </div>
        );
      })}
    </div>
  );

  const sidebarContent = useMemo(() => (
    <div className="theme-panel-solid flex h-full min-h-0 flex-col overflow-hidden rounded-[1.2rem]">
      <div className="theme-sidebar-divider flex items-center justify-between border-b px-3.5 py-3">
        <h2 className="text-[11px] font-semibold text-[hsl(var(--accent-primary-hsl))] uppercase tracking-[0.2em] flex items-center gap-2">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {chat('historyTitle')}
        </h2>
        <button
          type="button"
          onClick={handleStartNewChat}
          className="theme-panel-subtle rounded-lg p-1.5 text-muted-text transition-all duration-200 ease-out hover:text-foreground"
          title={chat('newChatTitle')}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
        </button>
      </div>
      {sessionLoadError ? (
        <ApiErrorAlert
          error={sessionLoadError}
          className="m-3"
          actionLabel={chat('retryLoadSessions')}
          onAction={() => {
            void loadSessions();
          }}
        />
      ) : null}
      <ScrollArea testId="chat-session-list-scroll" viewportClassName="p-3">
        {sessionsLoading ? (
          <div className="p-4 text-center text-xs text-muted-text">{chat('loadingSessions')}</div>
        ) : sessions.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-text">{chat('emptySessions')}</div>
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => (
              <div
                key={s.session_id}
                role="button"
                tabIndex={0}
                onClick={() => handleSwitchSession(s.session_id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSwitchSession(s.session_id);
                  }
                }}
                data-active={s.session_id === sessionId}
                className="theme-list-item group relative flex w-full cursor-pointer items-start gap-3 overflow-hidden rounded-xl border p-2.5 transition-all duration-200 ease-out"
                aria-label={chat('switchToConversation', { title: s.title })}
              >
                {/* 装饰条 */}
                <div
                  className={`h-10 w-1 rounded-full flex-shrink-0 transition-colors ${
                    s.session_id === sessionId ? 'bg-[hsl(var(--accent-primary-hsl))]' : 'bg-white/10'
                  }`}
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <span className={`block truncate text-sm font-semibold tracking-tight transition-colors ${
                        s.session_id === sessionId ? 'text-foreground' : 'text-secondary-text group-hover:text-foreground'
                      }`}>
                        {s.title}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirmId(s.session_id);
                      }}
                      className="flex-shrink-0 rounded p-1 text-muted-text opacity-0 transition-all hover:bg-white/10 hover:text-danger group-hover:opacity-100"
                      title={chat('deleteConversationAction')}
                    >
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[11px] text-muted-text">
                      {chat('messageCount', { count: s.message_count })}
                    </span>
                    {s.last_active && (
                      <>
                        <span className="h-1 w-1 rounded-full bg-white/10" />
                        <span className="text-[11px] text-muted-text">
                          {new Date(s.last_active).toLocaleDateString(language === 'en' ? 'en-US' : 'zh-CN', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  ), [chat, handleStartNewChat, handleSwitchSession, language, loadSessions, sessionId, sessionLoadError, sessions, sessionsLoading]);

  useShellRailSlot(sidebarContent);

  const heroItems: BentoHeroItem[] = [
    {
      label: language === 'en' ? 'Skill mode' : '技能模式',
      value: selectedSkillLabel,
      detail: chat('skills.sectionBody'),
      tone: selectedSkill ? 'bullish' : 'neutral',
      testId: 'chat-bento-hero-skill',
      valueTestId: 'chat-bento-hero-skill-value',
    },
    {
      label: language === 'en' ? 'Tracked threads' : '跟踪对话',
      value: sessions.length,
      detail: chat('newChatTitle'),
      testId: 'chat-bento-hero-sessions',
    },
    {
      label: language === 'en' ? 'Message depth' : '消息深度',
      value: messages.length,
      detail: loading ? getCurrentStage(progressSteps) : chat('description'),
      tone: loading ? 'bullish' : 'neutral',
      testId: 'chat-bento-hero-messages',
      valueTestId: 'chat-bento-hero-messages-value',
    },
    {
      label: language === 'en' ? 'Delivery' : '发送状态',
      value: sending ? chat('notifySending') : chat('notifyAction'),
      detail: sendToast?.message || chat('notifyTitle'),
      tone: sendToast?.type === 'error' ? 'bearish' : sending ? 'bullish' : 'neutral',
      testId: 'chat-bento-hero-delivery',
      valueTestId: 'chat-bento-hero-delivery-value',
    },
  ];

  const latestAssistantMessageId = useMemo(
    () => [...messages].reverse().find((msg) => msg.role === 'assistant')?.id ?? null,
    [messages],
  );
  const [animatedAssistantMessageId, setAnimatedAssistantMessageId] = useState<string | null>(null);

  useEffect(() => {
    const assistantIds = messages
      .filter((msg) => msg.role === 'assistant')
      .map((msg) => msg.id);
    const seenAssistantIds = seenAssistantMessageIdsRef.current;

    if (!hasHydratedAssistantMessagesRef.current) {
      assistantIds.forEach((id) => seenAssistantIds.add(id));
      hasHydratedAssistantMessagesRef.current = true;
      return;
    }

    const newAssistantIds = assistantIds.filter((id) => !seenAssistantIds.has(id));

    if (newAssistantIds.length > 0) {
      const newestAssistantId = newAssistantIds[newAssistantIds.length - 1];
      setAnimatedAssistantMessageId(newestAssistantId);
      newAssistantIds.forEach((id) => seenAssistantIds.add(id));
      return;
    }

    assistantIds.forEach((id) => seenAssistantIds.add(id));
  }, [messages]);

  useEffect(() => {
    const textarea = composerTextareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [input]);

  return (
    <div
      data-testid="chat-bento-page"
      data-bento-surface="true"
      className="gemini-bento-page bento-surface-root workspace-page workspace-page--chat workspace-width-wide gemini-bento-page--chat flex w-full flex-col bg-black"
    >
      <div
        data-testid="chat-workspace"
        className="relative w-full h-[calc(100vh-80px)] flex flex-col overflow-hidden bg-transparent"
      >
        <ConfirmDialog
          isOpen={Boolean(deleteConfirmId)}
          title={chat('deleteConversationTitle')}
          message={chat('deleteConversationMessage')}
          confirmText={chat('deleteConversationConfirm')}
          cancelText={chat('deleteConversationCancel')}
          isDanger
          onConfirm={confirmDelete}
          onCancel={() => setDeleteConfirmId(null)}
        />

        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-between gap-3 px-4 pt-4 md:px-6">
          <div
            data-testid="chat-status-strip"
            className="pointer-events-auto inline-flex max-w-[calc(100%-12rem)] flex-wrap items-center gap-x-4 gap-y-2 rounded-full border border-white/10 bg-black/45 px-4 py-2 text-[11px] text-white/50 backdrop-blur-2xl"
          >
            {heroItems.map((item, index) => (
              <div
                key={`${item.label}-${index}`}
                data-testid={item.testId}
                className="flex items-center gap-2"
              >
                <span className="uppercase tracking-[0.16em] text-white/32">{item.label}</span>
                <span
                  data-testid={item.valueTestId}
                  className="font-medium text-white/78"
                >
                  {item.value}
                </span>
              </div>
            ))}
          </div>
          <div className="pointer-events-auto flex items-start gap-2">
            <button
              type="button"
              onClick={() => setIsBriefDrawerOpen(true)}
              data-testid="chat-bento-drawer-trigger"
              className={CARD_BUTTON_CLASS}
              title={language === 'en' ? 'Open brief' : '查看摘要'}
            >
              <PanelRightOpen className="h-4 w-4" />
              <span className="hidden sm:inline">{language === 'en' ? 'Open brief' : '查看摘要'}</span>
            </button>
            {messages.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => downloadSession(messages)}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/45 text-secondary-text backdrop-blur-2xl transition-colors hover:bg-white/10 hover:text-foreground"
                  title={chat('exportTitle')}
                >
                  <Download className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (sending) return;
                    setSending(true);
                    setSendToast(null);
                    try {
                      const content = formatSessionAsMarkdown(messages);
                      await agentApi.sendChat(content);
                      setSendToast({ type: 'success', message: chat('notifySuccess') });
                      setTimeout(() => setSendToast(null), 3000);
                    } catch (err) {
                      const parsed = getParsedApiError(err);
                      setSendToast({
                        type: 'error',
                        message: parsed.message || chat('notifyFailed'),
                      });
                      setTimeout(() => setSendToast(null), 5000);
                    } finally {
                      setSending(false);
                    }
                  }}
                  disabled={sending}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/45 text-secondary-text backdrop-blur-2xl transition-colors hover:bg-white/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  title={chat('notifyTitle')}
                >
                  {sending ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/25 border-t-white" />
                  ) : (
                    <SendHorizontal className="h-4 w-4" />
                  )}
                </button>
              </>
            ) : null}
          </div>
        </div>

        <main
          ref={messagesViewportRef}
          data-testid="chat-main"
          onScroll={handleMessagesScroll}
          className="flex-1 w-full overflow-y-auto no-scrollbar"
        >
          <div
            data-testid="chat-message-stream"
            className="mx-auto flex w-full max-w-[1440px] flex-col gap-10 px-4 pt-16 pb-[15rem] md:px-6 md:pb-[14rem]"
          >
            {skillsLoadError ? (
              <ApiErrorAlert
                error={skillsLoadError}
                actionLabel={chat('retryLoadSkills')}
                onAction={() => {
                  void loadSkills();
                }}
              />
            ) : null}
            {messages.length === 0 && !loading ? (
              <div
                data-testid="chat-empty-state"
                className="w-full"
              >
                <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
                  <div className="text-center">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-white/5 bg-white/[0.02] text-[hsl(var(--accent-primary-hsl))] backdrop-blur-xl">
                      <svg
                        className="h-7 w-7"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                        />
                      </svg>
                    </div>
                    <h3 className="mt-5 text-3xl font-medium tracking-tight text-foreground">{chat('emptyTitle')}</h3>
                    <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-secondary-text md:text-base">
                      {chat('emptyBody')}
                    </p>
                  </div>

                  <div className="grid gap-4 place-items-stretch lg:grid-cols-3">
                    {starterPromptCards.map((card) => (
                      <button
                        key={card.id}
                        type="button"
                        data-testid={`chat-starter-card-${card.id}`}
                        onClick={() => handleSend(chat(`starterCards.${card.id}.prompt`), card.skill)}
                        className="rounded-[28px] border border-white/8 bg-white/[0.03] px-5 py-5 text-left backdrop-blur-2xl transition-colors duration-150 hover:bg-white/[0.05]"
                      >
                        <p className="text-sm font-medium tracking-tight text-foreground">{chat(`starterCards.${card.id}.title`)}</p>
                        <p className="mt-3 text-sm leading-relaxed text-secondary-text">{chat(`starterCards.${card.id}.description`)}</p>
                        <p className="mt-4 text-xs leading-relaxed text-muted-text">{chat(`starterCards.${card.id}.prompt`)}</p>
                      </button>
                    ))}
                  </div>

                  {quickQuestions.length > 0 ? (
                    <div className="flex flex-wrap justify-center gap-2.5">
                      {quickQuestions.map((q) => (
                        <button
                          key={q.id}
                          type="button"
                          onClick={() => handleQuickQuestion(q)}
                          className="rounded-full border border-white/8 bg-white/[0.02] px-4 py-2 text-sm text-secondary-text transition-colors duration-150 hover:bg-white/[0.05] hover:text-foreground"
                        >
                          {chat(`quickQuestions.${q.id}`)}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex w-full flex-col gap-6">
                {messages.map((msg) => (
                  msg.role === 'user' ? (
                    <div
                      key={msg.id}
                      data-testid={`chat-user-message-${msg.id}`}
                      className="w-full flex justify-end mb-4"
                    >
                      <div className="max-w-[min(88%,72rem)] bg-white/[0.08] text-white px-5 py-3 rounded-2xl rounded-tr-sm text-sm break-words">
                        {msg.content
                          .split('\n')
                          .map((line, i) => (
                            <p
                              key={i}
                              className="mb-1 last:mb-0 leading-relaxed"
                            >
                              {line || '\u00A0'}
                            </p>
                          ))}
                      </div>
                    </div>
                  ) : (
                    <div
                      key={msg.id}
                      data-testid={`chat-assistant-message-${msg.id}`}
                      className="w-full flex gap-4"
                    >
                      <div className="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-[11px] font-semibold text-white/72">
                        AI
                      </div>
                      <div className="flex-1 min-w-0 bg-transparent text-white/90 text-sm md:text-base leading-relaxed break-words whitespace-pre-wrap">
                        {msg.skillName && (
                          <div className="mb-2">
                            <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-xs text-[hsl(var(--accent-primary-hsl))]">
                              <svg
                                className="w-3 h-3"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M13 10V3L4 14h7v7l9-11h-7z"
                                />
                              </svg>
                              {getLocalizedSkillLabel(msg.skillName, t)}
                            </span>
                          </div>
                        )}
                        {renderThinkingBlock(msg)}
                        {expandedThinking.has(msg.id) &&
                          msg.thinkingSteps &&
                          renderThinkingDetails(msg.thinkingSteps)}
                        {msg.id === latestAssistantMessageId && msg.id === animatedAssistantMessageId ? (
                          <TypewriterText
                            as="div"
                            className="w-full markdown-body break-words whitespace-pre-wrap"
                            speed={20}
                            testId={`chat-typewriter-${msg.id}`}
                            text={msg.content}
                            onComplete={() => {
                              setAnimatedAssistantMessageId((currentId) => (currentId === msg.id ? null : currentId));
                            }}
                          />
                        ) : (
                          <div className="w-full markdown-body break-words whitespace-pre-wrap">
                            <Markdown components={assistantMarkdownComponents} remarkPlugins={[remarkGfm]}>
                              {msg.content}
                            </Markdown>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                ))}
              </div>
            )}

            {loading && (
              <div className="w-full flex gap-4 pt-2">
                <div className="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-[11px] font-semibold text-white/72">
                  AI
                </div>
                <div className="flex-1 min-w-0 overflow-hidden rounded-2xl bg-white/[0.03] px-5 py-4">
                  <div className="flex items-center gap-2.5 text-sm text-secondary-text">
                    <div className="relative w-4 h-4 flex-shrink-0">
                      <div className="absolute inset-0 rounded-full border-2 border-[hsl(var(--accent-primary-hsl)/0.2)]" />
                      <div className="absolute inset-0 rounded-full border-2 border-[hsl(var(--accent-primary-hsl))] border-t-transparent animate-spin" />
                    </div>
                    <span className="text-secondary-text">
                      {getCurrentStage(progressSteps)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </main>

        <footer
          data-testid="chat-input-shell"
          className="pointer-events-none absolute bottom-0 left-0 z-50 flex w-full justify-center bg-gradient-to-t from-[#050505] via-[#050505]/95 to-transparent px-4 pt-20 pb-8 md:px-6"
        >
          <div className="relative flex w-full max-w-[1440px] flex-col gap-3 pointer-events-auto">
            {sendToast ? (
              <p className={`text-right text-xs ${sendToast.type === 'success' ? 'text-success' : 'text-danger'}`}>
                {sendToast.message}
              </p>
            ) : null}
            {chatError ? (
              <ApiErrorAlert
                error={chatError}
                className="mb-1"
                actionLabel={chatError.category === 'local_connection_failed' ? chat('reloadPageAction') : undefined}
                onAction={
                  chatError.category === 'local_connection_failed'
                    ? () => {
                        window.location.reload();
                      }
                    : undefined
                }
              />
            ) : null}
            <div
              data-testid="chat-skill-toolbar"
              className="flex flex-wrap items-center gap-2 overflow-visible px-1"
            >
              <span className="shrink-0 text-[10px] uppercase tracking-[0.28em] text-white/40">{engineSwitcherLabel}</span>
              <button
                type="button"
                onClick={() => setSelectedSkill('')}
                className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  selectedSkill === ''
                    ? 'border-indigo-500/20 bg-indigo-500/10 text-indigo-300'
                    : 'border-white/10 bg-white/[0.03] text-white/55 hover:bg-white/[0.06] hover:text-white/80'
                }`}
              >
                <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current align-middle" />
                {chat('skills.general')}
              </button>
              {skills.map((s) => (
                <div
                  key={s.id}
                  className="relative shrink-0"
                  onMouseEnter={() => setShowSkillDesc(s.id)}
                  onMouseLeave={() => setShowSkillDesc(null)}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedSkill(s.id)}
                    className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      selectedSkill === s.id
                        ? 'border-indigo-500/20 bg-indigo-500/10 text-indigo-300'
                        : 'border-white/10 bg-white/[0.03] text-white/55 hover:bg-white/[0.06] hover:text-white/80'
                    }`}
                  >
                    <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${selectedSkill === s.id ? 'animate-pulse bg-indigo-300' : 'bg-white/35'}`} />
                    {getLocalizedSkillNameById(s.id, s.name, t)}
                  </button>
                  {showSkillDesc === s.id && s.description ? (
                    <div className="theme-menu-panel absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-lg p-2.5 text-xs leading-relaxed text-secondary-text shadow-xl pointer-events-none animate-fade-in">
                      <p className="mb-1 font-medium text-foreground">{getLocalizedSkillNameById(s.id, s.name, t)}</p>
                      <p>{s.description}</p>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            <div
              data-testid="chat-composer-omnibar"
              className="relative w-full rounded-[24px] border border-white/10 bg-white/[0.03] p-2 text-white shadow-2xl backdrop-blur-2xl transition-all focus-within:border-white/30 focus-within:bg-white/[0.05]"
            >
              <div className="flex items-end gap-3">
                <textarea
                  ref={composerTextareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={chat('inputPlaceholder')}
                  disabled={loading}
                  rows={1}
                  className="min-h-[60px] max-h-[200px] w-full flex-1 resize-none border-0 bg-transparent px-4 py-3 pr-16 text-sm leading-relaxed text-white placeholder:text-white/30 focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50"
                  onInput={(e) => {
                    const textarea = e.target as HTMLTextAreaElement;
                    textarea.style.height = 'auto';
                    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
                  }}
                />
                <button
                  type="button"
                  onClick={() => handleSend()}
                  disabled={!input.trim() || loading}
                  className="absolute bottom-3 right-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-black transition-transform duration-150 hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label={chat('notifyAction')}
                >
                  {loading ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/25 border-t-black" />
                  ) : (
                    <ArrowUp className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>
            {isFollowUpContextLoading && (
              <p className="text-xs text-secondary-text">
                {chat('followUpContextLoading')}
              </p>
            )}
            <div className="text-center text-[10px] text-white/30">
              {composerDisclaimer}
            </div>
          </div>
        </footer>
      </div>
      <PageBriefDrawer
        isOpen={isBriefDrawerOpen}
        onClose={() => setIsBriefDrawerOpen(false)}
        title={chat('title')}
        testId="chat-bento-drawer"
        summary={language === 'en'
          ? 'Ask Stock now shares the same Bento shell as the rest of the app while keeping session state, streamed replies, and follow-up context behavior intact.'
          : '问股页现在与其他页面共用同一套 Bento 外壳，但会话状态、流式回复和追问上下文行为保持不变。'}
        metrics={[
          {
            label: language === 'en' ? 'Skill mode' : '技能模式',
            value: selectedSkillLabel,
            tone: selectedSkill ? 'bullish' : 'neutral',
          },
          {
            label: language === 'en' ? 'Tracked threads' : '跟踪对话',
            value: sessions.length,
          },
          {
            label: language === 'en' ? 'Message depth' : '消息深度',
            value: messages.length,
            tone: loading ? 'bullish' : 'neutral',
          },
          {
            label: language === 'en' ? 'Delivery' : '发送状态',
            value: sending ? chat('notifySending') : chat('notifyAction'),
            tone: sendToast?.type === 'error' ? 'bearish' : sending ? 'bullish' : 'neutral',
          },
        ]}
        bullets={[
          language === 'en'
            ? 'The hero strip surfaces mode, session count, message depth, and delivery state before you enter the conversation stream.'
            : 'Hero strip 先抬出模式、会话数、消息深度和发送状态，再进入对话流。',
          language === 'en'
            ? 'The shell rail, message viewport, and composer remain separate scroll regions, so the chat workflow stays ergonomic.'
            : '侧栏、消息区和输入区仍然保持独立滚动层，因此聊天工作流的手感不变。',
          language === 'en'
            ? 'This pass is visual convergence and testability, not a chat behavior rewrite.'
            : '这次改动是视觉收敛和可测性补齐，不是聊天行为重写。',
        ]}
        footnote={language === 'en' ? 'Session and agent APIs unchanged.' : '会话和 agent API 保持不变。'}
      />
    </div>
  );
};

export default ChatPage;
