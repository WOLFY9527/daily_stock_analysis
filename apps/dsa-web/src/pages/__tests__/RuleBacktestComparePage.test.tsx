import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import RuleBacktestComparePage from '../RuleBacktestComparePage';

const { compareRuleBacktestRuns } = vi.hoisted(() => ({
  compareRuleBacktestRuns: vi.fn(),
}));

vi.mock('../../api/backtest', () => ({
  backtestApi: {
    compareRuleBacktestRuns,
  },
}));

function renderComparePage(initialEntry = '/backtest/compare?runIds=101,202') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/backtest/compare" element={<RuleBacktestComparePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RuleBacktestComparePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads the compare API and renders the foundation workbench sections', async () => {
    compareRuleBacktestRuns.mockResolvedValue({
      comparisonSource: 'stored_rule_backtest_runs',
      readMode: 'stored_first',
      requestedRunIds: [101, 202],
      resolvedRunIds: [101, 202],
      comparableRunIds: [101, 202],
      missingRunIds: [],
      unavailableRuns: [],
      fieldGroups: ['market_code_comparison', 'period_comparison', 'comparison_summary'],
      marketCodeComparison: {
        baselineRunId: 101,
        selectionRule: 'first_comparable_run_by_request_order',
        relationship: 'same_code',
        state: 'direct',
        directlyComparable: true,
        diagnostics: ['same_normalized_code'],
      },
      periodComparison: {
        baselineRunId: 101,
        selectionRule: 'first_comparable_run_by_request_order',
        relationship: 'overlapping',
        state: 'comparable',
        meaningfullyComparable: true,
        diagnostics: ['overlapping_periods'],
      },
      comparisonSummary: {
        baseline: {
          runId: 101,
          selectionRule: 'first_comparable_run_by_request_order',
          code: 'ORCL',
          timeframe: 'daily',
          startDate: '2025-01-01',
          endDate: '2025-12-31',
          strategyFamily: 'moving_average_crossover',
          strategyType: 'moving_average_crossover',
        },
        context: {
          codeValues: ['ORCL'],
          timeframeValues: ['daily'],
          strategyFamilyValues: ['moving_average_crossover'],
          strategyTypeValues: ['moving_average_crossover'],
          dateRanges: [
            { runId: 101, startDate: '2025-01-01', endDate: '2025-12-31' },
            { runId: 202, startDate: '2025-03-01', endDate: '2025-12-31' },
          ],
          allSameCode: true,
          allSameTimeframe: true,
          allSameDateRange: false,
        },
        metricDeltas: {
          totalReturnPct: {
            label: 'total_return_pct',
            state: 'comparable',
            baselineRunId: 101,
            baselineValue: 12,
            availableRunIds: [101, 202],
            unavailableRunIds: [],
            deltas: [
              { runId: 101, value: 12, deltaVsBaseline: 0 },
              { runId: 202, value: 18, deltaVsBaseline: 6 },
            ],
          },
          annualizedReturnPct: {
            label: 'annualized_return_pct',
            state: 'partial',
            baselineRunId: 101,
            baselineValue: 10,
            availableRunIds: [101],
            unavailableRunIds: [202],
            deltas: [{ runId: 101, value: 10, deltaVsBaseline: 0 }],
          },
        },
      },
      robustnessSummary: {
        baselineRunId: 101,
        selectionRule: 'first_comparable_run_by_request_order',
        overallState: 'partially_comparable',
        directlyComparable: false,
        alignedDimensions: ['market_code'],
        partialDimensions: ['periods', 'metrics_baseline'],
        divergentDimensions: [],
        unavailableDimensions: [],
        dimensions: {
          marketCode: {
            state: 'aligned',
            sourceState: 'direct',
            relationship: 'same_code',
            directlyComparable: true,
            diagnostics: ['same_normalized_code'],
          },
          periods: {
            state: 'partial',
            sourceState: 'limited',
            relationship: 'partial',
            meaningfullyComparable: false,
            diagnostics: ['overlapping_periods'],
          },
        },
        diagnostics: ['partial_metric_deltas', 'overlapping_periods'],
      },
      comparisonProfile: {
        baselineRunId: 101,
        selectionRule: 'first_comparable_run_by_request_order',
        primaryProfile: 'same_code_different_periods',
        alignedDimensions: ['market_code'],
        drivingDimensions: ['periods'],
        dimensionFlags: {
          sameCode: true,
          sameMarket: true,
          crossMarket: false,
          sameStrategyFamily: true,
          parameterDifferencesPresent: false,
          periodDifferencesPresent: true,
        },
        diagnostics: ['overlapping_periods'],
      },
      comparisonHighlights: {
        baselineRunId: 101,
        selectionRule: 'first_comparable_run_by_request_order',
        primaryProfile: 'same_code_different_periods',
        overallContextState: 'partially_comparable',
        highlights: {
          totalReturnPct: {
            metric: 'total_return_pct',
            preference: 'higher_is_better',
            state: 'limited_context_winner',
            winnerRunIds: [202],
            winnerValue: 18,
            availableRunIds: [101, 202],
            candidateCount: 2,
            diagnostics: ['partially_comparable_context'],
          },
          annualizedReturnPct: {
            metric: 'annualized_return_pct',
            preference: 'higher_is_better',
            state: 'unavailable',
            winnerRunIds: [],
            winnerValue: null,
            availableRunIds: [101],
            candidateCount: 1,
            diagnostics: ['metric_unavailable'],
          },
        },
        diagnostics: ['partially_comparable_context', 'metric_unavailable'],
      },
      parameterComparison: {
        state: 'same_family_comparable',
        strategyFamilyValues: ['moving_average_crossover'],
        strategyTypeValues: ['moving_average_crossover'],
        sharedParameterKeys: ['strategy_spec.execution.signal_timing'],
        differingParameterKeys: ['strategy_spec.signal.fast_period'],
        missingParameterKeys: ['strategy_spec.signal.slow_type'],
        sharedParameters: {
          'strategy_spec.execution.signal_timing': 'bar_close',
        },
        differingParameters: {},
        missingParameters: {},
      },
      items: [
        {
          metadata: {
            id: 101,
            code: 'ORCL',
            status: 'completed',
            runAt: '2026-04-01T08:00:00Z',
            completedAt: '2026-04-01T08:02:00Z',
            timeframe: 'daily',
            startDate: '2025-01-01',
            endDate: '2025-12-31',
            periodStart: '2025-01-01',
            periodEnd: '2025-12-31',
            lookbackBars: 252,
            initialCapital: 100000,
            feeBps: 0,
            slippageBps: 0,
          },
          metrics: {
            tradeCount: 12,
            winCount: 8,
            lossCount: 4,
            totalReturnPct: 12,
            annualizedReturnPct: 10,
            benchmarkReturnPct: 8,
            excessReturnVsBenchmarkPct: 4,
            buyAndHoldReturnPct: 7,
            excessReturnVsBuyAndHoldPct: 5,
            winRatePct: 66.7,
            avgTradeReturnPct: 1.5,
            maxDrawdownPct: 8.5,
            avgHoldingDays: 6,
            avgHoldingBars: 6,
            avgHoldingCalendarDays: 8,
            finalEquity: 112000,
          },
          parsedStrategy: {
            strategySpec: {
              strategyFamily: 'moving_average_crossover',
              strategyType: 'moving_average_crossover',
            },
          },
          benchmark: {
            mode: 'auto',
            code: 'QQQ',
            returnPct: 8,
          },
        },
        {
          metadata: {
            id: 202,
            code: 'ORCL',
            status: 'completed',
            runAt: '2026-04-02T08:00:00Z',
            completedAt: '2026-04-02T08:03:00Z',
            timeframe: 'daily',
            startDate: '2025-03-01',
            endDate: '2025-12-31',
            periodStart: '2025-03-01',
            periodEnd: '2025-12-31',
            lookbackBars: 252,
            initialCapital: 100000,
            feeBps: 0,
            slippageBps: 0,
          },
          metrics: {
            tradeCount: 9,
            winCount: 6,
            lossCount: 3,
            totalReturnPct: 18,
            annualizedReturnPct: null,
            benchmarkReturnPct: 7,
            excessReturnVsBenchmarkPct: 11,
            buyAndHoldReturnPct: 8,
            excessReturnVsBuyAndHoldPct: 10,
            winRatePct: 66.7,
            avgTradeReturnPct: 2,
            maxDrawdownPct: 9.2,
            avgHoldingDays: 5,
            avgHoldingBars: 5,
            avgHoldingCalendarDays: 7,
            finalEquity: 118000,
          },
          parsedStrategy: {
            strategySpec: {
              strategyFamily: 'moving_average_crossover',
              strategyType: 'moving_average_crossover',
            },
          },
          benchmark: {
            mode: 'auto',
            code: 'QQQ',
            returnPct: 7,
          },
        },
      ],
    });

    renderComparePage();

    await waitFor(() => {
      expect(compareRuleBacktestRuns).toHaveBeenCalledWith({ runIds: [101, 202] });
    });

    expect(await screen.findByRole('heading', { name: '规则回测比较工作台' })).toBeInTheDocument();
    expect(screen.getAllByText('same_code_different_periods').length).toBeGreaterThan(0);
    expect(screen.getAllByText('partially_comparable').length).toBeGreaterThan(0);
    expect(screen.getAllByText('limited_context_winner').length).toBeGreaterThan(0);
    expect(screen.getByText('same_family_comparable')).toBeInTheDocument();
    expect(screen.getAllByText('metric_unavailable').length).toBeGreaterThan(0);
    expect(screen.getByTestId('compare-metric-matrix')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /#101 baseline/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /#202 candidate/ })).toBeInTheDocument();
    expect(screen.getByText('delta +6.00%')).toBeInTheDocument();
    expect(screen.getAllByText('unavailable').length).toBeGreaterThan(0);
  });

  it('shows an explicit empty state when fewer than two run ids are provided', async () => {
    renderComparePage('/backtest/compare?runIds=101');

    expect(await screen.findByText('至少需要 2 条已完成运行才能打开比较工作台。')).toBeInTheDocument();
    expect(compareRuleBacktestRuns).not.toHaveBeenCalled();
  });
});
