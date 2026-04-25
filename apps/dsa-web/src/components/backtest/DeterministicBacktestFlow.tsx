import type React from 'react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ApiErrorAlert, Badge, Button, Card, Disclosure } from '../../components/common';
import type { ParsedApiError } from '../../api/error';
import type {
  AssumptionMap,
  RuleBacktestHistoryItem,
  RuleBacktestParseResponse,
} from '../../types/backtest';
import {
  AssumptionList,
  Banner,
  RULE_BENCHMARK_OPTIONS,
  RuleRunsTable,
  SectionEyebrow,
  MetricCard,
  SummaryStrip,
  buildPeriodicAssumptionLabels,
  getBenchmarkModeLabel,
  type RuleBenchmarkMode,
  getStrategyPreviewSpec,
  getStrategySpecValue,
} from './shared';
import {
  buildRuleStrategySummaryRows,
  formatRuleNormalizationStateLabel,
  getRuleStrategySpecSourceLabel,
  getRuleStrategyTypeLabel,
} from './strategyInspectability';
import {
  deleteRuleBacktestPreset,
  loadRuleBacktestPresets,
  type RuleBacktestPreset,
} from './ruleBacktestP6';
import { useI18n } from '../../contexts/UiLanguageContext';

export type RuleWizardStep = 'symbol' | 'setup' | 'strategy' | 'confirm' | 'run';

type ProfessionalStep = RuleWizardStep;
type NormalStep = Exclude<RuleWizardStep, 'confirm'>;
type BacktestLanguage = 'zh' | 'en';

const PROFESSIONAL_STEP_ORDER: ProfessionalStep[] = ['symbol', 'setup', 'strategy', 'confirm', 'run'];
const NORMAL_STEP_ORDER: NormalStep[] = ['symbol', 'setup', 'strategy', 'run'];

const PROFESSIONAL_STEP_LABELS: Record<BacktestLanguage, Record<ProfessionalStep, { title: string; short: string }>> = {
  zh: {
    symbol: { title: '基础参数', short: '参数' },
    setup: { title: '策略输入', short: '输入' },
    strategy: { title: '解析确认', short: '确认' },
    confirm: { title: '执行设置', short: '执行' },
    run: { title: '运行控制', short: '运行' },
  },
  en: {
    symbol: { title: 'Core setup', short: 'Setup' },
    setup: { title: 'Strategy input', short: 'Input' },
    strategy: { title: 'Parse review', short: 'Review' },
    confirm: { title: 'Execution settings', short: 'Exec' },
    run: { title: 'Run controls', short: 'Run' },
  },
};

const NORMAL_STEP_LABELS: Record<BacktestLanguage, Record<NormalStep, { title: string; short: string }>> = {
  zh: {
    symbol: { title: '基础参数', short: '参数' },
    setup: { title: '策略输入', short: '输入' },
    strategy: { title: '策略确认', short: '确认' },
    run: { title: '开始运行', short: '运行' },
  },
  en: {
    symbol: { title: 'Core setup', short: 'Setup' },
    setup: { title: 'Strategy input', short: 'Input' },
    strategy: { title: 'Strategy review', short: 'Review' },
    run: { title: 'Run backtest', short: 'Run' },
  },
};

const STRATEGY_EXAMPLES: Record<BacktestLanguage, string[]> = {
  zh: [
    'MACD 金叉买入，死叉卖出',
    '5日均线上穿20日均线买入，下穿卖出',
    '从2025-01-01到2025-12-31，每月定投1000美元AAPL',
    'RSI 小于 30 买入，大于 70 卖出',
  ],
  en: [
    'Buy on a MACD bullish crossover and sell on a bearish crossover',
    'Buy when the 5-day moving average crosses above the 20-day average, and sell on the reverse crossover',
    'Invest 1000 USD into AAPL every month from 2025-01-01 to 2025-12-31',
    'Buy when RSI drops below 30 and sell when it rises above 70',
  ],
};

const FLOW_PANEL_TRANSITION = {
  duration: 0.24,
  ease: [0.22, 1, 0.36, 1] as const,
};

type ParseState = 'empty' | 'ready' | 'assumed' | 'unsupported' | 'stale';

type StrategyFieldSource = 'explicit' | 'derived' | 'compat';
type StrategyPreviewRow = { label: string; value: string; source?: StrategyFieldSource | null; numericValue?: number | null };
type StrategyPreviewCardGroup = { label: string; items: string[] };
type StrategyFieldSourceHint = {
  specPaths?: string[][];
  setupKeys?: string[];
  assumptionKeys?: string[];
  assumptionKeywords?: string[];
  warningCodes?: string[];
  warningKeywords?: string[];
};

function getParsedExecutable(parsed: RuleBacktestParseResponse | null): boolean {
  if (!parsed) return false;
  if (typeof parsed.executable === 'boolean') return parsed.executable;
  return Boolean(parsed.parsedStrategy.executable);
}

function getParsedNormalizationState(parsed: RuleBacktestParseResponse | null): string {
  if (!parsed) return 'pending';
  return String(parsed.normalizationState || parsed.parsedStrategy.normalizationState || 'pending');
}

function getParsedAssumptionRecords(parsed: RuleBacktestParseResponse | null): Array<Record<string, unknown>> {
  if (!parsed) return [];
  const topLevel = Array.isArray(parsed.assumptions) ? parsed.assumptions : [];
  if (topLevel.length > 0) return topLevel;
  return Array.isArray(parsed.parsedStrategy.assumptions) ? parsed.parsedStrategy.assumptions : [];
}

function getParsedAssumptionGroups(parsed: RuleBacktestParseResponse | null): Array<Record<string, unknown>> {
  if (!parsed) return [];
  const topLevel = Array.isArray(parsed.assumptionGroups) ? parsed.assumptionGroups : [];
  if (topLevel.length > 0) return topLevel;
  return Array.isArray(parsed.parsedStrategy.assumptionGroups) ? parsed.parsedStrategy.assumptionGroups : [];
}

function getUnsupportedReason(parsed: RuleBacktestParseResponse | null): string | null {
  if (!parsed) return null;
  return String(parsed.unsupportedReason || parsed.parsedStrategy.unsupportedReason || '') || null;
}

function getUnsupportedDetails(parsed: RuleBacktestParseResponse | null): Array<Record<string, unknown>> {
  if (!parsed) return [];
  const topLevel = Array.isArray(parsed.unsupportedDetails) ? parsed.unsupportedDetails : [];
  if (topLevel.length > 0) return topLevel;
  return Array.isArray(parsed.parsedStrategy.unsupportedDetails) ? parsed.parsedStrategy.unsupportedDetails : [];
}

function getUnsupportedExtensions(parsed: RuleBacktestParseResponse | null): Array<Record<string, unknown>> {
  if (!parsed) return [];
  const topLevel = Array.isArray(parsed.unsupportedExtensions) ? parsed.unsupportedExtensions : [];
  if (topLevel.length > 0) return topLevel;
  return Array.isArray(parsed.parsedStrategy.unsupportedExtensions) ? parsed.parsedStrategy.unsupportedExtensions : [];
}

function getDetectedStrategyFamily(parsed: RuleBacktestParseResponse | null): string | null {
  if (!parsed) return null;
  return String(parsed.detectedStrategyFamily || parsed.parsedStrategy.detectedStrategyFamily || '') || null;
}

function getCoreIntentSummary(parsed: RuleBacktestParseResponse | null): string | null {
  if (!parsed) return null;
  return String(parsed.coreIntentSummary || parsed.parsedStrategy.coreIntentSummary || '') || null;
}

function getSupportedPortionSummary(parsed: RuleBacktestParseResponse | null): string | null {
  if (!parsed) return null;
  return String(parsed.supportedPortionSummary || parsed.parsedStrategy.supportedPortionSummary || '') || null;
}

function getRewriteSuggestions(parsed: RuleBacktestParseResponse | null): Array<Record<string, unknown>> {
  if (!parsed) return [];
  const topLevel = Array.isArray(parsed.rewriteSuggestions) ? parsed.rewriteSuggestions : [];
  if (topLevel.length > 0) return topLevel;
  return Array.isArray(parsed.parsedStrategy.rewriteSuggestions) ? parsed.parsedStrategy.rewriteSuggestions : [];
}

function getParseWarnings(parsed: RuleBacktestParseResponse | null): Array<Record<string, unknown>> {
  if (!parsed) return [];
  const topLevel = Array.isArray(parsed.parseWarnings) ? parsed.parseWarnings : [];
  if (topLevel.length > 0) return topLevel;
  return Array.isArray(parsed.parsedStrategy.parseWarnings) ? parsed.parsedStrategy.parseWarnings : [];
}

function hasMeaningfulNode(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const candidate = node as { type?: string; rules?: unknown[] };
  if (candidate.type === 'comparison') return true;
  if (candidate.type === 'group' && Array.isArray(candidate.rules)) {
    return candidate.rules.some((child) => hasMeaningfulNode(child));
  }
  return false;
}

function getLocalizedStrategyTypeLabel(parsed: RuleBacktestParseResponse | null, language: BacktestLanguage): string {
  return getRuleStrategyTypeLabel(parsed?.parsedStrategy, getDetectedStrategyFamily(parsed), language);
}

function getStrategySpecSourceLabel(parsed: RuleBacktestParseResponse | null, language: BacktestLanguage): string {
  return getRuleStrategySpecSourceLabel(parsed?.parsedStrategy, language);
}

