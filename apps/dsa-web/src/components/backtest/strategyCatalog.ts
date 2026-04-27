export type BacktestLanguage = 'zh' | 'en';

type LocalizedText = Record<BacktestLanguage, string>;

export type StrategyTemplateCategoryId = 'basic' | 'advanced' | 'professional';

export type StrategyTemplateParameter = {
  key: string;
  label: LocalizedText;
  value: string | number;
};

export type StrategyCatalogEntry = {
  id: string;
  strategyFamily: string;
  category: StrategyTemplateCategoryId;
  executable: boolean;
  name: LocalizedText;
  description: LocalizedText;
  logicSummary: LocalizedText;
  editorText: LocalizedText;
  defaultParameters: StrategyTemplateParameter[];
};

export const STRATEGY_CATEGORY_COPY: Record<
StrategyTemplateCategoryId,
{ title: LocalizedText; description: LocalizedText }
> = {
  basic: {
    title: {
      zh: '基础 / 默认策略',
      en: 'Basic / Default Strategies',
    },
    description: {
      zh: '面向普通用户的开箱即用模板，术语少、逻辑直观。',
      en: 'Entry-level templates for ordinary users with simple and readable rules.',
    },
  },
  advanced: {
    title: {
      zh: '进阶 / 扩展策略',
      en: 'Advanced / Extended Strategies',
    },
    description: {
      zh: '提供更多量价、波动率和区间思路，适合想扩展选择的用户。',
      en: 'Extended templates for users who want more options around volume, volatility, and swing setups.',
    },
  },
  professional: {
    title: {
      zh: '专业 / 组合策略',
      en: 'Professional / Combination Strategies',
    },
    description: {
      zh: '多指标联合确认模板，适合专业用户做组合验证。',
      en: 'Multi-indicator combination templates for professional-style validation.',
    },
  },
};

export const POINT_AND_SHOOT_TEMPLATE_IDS = [
  'macd_crossover',
  'moving_average_crossover',
  'rsi_threshold',
  'periodic_accumulation',
] as const;

export type NormalStrategyTemplate = typeof POINT_AND_SHOOT_TEMPLATE_IDS[number];

