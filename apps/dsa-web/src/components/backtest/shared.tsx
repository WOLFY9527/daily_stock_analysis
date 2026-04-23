/* eslint-disable react-refresh/only-export-components */
import type React from 'react';
import { Badge, Button, Checkbox, Disclosure } from '../../components/common';
import { useI18n } from '../../contexts/UiLanguageContext';
import type {
  AssumptionMap,
  BacktestResultItem,
  BacktestRunHistoryItem,
  BacktestRunResponse,
  RuleBacktestHistoryItem,
  RuleBacktestParseResponse,
  RuleBacktestRunResponse,
  RuleBacktestTradeItem,
} from '../../types/backtest';

const ASSUMPTION_LABELS: Record<string, string> = {
  module_type: '模块语义',
  evaluation_window_unit: '评估窗口单位',
  maturity_unit: '成熟期单位',
  price_basis: '价格口径',
  analysis_signal_timing: '分析信号时点',
  simulated_entry_timing: '模拟入场时点',
  simulated_exit_timing: '模拟离场时点',
  position_sizing: '仓位假设',
  fees_slippage: '费用与滑点',
  timeframe: '时间周期',
  signal_evaluation_timing: '信号评估时点',
  entry_fill_timing: '入场成交时点',
  exit_fill_timing: '离场成交时点',
  position_sizing_model: '仓位模型',
  fee_model: '手续费模型',
  fee_bps_per_side: '单边手续费',
  slippage_model: '滑点模型',
  slippage_bps_per_side: '单边滑点',
  benchmark_method: '基准比较',
};

const RULE_STATUS_LABELS: Record<string, string> = {
  parsing: '解析中',
  queued: '排队中',
  running: '运行中',
  summarizing: '整理摘要',
  completed: '已完成',
  cancelled: '已取消',
  failed: '失败',
};

const TERMINAL_RULE_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const CANCELLABLE_RULE_STATUSES = new Set(['queued', 'parsing', 'running', 'summarizing']);

const HISTORICAL_STATUS_LABELS: Record<string, string> = {
  completed: '已完成',
  error: '执行异常',
  insufficient_data: '样本不足',
};

type BacktestLanguage = 'zh' | 'en';

function getRuleStatusText(status?: string, language: BacktestLanguage = 'zh'): string {
  const normalized = String(status || 'queued').trim().toLowerCase();
  if (language === 'en') {
    const labels: Record<string, string> = {
      parsing: 'Parsing',
      queued: 'Queued',
      running: 'Running',
      summarizing: 'Summarizing',
      completed: 'Completed',
      cancelled: 'Cancelled',
      failed: 'Failed',
    };
    return labels[normalized] || normalized;
  }
  return RULE_STATUS_LABELS[normalized] || normalized;
}

function getHistoricalStatusText(status?: string, language: BacktestLanguage = 'zh'): string {
  const normalized = String(status || 'completed').trim().toLowerCase();
  if (language === 'en') {
    const labels: Record<string, string> = {
      completed: 'Completed',
      error: 'Error',
      insufficient_data: 'Insufficient data',
    };
    return labels[normalized] || normalized;
  }
  return HISTORICAL_STATUS_LABELS[normalized] || normalized;
}

export { Disclosure };

export function pct(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return '--';
  return `${value.toFixed(2)}%`;
}

export function formatNumber(value?: number | null, digits = 2): string {
  if (value == null || Number.isNaN(value)) return '--';
  return value.toFixed(digits);
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '--';
  return value.replace('T', ' ').replace('Z', '');
}

export function toDateInputValue(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function getDefaultRuleDateRange(): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(end.getFullYear() - 1);
  return {
    startDate: toDateInputValue(start),
    endDate: toDateInputValue(end),
  };
}

export type RuleBenchmarkMode =
  | 'auto'
  | 'none'
  | 'same_symbol_buy_and_hold'
  | 'index_hs300'
  | 'index_csi500'
  | 'index_ndx100'
  | 'etf_qqq'
  | 'index_sp500'
  | 'etf_spy'
  | 'custom_code';

export const RULE_BENCHMARK_OPTIONS: Array<{ value: RuleBenchmarkMode; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'none', label: '无基准' },
  { value: 'same_symbol_buy_and_hold', label: '当前标的买入并持有' },
  { value: 'index_hs300', label: '沪深300' },
  { value: 'index_csi500', label: '中证500' },
  { value: 'index_ndx100', label: '纳指100' },
  { value: 'etf_qqq', label: 'QQQ' },
  { value: 'index_sp500', label: '标普500' },
  { value: 'etf_spy', label: 'SPY' },
  { value: 'custom_code', label: '自定义代码' },
];

function isAshareLikeCode(code: string): boolean {
  const normalized = String(code || '').trim().toUpperCase();
  return /^\d{6}$/.test(normalized);
}

function isUsLikeCode(code: string): boolean {
  const normalized = String(code || '').trim().toUpperCase();
  return /^[A-Z^]{1,5}(\.[A-Z])?$/.test(normalized);
}

export function getAutoBenchmarkMode(code: string): RuleBenchmarkMode {
  if (isAshareLikeCode(code)) return 'index_hs300';
  if (isUsLikeCode(code)) return 'etf_qqq';
  return 'same_symbol_buy_and_hold';
}

