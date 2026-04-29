import type React from 'react';
import type { MarketOverviewItem, MarketOverviewPanel } from '../../api/marketOverview';
import { GlassCard } from '../common';
import { cn } from '../../utils/cn';
import {
  formatMetricValue,
  getDirectionTone,
} from './marketOverviewUtils';
import {
  MarketOverviewPanelFooter,
} from './marketOverviewPrimitives';

const GAUGE_TOOLTIP = '市场动量 30% | 股价强度 25% | 期权多空比 20% | 波动率需求 15% | 避险需求 10%';

const sentimentLabels: Record<string, string> = {
  PUTCALL: '避险情绪等级',
  BULLBEAR: '资金面空头回补',
  AAII: '股权风险偏好',
};

function resolvePrimaryItem(items: MarketOverviewItem[]): MarketOverviewItem | undefined {
  return items.find((item) => item.symbol.toUpperCase() === 'FGI') || items[0];
}

function describeSentiment(score?: number | null): string {
  if (score === null || score === undefined) {
    return 'Neutral';
  }
  if (score >= 75) {
    return 'Greed';
  }
  if (score >= 55) {
    return 'Risk-on';
  }
  if (score >= 40) {
    return 'Balanced';
  }
  if (score >= 25) {
    return 'Defensive';
  }
  return 'Fear';
}

export const MarketSentimentCard: React.FC<{ panel?: MarketOverviewPanel; loading?: boolean }> = ({ panel, loading }) => {
  const status = panel?.status || (loading ? 'loading' : 'failure');
  const items = panel?.items || [];
  const primary = resolvePrimaryItem(items);
  const supporting = items.filter((item) => item.symbol !== primary?.symbol).slice(0, 3);
  const score = primary?.value ?? 50;
  const gaugeRatio = Math.min(1, Math.max(0, score / 100));

  return (
    <GlassCard as="section" className="xl:col-span-4 flex h-full flex-col p-6">
      <div className="flex h-full flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40">Market sentiment</p>
            <h2 className="mt-2 text-xl font-semibold text-white">情绪与资金面</h2>
          </div>
          <span className={cn('text-[10px] font-semibold uppercase tracking-widest', status === 'success' ? 'text-emerald-400' : 'text-red-400')}>
            {status}
          </span>
        </div>

        {panel?.errorMessage ? (
          <div className="rounded-2xl border border-red-300/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {panel.errorMessage}
          </div>
        ) : null}

        {primary ? (
          <div className="rounded-2xl border border-white/6 bg-white/[0.015] p-5" title={GAUGE_TOOLTIP}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40">Fear & greed index</p>
                <p className="mt-2 text-3xl font-bold font-mono text-white">{formatMetricValue(primary, 0)}</p>
                <p className="mt-1 text-xs uppercase tracking-widest text-white/28">{describeSentiment(primary.value)}</p>
              </div>
              <span className={cn('pt-1 text-[11px] font-bold', getDirectionTone(primary.riskDirection))}>
                {primary.changePct === null || primary.changePct === undefined ? 'neutral' : `${primary.changePct >= 0 ? '+' : ''}${primary.changePct.toFixed(2)}%`}
              </span>
            </div>

            <div className="mt-5 flex items-center justify-center">
              <svg viewBox="0 0 160 96" className="h-32 w-full max-w-[15rem]" aria-hidden="true">
                <path d="M 16 80 A 64 64 0 0 1 144 80" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" strokeLinecap="round" />
                <path
                  d="M 16 80 A 64 64 0 0 1 144 80"
                  fill="none"
                  stroke="url(#sentimentGauge)"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={`${gaugeRatio * 201} 201`}
                />
                <defs>
                  <linearGradient id="sentimentGauge" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#f87171" />
                    <stop offset="50%" stopColor="#6366f1" />
                    <stop offset="100%" stopColor="#34d399" />
                  </linearGradient>
                </defs>
                <circle cx="80" cy="80" r="3" fill="rgba(255,255,255,0.9)" />
                <path
                  d={`M 80 80 L ${(80 - 58 * Math.cos(Math.PI * gaugeRatio)).toFixed(2)} ${(80 - 58 * Math.sin(Math.PI * gaugeRatio)).toFixed(2)}`}
                  stroke="rgba(255,255,255,0.92)"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <text x="16" y="94" fill="rgba(255,255,255,0.34)" fontSize="9" letterSpacing="1.6">FEAR</text>
                <text x="111" y="94" fill="rgba(255,255,255,0.34)" fontSize="9" letterSpacing="1.6">GREED</text>
              </svg>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {supporting.map((item) => (
            <div key={item.symbol} className="rounded-2xl border border-white/6 bg-white/[0.015] p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 text-[10px] font-semibold uppercase tracking-widest text-white/40">
                  {sentimentLabels[item.symbol] || item.label}
                </p>
                <span className={cn('shrink-0 text-[11px] font-bold', getDirectionTone(item.riskDirection))}>
                  {item.changePct === null || item.changePct === undefined ? 'neutral' : `${item.changePct >= 0 ? '+' : ''}${item.changePct.toFixed(2)}%`}
                </span>
              </div>
              <p className="mt-3 truncate text-2xl font-mono text-white">{formatMetricValue(item)}</p>
              <div className="mt-2 flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/24">
                {item.unit ? <span>{item.unit}</span> : null}
                <span>{item.symbol}</span>
              </div>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm text-white/60">
            Loading live market data...
          </div>
        ) : null}

        <MarketOverviewPanelFooter panel={panel} />
      </div>
    </GlassCard>
  );
};
