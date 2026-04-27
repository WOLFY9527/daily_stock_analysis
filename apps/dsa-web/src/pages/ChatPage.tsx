import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ArrowUp, Download, PanelRightOpen, SendHorizontal } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { agentApi } from '../api/agent';
import { ApiErrorAlert, ConfirmDialog, TypewriterText } from '../components/common';
import {
  CARD_BUTTON_CLASS,
  PageBriefDrawer,
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
import { normalizeAssistantMessageContent } from '../utils/chatTimeoutFallback';
import { useI18n } from '../contexts/UiLanguageContext';
import {
  getSafariReadySurfaceClassName,
  shouldApplySafariA11yGuard,
  useSafariRenderReady,
  useSafariWarmActivation,
} from '../hooks/useSafariInteractionReady';
import { translate } from '../i18n/core';

const assistantMarkdownComponents = {
  h1: ({ children }: React.PropsWithChildren) => <h1 className="mb-3 text-lg font-bold text-white">{children}</h1>,
  h2: ({ children }: React.PropsWithChildren) => <h2 className="mb-3 mt-4 text-base font-semibold text-white">{children}</h2>,
  h3: ({ children }: React.PropsWithChildren) => <h3 className="mb-2 mt-4 text-base font-semibold text-white">{children}</h3>,
  p: ({ children }: React.PropsWithChildren) => <p className="mb-2 leading-[1.6] last:mb-0">{children}</p>,
  ul: ({ children }: React.PropsWithChildren) => <ul className="my-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }: React.PropsWithChildren) => <ol className="my-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
  li: ({ children }: React.PropsWithChildren) => <li className="mb-1 break-words leading-[1.6]">{children}</li>,
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
    <pre className="mb-3 overflow-x-auto rounded-xl border border-white/8 bg-black/30 p-3 text-[13px] leading-6 text-white/88 last:mb-0">
      {children}
    </pre>
  ),
  table: ({ children }: React.PropsWithChildren) => (
    <div className="mb-4 overflow-x-auto last:mb-0">
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

const ASSISTANT_MESSAGE_SURFACE_CLASS = 'w-full markdown-body text-[15px] leading-[1.6] text-white/90 break-words [&>p]:mb-3 [&>ul]:my-2 [&>ul]:pl-5 [&>li]:mb-1 [&>h3]:text-base [&>h3]:font-bold [&>h3]:mt-4 [&>h3]:mb-2';
const STREAMING_ASSISTANT_MESSAGE_SURFACE_CLASS = `${ASSISTANT_MESSAGE_SURFACE_CLASS} whitespace-pre-wrap`;

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

function getSessionBucketLabel(dateValue: string | null | undefined, language: 'zh' | 'en'): string {
  if (!dateValue) return language === 'en' ? 'Earlier' : '更早';

  const now = new Date();
  const target = new Date(dateValue);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const diffDays = Math.round((startOfToday.getTime() - startOfTarget.getTime()) / 86400000);

  if (diffDays <= 0) return language === 'en' ? 'Today' : '今天';
  if (diffDays <= 7) return language === 'en' ? 'Last 7 days' : '近 7 天';
  if (diffDays <= 30) return language === 'en' ? 'Last 30 days' : '近 30 天';
  return language === 'en' ? 'Earlier' : '更早';
}

const ChatPage: React.FC = () => {
  const { isReady: isSafariReady, surfaceRef } = useSafariRenderReady();
  const shouldGuardA11y = shouldApplySafariA11yGuard();
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
  const [animatedAssistantMessageId, setAnimatedAssistantMessageId] = useState<string | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const isAutoScroll = useRef(true);
  const isMountedRef = useRef(true);
  const followUpHydrationTokenRef = useRef(0);
  const followUpContextRef = useRef<ChatFollowUpContext | null>(null);
  const seenAssistantMessageIdsRef = useRef<Set<string>>(new Set());
  const hasHydratedAssistantMessagesRef = useRef(false);
  const chat = useCallback(
    (key: string, vars?: Record<string, string | number | undefined>) => t(`chat.${key}`, vars),
    [t],
  );

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
    stopStream,
    clearCompletionBadge,
  } = useAgentChatStore();

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
      const defaultId = res.default_skill_id || res.skills[0]?.id || '';
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
  const engineSwitcherLabel = language === 'en' ? 'Analysis engines & perspectives' : '分析引擎与视角';
  const composerDisclaimer = language === 'en'
    ? 'AI insights are for reference only and are not investment advice. Confirm your risk tolerance before trading.'
    : 'AI 洞察仅供参考，不构成实质性投资建议。执行交易前请确认风险承受能力。';

  const handleStartNewChat = useCallback(() => {
    followUpContextRef.current = null;
    useAgentChatStore.getState().startNewChat();
  }, []);

  const handleSwitchSession = useCallback((targetSessionId: string) => {
    switchSession(targetSessionId);
  }, [switchSession]);

  const confirmDelete = useCallback(() => {
    if (!deleteConfirmId) return;
    agentApi.deleteChatSession(deleteConfirmId).then(() => {
      void loadSessions();
      if (deleteConfirmId === sessionId) {
        handleStartNewChat();
      }
    }).catch(() => {});
    setDeleteConfirmId(null);
  }, [deleteConfirmId, handleStartNewChat, loadSessions, sessionId]);

  useEffect(() => {
    const stock = searchParams.get('stock');
    const name = searchParams.get('name');
    const recordId = searchParams.get('recordId');
    if (!stock) return;

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
      if (!isMountedRef.current || followUpHydrationTokenRef.current !== hydrationToken) return;
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
      isAutoScroll.current = true;
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
      await startStream(payload, { skillName: usedSkillName });
    },
    [chat, input, loading, selectedSkill, sessionId, skills, startStream, t],
  );

  const handleStopGeneration = useCallback(() => {
    stopStream();
  }, [stopStream]);

  const startNewChatDesktopButton = useSafariWarmActivation<HTMLButtonElement>(handleStartNewChat);
  const startNewChatMobileButton = useSafariWarmActivation<HTMLButtonElement>(handleStartNewChat);
  const openBriefButton = useSafariWarmActivation<HTMLButtonElement>(() => setIsBriefDrawerOpen(true));
  const sendMessageButton = useSafariWarmActivation<HTMLButtonElement>(() => {
    void handleSend();
  });

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleQuickQuestion = (q: QuickQuestion) => {
    setSelectedSkill(q.skill);
    void handleSend(chat(`quickQuestions.${q.id}`), q.skill);
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
    if (last.type === 'tool_start') return chat('stage.toolRunning', { tool: last.display_name || last.tool });
    if (last.type === 'tool_done') return chat('stage.toolDone', { tool: last.display_name || last.tool });
    if (last.type === 'generating') return last.message || chat('stage.generating');
    return chat('stage.processing');
  };

  const renderThinkingBlock = (msg: Message) => {
    if (!msg.thinkingSteps || msg.thinkingSteps.length === 0) return null;
    const isExpanded = expandedThinking.has(msg.id);
    const toolSteps = msg.thinkingSteps.filter((s) => s.type === 'tool_done');
    const totalDuration = toolSteps.reduce((sum, s) => sum + (s.duration || 0), 0);
    const summary = chat('thinking.summary', { count: toolSteps.length, duration: totalDuration.toFixed(1) });

    return (
      <button
        type="button"
        aria-label={chat('thinking.toggleLabel')}
        onClick={() => toggleThinking(msg.id)}
        className="mb-2 flex w-full items-center gap-2 text-left text-xs text-muted-text transition-colors hover:text-secondary-text"
      >
        <svg
          className={`h-3 w-3 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
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
          <div key={idx} className={`flex items-center gap-2 py-0.5 text-xs ${colorClass}`}>
            <span className="w-4 flex-shrink-0 text-center">{icon}</span>
            <span className="leading-relaxed">{text}</span>
          </div>
        );
      })}
    </div>
  );

  const latestAssistantMessageId = useMemo(
    () => [...messages].reverse().find((msg) => msg.role === 'assistant')?.id ?? null,
    [messages],
  );

  const isGenerating = loading;

  const groupedSessions = useMemo(() => {
    const buckets = new Map<string, typeof sessions>();
    sessions.forEach((session) => {
      const label = getSessionBucketLabel(session.last_active || session.created_at, language);
      const existing = buckets.get(label) ?? [];
      existing.push(session);
      buckets.set(label, existing);
    });
    return Array.from(buckets.entries());
  }, [language, sessions]);

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
      ref={surfaceRef}
      data-testid="chat-bento-page"
      data-bento-surface="true"
      aria-hidden={shouldGuardA11y && !isSafariReady ? true : undefined}
      aria-live={shouldGuardA11y ? (isSafariReady ? 'polite' : 'off') : undefined}
      className={getSafariReadySurfaceClassName(
        isSafariReady,
        'gemini-bento-page bento-surface-root workspace-page workspace-page--chat workspace-width-wide gemini-bento-page--chat flex w-full flex-1 min-w-0 flex-col bg-[#030303]',
      )}
    >
      <div
        data-testid="chat-workspace"
        className="flex h-[calc(100vh-80px)] w-full min-w-0 overflow-hidden bg-transparent"
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

        <aside
          data-testid="chat-history-pane"
          className="hidden w-64 shrink-0 flex-col border-r border-white/5 bg-white/[0.01] md:flex md:flex-col"
        >
          <div className="p-4">
            <p className="mb-3 text-[10px] uppercase tracking-[0.28em] text-white/30">{chat('historyTitle')}</p>
            <button
              ref={startNewChatDesktopButton.ref}
              type="button"
              onClick={startNewChatDesktopButton.onClick}
              onPointerUp={startNewChatDesktopButton.onPointerUp}
              aria-label={chat('newChatTitle')}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] py-2.5 text-sm font-medium text-white transition-all hover:bg-white/[0.1]"
            >
              + {language === 'en' ? 'Start new analysis' : '开启新分析'}
            </button>
          </div>

          {sessionLoadError ? (
            <ApiErrorAlert
              error={sessionLoadError}
              className="mx-3 mb-3"
              actionLabel={chat('retryLoadSessions')}
              onAction={() => {
                void loadSessions();
              }}
            />
          ) : null}

          <div
            data-testid="chat-history-list"
            className="flex flex-1 flex-col gap-1 overflow-y-auto no-scrollbar px-3 pb-4"
          >
            {sessionsLoading ? (
              <div className="rounded-2xl border border-white/6 bg-white/[0.02] px-3 py-4 text-xs text-secondary-text">
                {chat('loadingSessions')}
              </div>
            ) : sessions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-3 py-4 text-xs text-secondary-text">
                {chat('emptySessions')}
              </div>
            ) : (
              groupedSessions.map(([bucketLabel, bucketSessions]) => (
                <section key={bucketLabel} className="flex flex-col gap-1.5 pb-3">
                  <p className="px-2 text-[10px] uppercase tracking-[0.24em] text-white/30">{bucketLabel}</p>
                  {bucketSessions.map((s) => (
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
                      className={`group rounded-2xl border px-3 py-3 transition-all ${
                        s.session_id === sessionId
                          ? 'border-white/14 bg-white/[0.07]'
                          : 'border-white/6 bg-white/[0.02] hover:bg-white/[0.05]'
                      }`}
                      aria-label={chat('switchToConversation', { title: s.title })}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-white/88">{s.title}</p>
                          <div className="mt-2 flex items-center gap-2 text-[11px] text-white/36">
                            <span>{chat('messageCount', { count: s.message_count })}</span>
                            {s.last_active ? <span className="h-1 w-1 rounded-full bg-white/14" /> : null}
                            {s.last_active ? (
                              <span>
                                {new Date(s.last_active).toLocaleDateString(language === 'en' ? 'en-US' : 'zh-CN', {
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirmId(s.session_id);
                          }}
                          className="rounded-lg p-1 text-white/28 opacity-0 transition-all hover:bg-white/10 hover:text-danger group-hover:opacity-100"
                          title={chat('deleteConversationAction')}
                        >
                          <svg
                            className="h-3.5 w-3.5"
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
                    </div>
                  ))}
                </section>
              ))
            )}
          </div>
        </aside>

        <div
          data-testid="chat-main-shell"
          className="flex flex-1 min-w-0 overflow-hidden"
        >
          <section
            data-testid="chat-main-panel"
            className="relative flex flex-1 min-w-0 flex-col border-r border-white/5"
          >
            <main
            id="chat-scroll-container"
            data-testid="chat-main"
            onWheel={() => {
              isAutoScroll.current = false;
            }}
            onTouchMove={() => {
              isAutoScroll.current = false;
            }}
            onScroll={(e) => {
              const target = e.target as HTMLElement;
              if (target.scrollHeight - target.scrollTop - target.clientHeight < 50) {
                isAutoScroll.current = true;
              }
            }}
            className="flex-1 overflow-y-auto no-scrollbar w-full"
          >
            <div
              data-testid="chat-message-scroll"
              className="w-full"
            >
              <div
                data-testid="chat-message-stream"
                className="flex w-full min-w-0 flex-col gap-6 px-6 pb-48 pt-8 md:px-8 xl:px-12"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-[0.28em] text-white/30">WolfyStock</p>
                    <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-3xl">{chat('title')}</h1>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      ref={startNewChatMobileButton.ref}
                      type="button"
                      onClick={startNewChatMobileButton.onClick}
                      onPointerUp={startNewChatMobileButton.onPointerUp}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white transition-colors hover:bg-white/[0.08] md:hidden"
                    >
                      + {language === 'en' ? 'New' : '新建'}
                    </button>
                    <button
                      ref={openBriefButton.ref}
                      type="button"
                      onClick={openBriefButton.onClick}
                      onPointerUp={openBriefButton.onPointerUp}
                      data-testid="chat-bento-brief-trigger"
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
                          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-secondary-text transition-colors hover:bg-white/[0.08] hover:text-foreground"
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
                          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-secondary-text transition-colors hover:bg-white/[0.08] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
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
                  <div data-testid="chat-empty-state" className="w-full">
                    <div className="flex w-full flex-col gap-10">
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
                        <h3 className="mt-5 text-2xl font-medium tracking-tight text-foreground md:text-[2rem]">{chat('emptyTitle')}</h3>
                        <p className="mx-auto mt-3 max-w-3xl text-[14px] leading-relaxed text-secondary-text">
                          {chat('emptyBody')}
                        </p>
                      </div>

                      <div className="grid place-items-stretch gap-4 lg:grid-cols-3">
                        {starterPromptCards.map((card) => (
                          <button
                            key={card.id}
                            type="button"
                            data-testid={`chat-starter-card-${card.id}`}
                            onClick={() => {
                              void handleSend(chat(`starterCards.${card.id}.prompt`), card.skill);
                            }}
                            className="rounded-[28px] border border-white/8 bg-white/[0.03] px-5 py-5 text-left backdrop-blur-2xl transition-colors duration-150 hover:border-white/20 hover:bg-white/[0.04]"
                          >
                            <p className="text-sm font-medium tracking-tight text-foreground">{chat(`starterCards.${card.id}.title`)}</p>
                            <p className="mt-3 text-[14px] leading-relaxed text-secondary-text">{chat(`starterCards.${card.id}.description`)}</p>
                            <p className="mt-4 text-[13px] leading-relaxed text-muted-text">{chat(`starterCards.${card.id}.prompt`)}</p>
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
                    {messages.map((msg, index) => {
                      const displayContent = msg.role === 'assistant'
                        ? normalizeAssistantMessageContent(msg.content)
                        : msg.content;
                      const isLast = index === messages.length - 1;
                      const shouldStream = isGenerating
                        && msg.role === 'assistant'
                        && isLast
                        && msg.id === latestAssistantMessageId
                        && msg.id === animatedAssistantMessageId;

                      return msg.role === 'user' ? (
                        <div
                          key={msg.id}
                          data-testid={`chat-user-message-${msg.id}`}
                          className="mb-6 flex w-full justify-end"
                        >
                          <div className="max-w-[80%] rounded-2xl rounded-tr-[4px] border border-white/10 bg-white/[0.05] px-5 py-3.5 text-[15px] leading-relaxed text-white/90 shadow-lg backdrop-blur-md break-words">
                            {displayContent.split('\n').map((line, i) => (
                              <p key={i} className="mb-1 leading-relaxed last:mb-0">
                                {line || '\u00A0'}
                              </p>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div
                          key={msg.id}
                          data-testid={`chat-assistant-message-${msg.id}`}
                          className="flex w-full gap-4"
                        >
                          <div className="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-[11px] font-semibold text-white/72">
                            AI
                          </div>
                          <div className="flex-1 min-w-0 bg-transparent">
                            {msg.skillName ? (
                              <div className="mb-2">
                                <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-xs text-[hsl(var(--accent-primary-hsl))]">
                                  <svg
                                    className="h-3 w-3"
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
                            ) : null}
                            {renderThinkingBlock(msg)}
                            {expandedThinking.has(msg.id) && msg.thinkingSteps ? renderThinkingDetails(msg.thinkingSteps) : null}
                            {shouldStream ? (
                              <TypewriterText
                                as="div"
                                className={STREAMING_ASSISTANT_MESSAGE_SURFACE_CLASS}
                                testId={`chat-typewriter-${msg.id}`}
                                text={displayContent}
                                autoScrollRef={isAutoScroll}
                                onComplete={() => {
                                  setAnimatedAssistantMessageId((currentId) => (currentId === msg.id ? null : currentId));
                                }}
                              />
                            ) : (
                              <div className={ASSISTANT_MESSAGE_SURFACE_CLASS}>
                                <Markdown components={assistantMarkdownComponents} remarkPlugins={[remarkGfm]}>
                                  {displayContent}
                                </Markdown>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {loading ? (
                  <div className="flex w-full gap-4 pt-2">
                    <div className="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-[11px] font-semibold text-white/72">
                      AI
                    </div>
                    <div className="flex-1 min-w-0 overflow-hidden rounded-2xl bg-white/[0.03] px-5 py-4">
                      <div className="flex items-center gap-2.5 text-sm text-secondary-text">
                        <div className="relative h-4 w-4 flex-shrink-0">
                          <div className="absolute inset-0 rounded-full border-2 border-[hsl(var(--accent-primary-hsl)/0.2)]" />
                          <div className="absolute inset-0 rounded-full border-2 border-[hsl(var(--accent-primary-hsl))] border-t-transparent animate-spin" />
                        </div>
                        <span className="text-secondary-text">
                          {getCurrentStage(progressSteps)}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            </main>

            <footer
              data-testid="chat-input-shell"
              className="pointer-events-none absolute bottom-0 left-0 w-full z-50"
            >
              <div
                data-testid="chat-input-gradient"
                className="w-full bg-gradient-to-t from-[#030303] via-[#030303]/95 to-transparent pt-20 pb-8"
              >
                <div
                  data-testid="chat-console-inner"
                  className="w-full pointer-events-auto px-6 md:px-8 xl:px-12"
                >
                  {sendToast ? (
                    <p className={`mb-3 text-right text-xs ${sendToast.type === 'success' ? 'text-success' : 'text-danger'}`}>
                      {sendToast.message}
                    </p>
                  ) : null}

                  {chatError ? (
                    <ApiErrorAlert
                      error={chatError}
                      className="mb-3"
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
                    data-testid="chat-composer-omnibar"
                    className="relative flex w-full flex-col rounded-[24px] border border-white/10 bg-white/[0.02] p-2 text-white backdrop-blur-3xl transition-all duration-300 hover:border-white/20 focus-within:border-indigo-500/50 focus-within:bg-white/[0.04] focus-within:shadow-[0_0_30px_rgba(99,102,241,0.1)]"
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
                        className="min-h-[60px] max-h-[200px] w-full flex-1 resize-none border-0 bg-transparent px-4 py-3 text-sm leading-relaxed text-white placeholder:text-white/30 focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50"
                        onInput={(e) => {
                          const textarea = e.target as HTMLTextAreaElement;
                          textarea.style.height = 'auto';
                          textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
                        }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between px-4 pb-2">
                      <span className="text-[10px] font-medium tracking-wide text-white/30">
                        {composerDisclaimer}
                      </span>
                      {isGenerating ? (
                        <button
                          type="button"
                          onClick={handleStopGeneration}
                          className="group flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors active:scale-95 hover:bg-indigo-400/30 hover:text-white"
                          aria-label={chat('stopGeneration')}
                          title={chat('stopGeneration')}
                        >
                          <div className="h-3 w-3 rounded-sm bg-current transition-colors" />
                        </button>
                      ) : (
                        <button
                          ref={sendMessageButton.ref}
                          type="button"
                          onClick={sendMessageButton.onClick}
                          onPointerUp={sendMessageButton.onPointerUp}
                          disabled={!input.trim() || loading}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-black transition-all active:scale-95 hover:bg-indigo-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                          aria-label={chat('notifyAction')}
                          title={chat('notifyAction')}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {isFollowUpContextLoading ? (
                    <p className="mt-3 text-xs text-secondary-text">
                      {chat('followUpContextLoading')}
                    </p>
                  ) : null}
                </div>
              </div>
            </footer>
          </section>

          <aside
            data-testid="chat-strategy-panel"
            className="hidden h-full w-full shrink-0 flex-col gap-6 overflow-y-auto border-l border-white/5 bg-gradient-to-b from-white/[0.01] to-transparent p-6 no-scrollbar lg:flex lg:w-[280px] xl:w-[320px]"
          >
            <div className="flex flex-col gap-4">
              <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.24em] text-white/50">
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                {engineSwitcherLabel}
              </h3>
              <div data-testid="chat-strategy-grid" className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => setSelectedSkill('')}
                  className={`rounded-full border px-4 py-2 text-xs font-medium transition-all ${
                    selectedSkill === ''
                      ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300 shadow-[0_0_10px_rgba(99,102,241,0.1)]'
                      : 'border-white/10 bg-transparent text-white/50 hover:bg-white/[0.05] hover:text-white/90'
                  }`}
                >
                  <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current align-middle" />
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
                      className={`rounded-full border px-4 py-2 text-xs font-medium transition-all ${
                        selectedSkill === s.id
                          ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300 shadow-[0_0_10px_rgba(99,102,241,0.1)]'
                          : 'border-white/10 bg-transparent text-white/50 hover:bg-white/[0.05] hover:text-white/90'
                      }`}
                    >
                      <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${selectedSkill === s.id ? 'animate-pulse bg-indigo-300' : 'bg-white/35'}`} />
                      {getLocalizedSkillNameById(s.id, s.name, t)}
                    </button>
                    {showSkillDesc === s.id && s.description ? (
                      <div className="theme-menu-panel absolute left-0 top-full z-50 mt-2 w-64 rounded-lg p-2.5 text-xs leading-relaxed text-secondary-text shadow-xl animate-fade-in">
                        <p className="mb-1 font-medium text-foreground">{getLocalizedSkillNameById(s.id, s.name, t)}</p>
                        <p>{s.description}</p>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>

      <PageBriefDrawer
        isOpen={isBriefDrawerOpen}
        onClose={() => setIsBriefDrawerOpen(false)}
        title={chat('title')}
        testId="chat-bento-drawer"
        summary={language === 'en'
          ? 'The chat surface now behaves like a dense three-column research desk with persistent history, a wide answer canvas, and a dedicated strategy console.'
          : '问股页现在是一套高密度三栏研究工作台：左侧历史、中间回答画布、右侧独立策略控制台。'}
        metrics={[
          {
            label: language === 'en' ? 'Engine' : '分析引擎',
            value: selectedSkillLabel,
            tone: selectedSkill ? 'bullish' : 'neutral',
          },
          {
            label: language === 'en' ? 'Conversations' : '历史对话',
            value: sessions.length,
          },
          {
            label: language === 'en' ? 'Visible messages' : '当前消息',
            value: messages.length,
            tone: loading ? 'bullish' : 'neutral',
          },
          {
            label: language === 'en' ? 'Console state' : '指挥中心',
            value: sending ? chat('notifySending') : chat('notifyAction'),
            tone: sendToast?.type === 'error' ? 'bearish' : sending ? 'bullish' : 'neutral',
          },
        ]}
        bullets={[
          language === 'en'
            ? 'Desktop keeps history on the left, the answer stream in the center, and strategy switches in an isolated right rail.'
            : '桌面端把历史对话固定在左侧，中间保留纯回答画布，右侧单独承载策略切换。',
          language === 'en'
            ? 'The docked bottom composer uses a stronger gradient shield and bottom-safe padding so long replies no longer bleed under the input area.'
            : '吸底输入区现在配合更强的渐变遮罩与底部安全留白，长回复不会再钻进输入框下方。',
          language === 'en'
            ? 'Assistant typography is compressed to a denser 15px/1.6 reading rhythm without sacrificing streaming behavior.'
            : 'AI 文本被压到更高密度的 15px/1.6 阅读节奏，同时保留流式输出体验。',
        ]}
        footnote={language === 'en' ? 'Session and agent APIs unchanged.' : '会话与 agent API 保持不变。'}
      />
    </div>
  );
};

export default ChatPage;
