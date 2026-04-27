import type { PublicAnalysisPreviewResponse } from '../types/publicAnalysis';

const PREVIEW_SEEDS: Record<string, {
  stockName: string;
  actionZh: string;
  actionEn: string;
  summaryZh: string;
  summaryEn: string;
  trendZh: string;
  trendEn: string;
  score: number;
}> = {
  AAPL: {
    stockName: 'Apple',
    actionZh: '等待回踩',
    actionEn: 'Wait for pullback',
    summaryZh: '本地快照显示趋势仍偏强，但更好的介入点通常出现在回踩确认之后。',
    summaryEn: 'The local snapshot still leans constructive, but the cleaner entry usually appears after a confirmed pullback.',
    trendZh: '偏强震荡',
    trendEn: 'Constructive consolidation',
    score: 72,
  },
  NVDA: {
    stockName: 'NVIDIA',
    actionZh: '继续持有',
    actionEn: 'Keep holding',
    summaryZh: '本地快照延续了高景气龙头的强势结构，短线仍由趋势主导。',
    summaryEn: 'The local snapshot keeps the leadership trend intact, with momentum still driving the short-term structure.',
    trendZh: '趋势上行',
    trendEn: 'Trend up',
    score: 84,
  },
  ORCL: {
    stockName: 'Oracle',
    actionZh: '持有观察',
    actionEn: 'Hold and monitor',
    summaryZh: '本地快照显示资金承接仍在，但短线需要确认突破后的延续性。',
    summaryEn: 'The local snapshot still shows healthy sponsorship, but the post-breakout follow-through needs confirmation.',
    trendZh: '温和偏多',
    trendEn: 'Moderately bullish',
    score: 76,
  },
  TSLA: {
    stockName: 'Tesla',
    actionZh: '控制仓位',
    actionEn: 'Keep size disciplined',
    summaryZh: '本地快照维持波动偏大的判断，适合把仓位和节奏放在首位。',
    summaryEn: 'The local snapshot keeps the higher-volatility read, so sizing discipline matters more than aggressive chasing.',
    trendZh: '高波动震荡',
    trendEn: 'High-volatility range',
    score: 63,
  },
};

function normalizeTicker(value?: string): string {
  return String(value || '').trim().toUpperCase();
}

export function createPublicAnalysisFallbackPreview(
  ticker: string,
  language: 'zh' | 'en',
): PublicAnalysisPreviewResponse {
  const normalizedTicker = normalizeTicker(ticker) || 'AAPL';
  const seed = PREVIEW_SEEDS[normalizedTicker] || {
    stockName: normalizedTicker,
    actionZh: '等待确认',
    actionEn: 'Wait for confirmation',
    summaryZh: '本地快照已接管预览，当前更适合先观察结构是否继续改善。',
    summaryEn: 'The local snapshot is now driving the preview, so it is safer to watch whether the structure continues to improve.',
    trendZh: '观察中',
    trendEn: 'Under review',
    score: 68,
  };
  const now = new Date().toISOString();

  return {
    queryId: `guest-fallback-${normalizedTicker.toLowerCase()}`,
    stockCode: normalizedTicker,
    stockName: seed.stockName,
    previewScope: 'guest',
    report: {
      meta: {
        queryId: `guest-fallback-${normalizedTicker.toLowerCase()}`,
        stockCode: normalizedTicker,
        stockName: seed.stockName,
        reportType: 'brief',
        createdAt: now,
      },
      summary: {
        analysisSummary: language === 'en' ? seed.summaryEn : seed.summaryZh,
        operationAdvice: language === 'en' ? seed.actionEn : seed.actionZh,
        trendPrediction: language === 'en' ? seed.trendEn : seed.trendZh,
        sentimentScore: seed.score,
      },
    },
  };
}