export function getBenchmarkModeLabel(mode: RuleBenchmarkMode, code?: string, customCode?: string, language: BacktestLanguage = 'zh'): string {
  if (mode === 'auto') {
    return language === 'en'
      ? `Auto · ${getBenchmarkModeLabel(getAutoBenchmarkMode(code || ''), code, customCode, language)}`
      : `自动 · ${getBenchmarkModeLabel(getAutoBenchmarkMode(code || ''), code, customCode, language)}`;
  }
  if (mode === 'custom_code') {
    const normalizedCustomCode = String(customCode || '').trim().toUpperCase();
    return normalizedCustomCode
      ? `${language === 'en' ? 'Custom' : '自定义'} · ${normalizedCustomCode}`
      : (language === 'en' ? 'Custom code' : '自定义代码');
  }
  if (language === 'en') {
    const englishLabels: Record<RuleBenchmarkMode, string> = {
      auto: 'Auto',
      none: 'No benchmark',
      same_symbol_buy_and_hold: 'Current instrument buy and hold',
      index_hs300: 'CSI 300',
      index_csi500: 'CSI 500',
      index_ndx100: 'NASDAQ 100',
      etf_qqq: 'QQQ',
      index_sp500: 'S&P 500',
      etf_spy: 'SPY',
      custom_code: 'Custom code',
    };
    return englishLabels[mode] || 'Benchmark';
  }
  const matched = RULE_BENCHMARK_OPTIONS.find((item) => item.value === mode);
  return matched?.label || '基准';
}

export function parsePositiveInt(value: string, fallback: number, minimum = 1): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, parsed);
}

function getSetupValue(setup: Record<string, unknown> | undefined, key: string): unknown {
  if (!setup) return undefined;
  if (key in setup) return setup[key];
  const camelKey = key.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
  if (camelKey in setup) return setup[camelKey];
  return undefined;
}

export function getStrategySpecValue(spec: Record<string, unknown> | undefined, path: string[]): unknown {
  let current: unknown = spec;
  for (const segment of path) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    const record = current as Record<string, unknown>;
    const camelSegment = segment.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
    if (segment in record) {
      current = record[segment];
      continue;
    }
    if (camelSegment in record) {
      current = record[camelSegment];
      continue;
    }
    return undefined;
  }
  return current;
}

export function getStrategyPreviewSpec(parsed: RuleBacktestParseResponse | null): Record<string, unknown> | undefined {
  const direct = parsed?.parsedStrategy.strategySpec;
  if (direct && typeof direct === 'object') return direct;
  const fallback = parsed?.parsedStrategy.setup;
  return fallback && typeof fallback === 'object' ? fallback : undefined;
}

function getSetupString(setup: Record<string, unknown> | undefined, key: string): string {
  const value = getSetupValue(setup, key);
  if (value == null || value === '') return '--';
  return String(value);
}