function formatAssumptionRecord(item: Record<string, unknown>, language: BacktestLanguage): string {
  const label = String(item.label || item.key || (language === 'en' ? 'Assumption' : '假设'));
  const value = item.value == null || item.value === '' ? '' : `${language === 'en' ? ': ' : '：'}${String(item.value)}`;
  const reason = String(item.reason || '').trim();
  return `${label}${value}${reason ? `${language === 'en' ? '. ' : '。'}${reason}` : ''}`;
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function getLegacySetupValue(setup: Record<string, unknown> | undefined, key: string): unknown {
  if (!setup) return undefined;
  if (key in setup) return setup[key];
  const camelKey = key.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
  if (camelKey in setup) return setup[camelKey];
  return undefined;
}

function matchesKeyword(text: string, keywords: string[]): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return keywords.some((keyword) => normalized.includes(keyword.trim().toLowerCase()));
}

function containsCjk(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value);
}

function resolveFieldSource(
  parsed: RuleBacktestParseResponse | null,
  hint: StrategyFieldSourceHint,
): StrategyFieldSource | null {
  if (!parsed) return null;

  const assumptionItems = getParsedAssumptionRecords(parsed);
  const warnings = getParseWarnings(parsed);

  if (hint.assumptionKeys?.length || hint.assumptionKeywords?.length) {
    const hasAssumptionMatch = assumptionItems.some((item) => {
      const key = String(item.key || '').trim();
      const text = [item.label, item.reason, item.value].map((value) => String(value || '')).join(' ');
      return (hint.assumptionKeys?.includes(key) ?? false)
        || (hint.assumptionKeywords ? matchesKeyword(text, hint.assumptionKeywords) : false);
    });
    if (hasAssumptionMatch) return 'derived';
  }

  if (hint.warningCodes?.length || hint.warningKeywords?.length) {
    const hasWarningMatch = warnings.some((item) => {
      const code = String(item.code || '').trim();
      const text = String(item.message || '');
      return (hint.warningCodes?.includes(code) ?? false)
        || (hint.warningKeywords ? matchesKeyword(text, hint.warningKeywords) : false);
    });
    if (hasWarningMatch) return 'derived';
  }

  const directSpec = parsed.parsedStrategy.strategySpec;
  if (directSpec && typeof directSpec === 'object') {
    const hasSpecValue = (hint.specPaths || []).some((path) => hasMeaningfulValue(getStrategySpecValue(directSpec as Record<string, unknown>, path)));
    if (hasSpecValue) return 'explicit';
  }

  const setup = parsed.parsedStrategy.setup;
  const hasSetupValue = (hint.setupKeys || []).some((key) => hasMeaningfulValue(getLegacySetupValue(setup, key)));
  if (hasSetupValue || (!directSpec && setup && typeof setup === 'object')) {
    return 'compat';
  }

  return null;
}

function getFieldSourceLabel(source: StrategyFieldSource | null | undefined, language: BacktestLanguage = 'zh'): string | null {
  if (source === 'explicit') return language === 'en' ? 'Explicit spec' : '显式结构化';
  if (source === 'derived') return language === 'en' ? 'Derived / defaulted' : '默认/推断';
  if (source === 'compat') return language === 'en' ? 'Compat setup' : '兼容 setup';
  return null;
}

function row(
  label: string,
  value: string,
  parsed: RuleBacktestParseResponse | null,
  hint: StrategyFieldSourceHint,
): StrategyPreviewRow {
  return {
    label,
    value,
    source: resolveFieldSource(parsed, hint),
  };
}

function buildConfirmationRows(
  parsed: RuleBacktestParseResponse | null,
  currentCode: string,
  startDate: string,
  endDate: string,
  language: BacktestLanguage,
): StrategyPreviewRow[] {
  if (!parsed) return [];
  const sourceHints: Record<string, StrategyFieldSourceHint> = {
    strategy_family: { specPaths: [['strategy_type']] },
    symbol: { specPaths: [['symbol']], setupKeys: ['symbol'] },
    date_range: { specPaths: [['date_range', 'start_date'], ['date_range', 'end_date']], setupKeys: ['start_date', 'end_date'] },
    initial_capital: { specPaths: [['capital', 'initial_capital']], setupKeys: ['initial_capital'] },
    frequency: { specPaths: [['schedule', 'frequency'], ['execution', 'frequency']], setupKeys: ['execution_frequency'] },
    entry: {
      specPaths: [['entry'], ['signal']],
      setupKeys: ['order_mode', 'quantity_per_trade', 'amount_per_trade', 'indicator_family', 'fast_period', 'slow_period', 'signal_period', 'period', 'lower_threshold', 'upper_threshold'],
      warningCodes: ['default_macd_periods'],
      warningKeywords: ['默认使用', '未显式写出'],
    },
    fill_timing: {
      specPaths: [['entry', 'price_basis'], ['execution', 'fill_timing']],
      setupKeys: ['execution_price_basis'],
      assumptionKeys: ['fill_timing', 'entry_fill_timing', 'simulated_entry_timing'],
      assumptionKeywords: ['成交时点', '开盘执行', '下一根开盘'],
    },
    exit: { specPaths: [['exit'], ['end_behavior', 'policy']], setupKeys: ['exit_policy'] },
    cash_policy: { specPaths: [['position_behavior', 'cash_policy']], setupKeys: ['cash_policy'] },
    signal_timing: {
      specPaths: [['execution', 'signal_timing']],
      assumptionKeys: ['analysis_signal_timing', 'signal_evaluation_timing'],
      assumptionKeywords: ['信号时点', '收盘后判定'],
    },
    end_behavior: { specPaths: [['end_behavior', 'policy']] },
    costs: { specPaths: [['costs', 'fee_bps'], ['costs', 'slippage_bps']], setupKeys: ['fee_bps', 'slippage_bps'] },
  };

  return buildRuleStrategySummaryRows(parsed.parsedStrategy, currentCode, startDate, endDate, getDetectedStrategyFamily(parsed), language)
    .map((item) => row(item.label, item.value, parsed, sourceHints[item.key] || {}));
}

function getUnsupportedMessages(parsed: RuleBacktestParseResponse, language: BacktestLanguage): string[] {
  const details = getUnsupportedDetails(parsed);
  if (details.length > 0) {
    return details.slice(0, 3).map((item) => String(item.message || item.title || (language === 'en' ? 'This setup is not supported yet.' : '当前不支持。')));
  }
  const unsupportedReason = getUnsupportedReason(parsed);
  if (unsupportedReason) {
    return [
      unsupportedReason,
      language === 'en'
        ? 'Add the missing fields or rewrite the setup into a supported deterministic single-instrument rule.'
        : '请补齐关键字段，或改写成当前已支持的确定性单标的规则。',
    ];
  }
  const messages = parsed.ambiguities
    .slice(0, 3)
    .map((item) => String(item.message || item.suggestion || '').trim())
    .filter(Boolean);

  if (messages.length > 0) return messages;
  return language === 'en'
    ? ['The current input has not been normalized into an executable deterministic rule yet.', 'Tighten the wording, or switch to a supported single-instrument accumulation or simple rule-based strategy.']
    : ['当前输入还没有被归一化成可执行的确定性规则。', '请收紧表达，或改用当前已支持的单标的区间定投 / 简单条件规则。'];
}

function getParseState(parsed: RuleBacktestParseResponse | null, parseStale: boolean): ParseState {
  if (!parsed) return 'empty';
  if (parseStale) return 'stale';

  const normalizationState = getParsedNormalizationState(parsed);
  if (normalizationState === 'ready') return 'ready';
  if (normalizationState === 'assumed') return 'assumed';
  if (normalizationState === 'unsupported') return 'unsupported';

  const spec = getStrategyPreviewSpec(parsed);
  const strategyType = String(getStrategySpecValue(spec, ['strategy_type']) || parsed.parsedStrategy.strategyKind || '');
  const executable = getParsedExecutable(parsed) || strategyType === 'periodic_accumulation'
    || (strategyType === 'rule_conditions' && hasMeaningfulNode(parsed.parsedStrategy.entry) && hasMeaningfulNode(parsed.parsedStrategy.exit));
  if (!executable) return 'unsupported';

  const unsupportedCodes = new Set(['missing_symbol', 'unknown_operand', 'unparsed_atom', 'missing_exit', 'empty_rule']);
  const hasUnsupportedAmbiguity = parsed.ambiguities.some((item) => unsupportedCodes.has(String(item.code || '')));
  if (hasUnsupportedAmbiguity) return 'unsupported';

  if (parsed.needsConfirmation || parsed.ambiguities.length > 0 || parsed.confidence < 0.9) return 'assumed';
  return 'ready';
}

function getParseStateMeta(parseState: ParseState, language: BacktestLanguage = 'zh'): { tone: 'default' | 'success' | 'warning' | 'danger' | 'info'; label: string; title: string } {
  if (language === 'en') {
    if (parseState === 'ready') return { tone: 'success', label: 'Runnable', title: 'Normalization complete' };
    if (parseState === 'assumed') return { tone: 'warning', label: 'Needs review', title: 'Contains derived defaults' };
    if (parseState === 'unsupported') return { tone: 'danger', label: 'Unsupported', title: 'Not supported yet' };
    if (parseState === 'stale') return { tone: 'warning', label: 'Stale', title: 'Parse result is stale' };
    return { tone: 'info', label: 'Pending parse', title: 'Waiting for parse' };
  }
  if (parseState === 'ready') return { tone: 'success', label: '可运行', title: '已完成归一化' };
  if (parseState === 'assumed') return { tone: 'warning', label: '待确认', title: '含默认假设' };
  if (parseState === 'unsupported') return { tone: 'danger', label: '不支持', title: '当前不支持' };
  if (parseState === 'stale') return { tone: 'warning', label: '已过期', title: '解析结果已过期' };
  return { tone: 'info', label: '待解析', title: '等待解析' };
}

