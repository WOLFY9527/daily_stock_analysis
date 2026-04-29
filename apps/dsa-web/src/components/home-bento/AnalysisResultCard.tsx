import type React from 'react';
import { translate, type UiLanguage } from '../../i18n/core';
import type { AnalysisReport } from '../../types/analysis';
import { BentoCard } from './BentoCard';

type AnalysisResultCardProps = {
  language: UiLanguage;
  report: AnalysisReport;
};

function resolveDecision(report: AnalysisReport): string {
  const action = String(report.summary?.operationAdvice || '').trim();
  if (!action) return 'NEUTRAL';
  if (/买|buy/i.test(action)) return 'BUY';
  if (/卖|sell/i.test(action)) return 'SELL';
  return 'NEUTRAL';
}

const AnalysisResultCard: React.FC<AnalysisResultCardProps> = ({ language, report }) => {
  const decision = resolveDecision(report);
  const summary = report.summary?.analysisSummary || '-';
  const score = report.summary?.sentimentScore ?? '-';
  const target = report.strategy?.takeProfit || report.details?.standardReport?.decisionPanel?.target || '-';
  const stopLoss = report.strategy?.stopLoss || report.details?.standardReport?.decisionPanel?.stopLoss || '-';

  return (
    <BentoCard
      testId="home-bento-analysis-result-card"
      eyebrow={translate(language, 'home.finalAnalysisEyebrow')}
      title={translate(language, 'home.finalAnalysisTitle')}
      subtitle={summary}
      className="rounded-[36px] border-white/6 bg-[radial-gradient(circle_at_top,rgba(52,211,153,0.16),transparent_40%),rgba(255,255,255,0.03)]"
      accentGlow
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="mt-2 text-[2rem] font-semibold tracking-tight text-white">{decision}</h2>
        </div>
        <div className="rounded-3xl border border-white/8 bg-black/20 px-5 py-4 text-right">
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">{translate(language, 'home.analysisScore')}</p>
          <p className="mt-1 text-3xl font-semibold text-white">{score}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">{translate(language, 'home.analysisTarget')}</p>
          <p className="mt-2 text-lg font-semibold text-white">{target}</p>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">{translate(language, 'home.analysisStopLoss')}</p>
          <p className="mt-2 text-lg font-semibold text-white">{stopLoss}</p>
        </div>
      </div>
    </BentoCard>
  );
};

export default AnalysisResultCard;
