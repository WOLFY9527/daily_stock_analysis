import { describe, expect, it } from 'vitest';
import {
  getResearchQueueConsumerCopy,
  getResearchQueueConsumerText,
  getWatchlistRowResearchPacketConsumerCopy,
} from '../researchQueueConsumerCopy';
import type { WatchlistResearchProvenanceState, WatchlistResearchReadinessState, WatchlistRowResearchPacketResponse } from '../../types/watchlist';

function makeRowPacket(
  state: WatchlistResearchReadinessState,
  provenanceState: WatchlistResearchProvenanceState,
): WatchlistRowResearchPacketResponse {
  const dimension = {
    state,
    freshnessState: state,
    sourceClass: provenanceState === 'fixture'
      ? 'fixture' as const
      : provenanceState === 'simulated'
        ? 'simulated' as const
        : provenanceState === 'example'
          ? 'example' as const
          : 'market_observation' as const,
    provenanceState,
    asOf: state === 'unknown' ? null : '2026-05-01T12:30:00Z',
  };
  return {
    symbol: '600519',
    market: 'cn',
    identity: { name: null, exchange: null, sector: null, industry: null },
    savedItemSource: 'manual',
    quote: { state: 'missing', price: null, changePercent: null, asOf: null },
    provenance: {
      sourceClass: dimension.sourceClass,
      provenanceState,
      asOf: dimension.asOf,
      freshnessState: state,
    },
    scannerLineage: { runId: null, rank: null, score: null, status: null, lastScoredAt: null },
    researchStatus: 'blocked',
    researchReadiness: {
      state,
      freshnessState: state,
      identityState: 'resolved',
      marketData: dimension,
      scannerEvidence: { ...dimension, sourceClass: 'scanner_run', provenanceState: 'calculated' },
      backtestResult: { ...dimension, sourceClass: 'rule_backtest_result', provenanceState: 'calculated' },
      blockedReasons: state === 'available' ? [] : ['market_data_unavailable'],
    },
    missingData: ['quote'],
    nextDataAction: 'Add quote.',
    observationOnly: true,
    noAdviceDisclosure: 'Observation only.',
  };
}

describe('researchQueueConsumerCopy', () => {
  it('maps known English research queue phrases into consumer-safe Chinese copy', () => {
    const copy = getResearchQueueConsumerCopy({
      priorityTier: 'attention',
      priorityReason: 'Missing evidence needs review.',
      evidenceState: 'no_evidence',
      missingEvidence: ['Price-history evidence', 'Scanner score evidence', 'Supporting evidence'],
      suggestedResearchPath: [
        {
          label: 'Stock Structure',
          route: '/stocks/MSFT/structure-decision',
          reason: 'Open symbol structure detail.',
        },
      ],
    }, 'zh');

    expect(copy).toEqual({
      priorityTierLabel: '建议复核',
      priorityVariant: 'caution',
      evidenceStateLabel: '缺少关键证据',
      priorityReason: '研究上下文待补',
      missingEvidence: ['价格与历史数据待补', '扫描评分待更新', '研究上下文待补'],
      suggestedResearchPath: [
        {
          label: '查看个股结构',
          reason: '先核对结构与资料完整性。',
        },
      ],
    });
  });

  it('fails closed for unknown raw queue copy and diagnostic tokens', () => {
    const copy = getResearchQueueConsumerCopy({
      priorityTier: 'monitor',
      priorityReason: 'Queue review pending from backend memo',
      evidenceState: 'provider_trace_pending',
      missingEvidence: ['provider_runtime_trace', 'custom upstream phrase'],
      suggestedResearchPath: [
        {
          label: 'queue_debug_path',
          route: '/stocks/BABA/structure-decision',
          reason: 'provider_runtime_trace',
        },
      ],
    }, 'zh');

    expect(copy.priorityTierLabel).toBe('继续观察');
    expect(copy.evidenceStateLabel).toBe('证据待确认');
    expect(copy.priorityReason).toBe('当前条目的证据覆盖仍需复核。');
    expect(copy.missingEvidence).toEqual(['部分外部数据暂不可用', '部分关键资料待补充']);
    expect(copy.suggestedResearchPath).toEqual([
      {
        label: '查看个股结构',
        reason: '部分外部数据暂不可用',
      },
    ]);
  });

  it('suppresses advice wording instead of rendering it to consumers', () => {
    expect(getResearchQueueConsumerText('Buy before breakout with stop loss', 'zh', '当前条目的证据覆盖仍需复核。')).toBe('当前条目的证据覆盖仍需复核。');
    expect(getResearchQueueConsumerText('目标价 150，建议加仓', 'zh', '部分关键资料待补充')).toBe('部分关键资料待补充');
  });

  it('maps watchlist row research packet states into compact consumer labels', () => {
    const copy = getWatchlistRowResearchPacketConsumerCopy({
      symbol: '600519',
      market: 'cn',
      identity: {
        name: null,
        exchange: null,
        sector: null,
        industry: null,
      },
      savedItemSource: 'manual',
      quote: {
        state: 'missing',
        price: null,
        changePercent: null,
        asOf: null,
      },
      provenance: {
        sourceClass: 'unknown',
        provenanceState: 'unknown',
        asOf: null,
        freshnessState: 'unknown',
      },
      scannerLineage: {
        runId: null,
        rank: null,
        score: null,
        status: null,
        lastScoredAt: null,
      },
      researchStatus: 'blocked',
      missingData: [
        'quote',
        'price_history',
        'fundamentals',
        'filing_event_catalyst',
        'peer_benchmark',
        'Missing evidence needs review',
        'evidence_gap',
      ],
      nextDataAction: 'Add quote and daily price history evidence before marking the packet ready.',
      observationOnly: true,
      noAdviceDisclosure: 'Observation-only research packet; no personalized action instruction.',
    }, 'zh');

    expect(copy.quoteStateLabel).toBe('报价待补');
    expect(copy.researchStatusLabel).toBe('数据待补');
    expect(copy.scannerLineageLabel).toBe('待扫描');
    expect(copy.missingSummary).toBe('报价与历史待补 · 基本面、事件、同业待补');
    expect(copy.nextDataActionLabel).toBe('补报价与历史');
    expect(copy.noAdviceLabel).toBe('仅供观察');
    expect(Object.values(copy).filter((value) => typeof value === 'string').join(' ')).not.toMatch(/Missing evidence needs review|evidence_gap|missing|blocked|observationOnly|noAdviceDisclosure|not personalized financial advice/i);
  });

  it.each([
    ['available', 'observed', 'Research evidence available · observed data', true],
    ['partial', 'delayed', 'Research evidence partial · delayed data', false],
    ['stale', 'delayed', 'Research evidence stale · delayed data', false],
    ['available', 'simulated', 'Research evidence available · simulated data', true],
    ['available', 'fixture', 'Research evidence available · fixture data', true],
    ['unavailable', 'unavailable', 'Research evidence unavailable · source unavailable', false],
    ['unknown', 'unknown', 'Research evidence needs data · source unknown', false],
  ] as const)(
    'preserves canonical %s readiness with %s provenance',
    (state, provenance, label, available) => {
      const copy = getWatchlistRowResearchPacketConsumerCopy(makeRowPacket(state, provenance), 'en');

      expect(copy?.evidenceSummaryLabel).toBe(label);
      expect(copy?.evidenceAvailable).toBe(available);
    },
  );
});