export const BUILT_IN_STRATEGY_CATALOG: StrategyCatalogEntry[] = [
  {
    id: 'macd_crossover',
    strategyFamily: 'macd_crossover',
    category: 'basic',
    executable: true,
    name: { zh: 'MACD 金叉 / 死叉', en: 'MACD bullish / bearish crossover' },
    description: { zh: '经典趋势模板，用 MACD 金叉买入、死叉卖出。', en: 'Classic trend template that buys on a MACD bullish crossover and exits on a bearish crossover.' },
    logicSummary: { zh: '当 MACD 线向上穿过信号线时买入，向下跌破时卖出。', en: 'Buy when the MACD line crosses above the signal line and exit on the reverse crossover.' },
    editorText: { zh: 'MACD 金叉买入，死叉卖出', en: 'Buy on a MACD bullish crossover and sell on a bearish crossover' },
    defaultParameters: [
      { key: 'fastPeriod', label: { zh: '快线周期', en: 'Fast period' }, value: 12 },
      { key: 'slowPeriod', label: { zh: '慢线周期', en: 'Slow period' }, value: 26 },
      { key: 'signalPeriod', label: { zh: '信号周期', en: 'Signal period' }, value: 9 },
    ],
  },
  {
    id: 'moving_average_crossover',
    strategyFamily: 'moving_average_crossover',
    category: 'basic',
    executable: true,
    name: { zh: '均线交叉（SMA / EMA）', en: 'Moving-average crossover (SMA / EMA)' },
    description: { zh: '短均线上穿长均线买入，下穿卖出，适合普通用户入门。', en: 'Buy when a short moving average crosses above a long moving average, and exit on the reverse crossover.' },
    logicSummary: { zh: '默认使用 5 日与 20 日均线观察趋势切换。', en: 'Uses a default 5-day versus 20-day crossover to detect trend changes.' },
    editorText: { zh: '5日均线上穿20日均线买入，下穿卖出', en: 'Buy when the 5-day moving average crosses above the 20-day average, and sell on the reverse crossover' },
    defaultParameters: [
      { key: 'fastPeriod', label: { zh: '快线周期', en: 'Fast period' }, value: 5 },
      { key: 'slowPeriod', label: { zh: '慢线周期', en: 'Slow period' }, value: 20 },
      { key: 'averageType', label: { zh: '均线类型', en: 'Average type' }, value: 'SMA' },
    ],
  },
  {
    id: 'rsi_threshold',
    strategyFamily: 'rsi_threshold',
    category: 'basic',
    executable: true,
    name: { zh: 'RSI 超买 / 超卖', en: 'RSI overbought / oversold' },
    description: { zh: '用 RSI 判断超卖买入与超买卖出。', en: 'Uses RSI oversold and overbought thresholds for entries and exits.' },
    logicSummary: { zh: '默认 RSI14 低于 30 买入，高于 70 卖出。', en: 'Default behavior buys when RSI14 drops below 30 and exits above 70.' },
    editorText: { zh: 'RSI14 低于30买入，高于70卖出', en: 'Buy when RSI14 drops below 30 and sell when it rises above 70' },
    defaultParameters: [
      { key: 'period', label: { zh: 'RSI 周期', en: 'RSI period' }, value: 14 },
      { key: 'lowerThreshold', label: { zh: '超卖阈值', en: 'Oversold threshold' }, value: 30 },
      { key: 'upperThreshold', label: { zh: '超买阈值', en: 'Overbought threshold' }, value: 70 },
    ],
  },
  {
    id: 'periodic_accumulation',
    strategyFamily: 'periodic_accumulation',
    category: 'basic',
    executable: true,
    name: { zh: '定投策略', en: 'Periodic accumulation' },
    description: { zh: '按固定频率持续买入，适合验证长期资金部署。', en: 'Buys on a fixed cadence to test steady capital deployment.' },
    logicSummary: { zh: '默认每月投入固定金额，直到区间结束。', en: 'Invests a fixed amount on a monthly cadence until the backtest window ends.' },
    editorText: { zh: '每月定投1000美元', en: 'Invest 1000 USD every month' },
    defaultParameters: [
      { key: 'cadence', label: { zh: '定投频率', en: 'Cadence' }, value: 'monthly' },
      { key: 'amount', label: { zh: '每次金额', en: 'Amount per trade' }, value: 1000 },
      { key: 'cashPolicy', label: { zh: '现金策略', en: 'Cash policy' }, value: 'stop_when_insufficient_cash' },
    ],
  },
  {
    id: 'bollinger_breakout',
    strategyFamily: 'bollinger_breakout',
    category: 'basic',
    executable: false,
    name: { zh: '布林带突破', en: 'Bollinger Band breakout' },
    description: { zh: '价格上破上轨时追随突破，回落时退出。', en: 'Follows upside breakouts above the upper Bollinger Band and exits on weakness.' },
    logicSummary: { zh: '收盘价突破上轨买入，跌回中轨或下轨卖出。', en: 'Buy when price closes above the upper band and exit on a move back to the middle or lower band.' },
    editorText: { zh: '收盘价突破布林带上轨买入，跌回中轨卖出', en: 'Buy when price closes above the upper Bollinger Band and sell when it falls back to the middle band' },
    defaultParameters: [
      { key: 'period', label: { zh: '带宽周期', en: 'Band period' }, value: 20 },
      { key: 'stdDev', label: { zh: '标准差倍数', en: 'Standard deviation' }, value: 2 },
      { key: 'exitLine', label: { zh: '离场参考', en: 'Exit line' }, value: 'middle_band' },
    ],
  },
  {
    id: 'previous_high_low_breakout',
    strategyFamily: 'previous_high_low_breakout',
    category: 'basic',
    executable: false,
    name: { zh: '前高 / 前低突破', en: 'Previous high / low breakout' },
    description: { zh: '突破前高追涨，跌破前低离场，逻辑直观。', en: 'Buy on a break above a recent high and exit on a break below a recent low.' },
    logicSummary: { zh: '突破前 20 日高点买入，跌破前 10 日低点卖出。', en: 'Buy on a break above the prior 20-day high and exit below the prior 10-day low.' },
    editorText: { zh: '突破前20日最高价买入，跌破前10日最低价卖出', en: 'Buy on a break above the previous 20-day high and sell below the previous 10-day low' },
    defaultParameters: [
      { key: 'entryLookback', label: { zh: '突破观察窗口', en: 'Entry lookback' }, value: 20 },
      { key: 'exitLookback', label: { zh: '离场观察窗口', en: 'Exit lookback' }, value: 10 },
    ],
  },
  {
    id: 'simple_momentum',
    strategyFamily: 'simple_momentum',
    category: 'basic',
    executable: false,
    name: { zh: '简单动量', en: 'Simple momentum' },
    description: { zh: '上涨动能延续时跟随，适合做基础趋势验证。', en: 'Rides basic momentum when recent performance stays strong.' },
    logicSummary: { zh: '近 20 日涨幅转正并创新高买入，跌破 10 日低点卖出。', en: 'Buy when the 20-day return turns positive and price makes a new short-term high, then exit below the 10-day low.' },
    editorText: { zh: '近20日涨幅转正并创新高买入，跌破10日低点卖出', en: 'Buy when the 20-day return turns positive and price makes a fresh high, then sell below the 10-day low' },
    defaultParameters: [
      { key: 'momentumLookback', label: { zh: '动量窗口', en: 'Momentum lookback' }, value: 20 },
      { key: 'exitLookback', label: { zh: '离场窗口', en: 'Exit lookback' }, value: 10 },
    ],
  },
  {
    id: 'simple_mean_reversion',
    strategyFamily: 'simple_mean_reversion',
    category: 'basic',
    executable: false,
    name: { zh: '简单均值回归', en: 'Simple mean reversion' },
    description: { zh: '价格短期偏离均值后，等待回归反弹。', en: 'Looks for short-term deviations from the mean and a snap-back move.' },
    logicSummary: { zh: '价格低于 20 日均线 5% 买入，回到均线附近卖出。', en: 'Buy when price trades 5% below the 20-day average and exit near the mean.' },
    editorText: { zh: '价格低于20日均线5%买入，回到均线附近卖出', en: 'Buy when price trades 5% below the 20-day average and sell when it returns near the mean' },
    defaultParameters: [
      { key: 'meanPeriod', label: { zh: '均值周期', en: 'Mean period' }, value: 20 },
      { key: 'entryDeviationPct', label: { zh: '入场偏离', en: 'Entry deviation' }, value: '5%' },
      { key: 'exitTarget', label: { zh: '离场目标', en: 'Exit target' }, value: 'mean_retest' },
    ],
  },
  {
    id: 'ema_pullback_trend',
    strategyFamily: 'ema_pullback_trend',
    category: 'basic',
    executable: false,
    name: { zh: 'EMA 回踩趋势', en: 'EMA pullback trend' },
    description: { zh: '趋势向上时等待回踩短期 EMA 再介入。', en: 'Waits for an orderly pullback into a rising EMA before entering.' },
    logicSummary: { zh: 'EMA20 在 EMA60 上方时，价格回踩 EMA20 再转强买入。', en: 'When EMA20 stays above EMA60, buy after price pulls back to EMA20 and turns back up.' },
    editorText: { zh: 'EMA20 在 EMA60 上方时，价格回踩 EMA20 再转强买入', en: 'Buy when EMA20 stays above EMA60 and price pulls back to EMA20 before turning up again' },
    defaultParameters: [
      { key: 'fastPeriod', label: { zh: '短 EMA', en: 'Fast EMA' }, value: 20 },
      { key: 'slowPeriod', label: { zh: '长 EMA', en: 'Slow EMA' }, value: 60 },
      { key: 'stopLossPct', label: { zh: '止损', en: 'Stop loss' }, value: '4%' },
    ],
  },
  {
    id: 'price_channel_breakout',
    strategyFamily: 'price_channel_breakout',
    category: 'basic',
    executable: false,
    name: { zh: '价格通道突破', en: 'Price channel breakout' },
    description: { zh: '用价格通道判断区间突破与失效。', en: 'Uses a simple price channel to detect breakouts and breakdown exits.' },
    logicSummary: { zh: '突破 20 日通道上沿买入，跌破 10 日通道下沿卖出。', en: 'Buy above the 20-day channel high and exit below the 10-day channel low.' },
    editorText: { zh: '突破20日价格通道上沿买入，跌破10日通道下沿卖出', en: 'Buy above the 20-day price channel high and sell below the 10-day channel low' },
    defaultParameters: [
      { key: 'entryChannel', label: { zh: '入场通道', en: 'Entry channel' }, value: 20 },
      { key: 'exitChannel', label: { zh: '离场通道', en: 'Exit channel' }, value: 10 },
    ],
  },
  {
    id: 'rsi_mean_reversion',
    strategyFamily: 'rsi_mean_reversion',
    category: 'advanced',
    executable: false,
    name: { zh: 'RSI 均值回归', en: 'RSI mean reversion' },
    description: { zh: '更偏交易型的反转思路，等待超卖反弹。', en: 'A more tactical mean-reversion setup that looks for oversold rebounds.' },
    logicSummary: { zh: 'RSI2 跌破 10 买入，反弹到 60 附近卖出。', en: 'Buy when RSI2 falls below 10 and exit after it rebounds toward 60.' },
    editorText: { zh: 'RSI2 低于10买入，反弹到60附近卖出', en: 'Buy when RSI2 falls below 10 and sell when it rebounds toward 60' },
    defaultParameters: [
      { key: 'period', label: { zh: 'RSI 周期', en: 'RSI period' }, value: 2 },
      { key: 'entryThreshold', label: { zh: '入场阈值', en: 'Entry threshold' }, value: 10 },
      { key: 'exitThreshold', label: { zh: '离场阈值', en: 'Exit threshold' }, value: 60 },
    ],
  },
  {
    id: 'bollinger_band_reversion',
    strategyFamily: 'bollinger_band_reversion',
    category: 'advanced',
    executable: false,
    name: { zh: '布林带回归', en: 'Bollinger Band reversion' },
    description: { zh: '价格跌出下轨后，等待回归中轨。', en: 'Looks for a rebound after price stretches below the lower band.' },
    logicSummary: { zh: '价格跌破下轨买入，回到中轨或上轨减仓离场。', en: 'Buy when price drops below the lower band and exit as it reverts toward the middle or upper band.' },
    editorText: { zh: '价格跌破布林带下轨买入，回到中轨卖出', en: 'Buy when price drops below the lower Bollinger Band and sell when it reverts to the middle band' },
    defaultParameters: [
      { key: 'period', label: { zh: '带宽周期', en: 'Band period' }, value: 20 },
      { key: 'stdDev', label: { zh: '标准差倍数', en: 'Standard deviation' }, value: 2 },
      { key: 'exitLine', label: { zh: '回归目标', en: 'Reversion target' }, value: 'middle_band' },
    ],
  },
  {
    id: 'volume_breakout',
    strategyFamily: 'volume_breakout',
    category: 'advanced',
    executable: false,
    name: { zh: '成交量突破', en: 'Volume breakout' },
    description: { zh: '量价同时放大时介入，适合观察放量突破。', en: 'Focuses on breakouts that are confirmed by expanding volume.' },
    logicSummary: { zh: '价格突破平台高点且成交量大于 20 日均量 1.5 倍时买入。', en: 'Buy when price breaks a recent range high with volume at least 1.5x the 20-day average.' },
    editorText: { zh: '价格突破平台高点且成交量放大到20日均量1.5倍时买入', en: 'Buy when price breaks the range high and volume expands to 1.5x the 20-day average' },
    defaultParameters: [
      { key: 'priceLookback', label: { zh: '平台窗口', en: 'Price lookback' }, value: 20 },
      { key: 'volumeMultiplier', label: { zh: '放量倍数', en: 'Volume multiplier' }, value: '1.5x' },
      { key: 'exitRule', label: { zh: '离场规则', en: 'Exit rule' }, value: 'fall_back_into_range' },
    ],
  },
  {
    id: 'price_volume_divergence',
    strategyFamily: 'price_volume_divergence',
    category: 'advanced',
    executable: false,
    name: { zh: '价量背离', en: 'Price-volume divergence' },
    description: { zh: '用价格创新高而量能转弱的背离信号观察风险。', en: 'Tracks divergence when price pushes higher but volume support fades.' },
    logicSummary: { zh: '价格创新高但量能未同步放大时减仓或离场。', en: 'Exit or reduce when price makes a fresh high without confirming volume expansion.' },
    editorText: { zh: '价格创新高但量能不再放大时减仓离场', en: 'Reduce or exit when price makes a new high but volume no longer confirms' },
    defaultParameters: [
      { key: 'priceLookback', label: { zh: '价格窗口', en: 'Price window' }, value: 20 },
      { key: 'volumeLookback', label: { zh: '量能窗口', en: 'Volume window' }, value: 20 },
    ],
  },
  {
    id: 'support_resistance_bounce',
    strategyFamily: 'support_resistance_bounce',
    category: 'advanced',
    executable: false,
    name: { zh: '支撑 / 阻力反弹', en: 'Support / resistance bounce' },
    description: { zh: '接近支撑位企稳时买入，接近阻力位减仓。', en: 'Looks for a bounce near support and trims near resistance.' },
    logicSummary: { zh: '回踩前低或平台支撑企稳买入，接近前高或阻力位卖出。', en: 'Buy after price stabilizes near support and exit as it approaches prior resistance.' },
    editorText: { zh: '回踩支撑企稳买入，接近阻力位卖出', en: 'Buy after price stabilizes near support and sell as it approaches resistance' },
    defaultParameters: [
      { key: 'supportLookback', label: { zh: '支撑观察窗', en: 'Support lookback' }, value: 20 },
      { key: 'resistanceLookback', label: { zh: '阻力观察窗', en: 'Resistance lookback' }, value: 20 },
    ],
  },
  {
    id: 'prior_day_range_breakout',
    strategyFamily: 'prior_day_range_breakout',
    category: 'advanced',
    executable: false,
    name: { zh: '前一日区间突破', en: 'Prior-day range breakout' },
    description: { zh: '常见波段模板，用前一日高低点做突破确认。', en: 'A swing-trading template that uses the prior day range as the trigger.' },
    logicSummary: { zh: '突破前一日高点买入，跌回前一日低点附近卖出。', en: 'Buy above the prior day high and exit on a fade back toward the prior day low.' },
    editorText: { zh: '突破前一日高点买入，跌回前一日低点附近卖出', en: 'Buy above the prior day high and sell when price fades back toward the prior day low' },
    defaultParameters: [
      { key: 'referenceRange', label: { zh: '参考区间', en: 'Reference range' }, value: 'prior_day' },
      { key: 'confirmation', label: { zh: '确认方式', en: 'Confirmation' }, value: 'close_above_high' },
    ],
  },
  {
    id: 'macd_rsi_combo',
    strategyFamily: 'macd_rsi_combo',
    category: 'professional',
    executable: false,
    name: { zh: 'MACD + RSI 共振', en: 'MACD + RSI combo' },
    description: { zh: '用趋势和动量双确认减少单指标噪音。', en: 'Combines trend and momentum confirmation to reduce single-indicator noise.' },
    logicSummary: { zh: 'MACD 金叉且 RSI14 上穿 50 买入，任一信号走弱时卖出。', en: 'Buy when MACD turns bullish and RSI14 rises above 50, then exit when either signal weakens.' },
    editorText: { zh: 'MACD金叉且RSI14上穿50买入，任一信号走弱卖出', en: 'Buy when MACD turns bullish and RSI14 rises above 50, then sell when either signal weakens' },
    defaultParameters: [
      { key: 'macd', label: { zh: 'MACD 参数', en: 'MACD parameters' }, value: '12/26/9' },
      { key: 'rsiPeriod', label: { zh: 'RSI 周期', en: 'RSI period' }, value: 14 },
      { key: 'rsiConfirm', label: { zh: '动量确认', en: 'Momentum confirm' }, value: 50 },
    ],
  },
  {
    id: 'sma_bollinger_combo',
    strategyFamily: 'sma_bollinger_combo',
    category: 'professional',
    executable: false,
    name: { zh: 'SMA + 布林带组合', en: 'SMA + Bollinger combo' },
    description: { zh: '先判断趋势方向，再用波动率带筛掉假突破。', en: 'Uses trend direction first and Bollinger structure second to filter weak breakouts.' },
    logicSummary: { zh: 'SMA20 在 SMA60 上方且价格重新站上布林带中轨时买入。', en: 'Buy when SMA20 stays above SMA60 and price reclaims the Bollinger middle band.' },
    editorText: { zh: 'SMA20 在 SMA60 上方且价格重回布林带中轨上方时买入', en: 'Buy when SMA20 stays above SMA60 and price reclaims the Bollinger middle band' },
    defaultParameters: [
      { key: 'trendWindow', label: { zh: '趋势均线', en: 'Trend averages' }, value: '20 / 60' },
      { key: 'bollinger', label: { zh: '布林带参数', en: 'Bollinger settings' }, value: '20 / 2' },
    ],
  },
  {
    id: 'trend_momentum_volume_mix',
    strategyFamily: 'trend_momentum_volume_mix',
    category: 'professional',
    executable: false,
    name: { zh: '趋势 + 动量 + 量能混合', en: 'Trend + momentum + volume mix' },
    description: { zh: '把趋势、动量、量能三类信号放在一套规则里联合确认。', en: 'Mixes trend, momentum, and volume into a single confirmation stack.' },
    logicSummary: { zh: '均线多头、RSI 强势且放量突破同时出现时买入。', en: 'Buy only when moving averages align, RSI stays strong, and a volume-confirmed breakout appears together.' },
    editorText: { zh: '均线多头、RSI 强势且放量突破同时出现时买入', en: 'Buy when moving averages align, RSI stays strong, and a volume-confirmed breakout appears together' },
    defaultParameters: [
      { key: 'maStack', label: { zh: '均线结构', en: 'MA stack' }, value: '20 / 60 / 120' },
      { key: 'rsiThreshold', label: { zh: 'RSI 强势线', en: 'RSI strength line' }, value: 55 },
      { key: 'volumeMultiplier', label: { zh: '放量倍数', en: 'Volume multiplier' }, value: '1.5x' },
    ],
  },
  {
    id: 'multi_indicator_trend_filter',
    strategyFamily: 'multi_indicator_trend_filter',
    category: 'professional',
    executable: false,
    name: { zh: '多指标趋势过滤', en: 'Multi-indicator trend filter' },
    description: { zh: '先用趋势过滤市场状态，再在强势区间内触发入场。', en: 'Filters for favorable regime first, then triggers entries only inside strong trend windows.' },
    logicSummary: { zh: '价格位于长期均线上方、MACD 为正且 ATR 扩张时才允许入场。', en: 'Allow entries only when price is above the long-term average, MACD stays positive, and ATR is expanding.' },
    editorText: { zh: '价格位于长期均线上方、MACD 为正且波动率扩张时才允许入场', en: 'Only allow entries when price is above the long-term average, MACD is positive, and volatility is expanding' },
    defaultParameters: [
      { key: 'trendAverage', label: { zh: '长期均线', en: 'Trend average' }, value: 120 },
      { key: 'atrPeriod', label: { zh: 'ATR 周期', en: 'ATR period' }, value: 14 },
      { key: 'macdBias', label: { zh: 'MACD 偏向', en: 'MACD bias' }, value: 'positive_histogram' },
    ],
  },
];