function StrategySpecSummaryCard({
  parsed,
  currentCode,
  startDate,
  endDate,
}: {
  parsed: RuleBacktestParseResponse | null;
  currentCode: string;
  startDate: string;
  endDate: string;
}) {
  const { language } = useI18n();
  const rows = buildConfirmationRows(parsed, currentCode, startDate, endDate, language);
  if (!rows.length) return <div className="product-empty-state product-empty-state--compact">{language === 'en' ? 'No strategy spec is available yet.' : '暂无策略规格。'}</div>;

  return (
    <div className="preview-grid">
      {rows.map((row) => (
        <div key={`${row.label}-${row.value}`} className="preview-card">
          <p className="metric-card__label">{row.label}</p>
          {getFieldSourceLabel(row.source, language) ? (
            <div className="product-chip-list product-chip-list--tight">
              <span className="product-chip">{getFieldSourceLabel(row.source, language)}</span>
            </div>
          ) : null}
          <p className="preview-card__text">{row.value}</p>
        </div>
      ))}
    </div>
  );
}

function getRiskControlRows(parsed: RuleBacktestParseResponse | null): StrategyPreviewRow[] {
  const strategySpec = getStrategyPreviewSpec(parsed);
  const controls = [
    {
      label: '止损',
      value: getStrategySpecValue(strategySpec, ['risk_controls', 'stop_loss_pct']),
    },
    {
      label: '止盈',
      value: getStrategySpecValue(strategySpec, ['risk_controls', 'take_profit_pct']),
    },
    {
      label: '移动止损',
      value: getStrategySpecValue(strategySpec, ['risk_controls', 'trailing_stop_pct']),
    },
  ];

  return controls
    .filter((item) => typeof item.value === 'number' && Number.isFinite(item.value))
    .map((item) => ({
      label: item.label,
      value: `${Number(item.value).toFixed(2)}%`,
      numericValue: Number(item.value),
      source: 'explicit',
    }));
}

function StrategyParseDetails({
  parsed,
}: {
  parsed: RuleBacktestParseResponse | null;
}) {
  const { language } = useI18n();
  if (!parsed) return <div className="product-empty-state product-empty-state--compact">{language === 'en' ? 'No parse detail is available yet.' : '暂无解析细节。'}</div>;

  const normalizedText = String(parsed.parsedStrategy.normalizedText || '').trim();
  const sourceText = String(parsed.parsedStrategy.sourceText || parsed.strategyText || '').trim();

  return (
    <div className="summary-block">
      <div className="summary-block__header">
        <div>
          <SectionEyebrow>{language === 'en' ? 'Parse detail' : '解析细节'}</SectionEyebrow>
          <h3 className="summary-block__title">{language === 'en' ? 'Source input and normalized expression' : '原始输入与归一化表达'}</h3>
        </div>
      </div>
      <div className="preview-grid">
        <div className="preview-card">
          <p className="metric-card__label">{language === 'en' ? 'Spec source' : '规格来源'}</p>
          <p className="preview-card__text">{getStrategySpecSourceLabel(parsed, language)}</p>
        </div>
        <div className="preview-card">
          <p className="metric-card__label">{language === 'en' ? 'Needs confirmation' : '需要确认'}</p>
          <p className="preview-card__text">{parsed.needsConfirmation ? (language === 'en' ? 'Yes' : '是') : (language === 'en' ? 'No' : '否')}</p>
        </div>
      </div>
      <div className="mt-4">
        <p className="metric-card__label">{language === 'en' ? 'Source input' : '原始输入'}</p>
        <p className="product-section-copy">{sourceText || '--'}</p>
      </div>
      <div className="mt-4">
        <p className="metric-card__label">{language === 'en' ? 'Normalized expression' : '归一化表达'}</p>
        <p className="product-section-copy">{normalizedText || '--'}</p>
      </div>
    </div>
  );
}

function buildAssumptionCards(
  assumptionGroups: Array<Record<string, unknown>>,
  assumptionItems: string[],
  parseWarnings: Array<Record<string, unknown>>,
  ambiguities: Array<Record<string, unknown>>,
  language: BacktestLanguage,
): StrategyPreviewCardGroup[] {
  const cards: StrategyPreviewCardGroup[] = [];

  if (assumptionGroups.length > 0) {
    cards.push(
      ...assumptionGroups.map((group, index) => ({
        label: String(group.label || (language === 'en' ? `Default assumption ${index + 1}` : `默认假设 ${index + 1}`)),
        items: (Array.isArray(group.items) ? group.items : [])
          .map((item) => formatAssumptionRecord(item as Record<string, unknown>, language))
          .filter(Boolean),
      })),
    );
  } else if (assumptionItems.length > 0) {
    cards.push({
      label: language === 'en' ? 'Default assumptions' : '默认假设',
      items: assumptionItems,
    });
  }

  const warningItems = [
    ...parseWarnings.slice(0, 4).map((item) => String(item.message || (language === 'en' ? 'Please review this manually.' : '请人工确认。'))),
    ...ambiguities.slice(0, 4).map((item) => String(item.message || item.suggestion || (language === 'en' ? 'Please review this manually.' : '请人工确认。'))),
  ].filter(Boolean);

  if (warningItems.length > 0) {
    cards.push({
      label: language === 'en' ? 'Derived notes and warnings' : '推断与提醒',
      items: warningItems,
    });
  }

  return cards.filter((card) => card.items.length > 0);
}

type FlowProps = {
  code: string;
  onCodeChange: (value: string) => void;
  onCodeEnter: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  strategyText: string;
  onStrategyTextChange: (value: string) => void;
  startDate: string;
  onStartDateChange: (value: string) => void;
  endDate: string;
  onEndDateChange: (value: string) => void;
  initialCapital: string;
  onInitialCapitalChange: (value: string) => void;
  lookbackBars: string;
  onLookbackBarsChange: (value: string) => void;
  feeBps: string;
  onFeeBpsChange: (value: string) => void;
  slippageBps: string;
  onSlippageBpsChange: (value: string) => void;
  benchmarkMode: RuleBenchmarkMode;
  onBenchmarkModeChange: (value: RuleBenchmarkMode) => void;
  benchmarkCode: string;
  onBenchmarkCodeChange: (value: string) => void;
  parsedStrategy: RuleBacktestParseResponse | null;
  confirmed: boolean;
  onToggleConfirmed: (value: boolean) => void;
  isParsing: boolean;
  parseError: ParsedApiError | null;
  onParse: () => Promise<void>;
  isSubmitting: boolean;
  runError: ParsedApiError | null;
  onRun: () => Promise<void>;
  onReset: () => void;
  historyItems: RuleBacktestHistoryItem[];
  historyTotal: number;
  historyPage: number;
  selectedRunId: number | null;
  isLoadingHistory: boolean;
  historyError: ParsedApiError | null;
  onRefreshHistory: () => void;
  onOpenHistoryRun: (run: RuleBacktestHistoryItem) => void;
  previewAssumptions: AssumptionMap;
  currentStep: RuleWizardStep;
  onStepChange: (step: RuleWizardStep) => void;
  parseStale: boolean;
  onApplyRewriteSuggestion: (value: string) => void;
  appliedRewriteText: string | null;
  panelMode: 'normal' | 'professional';
};

