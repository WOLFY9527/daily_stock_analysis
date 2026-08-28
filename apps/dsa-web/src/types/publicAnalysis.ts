export interface PublicAnalysisPreviewMeta {
  queryId: string;
  stockCode: string;
  stockName?: string | null;
  companyName?: string | null;
  reportType?: string | null;
  reportLanguage?: string | null;
  createdAt?: string | null;
  marketTimestamp?: string | null;
  marketSessionDate?: string | null;
  newsPublishedAt?: string | null;
  reportGeneratedAt?: string | null;
  currentPrice?: number | null;
  changePct?: number | null;
}

export interface PublicAnalysisPreviewSummary {
  analysisSummary: string;
  trendPrediction: string;
  sentimentScore?: number | null;
  sentimentLabel?: string | null;
  observationScope: string;
  keyPriceReference: string;
  evidenceBoundary: string;
}

export interface PublicAnalysisPreviewReport {
  meta: PublicAnalysisPreviewMeta;
  summary: PublicAnalysisPreviewSummary;
}

export interface PublicAnalysisPreviewResponse {
  queryId: string;
  stockCode: string;
  stockName?: string | null;
  previewScope: 'guest' | string;
  report: PublicAnalysisPreviewReport;
}