const POINT_AND_SHOOT_TEMPLATE_SET = new Set<string>(POINT_AND_SHOOT_TEMPLATE_IDS);

export const POINT_AND_SHOOT_TEMPLATES = BUILT_IN_STRATEGY_CATALOG.filter(
  (template): template is StrategyCatalogEntry & { id: NormalStrategyTemplate } =>
    template.executable && POINT_AND_SHOOT_TEMPLATE_SET.has(template.id),
);

export function getStrategyCatalogEntry(templateId: string): StrategyCatalogEntry | undefined {
  return BUILT_IN_STRATEGY_CATALOG.find((template) => template.id === templateId);
}

export function getStrategyCatalogGroups(): Array<{
  id: StrategyTemplateCategoryId;
  title: LocalizedText;
  description: LocalizedText;
  templates: StrategyCatalogEntry[];
}> {
  return (['basic', 'advanced', 'professional'] as StrategyTemplateCategoryId[]).map((category) => ({
    id: category,
    title: STRATEGY_CATEGORY_COPY[category].title,
    description: STRATEGY_CATEGORY_COPY[category].description,
    templates: BUILT_IN_STRATEGY_CATALOG.filter((template) => template.category === category),
  }));
}

export function buildPointAndShootStrategyText(
  language: BacktestLanguage,
  template: NormalStrategyTemplate,
  payload: {
    code: string;
    startDate: string;
    endDate: string;
    initialCapital: string;
  },
): string {
  const resolvedCode = payload.code || (language === 'en' ? 'the selected ticker' : '当前标的');
  const resolvedStart = payload.startDate || (language === 'en' ? 'the start date' : '开始日期');
  const resolvedEnd = payload.endDate || (language === 'en' ? 'the end date' : '结束日期');
  const resolvedCapital = payload.initialCapital || '100000';

  if (template === 'macd_crossover') {
    return language === 'en'
      ? `Use initial capital ${resolvedCapital}. Backtest ${resolvedCode} from ${resolvedStart} to ${resolvedEnd}. Buy on a MACD bullish crossover and sell on a bearish crossover.`
      : `初始资金 ${resolvedCapital}，回测 ${resolvedCode} 在 ${resolvedStart} 到 ${resolvedEnd} 的表现，MACD 金叉买入，死叉卖出。`;
  }
  if (template === 'rsi_threshold') {
    return language === 'en'
      ? `Use initial capital ${resolvedCapital}. Backtest ${resolvedCode} from ${resolvedStart} to ${resolvedEnd}. Buy when RSI14 drops below 30 and sell when it rises above 70.`
      : `初始资金 ${resolvedCapital}，回测 ${resolvedCode} 在 ${resolvedStart} 到 ${resolvedEnd} 的表现，RSI14 低于 30 买入，高于 70 卖出。`;
  }
  if (template === 'periodic_accumulation') {
    return language === 'en'
      ? `Use initial capital ${resolvedCapital}. Backtest ${resolvedCode} from ${resolvedStart} to ${resolvedEnd}. Invest a fixed amount every month until the test window ends or cash runs out.`
      : `初始资金 ${resolvedCapital}，回测 ${resolvedCode} 在 ${resolvedStart} 到 ${resolvedEnd} 的表现，每月按固定金额持续定投，直到区间结束或现金耗尽。`;
  }
  return language === 'en'
    ? `Use initial capital ${resolvedCapital}. Backtest ${resolvedCode} from ${resolvedStart} to ${resolvedEnd}. Buy when the 5-day moving average crosses above the 20-day average, and sell on the reverse crossover.`
    : `初始资金 ${resolvedCapital}，回测 ${resolvedCode} 在 ${resolvedStart} 到 ${resolvedEnd} 的表现，5 日均线上穿 20 日均线买入，下穿卖出。`;
}