function getSetupNumber(setup: Record<string, unknown> | undefined, key: string): number | null {
  const value = getSetupValue(setup, key);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function getPeriodicString(source: Record<string, unknown> | undefined, key: string): string {
  const strategyType = getStrategySpecValue(source, ['strategy_type']);
  if (strategyType === 'periodic_accumulation') {
    const fromSpec = {
      symbol: getStrategySpecValue(source, ['symbol']),
      start_date: getStrategySpecValue(source, ['date_range', 'start_date']),
      end_date: getStrategySpecValue(source, ['date_range', 'end_date']),
      execution_frequency: getStrategySpecValue(source, ['schedule', 'frequency']),
      execution_price_basis: getStrategySpecValue(source, ['entry', 'price_basis']),
      cash_policy: getStrategySpecValue(source, ['position_behavior', 'cash_policy']),
      exit_policy: getStrategySpecValue(source, ['exit', 'policy']),
      execution_timing: getStrategySpecValue(source, ['schedule', 'timing']),
    }[key];
    if (fromSpec != null && fromSpec !== '') return String(fromSpec);
  }
  return getSetupString(source, key);
}

export function getPeriodicNumber(source: Record<string, unknown> | undefined, key: string): number | null {
  const strategyType = getStrategySpecValue(source, ['strategy_type']);
  if (strategyType === 'periodic_accumulation') {
    const fromSpec = {
      initial_capital: getStrategySpecValue(source, ['capital', 'initial_capital']),
      quantity_per_trade: getStrategySpecValue(source, ['entry', 'order', 'quantity']),
      amount_per_trade: getStrategySpecValue(source, ['entry', 'order', 'amount']),
      fee_bps: getStrategySpecValue(source, ['costs', 'fee_bps']),
      slippage_bps: getStrategySpecValue(source, ['costs', 'slippage_bps']),
    }[key];
    if (fromSpec != null && fromSpec !== '') {
      const parsed = Number(fromSpec);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return getSetupNumber(source, key);
}

export function formatDraftOrder(source: Record<string, unknown> | undefined): string {
  const orderMode = String(getStrategySpecValue(source, ['entry', 'order', 'mode']) || getSetupString(source, 'order_mode'));
  if (orderMode === 'fixed_amount') {
    const amount = getPeriodicNumber(source, 'amount_per_trade');
    return amount != null ? `${amount} 元 / 次` : '--';
  }
  const quantity = getPeriodicNumber(source, 'quantity_per_trade');
  return quantity != null ? `${quantity} 股 / 次` : '--';
}

export function formatCashPolicy(source: Record<string, unknown> | undefined): string {
  const value = getPeriodicString(source, 'cash_policy');
  if (value === 'stop_when_insufficient_cash') return '现金不足时停止';
  if (value === 'skip_when_insufficient_cash') return '现金不足时跳过';
  return '--';
}

export function formatDraftOrderLabel(source: Record<string, unknown> | undefined, language: BacktestLanguage = 'zh'): string {
  const orderMode = String(getStrategySpecValue(source, ['entry', 'order', 'mode']) || getSetupString(source, 'order_mode'));
  if (orderMode === 'fixed_amount') {
    const amount = getPeriodicNumber(source, 'amount_per_trade');
    if (amount == null) return '--';
    return language === 'en' ? `${amount} per trade` : `${amount} 元 / 次`;
  }
  const quantity = getPeriodicNumber(source, 'quantity_per_trade');
  if (quantity == null) return '--';
  return language === 'en' ? `${quantity} shares per trade` : `${quantity} 股 / 次`;
}

export function formatCashPolicyLabel(source: Record<string, unknown> | undefined, language: BacktestLanguage = 'zh'): string {
  const value = getPeriodicString(source, 'cash_policy');
  if (value === 'stop_when_insufficient_cash') return language === 'en' ? 'Stop when cash is insufficient' : '现金不足时停止';
  if (value === 'skip_when_insufficient_cash') return language === 'en' ? 'Skip when cash is insufficient' : '现金不足时跳过';
  return '--';
}

export function formatExecutionPriceBasisLabel(source: Record<string, unknown> | undefined, language: BacktestLanguage = 'zh'): string {
  const value = getPeriodicString(source, 'execution_price_basis');
  if (value === 'open') return language === 'en' ? 'Same-day open' : '当日开盘价';
  if (value === 'next_bar_open') return language === 'en' ? 'Next-bar open' : '下一根开盘价';
  if (value === 'close') return language === 'en' ? 'Close' : '收盘价';
  return '--';
}

export function formatExitPolicyLabel(source: Record<string, unknown> | undefined, language: BacktestLanguage = 'zh'): string {
  const value = getPeriodicString(source, 'exit_policy');
  if (value === 'close_at_end') return language === 'en' ? 'Close all positions at the end' : '到期统一平仓';
  return '--';
}

export function buildPeriodicAssumptionLabels(
  source: Record<string, unknown> | undefined,
  language: BacktestLanguage = 'zh',
): string[] {
  const items: string[] = [];
  if (getPeriodicString(source, 'execution_price_basis') === 'open') {
    items.push(language === 'en' ? 'Open-price execution fills at the same-day market open.' : '“开市价 / 开盘价”按当日开盘价成交。');
  }
  if (getPeriodicString(source, 'execution_frequency') === 'daily') {
    items.push(language === 'en' ? 'Daily accumulation attempts one buy on each trading day and keeps adding exposure.' : '“每天买入”按每个交易日尝试一次，并持续累积仓位。');
  }
  if (getPeriodicString(source, 'cash_policy') === 'stop_when_insufficient_cash') {
    items.push(language === 'en' ? 'Once cash is no longer enough for one purchase, later buys stop.' : '现金不足以完成单次买入时，后续停止继续买入。');
  }
  if (getPeriodicString(source, 'exit_policy') === 'close_at_end') {
    items.push(language === 'en' ? 'If no sell rule is defined, the position closes on the final backtest day.' : '未写卖出规则时，回测结束日统一平仓。');
  }
  return items;
}

export function formatExecutionPriceBasis(source: Record<string, unknown> | undefined): string {
  const value = getPeriodicString(source, 'execution_price_basis');
  if (value === 'open') return '当日开盘价';
  if (value === 'next_bar_open') return '下一根开盘价';
  if (value === 'close') return '收盘价';
  return '--';
}

export function formatExitPolicy(source: Record<string, unknown> | undefined): string {
  const value = getPeriodicString(source, 'exit_policy');
  if (value === 'close_at_end') return '到期统一平仓';
  return '--';
}

export function buildPeriodicAssumptions(source: Record<string, unknown> | undefined): string[] {
  const items: string[] = [];
  if (getPeriodicString(source, 'execution_price_basis') === 'open') {
    items.push('“开市价 / 开盘价”按当日开盘价成交。');
  }
  if (getPeriodicString(source, 'execution_frequency') === 'daily') {
    items.push('“每天买入”按每个交易日尝试一次，并持续累积仓位。');
  }
  if (getPeriodicString(source, 'cash_policy') === 'stop_when_insufficient_cash') {
    items.push('现金不足以完成单次买入时，后续停止继续买入。');
  }
  if (getPeriodicString(source, 'exit_policy') === 'close_at_end') {
    items.push('未写卖出规则时，回测结束日统一平仓。');
  }
  return items;
}

function formatIndicatorEntries(snapshot?: Record<string, unknown>): Array<{ key: string; value: string }> {
  return Object.entries(snapshot || {})
    .filter(([, value]) => value != null)
    .slice(0, 6)
    .map(([key, value]) => ({
      key,
      value: typeof value === 'number' ? value.toFixed(2) : String(value),
    }));
}

export function isRuleRunTerminal(status?: string): boolean {
  return TERMINAL_RULE_STATUSES.has(String(status || '').trim().toLowerCase());
}

export function canCancelRuleRun(status?: string): boolean {
  return CANCELLABLE_RULE_STATUSES.has(String(status || '').trim().toLowerCase());
}

export function getRuleRunStatusDescription(status?: string, language: BacktestLanguage = 'zh'): string {
  const normalized = String(status || '').trim().toLowerCase();
  if (language === 'en') {
    if (normalized === 'parsing') return 'Parsing the strategy text into executable rules.';
    if (normalized === 'queued') return 'The task is queued and waiting to start.';
    if (normalized === 'running') return 'The backtest is running and the status will keep refreshing.';
    if (normalized === 'summarizing') return 'The run finished calculating and is assembling summary, trades, and execution trace.';
    if (normalized === 'completed') return 'The backtest is complete and ready for review.';
    if (normalized === 'cancelled') return 'The backtest was cancelled and will not continue.';
    if (normalized === 'failed') return 'The backtest failed. Adjust the setup and try again.';
    return 'The rule backtest has been submitted.';
  }
  if (normalized === 'parsing') return '正在解析策略文本并整理可执行规则。';
  if (normalized === 'queued') return '任务已入队，等待后台开始执行。';
  if (normalized === 'running') return '后台正在执行回测，会持续刷新状态。';
  if (normalized === 'summarizing') return '回测已算完，正在整理摘要、交易和执行轨迹。';
  if (normalized === 'completed') return '回测已完成，可以查看结果摘要、交易和执行轨迹。';
  if (normalized === 'cancelled') return '回测已取消，当前运行不会继续推进。';
  if (normalized === 'failed') return '回测执行失败，可以返回配置页调整后重试。';
  return '规则回测已提交。';
}

export function getRuleRunStatusTone(status?: string): 'default' | 'success' | 'warning' | 'danger' | 'info' {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'completed') return 'success';
  if (normalized === 'failed') return 'danger';
  if (normalized === 'summarizing') return 'info';
  if (normalized === 'cancelled') return 'warning';
  if (normalized === 'running' || normalized === 'queued' || normalized === 'parsing') return 'warning';
  return 'default';
}

export function getHistoricalStatusBadge(status?: string) {
  const normalized = status || 'completed';
  const label = HISTORICAL_STATUS_LABELS[normalized] || normalized;
  if (normalized === 'completed') return <Badge variant="success">{label}</Badge>;
  if (normalized === 'insufficient_data') return <Badge variant="warning">{label}</Badge>;
  if (normalized === 'error') return <Badge variant="danger">{label}</Badge>;
  return <Badge variant="default">{label}</Badge>;
}

export function getRuleStatusBadge(status?: string) {
  const normalized = status || 'queued';
  const label = RULE_STATUS_LABELS[normalized] || normalized;
  if (normalized === 'completed') return <Badge variant="success">{label}</Badge>;
  if (normalized === 'failed') return <Badge variant="danger">{label}</Badge>;
  if (normalized === 'summarizing') return <Badge variant="info">{label}</Badge>;
  if (normalized === 'cancelled') return <Badge variant="warning">{label}</Badge>;
  if (normalized === 'running') return <Badge variant="warning">{label}</Badge>;
  return <Badge variant="default">{label}</Badge>;
}

export function getRuleRunStatusLabel(status?: string, language: BacktestLanguage = 'zh'): string {
  return getRuleStatusText(status, language);
}

export function getHistoricalRequestedModeLabel(mode?: string | null, language: BacktestLanguage = 'zh'): string {
  const normalized = String(mode || '').trim().toLowerCase();
  if (!normalized) return '--';
  if (language === 'en') {
    if (normalized === 'local_first') return 'Local-first (prefer LocalParquet)';
    if (normalized === 'api_first') return 'API-first';
    if (normalized === 'auto') return 'Auto';
    return String(mode);
  }
  if (normalized === 'local_first') return '本地优先（优先读 LocalParquet）';
  if (normalized === 'api_first') return '远端优先';
  if (normalized === 'auto') return '自动选择';
  return String(mode);
}

export function getHistoricalResolvedSourceLabel(source?: string | null, language: BacktestLanguage = 'zh'): string {
  const normalized = String(source || '').trim();
  if (language === 'en') {
    if (normalized === 'LocalParquet') return 'LocalParquet local file';
    if (normalized === 'DatabaseCache') return 'Database cache';
    if (normalized === 'YfinanceFetcher') return 'Yfinance fallback';
    if (normalized === 'MixedFallback') return 'Mixed fallback path';
    if (normalized === 'Unknown') return 'Unknown source';
    return normalized || '--';
  }
  if (normalized === 'LocalParquet') return 'LocalParquet 本地文件';
  if (normalized === 'DatabaseCache') return '数据库缓存';
  if (normalized === 'YfinanceFetcher') return 'Yfinance 在线回退';
  if (normalized === 'MixedFallback') return '混合回退路径';
  if (normalized === 'Unknown') return '未知来源';
  return normalized || '--';
}

export function getHistoricalFallbackLabel(value?: boolean | null, language: BacktestLanguage = 'zh'): string {
  if (value == null) return '--';
  return value ? (language === 'en' ? 'Fallback used' : '已回退') : (language === 'en' ? 'No fallback' : '未回退');
}

export function describeHistoricalDataSource(meta: {
  requestedMode?: string | null;
  resolvedSource?: string | null;
  fallbackUsed?: boolean | null;
}, language: BacktestLanguage = 'zh'): {
  tone: 'success' | 'warning' | 'info';
  title: string;
  body: string;
  detail: string;
} {
  const requestedLabel = getHistoricalRequestedModeLabel(meta.requestedMode, language);
  const resolvedLabel = getHistoricalResolvedSourceLabel(meta.resolvedSource, language);
  const fallbackLabel = getHistoricalFallbackLabel(meta.fallbackUsed, language);

  if (meta.resolvedSource === 'LocalParquet' && meta.fallbackUsed === false) {
    return {
      tone: 'success',
      title: language === 'en' ? 'LocalParquet hit' : '已命中 LocalParquet',
      body: language === 'en' ? 'This run used local Parquet data directly without falling back.' : '本次样本与评估优先读取本地 Parquet，没有走回退路径。',
      detail: language === 'en' ? `Requested: ${requestedLabel} · Resolved: ${resolvedLabel} · Fallback: ${fallbackLabel}` : `请求模式：${requestedLabel} · 实际来源：${resolvedLabel} · 回退：${fallbackLabel}`,
    };
  }

  if (meta.fallbackUsed) {
    return {
      tone: 'warning',
      title: language === 'en' ? `Fell back to ${resolvedLabel}` : `已回退到 ${resolvedLabel}`,
      body: language === 'en' ? 'The run stayed local-first but resolved to a fallback path because local data was missing, unavailable, or incomplete.' : '系统仍按本地优先发起，但本次实际使用了回退路径。通常表示本地数据缺失、不可用，或覆盖范围不足。',
      detail: language === 'en' ? `Requested: ${requestedLabel} · Resolved: ${resolvedLabel} · Fallback: ${fallbackLabel}` : `请求模式：${requestedLabel} · 实际来源：${resolvedLabel} · 回退：${fallbackLabel}`,
    };
  }

  if (meta.resolvedSource) {
    return {
      tone: 'info',
      title: language === 'en' ? `Using ${resolvedLabel}` : `当前使用 ${resolvedLabel}`,
      body: language === 'en' ? 'This block shows the actual data path used for the run.' : '这里显示的是本次实际命中的数据路径，便于确认是否按预期读取。',
      detail: language === 'en' ? `Requested: ${requestedLabel} · Resolved: ${resolvedLabel} · Fallback: ${fallbackLabel}` : `请求模式：${requestedLabel} · 实际来源：${resolvedLabel} · 回退：${fallbackLabel}`,
    };
  }

  return {
    tone: 'info',
    title: language === 'en' ? 'Waiting for source diagnostics' : '等待生成数据源诊断',
    body: language === 'en' ? 'After sample prep or evaluation, this section shows the actual data path used by the run.' : '准备样本或运行评估后，这里会显示本次请求的实际数据路径。',
    detail: language === 'en' ? `Requested: ${requestedLabel} · Resolved: ${resolvedLabel} · Fallback: ${fallbackLabel}` : `请求模式：${requestedLabel} · 实际来源：${resolvedLabel} · 回退：${fallbackLabel}`,
  };
}

function renderDirectionBadge(correct?: boolean | null, expected?: string | null, language: BacktestLanguage = 'zh') {
  if (correct === true) return <span className="product-direction product-direction--positive">✓ {expected || (language === 'en' ? 'Matched' : '匹配')}</span>;
  if (correct === false) return <span className="product-direction product-direction--negative">✕ {expected || (language === 'en' ? 'Missed' : '偏离')}</span>;
  return <span className="product-direction">--</span>;
}

export const SectionEyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="product-kicker">{children}</span>
);

export const MetricCard: React.FC<{
  label: string;
  value: string;
  tone?: 'default' | 'positive' | 'negative' | 'accent';
  note?: string;
}> = ({ label, value, tone = 'default', note }) => (
  <div className={`metric-card metric-card--${tone}`}>
    <p className="metric-card__label">{label}</p>
    <p className="metric-card__value">{value}</p>
    {note ? <p className="metric-card__note">{note}</p> : null}
  </div>
);

export const SummaryStrip: React.FC<{
  items: Array<{ label: string; value: string; note?: string }>;
}> = ({ items }) => (
  <div className="summary-strip" role="list">
    {items.map((item) => (
      <div key={item.label} className="summary-strip__item" role="listitem">
        <p className="summary-strip__label">{item.label}</p>
        <p className="summary-strip__value">{item.value}</p>
        {item.note ? <p className="summary-strip__note">{item.note}</p> : null}
      </div>
    ))}
  </div>
);

export const Banner: React.FC<{
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  title: React.ReactNode;
  body?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}> = ({ tone = 'default', title, body, actions, className }) => (
  <div className={`product-banner product-banner--${tone}${className ? ` ${className}` : ''}`}>
    <div className="product-banner__copy">
      <p className="product-banner__title">{title}</p>
      {body ? <div className="product-banner__body">{body}</div> : null}
    </div>
    {actions ? <div className="product-banner__actions">{actions}</div> : null}
  </div>
);

export const AssumptionList: React.FC<{
  assumptions?: AssumptionMap;
  emptyText: string;
}> = ({ assumptions, emptyText }) => {
  const { language } = useI18n();
  const entries = Object.entries(assumptions || {})
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => ({
      key,
      label: (language === 'en'
        ? {
          module_type: 'Module semantics',
          evaluation_window_unit: 'Evaluation window unit',
          maturity_unit: 'Maturity unit',
          price_basis: 'Price basis',
          analysis_signal_timing: 'Signal timing',
          simulated_entry_timing: 'Simulated entry timing',
          simulated_exit_timing: 'Simulated exit timing',
          position_sizing: 'Sizing assumption',
          fees_slippage: 'Fees and slippage',
          timeframe: 'Timeframe',
          signal_evaluation_timing: 'Signal evaluation timing',
          entry_fill_timing: 'Entry fill timing',
          exit_fill_timing: 'Exit fill timing',
          position_sizing_model: 'Sizing model',
          fee_model: 'Fee model',
          fee_bps_per_side: 'Fee per side',
          slippage_model: 'Slippage model',
          slippage_bps_per_side: 'Slippage per side',
          benchmark_method: 'Benchmark method',
        } as Record<string, string>
        : ASSUMPTION_LABELS)[key] || key.replace(/_/g, ' '),
      value: typeof value === 'boolean' ? (value ? (language === 'en' ? 'Yes' : '是') : (language === 'en' ? 'No' : '否')) : Array.isArray(value) ? value.join(', ') : String(value),
    }));

  if (entries.length === 0) {
    return <p className="product-empty-note">{emptyText}</p>;
  }

  return (
    <dl className="audit-grid">
      {entries.map((item) => (
        <div key={item.key} className="audit-grid__row">
          <dt className="audit-grid__label">{item.label}</dt>
          <dd className="audit-grid__value">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
};

export const HistoricalRunSummary: React.FC<{ data: BacktestRunResponse }> = ({ data }) => (
  (() => {
    const { language } = useI18n();
    return (
      <Banner
        tone="info"
        title={language === 'en' ? 'Historical evaluation updated' : '历史评估已更新'}
        body={(
          <>
            {language === 'en'
              ? `Processed ${data.processed} candidates, saved ${data.saved} results, and completed ${data.completed} evaluations.`
              : `已处理 ${data.processed} 条候选，写入 ${data.saved} 条结果，完成 ${data.completed} 条评估。`}
            <span className="product-banner__meta">
              {language === 'en'
                ? `Insufficient data ${data.insufficient}, errors ${data.errors}, candidates ${data.candidateCount}.`
                : `样本不足 ${data.insufficient} 条，异常 ${data.errors} 条，候选 ${data.candidateCount} 条。`}
            </span>
            {data.noResultMessage ? <span className="product-banner__meta">{data.noResultMessage}</span> : null}
          </>
        )}
      />
    );
  })()
);

export const RuleRunStatusBanner: React.FC<{ run: RuleBacktestRunResponse }> = ({ run }) => {
  const { language } = useI18n();
  const latestStatusAt = run.statusHistory?.[run.statusHistory.length - 1]?.at;
  const tone = getRuleRunStatusTone(run.status);
  const statusDescription = getRuleRunStatusDescription(run.status, language);
  const localizedNoResultMessage = run.noResultMessage === '回测窗口内没有触发任何入场信号。'
    ? (language === 'en' ? 'No entry signal was triggered during the backtest window.' : '回测窗口内没有触发任何入场信号。')
    : run.noResultMessage;

  return (
    <Banner
      tone={tone}
      title={(
        <span className="flex flex-wrap items-center gap-2">
          {language === 'en' ? 'Rule run status' : '规则任务状态'}
          <Badge variant={tone === 'success' ? 'success' : tone === 'danger' ? 'danger' : tone === 'warning' ? 'warning' : tone === 'info' ? 'info' : 'default'}>
            {getRuleStatusText(run.status, language)}
          </Badge>
        </span>
      )}
      body={(
        <>
          {language === 'en' ? statusDescription : (run.statusMessage || statusDescription)}
          <span className="product-banner__meta">
          {language === 'en' ? 'Run' : '运行'} #{run.id} · {run.code} · {latestStatusAt ? formatDateTime(latestStatusAt) : '--'}
          </span>
          {localizedNoResultMessage ? <span className="product-banner__meta">{localizedNoResultMessage}</span> : null}
        </>
      )}
    />
  );
};

export const HistoricalResultsTable: React.FC<{ rows: BacktestResultItem[] }> = ({ rows }) => {
  const { language } = useI18n();
  if (rows.length === 0) {
    return <div className="product-empty-state">{language === 'en' ? 'No historical evaluation results yet. Prepare samples or run an evaluation first.' : '暂无历史分析评估结果。先准备样本或运行一次评估。'}</div>;
  }

  return (
    <div className="product-table-shell">
      <table className="product-table">
        <thead>
          <tr>
            <th>{language === 'en' ? 'Date' : '日期'}</th>
            <th>{language === 'en' ? 'Code' : '代码'}</th>
            <th>{language === 'en' ? 'Advice' : '建议'}</th>
            <th>{language === 'en' ? 'Direction' : '方向'}</th>
            <th className="product-table__align-right">{language === 'en' ? 'Simulated return' : '模拟收益'}</th>
            <th className="product-table__align-right">{language === 'en' ? 'Instrument return' : '标的收益'}</th>
            <th>{language === 'en' ? 'Market source' : '实际数据源'}</th>
            <th>{language === 'en' ? 'Status' : '状态'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.analysisHistoryId}>
              <td>{row.analysisDate || '--'}</td>
              <td className="product-table__mono">{row.code}</td>
              <td>{row.operationAdvice || '--'}</td>
              <td>{renderDirectionBadge(row.directionCorrect, row.directionExpected, language)}</td>
              <td className="product-table__align-right">{pct(row.simulatedReturnPct)}</td>
              <td className="product-table__align-right">{pct(row.stockReturnPct)}</td>
              <td>{row.marketDataSources.length > 0 ? row.marketDataSources.join(', ') : '--'}</td>
              <td><Badge variant={row.evalStatus === 'completed' ? 'success' : row.evalStatus === 'insufficient_data' ? 'warning' : row.evalStatus === 'error' ? 'danger' : 'default'}>{getHistoricalStatusText(row.evalStatus, language)}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const HistoricalRunsTable: React.FC<{
  rows: BacktestRunHistoryItem[];
  selectedRunId: number | null;
  onOpen: (run: BacktestRunHistoryItem) => void;
}> = ({ rows, selectedRunId, onOpen }) => {
  const { language } = useI18n();
  if (rows.length === 0) {
    return <div className="product-empty-state">{language === 'en' ? 'No historical evaluation runs yet.' : '暂无历史分析评估运行记录。'}</div>;
  }

  return (
    <div className="product-table-shell">
      <table className="product-table">
        <thead>
          <tr>
            <th>{language === 'en' ? 'Run time' : '运行时间'}</th>
            <th>{language === 'en' ? 'Code' : '代码'}</th>
            <th>{language === 'en' ? 'Window' : '窗口定义'}</th>
            <th className="product-table__align-right">{language === 'en' ? 'Candidates' : '候选'}</th>
            <th className="product-table__align-right">{language === 'en' ? 'Win rate' : '胜率'}</th>
            <th className="product-table__align-right">{language === 'en' ? 'Average simulated return' : '平均模拟收益'}</th>
            <th>{language === 'en' ? 'Status' : '状态'}</th>
            <th className="product-table__align-right">{language === 'en' ? 'Action' : '操作'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} data-active={selectedRunId === row.id ? 'true' : 'false'}>
              <td>{formatDateTime(row.runAt)}</td>
              <td className="product-table__mono">{row.code || '--'}</td>
              <td>{row.evaluationWindowTradingBars || row.evalWindowDays} bars / {row.maturityCalendarDays || row.minAgeDays} {language === 'en' ? 'days' : '天'}</td>
              <td className="product-table__align-right">{row.candidateCount}</td>
              <td className="product-table__align-right">{pct(row.winRatePct)}</td>
              <td className="product-table__align-right">{pct(row.avgSimulatedReturnPct)}</td>
              <td><Badge variant={row.status === 'completed' ? 'success' : row.status === 'insufficient_data' ? 'warning' : row.status === 'error' ? 'danger' : 'default'}>{getHistoricalStatusText(row.status, language)}</Badge></td>
              <td className="product-table__align-right">
                <Button size="sm" variant="ghost" onClick={() => onOpen(row)}>
                  {language === 'en' ? 'Open' : '查看'}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const RuleBacktestTradeTable: React.FC<{ trades: RuleBacktestTradeItem[] }> = ({ trades }) => {
  const { language } = useI18n();
  if (trades.length === 0) {
    return <div className="product-empty-state">{language === 'en' ? 'No trade detail yet.' : '暂无交易明细。'}</div>;
  }

  return (
    <div className="product-table-shell">
      <table className="product-table product-table--wide">
        <thead>
          <tr>
            <th>{language === 'en' ? 'Signal and fills' : '信号与成交'}</th>
            <th>{language === 'en' ? 'Entry trigger' : '入场触发'}</th>
            <th>{language === 'en' ? 'Exit trigger' : '离场触发'}</th>
            <th>{language === 'en' ? 'Indicator snapshot' : '指标快照'}</th>
            <th className="product-table__align-right">{language === 'en' ? 'Return' : '收益'}</th>
            <th className="product-table__align-right">{language === 'en' ? 'Holding' : '持有'}</th>
            <th>{language === 'en' ? 'Execution audit' : '执行审计'}</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade, index) => {
            const entryIndicators = formatIndicatorEntries(trade.entryIndicators);
            const exitIndicators = formatIndicatorEntries(trade.exitIndicators);
            return (
              <tr key={`${trade.code}-${trade.tradeIndex ?? index}`}>
                <td>
                  <div className="product-table__stack">
                    <span className="product-table__mono">{trade.entrySignalDate || trade.entryDate || '--'} → {trade.exitSignalDate || trade.exitDate || '--'}</span>
                    <span>{trade.entryDate || '--'} @ {formatNumber(trade.entryPrice)}</span>
                    <span>{trade.exitDate || '--'} @ {formatNumber(trade.exitPrice)}</span>
                  </div>
                </td>
                <td>{trade.entryTrigger || trade.entrySignal || '--'}</td>
                <td>{trade.exitTrigger || trade.exitSignal || '--'}</td>
                <td>
                  <div className="indicator-stack">
                    {entryIndicators.length > 0 ? (
                      <div>
                        <p className="metric-card__label">Entry</p>
                        <div className="product-chip-list product-chip-list--tight">
                          {entryIndicators.map((item) => (
                            <span key={`entry-${item.key}`} className="product-chip">
                              {item.key}: {item.value}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {exitIndicators.length > 0 ? (
                      <div>
                        <p className="metric-card__label">Exit</p>
                        <div className="product-chip-list product-chip-list--tight">
                          {exitIndicators.map((item) => (
                            <span key={`exit-${item.key}`} className="product-chip">
                              {item.key}: {item.value}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </td>
                <td className="product-table__align-right">{pct(trade.returnPct)}</td>
                <td className="product-table__align-right">
                  <div className="product-table__stack">
                    <span>{trade.holdingBars ?? trade.holdingDays ?? '--'} bars</span>
                    <span>{trade.holdingCalendarDays ?? '--'} {language === 'en' ? 'days' : '天'}</span>
                  </div>
                </td>
                <td>
                  <div className="product-table__stack">
                    <span>{language === 'en' ? 'Signal price basis' : '信号价口径'}: {trade.signalPriceBasis || '--'}</span>
                    <span>{language === 'en' ? 'Fill price basis' : '成交价口径'}: {trade.priceBasis || '--'}</span>
                    <span>{language === 'en' ? 'Fee / slippage' : '手续费 / 滑点'}: {formatNumber(trade.feeBps, 1)}bp / {formatNumber(trade.slippageBps, 1)}bp</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export const RuleRunsTable: React.FC<{
  rows: RuleBacktestHistoryItem[];
  selectedRunId: number | null;
  onOpen: (run: RuleBacktestHistoryItem) => void;
  compareSelection?: {
    selectedIds: number[];
    onToggle: (run: RuleBacktestHistoryItem) => void;
    maxSelections?: number;
  };
}> = ({ rows, selectedRunId, onOpen, compareSelection }) => {
  const { language } = useI18n();
  if (rows.length === 0) {
    return <div className="product-empty-state">{language === 'en' ? 'No deterministic rule-backtest history yet.' : '暂无确定性规则回测历史。'}</div>;
  }

  return (
    <div className="product-table-shell">
      <table className="product-table">
        <thead>
          <tr>
            <th>{language === 'en' ? 'Run time' : '运行时间'}</th>
            <th>{language === 'en' ? 'Code' : '代码'}</th>
            <th>{language === 'en' ? 'Status' : '状态'}</th>
            <th className="product-table__align-right">{language === 'en' ? 'Lookback' : '回看范围'}</th>
            <th className="product-table__align-right">{language === 'en' ? 'Trades' : '交易'}</th>
            <th className="product-table__align-right">{language === 'en' ? 'Total return' : '总收益'}</th>
            <th className="product-table__align-right">{language === 'en' ? 'Excess return' : '超额收益'}</th>
            {compareSelection ? <th className="product-table__align-right">{language === 'en' ? 'Compare' : '比较'}</th> : null}
            <th className="product-table__align-right">{language === 'en' ? 'Action' : '操作'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} data-active={selectedRunId === row.id ? 'true' : 'false'}>
              <td>{formatDateTime(row.runAt)}</td>
              <td className="product-table__mono">{row.code}</td>
              <td>
                <div className="product-table__stack">
                  <Badge variant={row.status === 'completed' ? 'success' : row.status === 'failed' ? 'danger' : row.status === 'summarizing' ? 'info' : row.status === 'cancelled' || row.status === 'running' ? 'warning' : 'default'}>
                    {getRuleStatusText(row.status, language)}
                  </Badge>
                  <span>{language === 'en' ? (getRuleRunStatusDescription(row.status, language) || '--') : (row.statusMessage || getRuleRunStatusDescription(row.status, language) || '--')}</span>
                </div>
              </td>
              <td className="product-table__align-right">{row.lookbackBars}</td>
              <td className="product-table__align-right">{row.tradeCount}</td>
              <td className="product-table__align-right">{pct(row.totalReturnPct)}</td>
              <td className="product-table__align-right">{pct(row.excessReturnVsBuyAndHoldPct)}</td>
              {compareSelection ? (
                <td className="product-table__align-right">
                  {row.id === selectedRunId ? (
                    <span className="product-chip">当前</span>
                  ) : row.status !== 'completed' ? (
                    <span className="product-footnote">{language === 'en' ? 'Completed only' : '仅已完成'}</span>
                  ) : (
                    <Checkbox
                      aria-label={`比较运行 ${row.id}`}
                      checked={compareSelection.selectedIds.includes(row.id)}
                      disabled={
                        !compareSelection.selectedIds.includes(row.id)
                        && compareSelection.selectedIds.length >= (compareSelection.maxSelections ?? 3)
                      }
                      onChange={() => compareSelection.onToggle(row)}
                    />
                  )}
                </td>
              ) : null}
              <td className="product-table__align-right">
                <Button size="sm" variant="ghost" onClick={() => onOpen(row)}>
                  {language === 'en' ? 'Open' : '查看'}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