const DeterministicBacktestFlow: React.FC<FlowProps> = ({
  code,
  onCodeChange,
  onCodeEnter,
  strategyText,
  onStrategyTextChange,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  initialCapital,
  onInitialCapitalChange,
  lookbackBars,
  onLookbackBarsChange,
  feeBps,
  onFeeBpsChange,
  slippageBps,
  onSlippageBpsChange,
  benchmarkMode,
  onBenchmarkModeChange,
  benchmarkCode,
  onBenchmarkCodeChange,
  parsedStrategy,
  confirmed,
  onToggleConfirmed,
  isParsing,
  parseError,
  onParse,
  isSubmitting,
  runError,
  onRun,
  onReset,
  historyItems,
  historyTotal,
  historyPage,
  selectedRunId,
  isLoadingHistory,
  historyError,
  onRefreshHistory,
  onOpenHistoryRun,
  previewAssumptions,
  currentStep,
  onStepChange,
  parseStale,
  onApplyRewriteSuggestion,
  appliedRewriteText,
  panelMode,
}) => {
  const { language } = useI18n();
  const stepRefs = useRef<Partial<Record<RuleWizardStep, HTMLDivElement | null>>>({});
  const setStepRef = useCallback(
    (step: RuleWizardStep) => (node: HTMLDivElement | null) => {
      stepRefs.current[step] = node;
    },
    [],
  );

  const focusStep = useCallback((step: RuleWizardStep) => {
    onStepChange(step);
    const node = stepRefs.current[step];
    node?.scrollIntoView?.({ block: 'nearest' });
    const focusable = node?.querySelector<HTMLElement>(
      'input, textarea, select, button, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
  }, [onStepChange]);

  const parseState = getParseState(parsedStrategy, parseStale);
  const parseMeta = getParseStateMeta(parseState, language);
  const strategySpec = getStrategyPreviewSpec(parsedStrategy);
  const riskControlRows = getRiskControlRows(parsedStrategy);
  const strongestRiskControl = riskControlRows.reduce((max, row) => Math.max(max, Number(row.numericValue || 0)), 0);
  const assumptionGroups = getParsedAssumptionGroups(parsedStrategy);
  const coreIntentSummary = getCoreIntentSummary(parsedStrategy);
  const supportedPortionSummary = getSupportedPortionSummary(parsedStrategy);
  const unsupportedExtensions = getUnsupportedExtensions(parsedStrategy);
  const rewriteSuggestions = getRewriteSuggestions(parsedStrategy);
  const parseWarnings = getParseWarnings(parsedStrategy);
  const assumptionItems = getParsedAssumptionRecords(parsedStrategy).length > 0
    ? getParsedAssumptionRecords(parsedStrategy).map((item) => formatAssumptionRecord(item, language))
    : (
      String(getStrategySpecValue(strategySpec, ['strategy_type']) || parsedStrategy?.parsedStrategy.strategyKind || '') === 'periodic_accumulation'
        ? buildPeriodicAssumptionLabels(strategySpec, language)
        : []
    );
  const assumptionCards = buildAssumptionCards(
    assumptionGroups,
    assumptionItems,
    parseWarnings,
    parsedStrategy?.ambiguities || [],
    language,
  );
  const canProceedFromBaseParams = Boolean(
    startDate
    && endDate
    && initialCapital
    && startDate <= endDate
    && (benchmarkMode !== 'custom_code' || benchmarkCode.trim()),
  );
  const canProceedFromConfirm = (parseState === 'ready' || parseState === 'assumed') && confirmed && !parseStale;
  const isProfessionalMode = panelMode === 'professional';
  const professionalCurrentStepIndex = PROFESSIONAL_STEP_ORDER.indexOf(currentStep);
  const professionalStepLabels = PROFESSIONAL_STEP_LABELS[language];
  const normalCurrentStep = currentStep === 'confirm' ? 'strategy' : currentStep;
  const normalCurrentStepIndex = NORMAL_STEP_ORDER.indexOf(normalCurrentStep);
  const normalStepLabels = NORMAL_STEP_LABELS[language];
  const [presets, setPresets] = useState<RuleBacktestPreset[]>(() => loadRuleBacktestPresets());

  const handleStepSelect = useCallback((step: RuleWizardStep) => {
    if (isProfessionalMode) {
      focusStep(step);
      return;
    }
    onStepChange(step);
  }, [focusStep, isProfessionalMode, onStepChange]);

  const handleNormalRun = useCallback(async () => {
    onStepChange('run');
    await onRun();
  }, [onRun, onStepChange]);

  useEffect(() => {
    if (!isProfessionalMode && currentStep === 'confirm') {
      onStepChange('strategy');
    }
  }, [currentStep, isProfessionalMode, onStepChange]);

  const handleApplyPreset = useCallback((preset: RuleBacktestPreset) => {
    onCodeChange(preset.code);
    onStrategyTextChange(preset.strategyText);
    onStartDateChange(preset.startDate);
    onEndDateChange(preset.endDate);
    onLookbackBarsChange(preset.lookbackBars);
    onInitialCapitalChange(preset.initialCapital);
    onFeeBpsChange(preset.feeBps);
    onSlippageBpsChange(preset.slippageBps);
    onBenchmarkModeChange((preset.benchmarkMode as RuleBenchmarkMode) || 'auto');
    onBenchmarkCodeChange(preset.benchmarkCode);
    onToggleConfirmed(false);
    onStepChange('symbol');
  }, [
    onBenchmarkCodeChange,
    onBenchmarkModeChange,
    onCodeChange,
    onEndDateChange,
    onFeeBpsChange,
    onInitialCapitalChange,
    onLookbackBarsChange,
    onSlippageBpsChange,
    onStartDateChange,
    onStepChange,
    onStrategyTextChange,
    onToggleConfirmed,
  ]);

  const handleDeletePreset = useCallback((presetId: string) => {
    setPresets(deleteRuleBacktestPreset(presetId));
  }, []);

  const renderPresetSection = () => {
    if (presets.length === 0) return null;

    return (
      <Disclosure
        summary={language === 'en' ? `Presets (${presets.length})` : `预设（${presets.length}）`}
        className="backtest-entry-shell__disclosure"
        summaryClassName="backtest-entry-shell__disclosure-summary"
        bodyClassName="backtest-entry-shell__disclosure-body"
      >
        <div className="comparison-card-grid">
          {presets.map((preset) => (
            <div key={preset.id} className="comparison-card">
              <div className="comparison-card__header">
                <div>
                  <p className="metric-card__label">{preset.kind === 'saved' ? (language === 'en' ? 'Saved preset' : '已保存预设') : (language === 'en' ? 'Recent draft' : '最近草稿')}</p>
                  <h3 className="comparison-card__title">{language === 'en' && containsCjk(preset.name) ? preset.code : preset.name}</h3>
                </div>
                <span className="product-chip">{preset.code}</span>
              </div>
              <p className="comparison-card__meta">{preset.startDate || '--'} {'->'} {preset.endDate || '--'} · lookback {preset.lookbackBars}</p>
              <div className="product-chip-list product-chip-list--tight">
                <span className="product-chip">{preset.benchmarkMode || 'auto'}</span>
                <span className="product-chip">{language === 'en' ? 'Fee' : '费'} {preset.feeBps}bp</span>
                <span className="product-chip">{language === 'en' ? 'Slippage' : '滑'} {preset.slippageBps}bp</span>
              </div>
              <div className="product-action-row mt-4">
                <Button size="sm" variant="secondary" onClick={() => handleApplyPreset(preset)}>{language === 'en' ? 'Apply' : '应用'}</Button>
                {preset.kind === 'saved' ? (
                  <Button size="sm" variant="ghost" onClick={() => handleDeletePreset(preset.id)}>{language === 'en' ? 'Delete' : '删除'}</Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </Disclosure>
    );
  };

  const baseParamsSection = (
    <section
      ref={setStepRef('symbol')}
      id="backtest-control-section-symbol"
      className="backtest-control-section"
      data-testid="backtest-control-section-symbol"
      data-active={currentStep === 'symbol' ? 'true' : 'false'}
    >
      <Card title={language === 'en' ? 'Core setup' : '基础参数'} subtitle={language === 'en' ? 'Step 1' : '步骤 1'} className="product-section-card product-section-card--backtest-standard">
        {!isProfessionalMode ? (
          <p className="backtest-guided-step-helper">{language === 'en' ? 'Set the instrument, capital, and date range first, then move to the strategy input.' : '先确定标的、资金规模和回测区间，再进入策略输入。'}</p>
        ) : null}
        <div className="backtest-base-params-layout" data-testid="backtest-base-params-layout">
          <label className="product-field product-field--full">
            <span className="theme-field-label">{language === 'en' ? 'Ticker' : '标的代码'}</span>
            <input
              type="text"
              value={code}
              onChange={(event) => onCodeChange(event.target.value.toUpperCase())}
              onFocus={() => onStepChange('symbol')}
              onKeyDown={onCodeEnter}
              placeholder={language === 'en' ? 'For example ORCL / AAPL / 600519' : '例如 ORCL / AAPL / 600519'}
              className="input-surface input-focus-glow product-command-input"
              aria-label={language === 'en' ? 'Ticker' : '股票代码'}
            />
          </label>
          <div className="backtest-date-range-grid" data-testid="backtest-base-date-range">
            <label className="product-field">
              <span className="theme-field-label">{language === 'en' ? 'Start date' : '开始日期'}</span>
              <input
                type="date"
                value={startDate}
                onChange={(event) => onStartDateChange(event.target.value)}
                onFocus={() => onStepChange('symbol')}
                className="input-surface input-focus-glow product-command-input"
                aria-label={language === 'en' ? 'Start date' : '开始日期'}
              />
            </label>
            <label className="product-field">
              <span className="theme-field-label">{language === 'en' ? 'End date' : '结束日期'}</span>
              <input
                type="date"
                value={endDate}
                onChange={(event) => onEndDateChange(event.target.value)}
                onFocus={() => onStepChange('symbol')}
                className="input-surface input-focus-glow product-command-input"
                aria-label={language === 'en' ? 'End date' : '结束日期'}
              />
            </label>
          </div>
          <label className="product-field product-field--full">
            <span className="theme-field-label">{language === 'en' ? 'Initial capital' : '初始资金'}</span>
            <input
              type="number"
              min={1}
              value={initialCapital}
              onChange={(event) => onInitialCapitalChange(event.target.value)}
              onFocus={() => onStepChange('symbol')}
              className="input-surface input-focus-glow product-command-input"
              aria-label={language === 'en' ? 'Initial capital' : '初始资金'}
            />
          </label>
          <label className="product-field product-field--full">
            <span className="theme-field-label">{language === 'en' ? 'Benchmark' : '对比基准'}</span>
            <select
              value={benchmarkMode}
              onChange={(event) => onBenchmarkModeChange(event.target.value as RuleBenchmarkMode)}
              onFocus={() => onStepChange('symbol')}
              className="input-surface input-focus-glow product-command-input"
              aria-label={language === 'en' ? 'Benchmark' : '对比基准'}
            >
              {RULE_BENCHMARK_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {getBenchmarkModeLabel(option.value, code, benchmarkCode, language)}
                </option>
              ))}
            </select>
          </label>
          {benchmarkMode === 'custom_code' ? (
            <label className="product-field product-field--full">
              <span className="theme-field-label">{language === 'en' ? 'Custom benchmark code' : '自定义基准代码'}</span>
              <input
                type="text"
                value={benchmarkCode}
                onChange={(event) => onBenchmarkCodeChange(event.target.value.toUpperCase())}
                onFocus={() => onStepChange('symbol')}
                placeholder={language === 'en' ? 'For example QQQ / SPY / ^NDX / 000300' : '例如 QQQ / SPY / ^NDX / 000300'}
                className="input-surface input-focus-glow product-command-input"
                aria-label={language === 'en' ? 'Custom benchmark code' : '自定义基准代码'}
              />
            </label>
          ) : null}
        </div>
        <div className="product-chip-list">
          <span className="product-chip">{language === 'en' ? 'Instrument' : '当前标的'}: {code || '--'}</span>
          <span className="product-chip">{language === 'en' ? 'Benchmark' : '对比基准'}: {getBenchmarkModeLabel(benchmarkMode, code, benchmarkCode, language)}</span>
          <span className="product-chip">{language === 'en' ? 'Strategy type' : '策略类型'}: {parsedStrategy ? getLocalizedStrategyTypeLabel(parsedStrategy, language) : (language === 'en' ? 'Pending parse' : '待解析')}</span>
        </div>
        <div className="product-action-row backtest-control-actions backtest-control-actions--footer">
          <Button onClick={() => handleStepSelect('setup')} disabled={!canProceedFromBaseParams}>
            {language === 'en' ? 'Continue' : '继续'}
          </Button>
        </div>
      </Card>
    </section>
  );

  const strategyInputSection = (
    <section
      ref={setStepRef('setup')}
      id="backtest-control-section-setup"
      className="backtest-control-section"
      data-testid="backtest-control-section-setup"
      data-active={currentStep === 'setup' ? 'true' : 'false'}
    >
      <Card title={language === 'en' ? 'Strategy input' : '策略输入'} subtitle={language === 'en' ? 'Step 2' : '步骤 2'} className="product-section-card product-section-card--backtest-flow">
        {!isProfessionalMode ? (
          <p className="backtest-guided-step-helper">{language === 'en' ? 'Describe the rule in natural language, or start from one of the examples below.' : '用自然语言描述规则，或直接点一个示例作为确定性起点。'}</p>
        ) : null}
        <label className="product-field product-field--full">
          <span className="theme-field-label">{language === 'en' ? 'Natural-language strategy' : '自然语言策略'}</span>
          <AnimatePresence initial={false}>
            {appliedRewriteText ? (
              <motion.div
                key="rewrite-banner"
                className="mb-4"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={FLOW_PANEL_TRANSITION}
              >
                <Banner
                  tone="info"
                  title={language === 'en' ? 'Applied rewrite suggestion' : '已应用建议改写'}
                  body={language === 'en' ? 'The strategy text has been replaced with the suggested version. Parse it again before continuing.' : '策略文本已替换为建议版本。请重新解析后继续。'}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>
          <textarea
            aria-label={language === 'en' ? 'Strategy text' : '策略文本'}
            value={strategyText}
            onChange={(event) => onStrategyTextChange(event.target.value)}
            onFocus={() => onStepChange('setup')}
            rows={7}
            autoFocus={Boolean(appliedRewriteText)}
            className="input-surface input-focus-glow product-command-input product-command-input--textarea"
            placeholder={language === 'en' ? 'For example: Start with 100000, buy 100 shares of ORCL every trading day from 2025-01-01 to 2025-12-31, and stop when cash runs out' : '例如：资金100000，从2025-01-01到2025-12-31，每天买100股ORCL，买到资金耗尽为止'}
          />
        </label>

        <div className="product-chip-list wizard-example-chips">
          {STRATEGY_EXAMPLES[language].map((example) => (
            <button
              key={example}
              type="button"
              className="product-chip product-chip--button"
              onClick={() => {
                onStepChange('setup');
                onStrategyTextChange(example);
              }}
            >
              {example}
            </button>
          ))}
        </div>

        <div className="product-action-row backtest-control-actions backtest-control-actions--footer">
          <Button variant="ghost" onClick={() => handleStepSelect('symbol')}>{language === 'en' ? 'Back' : '返回'}</Button>
          <Button
            variant="secondary"
            onClick={() => void onParse()}
            isLoading={isParsing}
            loadingText={language === 'en' ? 'Parsing…' : '解析中…'}
            disabled={!canProceedFromBaseParams || !strategyText.trim()}
          >
            {appliedRewriteText ? (language === 'en' ? 'Parse again' : '重新解析') : (language === 'en' ? 'Parse strategy' : '解析策略')}
          </Button>
        </div>
        {parseError ? <ApiErrorAlert error={parseError} className="mt-4" /> : null}
      </Card>
    </section>
  );

  const executionSettingsFields = (
    <div className="product-field-grid backtest-control-grid">
      <label className="product-field">
        <span className="theme-field-label">{language === 'en' ? 'Lookback window' : '回看范围'}</span>
        <input
          type="number"
          min={10}
          max={5000}
          value={lookbackBars}
          onChange={(event) => onLookbackBarsChange(event.target.value)}
          onFocus={() => onStepChange(isProfessionalMode ? 'confirm' : 'strategy')}
          className="input-surface input-focus-glow product-command-input"
          aria-label={language === 'en' ? 'Lookback window' : '回看范围'}
        />
      </label>
      <label className="product-field">
        <span className="theme-field-label">{language === 'en' ? 'Fees (bp)' : '手续费 (bp)'}</span>
        <input
          type="number"
          min={0}
          max={500}
          value={feeBps}
          onChange={(event) => onFeeBpsChange(event.target.value)}
          onFocus={() => onStepChange(isProfessionalMode ? 'confirm' : 'strategy')}
          className="input-surface input-focus-glow product-command-input"
          aria-label={language === 'en' ? 'Fee per side (bp)' : '单边手续费 (bp)'}
        />
      </label>
      <label className="product-field">
        <span className="theme-field-label">{language === 'en' ? 'Slippage (bp)' : '滑点 (bp)'}</span>
        <input
          type="number"
          min={0}
          max={500}
          value={slippageBps}
          onChange={(event) => onSlippageBpsChange(event.target.value)}
          onFocus={() => onStepChange(isProfessionalMode ? 'confirm' : 'strategy')}
          className="input-surface input-focus-glow product-command-input"
          aria-label={language === 'en' ? 'Slippage per side (bp)' : '单边滑点 (bp)'}
        />
      </label>
    </div>
  );

  const parsedStrategySection = (
    <section
      ref={setStepRef('strategy')}
      id="backtest-control-section-strategy"
      className="backtest-control-section"
      data-testid="backtest-control-section-strategy"
      data-active={currentStep === 'strategy' ? 'true' : 'false'}
    >
      <Card title={isProfessionalMode ? (language === 'en' ? 'Parse review' : '解析确认') : (language === 'en' ? 'Strategy review' : '策略确认')} subtitle={language === 'en' ? 'Step 3' : '步骤 3'} className="product-section-card product-section-card--backtest-standard">
        {!isProfessionalMode ? (
          <p className="backtest-guided-step-helper">{language === 'en' ? 'Review the normalized rule, defaults, and unsupported parts here before opening the result page.' : '确认归一化后的规则、默认假设和不支持项，再从这里进入结果页流转。'}</p>
        ) : null}
        <motion.div layout className="backtest-step-stage-shell">
          <AnimatePresence initial={false} mode="wait">
            {parseState === 'empty' ? (
              <motion.div
                key="parsed-empty"
                className="backtest-step-stage"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={FLOW_PANEL_TRANSITION}
              >
                <div className="product-empty-state product-empty-state--compact">
                  {language === 'en' ? 'Parse the strategy first, then review the normalized rule and execution defaults.' : '先完成策略解析，再继续确认归一化结果和默认假设。'}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key={`parsed-${parseState}-${parseStale ? 'stale' : 'current'}`}
                className="backtest-step-stage"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={FLOW_PANEL_TRANSITION}
              >
                <div className="summary-block" data-testid="confirm-status-section">
                  <div className="summary-block__header">
                    <div>
                      <SectionEyebrow>{language === 'en' ? 'Parse status' : '解析状态'}</SectionEyebrow>
                      <h3 className="summary-block__title">{language === 'en' ? 'Review the current parse' : '确认当前解析'}</h3>
                    </div>
                    <Badge variant={parseMeta.tone === 'success' ? 'success' : parseMeta.tone === 'danger' ? 'danger' : parseMeta.tone === 'warning' ? 'warning' : 'default'}>
                      {parseMeta.label}
                    </Badge>
                  </div>
                  <Banner
                    tone={parseMeta.tone}
                    title={parseMeta.title}
                    body={
                      parseState === 'unsupported'
                        ? getUnsupportedMessages(parsedStrategy as RuleBacktestParseResponse, language)[0]
                        : parseState === 'stale'
                          ? (language === 'en' ? 'The inputs changed. Parse again before continuing.' : '输入已变更。请重新解析后再继续。')
                          : parseState === 'assumed'
                            ? (language === 'en' ? 'The strategy is executable, but it still contains derived defaults or execution assumptions.' : '策略可执行，但包含默认值或执行假设。')
                            : (language === 'en' ? 'The strategy is normalized and ready to continue into the dedicated result page.' : '策略已归一化，可直接进入独立结果页流转。')
                    }
                  />
                </div>

                <div className="summary-block mt-4" data-testid="confirm-compact-summary-section">
                  <div className="preview-grid">
                    <div className="preview-card">
                      <p className="metric-card__label">{language === 'en' ? 'Strategy type' : '策略类型'}</p>
                      <p className="preview-card__text">{getLocalizedStrategyTypeLabel(parsedStrategy, language)}</p>
                    </div>
                    <div className="preview-card">
                      <p className="metric-card__label">{language === 'en' ? 'Ticker' : '标的'}</p>
                      <p className="preview-card__text">{code || '--'}</p>
                    </div>
                    <div className="preview-card">
                      <p className="metric-card__label">{language === 'en' ? 'Date range' : '区间'}</p>
                      <p className="preview-card__text">{startDate || '--'} {'->'} {endDate || '--'}</p>
                    </div>
                    <div className="preview-card">
                      <p className="metric-card__label">{language === 'en' ? 'Core intent' : '核心意图'}</p>
                      <p className="preview-card__text">{coreIntentSummary || supportedPortionSummary || (language === 'en' ? 'Needs review' : '待确认')}</p>
                    </div>
                  </div>
                </div>

                {riskControlRows.length ? (
                  <div className="summary-block mt-4" data-testid="confirm-additive-dashboard">
                    <div
                      className="summary-block"
                      data-testid="confirm-dashboard-risk-controls"
                      title="查看确认页风险控制 additive 摘要"
                    >
                      <div className="summary-block__header">
                        <div>
                          <SectionEyebrow>Dashboard</SectionEyebrow>
                          <h3 className="summary-block__title">风险控制卡片 / Risk Controls</h3>
                        </div>
                        <div className="product-chip-list product-chip-list--tight">
                          <span className="product-chip">已启用 {riskControlRows.length} 项</span>
                          <span className="product-chip">最高阈值 {strongestRiskControl.toFixed(2)}%</span>
                        </div>
                      </div>
                      <div className="preview-grid">
                        {riskControlRows.map((row) => (
                          <div key={`confirm-dashboard-risk-${row.label}`} className="preview-card">
                            <p className="metric-card__label">{row.label}</p>
                            <p className="preview-card__text">{row.value}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="summary-block mt-4" data-testid="confirm-executable-spec-section">
                  <div className="summary-block__header">
                    <div>
                      <SectionEyebrow>{language === 'en' ? 'Executable spec' : '可执行规格'}</SectionEyebrow>
                      <h3 className="summary-block__title">{language === 'en' ? 'What will actually run' : '实际执行内容'}</h3>
                    </div>
                  </div>
                  <p className="product-section-copy">
                    {language === 'en' ? <>The fields below come from the current canonical <code>strategy_spec</code> and directly drive the deterministic backtest.</> : <>以下字段来自当前 canonical <code>strategy_spec</code>，会直接驱动确定性回测执行。</>}
                  </p>
                  <div className="product-chip-list mb-4">
                    <span className="product-chip">{language === 'en' ? 'Strategy family' : '策略族'} · {getLocalizedStrategyTypeLabel(parsedStrategy, language)}</span>
                    <span className="product-chip">{language === 'en' ? 'Spec source' : '规格来源'} · {getStrategySpecSourceLabel(parsedStrategy, language)}</span>
                    <span className="product-chip">{language === 'en' ? 'Normalization' : '归一化'} · {formatRuleNormalizationStateLabel(getParsedNormalizationState(parsedStrategy), language)}</span>
                    <span className="product-chip">{language === 'en' ? 'Needs confirmation' : '需要确认'} · {parsedStrategy?.needsConfirmation ? (language === 'en' ? 'Yes' : '是') : (language === 'en' ? 'No' : '否')}</span>
                    <span className="product-chip">{language === 'en' ? 'Executable' : '可执行'} · {getParsedExecutable(parsedStrategy) ? (language === 'en' ? 'Yes' : '是') : (language === 'en' ? 'No' : '否')}</span>
                  </div>
                  <div className="product-chip-list product-chip-list--tight mb-4">
                    <span className="product-chip">{language === 'en' ? 'Explicit spec' : '显式结构化'}</span>
                    <span className="product-chip">{language === 'en' ? 'Derived / defaulted' : '默认/推断'}</span>
                    <span className="product-chip">{language === 'en' ? 'Compat setup' : '兼容 setup'}</span>
                  </div>
                  <StrategySpecSummaryCard parsed={parsedStrategy} currentCode={code} startDate={startDate} endDate={endDate} />
                  {riskControlRows.length ? (
                    <div className="summary-block mt-4">
                      <div className="summary-block__header">
                        <div>
                          <SectionEyebrow>风险控制</SectionEyebrow>
                          <h3 className="summary-block__title">风险控制 / Risk Controls</h3>
                        </div>
                      </div>
                      <div className="preview-grid">
                        {riskControlRows.map((row) => (
                          <div key={`${row.label}-${row.value}`} className="preview-card">
                            <p className="metric-card__label">{row.label}</p>
                            <div className="product-chip-list product-chip-list--tight">
                              <span className="product-chip">{getFieldSourceLabel(row.source)}</span>
                            </div>
                            <p className="preview-card__text">{row.value}</p>
                          </div>
                        ))}
                      </div>
                      <div className="summary-block mt-4" data-testid="confirm-risk-controls-visualization">
                        <div className="summary-block__header">
                          <div>
                            <SectionEyebrow>保护摘要</SectionEyebrow>
                            <h3 className="summary-block__title">保护梯度 / Protection Ladder</h3>
                          </div>
                          <div className="product-chip-list product-chip-list--tight">
                            <span className="product-chip">已启用 {riskControlRows.length} 项</span>
                            <span className="product-chip">最高阈值 {strongestRiskControl.toFixed(2)}%</span>
                          </div>
                        </div>
                        <div className="space-y-3">
                          {riskControlRows.map((row) => {
                            const width = strongestRiskControl > 0 && row.numericValue
                              ? Math.max(16, (row.numericValue / strongestRiskControl) * 100)
                              : 0;
                            return (
                              <div key={`risk-ladder-${row.label}`} className="space-y-1.5">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="metric-card__label">{row.label}</span>
                                  <span className="preview-card__text">{row.value}</span>
                                </div>
                                <div className="h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
                                  <div
                                    className="h-full rounded-full bg-[var(--backtest-accent,#7dd3fc)]"
                                    style={{ width: `${width}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                <Disclosure summary={language === 'en' ? 'View parse detail' : '查看解析细节'}>
                  <StrategyParseDetails parsed={parsedStrategy} />
                </Disclosure>

                {(supportedPortionSummary || unsupportedExtensions.length > 0 || rewriteSuggestions.length > 0) && (
                  <div className="summary-block mt-4" data-testid="confirm-guidance-section">
                    <div className="summary-block__header">
                      <div>
                        <SectionEyebrow>{language === 'en' ? 'Limits and rewrites' : '限制与改写'}</SectionEyebrow>
                        <h3 className="summary-block__title">{language === 'en' ? 'Rewrite suggestions and limits' : '改写建议与限制'}</h3>
                      </div>
                    </div>
                    {supportedPortionSummary && supportedPortionSummary !== coreIntentSummary ? (
                      <p className="product-section-copy">{supportedPortionSummary}</p>
                    ) : null}
                    {unsupportedExtensions.length > 0 ? (
                      <div className="product-chip-list mb-4">
                        {unsupportedExtensions.slice(0, 3).map((item, index) => (
                          <span key={`${String(item.code || index)}-unsupported`} className="product-chip">
                            {String(item.title || item.message || (language === 'en' ? 'Not supported yet' : '当前不支持'))}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {rewriteSuggestions.length > 0 ? (
                      <div className="product-chip-list wizard-example-chips">
                        {rewriteSuggestions.slice(0, 3).map((item, index) => {
                          const text = String(item.strategyText || '');
                          const label = String(item.label || text || (language === 'en' ? `Suggestion ${index + 1}` : `建议 ${index + 1}`));
                          if (!text) return null;
                          return (
                            <button
                              key={`${label}-${index}`}
                              type="button"
                              className="product-chip product-chip--button"
                              onClick={() => onApplyRewriteSuggestion(text)}
                            >
                              {label}: {text}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                )}

                {assumptionCards.length > 0 ? (
                  <div className="summary-block mt-4" data-testid="confirm-assumptions-section">
                    <div className="summary-block__header">
                      <div>
                        <SectionEyebrow>{language === 'en' ? 'Defaults and assumptions' : '默认与推断'}</SectionEyebrow>
                        <h3 className="summary-block__title">{language === 'en' ? 'Defaults and review notes' : '默认补全与提醒'}</h3>
                      </div>
                    </div>
                    <p className="product-section-copy">{language === 'en' ? 'These are not explicit canonical execution fields from the user. They are system-filled defaults, derived values, or items that still need manual review.' : '这些内容不是用户显式写出的 canonical 执行字段，而是系统补全、默认或需要人工确认的部分。'}</p>
                    <div className="preview-grid">
                      {assumptionCards.map((group, index) => {
                        return (
                          <div key={`${group.label}-${index}`} className="preview-card">
                            <p className="metric-card__label">{group.label}</p>
                            <div className="product-chip-list">
                              {group.items.map((item, itemIndex) => (
                                <span key={`${group.label}-${itemIndex}`} className="product-chip">{item}</span>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {!isProfessionalMode ? (
                  <Disclosure summary={language === 'en' ? 'Execution settings' : '执行设置'}>
                    {executionSettingsFields}
                    <div className="mt-4">
                      <AssumptionList assumptions={previewAssumptions} emptyText={language === 'en' ? 'No execution defaults are available yet.' : '暂无执行默认值。'} />
                    </div>
                  </Disclosure>
                ) : null}

                <label className="product-checkbox-row mt-4">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={parseState === 'unsupported' || parseState === 'stale'}
                    onChange={(event) => {
                      onStepChange('strategy');
                      onToggleConfirmed(event.target.checked);
                    }}
                  />
                  <span>{language === 'en' ? 'I reviewed the current parse result and execution assumptions.' : '我已确认当前解析结果与执行假设。'}</span>
                </label>

                <div className="product-action-row backtest-control-actions backtest-control-actions--footer mt-4">
                  <Button variant="ghost" onClick={() => handleStepSelect('setup')}>{language === 'en' ? 'Back to editing' : '返回修改'}</Button>
                  <Button variant="secondary" onClick={() => void onParse()} disabled={isParsing || !strategyText.trim()}>
                    {language === 'en' ? 'Parse again' : '重新解析'}
                  </Button>
                  <Button
                    onClick={() => (isProfessionalMode ? handleStepSelect('confirm') : void handleNormalRun())}
                    disabled={!canProceedFromConfirm}
                    isLoading={!isProfessionalMode && isSubmitting}
                    loadingText={language === 'en' ? 'Opening result page…' : '正在打开结果页…'}
                  >
                    {isProfessionalMode ? (language === 'en' ? 'Continue' : '继续') : (language === 'en' ? 'Confirm and open result' : '确认并查看结果')}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </Card>
    </section>
  );

  const executionSettingsSection = (
    <section
      ref={setStepRef('confirm')}
      id="backtest-control-section-confirm"
      className="backtest-control-section"
      data-testid="backtest-control-section-confirm"
      data-active={currentStep === 'confirm' ? 'true' : 'false'}
    >
      <Card title={language === 'en' ? 'Execution settings' : '执行设置'} subtitle={language === 'en' ? 'Step 4' : '步骤 4'} className="product-section-card product-section-card--backtest-standard">
        <p className="backtest-guided-step-helper">{language === 'en' ? 'Adjust execution defaults here. After submission, the dedicated result page will handle polling and analysis.' : '这里调整执行默认值。提交后会直接进入独立结果页进行轮询和分析。'}</p>
        {executionSettingsFields}
        <Disclosure summary={language === 'en' ? 'Execution defaults' : '执行默认值'}>
          <AssumptionList assumptions={previewAssumptions} emptyText={language === 'en' ? 'No execution defaults are available yet.' : '暂无执行默认值。'} />
        </Disclosure>
        <div className="product-action-row backtest-control-actions backtest-control-actions--footer">
          <Button variant="ghost" onClick={() => handleStepSelect('strategy')}>{language === 'en' ? 'Back' : '返回'}</Button>
          <Button onClick={() => handleStepSelect('run')}>{language === 'en' ? 'Continue' : '继续'}</Button>
        </div>
      </Card>
    </section>
  );

  const runControlsSection = (
    <section
      ref={setStepRef('run')}
      id="backtest-control-section-run"
      className="backtest-control-section"
      data-testid="backtest-control-section-run"
      data-active={currentStep === 'run' ? 'true' : 'false'}
    >
      <Card title={isProfessionalMode ? (language === 'en' ? 'Run controls' : '运行控制') : (language === 'en' ? 'Run backtest' : '开始运行')} subtitle={language === 'en' ? `Step ${isProfessionalMode ? '5' : '4'}` : `步骤 ${isProfessionalMode ? '5' : '4'}`} className="product-section-card product-section-card--backtest-flow">
        <Banner
          tone={isSubmitting ? 'info' : 'default'}
          title={isSubmitting ? (language === 'en' ? 'Creating the backtest run' : '正在创建回测运行') : (language === 'en' ? 'Submission opens the dedicated result page' : '提交后进入独立结果页')}
          body={isSubmitting
            ? (language === 'en' ? 'Submitting the deterministic backtest and redirecting to the result page. The result page handles status polling, KPI display, and the full-width chart workspace.' : '正在提交规则回测并跳转到结果页。结果页会负责轮询状态、显示 KPI 和全宽图表工作区。')
            : (language === 'en' ? 'The config page only handles setup and strategy confirmation. After you run it, the app navigates to /backtest/results/:runId for the full analysis.' : '配置页只负责参数与策略确认。点击运行后会导航到 /backtest/results/:runId，由结果页承载完整分析。')}
        />
        <div className="backtest-inline-status mt-4" role="status" aria-live="polite">
          <span className="backtest-inline-status__pill" data-tone={parseMeta.tone}>{language === 'en' ? 'Parse' : '解析'} · {parseMeta.label}</span>
          <span className="backtest-inline-status__pill" data-tone="info">{language === 'en' ? 'Result page' : '结果页'} · KPI / {language === 'en' ? 'Charts / Audit / Trades' : '图表 / 审计 / 交易'}</span>
          {parseStale ? <span className="backtest-inline-status__pill" data-tone="warning">{language === 'en' ? 'Preview is stale' : '预览已过期'}</span> : null}
          {appliedRewriteText ? <span className="backtest-inline-status__pill" data-tone="info">{language === 'en' ? 'Rewrite applied' : '已应用改写'}</span> : null}
        </div>
        <div className="preview-grid mt-4">
          <div className="preview-card">
            <p className="metric-card__label">{language === 'en' ? 'Ticker' : '标的'}</p>
            <p className="preview-card__text">{code || '--'}</p>
          </div>
          <div className="preview-card">
            <p className="metric-card__label">{language === 'en' ? 'Date range' : '区间'}</p>
            <p className="preview-card__text">{startDate || '--'} {'->'} {endDate || '--'}</p>
          </div>
          <div className="preview-card">
            <p className="metric-card__label">{language === 'en' ? 'Initial capital' : '初始资金'}</p>
            <p className="preview-card__text">{initialCapital || '--'}</p>
          </div>
          <div className="preview-card">
            <p className="metric-card__label">{language === 'en' ? 'Benchmark' : '基准'}</p>
            <p className="preview-card__text">{getBenchmarkModeLabel(benchmarkMode, code, benchmarkCode, language)}</p>
          </div>
        </div>
        <div className="product-action-row backtest-control-actions backtest-control-actions--footer mt-4">
          <Button variant="ghost" onClick={() => handleStepSelect(isProfessionalMode ? 'confirm' : 'strategy')}>
            {language === 'en' ? 'Back' : '返回'}
          </Button>
          <Button
            onClick={() => void onRun()}
            isLoading={isSubmitting}
            loadingText={language === 'en' ? 'Opening result page…' : '正在打开结果页…'}
            disabled={!canProceedFromConfirm}
          >
            {language === 'en' ? 'Run backtest and open result' : '运行回测并打开结果页'}
          </Button>
          <Button variant="ghost" onClick={onReset}>{language === 'en' ? 'Reset' : '重置'}</Button>
          <Button variant="ghost" onClick={onRefreshHistory} disabled={isLoadingHistory}>
            {isLoadingHistory ? (language === 'en' ? 'Refreshing…' : '刷新中…') : (language === 'en' ? 'Refresh history' : '刷新历史')}
          </Button>
        </div>
        {runError ? <ApiErrorAlert error={runError} className="mt-4" /> : null}
      </Card>
    </section>
  );

  const professionalControlSections: Record<ProfessionalStep, React.ReactNode> = {
    symbol: baseParamsSection,
    setup: strategyInputSection,
    strategy: parsedStrategySection,
    confirm: executionSettingsSection,
    run: runControlsSection,
  };

  const normalControlSections: Record<NormalStep, React.ReactNode> = {
    symbol: baseParamsSection,
    setup: strategyInputSection,
    strategy: parsedStrategySection,
    run: runControlsSection,
  };

  const getNormalStepSummary = (step: NormalStep) => {
    if (step === 'symbol') {
      return {
        title: code || (language === 'en' ? 'Instrument not set' : '未设置标的'),
        detail: language === 'en'
          ? `${startDate || '--'} → ${endDate || '--'} · capital ${initialCapital || '--'}`
          : `${startDate || '--'} → ${endDate || '--'} · 资金 ${initialCapital || '--'}`,
        disabled: false,
      };
    }
    if (step === 'setup') {
      return {
        title: strategyText.trim() ? strategyText.trim().slice(0, 36) : (language === 'en' ? 'Enter a strategy' : '填写策略描述'),
        detail: strategyText.trim()
          ? (language === 'en' ? 'You can come back and keep editing the strategy text.' : '可返回继续修改策略描述。')
          : (language === 'en' ? 'Describe the entry, exit, and cadence in natural language.' : '请用自然语言描述买卖条件与周期。'),
        disabled: false,
      };
    }
    if (step === 'strategy') {
      return {
        title: parseMeta.title,
        detail: coreIntentSummary || supportedPortionSummary || (language === 'en' ? 'A confirmation summary will appear here after parsing.' : '解析后会在这里给出确认摘要。'),
        disabled: !parsedStrategy,
      };
    }
    return {
      title: isSubmitting ? (language === 'en' ? 'Submitting' : '提交中') : (language === 'en' ? 'Open result page' : '进入结果页'),
      detail: language === 'en'
        ? 'Submission redirects to the dedicated result page instead of expanding the full analysis inline.'
        : '运行提交后会跳转到独立结果页，不再在配置页内展开完整分析。',
      disabled: !(canProceedFromConfirm || isSubmitting),
    };
  };


  const isEmptyHistory = historyItems.length === 0 && !isLoadingHistory && !historyError;
  const backtestEntryMetrics = useMemo(() => ([
    {
      label: language === 'en' ? 'Strategy return' : '策略收益',
      value: '--',
      tone: 'accent' as const,
      note: language === 'en' ? 'Run a backtest to populate the result page.' : '运行一次回测后在结果页展示。',
    },
    {
      label: language === 'en' ? 'Benchmark return' : '基准收益',
      value: '--',
      tone: 'default' as const,
      note: language === 'en' ? 'Resolved after the instrument and benchmark are confirmed.' : '确认标的与基准后生成。',
    },
    {
      label: language === 'en' ? 'Max drawdown' : '最大回撤',
      value: '--',
      tone: 'negative' as const,
      note: language === 'en' ? 'Shown only after a completed run.' : '完成回测后显示。',
    },
    {
      label: language === 'en' ? 'Sharpe ratio' : '夏普比率',
      value: '--',
      tone: 'default' as const,
      note: language === 'en' ? 'Risk-adjusted signal stays empty before execution.' : '运行前不显示风险调整信号。',
    },
  ]), [language]);

  const renderEmptyStage = () => (
    <section className="backtest-entry-shell" data-testid="backtest-entry-shell">
      <div className="backtest-entry-shell__hero">
        <div className="backtest-entry-shell__hero-copy">
          <SectionEyebrow>{language === 'en' ? 'Deterministic backtest' : '确定性回测'}</SectionEyebrow>
          <h2 className="backtest-entry-shell__hero-title">{language === 'en' ? 'Set up the run, then move into the dedicated result console.' : '先完成配置，再进入独立结果控制台。'}</h2>
          <p className="product-section-copy">
            {language === 'en'
              ? 'The config page now behaves like a launch surface. You choose the symbol, window, capital, and strategy here; once you submit, the full KPI and chart workspace open on the result page.'
              : '配置页现在更像回测启动面板：先在这里选择标的、区间、资金和策略，提交后再进入独立结果页查看 KPI 与三图联动图表。'}
          </p>
        </div>
        <SummaryStrip
          items={[
            {
              label: language === 'en' ? 'Current symbol' : '当前标的',
              value: code || '--',
              note: language === 'en' ? 'Fill the ticker before parsing the strategy.' : '先填写代码，再解析策略。',
            },
            {
              label: language === 'en' ? 'Benchmark' : '对比基准',
              value: getBenchmarkModeLabel(benchmarkMode, code, undefined, language),
              note: language === 'en' ? 'Used later on the result page.' : '用于结果页的基准对比。',
            },
            {
              label: language === 'en' ? 'History' : '历史记录',
              value: historyTotal > 0 ? `${historyTotal}` : '--',
              note: historyTotal > 0
                ? (language === 'en' ? 'Previous runs can be reopened directly.' : '已有历史结果可直接打开。')
                : (language === 'en' ? 'No saved runs yet.' : '当前还没有已保存结果。'),
            },
          ]}
        />
      </div>
      <div className="backtest-entry-shell__metrics">
        {backtestEntryMetrics.map((item) => (
          <MetricCard key={item.label} label={item.label} value={item.value} tone={item.tone} note={item.note} />
        ))}
      </div>
      <div className="backtest-entry-shell__workspace">
        <aside className="backtest-entry-shell__sidebar">
          <div className="backtest-entry-shell__sidebar-block">
            <span className="backtest-entry-shell__sidebar-label">{language === 'en' ? 'Flow' : '流程'}</span>
            <strong>{language === 'en' ? 'Setup → Parse → Run' : '配置 → 解析 → 运行'}</strong>
          </div>
          <div className="backtest-entry-shell__sidebar-block">
            <span className="backtest-entry-shell__sidebar-label">{language === 'en' ? 'Mode' : '模式'}</span>
            <strong>{language === 'en' ? 'Pre-run' : '未运行'}</strong>
          </div>
          <div className="backtest-entry-shell__sidebar-block">
            <span className="backtest-entry-shell__sidebar-label">{language === 'en' ? 'Window' : '区间'}</span>
            <strong>{startDate || '--'} → {endDate || '--'}</strong>
          </div>
        </aside>
        <div className="backtest-entry-shell__workspace-card">
          <div className="backtest-entry-shell__workspace-head">
            <div>
              <p className="backtest-entry-shell__workspace-eyebrow">{language === 'en' ? 'Result workspace' : '结果工作区'}</p>
              <h3>{language === 'en' ? 'The chart console appears after you run the backtest.' : '运行后这里会切换成三图联动结果控制台。'}</h3>
            </div>
            <div className="backtest-entry-shell__workspace-tags">
              <span>{language === 'en' ? 'Hero metrics' : 'Hero 指标'}</span>
              <span>{language === 'en' ? 'Triple-linked charts' : '三图联动'}</span>
              <span>{language === 'en' ? 'History reopen' : '历史重开'}</span>
            </div>
          </div>
          <div className="backtest-entry-shell__workspace-preview" aria-hidden="true">
            <div className="backtest-entry-shell__preview-line" />
            <div className="backtest-entry-shell__preview-grid backtest-entry-shell__preview-grid--mid">
              <span className="is-pos" /><span className="is-neg" /><span className="is-pos" /><span className="is-neg" /><span className="is-pos" />
            </div>
            <div className="backtest-entry-shell__preview-grid backtest-entry-shell__preview-grid--bottom">
              <span /><span /><span /><span /><span /><span />
            </div>
          </div>
          <div className="backtest-entry-shell__workspace-empty">
            <strong>{language === 'en' ? 'No active run yet' : '当前还没有进行中的结果'}</strong>
            <p>{language === 'en' ? 'Finish the form on the left, submit the run, and this area will turn into the full result console.' : '先完成左侧步骤并提交回测，这里会切换成完整结果页中的 KPI 与三图联动图表。'}</p>
          </div>
        </div>
      </div>
    </section>
  );

  const renderHistorySection = () => (
    <Disclosure
      summary={language === 'en' ? `History (${historyTotal})` : `历史（${historyTotal}）`}
      className="backtest-entry-shell__disclosure"
      summaryClassName="backtest-entry-shell__disclosure-summary"
      bodyClassName="backtest-entry-shell__disclosure-body"
    >
      <div className="summary-block__header">
        <div>
          <SectionEyebrow>{language === 'en' ? 'History' : '历史记录'}</SectionEyebrow>
          <h3 className="summary-block__title">{language === 'en' ? 'Rule backtest history' : '规则回测历史'}</h3>
        </div>
        <Button variant="ghost" onClick={onRefreshHistory} disabled={isLoadingHistory}>
          {isLoadingHistory ? (language === 'en' ? 'Refreshing…' : '刷新中…') : (language === 'en' ? 'Refresh' : '刷新')}
        </Button>
      </div>
      <p className="product-section-copy">{language === 'en' ? 'Opening any historical item sends you to `/backtest/results/:runId`, where the dedicated result page carries KPI, charts, audit, and trade analysis.' : '点击任意历史项会打开 `/backtest/results/:runId`，由独立结果页承载相同的 KPI、图表、审计与交易分析。'}</p>
      {historyError ? <ApiErrorAlert error={historyError} className="mb-4" /> : null}
      <RuleRunsTable rows={historyItems} selectedRunId={selectedRunId} onOpen={onOpenHistoryRun} />
      {isEmptyHistory ? <div className="product-empty-state product-empty-state--compact">{language === 'en' ? 'No saved rule-backtest runs yet. Your first completed run will appear here and can reopen the dedicated result console.' : '当前还没有已保存的规则回测记录。完成第一次回测后，历史结果会出现在这里，并可直接重开独立结果页。'}</div> : null}
      <p className="product-footnote">{language === 'en' ? `${historyTotal} deterministic rule-backtest runs. Page ${historyPage}.` : `共 ${historyTotal} 条确定性规则回测记录。当前页 ${historyPage}。`}</p>
    </Disclosure>
  );

  if (!isProfessionalMode) {
    return (
      <div className="space-y-6" data-testid="backtest-normal-wizard">
        {renderEmptyStage()}

        <div className="backtest-entry-shell__compact-actions">
          <Disclosure
            key="page-help"
            summary={language === 'en' ? 'How this page works' : '页面说明'}
            className="backtest-entry-shell__disclosure"
            summaryClassName="backtest-entry-shell__disclosure-summary"
            bodyClassName="backtest-entry-shell__disclosure-body"
          >
            <p className="product-section-copy">
              {language === 'en' ? 'Normal mode keeps only the active setup step on the page. History, presets, and extra explanation are now folded away so the start surface stays clean.' : '普通模式现在只在首屏保留当前正在操作的步骤。历史记录、预设和补充说明已被收纳，避免启动面板继续堆满信息。'}
            </p>
          </Disclosure>
          {renderPresetSection()}
          {renderHistorySection()}
        </div>

        <nav className="backtest-normal-stepper" aria-label={language === 'en' ? 'Deterministic backtest wizard steps' : '确定性回测向导步骤'}>
          {NORMAL_STEP_ORDER.map((step, index) => {
            const stepMeta = normalStepLabels[step];
            const isActive = normalCurrentStep === step;
            const isDone = index < normalCurrentStepIndex;
            const summary = getNormalStepSummary(step);
            return (
              <button
                key={step}
                type="button"
                className={`backtest-normal-step${isActive ? ' is-active' : ''}${isDone ? ' is-done' : ''}`}
                onClick={() => !summary.disabled && handleStepSelect(step)}
                disabled={summary.disabled}
              >
                <span className="backtest-normal-step__index">{index + 1}</span>
                <span className="backtest-normal-step__copy">
                  <strong>{stepMeta.title}</strong>
                  <small>{stepMeta.short}</small>
                </span>
              </button>
            );
          })}
        </nav>

        <div data-testid="backtest-normal-active-stage">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={normalCurrentStep}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={FLOW_PANEL_TRANSITION}
            >
              {normalControlSections[normalCurrentStep]}
            </motion.div>
          </AnimatePresence>
        </div>

      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="backtest-unified-shell" data-module="rule" data-panel-mode={panelMode}>
      <Card title={language === 'en' ? 'Professional-mode setup' : '专业版配置'} subtitle={language === 'en' ? 'Config page' : '配置页'} className="product-section-card product-section-card--backtest-result">
        <p className="product-section-copy">
          {language === 'en' ? 'Professional mode keeps the full control surface, but the full analysis still lives on `/backtest/results/:runId` rather than inside the config page.' : '专业版保留完整配置控制，但完整分析结果统一落在 `/backtest/results/:runId`。这里不再承载全宽图表工作区。'}
        </p>
      </Card>

      {renderPresetSection()}

      <nav className="backtest-control-stepper backtest-control-stepper--secondary" aria-label={language === 'en' ? 'Deterministic backtest steps' : '确定性回测步骤'}>
        {PROFESSIONAL_STEP_ORDER.map((step, index) => {
          const stepMeta = professionalStepLabels[step];
          const isActive = currentStep === step;
          const isDone = index < professionalCurrentStepIndex;
          return (
            <button
              key={step}
              type="button"
              className={`backtest-control-step${isActive ? ' is-active' : ''}${isDone ? ' is-done' : ''}`}
              onClick={() => handleStepSelect(step)}
            >
              <span className="backtest-control-step__index">{index + 1}</span>
              <span className="backtest-control-step__copy">
                <strong>{stepMeta.title}</strong>
                <small>{stepMeta.short}</small>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="space-y-6" data-testid="backtest-control-panel-expanded">
        {PROFESSIONAL_STEP_ORDER.map((step) => (
          <Fragment key={step}>{professionalControlSections[step]}</Fragment>
        ))}
      </div>

      {renderHistorySection()}
    </div>
  );
};

export default DeterministicBacktestFlow;
