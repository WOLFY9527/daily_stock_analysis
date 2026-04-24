import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ArrowUp, PanelRightOpen } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { agentApi } from '../api/agent';
import { ApiErrorAlert, ConfirmDialog, ScrollArea } from '../components/common';
import {
  CARD_BUTTON_CLASS,
  PageBriefDrawer,
  PageChrome,
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

type QuickQuestion = {
  id: string;
  skill: string;
};

type StarterPromptCard = {
  id: string;
  skill: string;
};

const QUICK_QUESTIONS: QuickQuestion[] = [
  { id: 'q1', skill: 'chan_theory' },
  { id: 'q2', skill: 'wave_theory' },
  { id: 'q3', skill: 'bull_trend' },
  { id: 'q4', skill: 'box_oscillation' },
  { id: 'q5', skill: 'bull_trend' },
  { id: 'q6', skill: 'emotion_cycle' },
];

const STARTER_PROMPT_CARDS: StarterPromptCard[] = [
  { id: 'entryDecision', skill: 'bull_trend' },
  { id: 'positionReview', skill: 'bull_trend' },
  { id: 'eventFollowUp', skill: 'bull_trend' },
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
  const isMountedRef = useRef(true);
  const followUpHydrationTokenRef = useRef(0);
  const followUpContextRef = useRef<ChatFollowUpContext | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const pendingScrollBehaviorRef = useRef<ScrollBehavior>('auto');
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
    if (!shouldAutoScroll) return;

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
  const quickQuestions = QUICK_QUESTIONS.filter(
    (question) => availableSkillIds.size === 0 || availableSkillIds.has(question.skill),
  );
  const starterPromptCards = STARTER_PROMPT_CARDS.filter(
    (card) => availableSkillIds.size === 0 || availableSkillIds.has(card.skill),
  );

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
    <div className="mb-3 pl-5 border-l border-border/40 space-y-0.5 animate-fade-in">
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

  return (
    <PageChrome
      pageTestId="chat-bento-page"
      pageClassName="workspace-page workspace-page--chat gemini-bento-page--chat"
      eyebrow={chat('eyebrow')}
      title={(
        <span className="mb-2 mt-2 flex items-center gap-2">
          <svg
            className="h-6 w-6 text-[hsl(var(--accent-primary-hsl))]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>
          <span>{chat('title')}</span>
        </span>
      )}
      titleClassName="text-2xl font-bold"
      description={chat('description')}
      actions={(
        <>
          <button
            type="button"
            onClick={() => setIsBriefDrawerOpen(true)}
            data-testid="chat-bento-drawer-trigger"
            className={CARD_BUTTON_CLASS}
          >
            <PanelRightOpen className="h-4 w-4" />
            <span>{language === 'en' ? 'Open brief' : '查看摘要'}</span>
          </button>
          {messages.length > 0 ? (
            <>
              <button
                type="button"
                onClick={() => downloadSession(messages)}
                className="flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-sm text-secondary-text transition-colors hover:bg-hover hover:text-foreground"
                title={chat('exportTitle')}
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                {chat('exportAction')}
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
                className="flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-sm text-secondary-text transition-colors hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                title={chat('notifyTitle')}
              >
                {sending ? (
                  <svg
                    className="h-4 w-4 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                ) : (
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                    />
                  </svg>
                )}
                {sending ? chat('notifySending') : chat('notifyAction')}
              </button>
              {sendToast ? (
                <span className={`text-sm ${sendToast.type === 'success' ? 'text-success' : 'text-danger'}`}>
                  {sendToast.message}
                </span>
              ) : null}
            </>
          ) : null}
        </>
      )}
      heroItems={heroItems}
      heroTestId="chat-bento-hero"
    >
      <div data-testid="chat-workspace" className="workspace-chat-layout flex h-[calc(100vh-80px)] flex-col overflow-hidden">
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

        <div className="workspace-chat-main flex min-h-0 flex-1 overflow-hidden">
          <div className="workspace-surface relative z-10 mx-auto flex h-full min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden rounded-[1.4rem]">
          {skillsLoadError ? (
            <div className="px-4 pb-0 pt-4 md:px-6 md:pt-6">
              <ApiErrorAlert
                error={skillsLoadError}
                actionLabel={chat('retryLoadSkills')}
                onAction={() => {
                  void loadSkills();
                }}
              />
            </div>
          ) : null}
          {/* Messages */}
          <ScrollArea
            className="relative z-10 flex-1 min-h-0 overflow-hidden"
            viewportRef={messagesViewportRef}
            onScroll={handleMessagesScroll}
            viewportClassName="h-full p-4 md:p-6"
            testId="chat-message-scroll"
          >
            <div data-testid="chat-message-stream" className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-6">
              {messages.length === 0 && !loading ? (
                <div className="flex min-h-full w-full flex-col justify-center">
                  <div className="mx-auto w-full max-w-4xl">
                    <div className="mx-auto max-w-2xl text-center">
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
                      <h3 className="mt-5 text-2xl font-medium tracking-tight text-foreground">{chat('emptyTitle')}</h3>
                      <p className="mt-3 text-sm leading-relaxed text-secondary-text">
                        {chat('emptyBody')}
                      </p>
                    </div>

                    <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 place-items-stretch">
                      {starterPromptCards.map((card) => (
                        <button
                          key={card.id}
                          type="button"
                          data-testid={`chat-starter-card-${card.id}`}
                          onClick={() => handleSend(chat(`starterCards.${card.id}.prompt`), card.skill)}
                          className="rounded-3xl border border-white/5 bg-white/[0.02] px-5 py-5 text-left backdrop-blur-xl transition-colors duration-150 hover:bg-white/[0.04]"
                        >
                          <p className="text-sm font-medium tracking-tight text-foreground">{chat(`starterCards.${card.id}.title`)}</p>
                          <p className="mt-3 text-sm leading-relaxed text-secondary-text">{chat(`starterCards.${card.id}.description`)}</p>
                          <p className="mt-4 text-xs leading-relaxed text-muted-text">{chat(`starterCards.${card.id}.prompt`)}</p>
                        </button>
                      ))}
                    </div>

                    {quickQuestions.length > 0 ? (
                      <div className="mt-6 flex flex-wrap justify-center gap-2">
                        {quickQuestions.slice(0, 4).map((q, i) => (
                          <button
                            key={i}
                            onClick={() => handleQuickQuestion(q)}
                            className="rounded-full bg-white/[0.02] px-3 py-1.5 text-sm text-secondary-text transition-colors duration-150 hover:bg-white/[0.04] hover:text-foreground"
                          >
                            {chat(`quickQuestions.${q.id}`)}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
                  >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                      msg.role === 'user'
                        ? 'bg-[hsl(var(--accent-primary-hsl))] text-[hsl(var(--bg-page-hsl))]'
                        : 'bg-elevated text-foreground'
                    }`}
                  >
                    {msg.role === 'user' ? 'U' : 'AI'}
                  </div>
                  <div
                    className={`min-w-0 w-fit max-w-[min(100%,56rem)] overflow-hidden rounded-2xl px-5 py-3.5 ${
                      msg.role === 'user'
                        ? 'bg-[hsl(var(--accent-primary-hsl)/0.12)] text-foreground border border-[hsl(var(--accent-primary-hsl)/0.32)] rounded-tr-sm'
                        : 'theme-panel-subtle text-secondary-text rounded-tl-sm'
                    }`}
                  >
                    {msg.role === 'assistant' && msg.skillName && (
                      <div className="mb-2">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[hsl(var(--accent-primary-hsl)/0.12)] border border-[hsl(var(--accent-primary-hsl)/0.3)] text-xs text-[hsl(var(--accent-primary-hsl))]">
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
                    {msg.role === 'assistant' && renderThinkingBlock(msg)}
                    {msg.role === 'assistant' &&
                      expandedThinking.has(msg.id) &&
                      msg.thinkingSteps &&
                      renderThinkingDetails(msg.thinkingSteps)}
                    {msg.role === 'assistant' ? (
                      <div
                        className="prose prose-invert prose-sm max-w-none
                      prose-headings:text-foreground prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1.5
                      prose-h1:text-lg prose-h2:text-base prose-h3:text-sm
                      prose-p:mb-2 prose-p:last:mb-0 prose-p:leading-7 prose-p:break-words
                      prose-strong:text-foreground prose-strong:font-semibold
                      prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-li:break-words
                      prose-code:text-[hsl(var(--accent-primary-hsl))] prose-code:bg-card/70 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:break-all
                      prose-pre:max-w-full prose-pre:overflow-x-auto prose-pre:bg-black/30 prose-pre:border prose-pre:border-border/70 prose-pre:rounded-lg prose-pre:p-3
                      prose-table:w-full prose-table:text-sm
                      prose-th:text-foreground prose-th:font-medium prose-th:border-border prose-th:px-3 prose-th:py-1.5 prose-th:bg-card/70
                      prose-td:border-border/70 prose-td:px-3 prose-td:py-1.5
                      prose-hr:border-border/70 prose-hr:my-3
                      prose-a:text-[hsl(var(--accent-primary-hsl))] prose-a:no-underline hover:prose-a:underline
                      prose-blockquote:border-[hsl(var(--accent-primary-hsl)/0.3)] prose-blockquote:text-secondary-text
                      [&_table]:block [&_table]:overflow-x-auto [&_table]:whitespace-nowrap
                      [&_img]:max-w-full
                    "
                      >
                        <Markdown remarkPlugins={[remarkGfm]}>
                          {msg.content}
                        </Markdown>
                      </div>
                    ) : (
                      msg.content
                        .split('\n')
                        .map((line, i) => (
                          <p
                            key={i}
                            className="mb-1 last:mb-0 leading-relaxed"
                          >
                            {line || '\u00A0'}
                          </p>
                        ))
                    )}
                  </div>
                  </div>
                ))
              )}

              {loading && (
                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-elevated text-foreground flex items-center justify-center flex-shrink-0 text-xs font-bold">
                    AI
                  </div>
                  <div className="theme-panel-subtle min-w-[200px] max-w-[min(100%,56rem)] overflow-hidden rounded-2xl rounded-tl-sm px-5 py-4">
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
          </ScrollArea>

          {/* Input area */}
          <div className="pointer-events-none shrink-0 bg-gradient-to-t from-black via-black/92 to-transparent px-4 pb-8 pt-4 md:px-6">
            {chatError ? (
              <ApiErrorAlert
                error={chatError}
                className="pointer-events-auto mx-auto mb-3 max-w-4xl"
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
            {skills.length > 0 && (
              <div className="pointer-events-auto mx-auto mb-3 max-w-4xl px-2">
                <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted-text">{chat('skills.sectionTitle')}</p>
                    <p className="mt-1 text-sm text-secondary-text">{chat('skills.sectionBody')}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedSkill('')}
                    className={`rounded-full px-3 py-1.5 text-sm transition-colors duration-150 ${
                      selectedSkill === ''
                        ? 'bg-[hsl(var(--accent-primary-hsl)/0.12)] text-foreground'
                        : 'bg-white/[0.02] text-secondary-text hover:bg-white/[0.04] hover:text-foreground'
                    }`}
                  >
                    {chat('skills.general')}
                  </button>
                  {skills.map((s) => (
                    <div
                      key={s.id}
                      className="relative"
                      onMouseEnter={() => setShowSkillDesc(s.id)}
                      onMouseLeave={() => setShowSkillDesc(null)}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedSkill(s.id)}
                        className={`rounded-full px-3 py-1.5 text-sm transition-colors duration-150 ${
                          selectedSkill === s.id
                            ? 'bg-[hsl(var(--accent-primary-hsl)/0.12)] text-foreground'
                            : 'bg-white/[0.02] text-secondary-text hover:bg-white/[0.04] hover:text-foreground'
                        }`}
                      >
                        {getLocalizedSkillNameById(s.id, s.name, t)}
                      </button>
                      {showSkillDesc === s.id && s.description ? (
                        <div className="theme-menu-panel absolute left-0 bottom-full mb-2 z-50 w-64 rounded-lg p-2.5 text-xs leading-relaxed text-secondary-text shadow-xl pointer-events-none animate-fade-in">
                          <p className="mb-1 font-medium text-foreground">{getLocalizedSkillNameById(s.id, s.name, t)}</p>
                          <p>{s.description}</p>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div
              data-testid="chat-composer-omnibar"
              className="pointer-events-auto mx-auto max-w-4xl rounded-full border border-white/5 bg-white/[0.02] px-4 py-3 text-white shadow-[0_24px_80px_rgba(0,0,0,0.36)] backdrop-blur-xl transition-colors duration-150 focus-within:border-white/20 focus-within:bg-white/[0.04] focus-within:ring-1 focus-within:ring-white/10"
            >
              <div className="flex items-end gap-3">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={chat('inputPlaceholder')}
                  disabled={loading}
                  rows={1}
                  className="min-h-[42px] max-h-[160px] flex-1 resize-none border-0 bg-transparent px-2 py-2.5 text-sm leading-relaxed text-white placeholder:text-white/25 focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ height: 'auto' }}
                  onInput={(e) => {
                    const t = e.target as HTMLTextAreaElement;
                    t.style.height = 'auto';
                    t.style.height = `${Math.min(t.scrollHeight, 200)}px`;
                  }}
                />
                <button
                  type="button"
                  onClick={() => handleSend()}
                  disabled={!input.trim() || loading}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--accent-primary-hsl))] text-black shadow-[0_0_28px_hsl(var(--accent-primary-hsl)/0.32)] transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
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
              <p className="pointer-events-auto mx-auto mt-2 max-w-4xl text-xs text-secondary-text">
                {chat('followUpContextLoading')}
              </p>
            )}
          </div>
          </div>
        </div>
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
    </PageChrome>
  );
};

export default ChatPage;
