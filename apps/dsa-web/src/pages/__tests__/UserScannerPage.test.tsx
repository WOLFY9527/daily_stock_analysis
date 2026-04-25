import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UserScannerPage from '../UserScannerPage';
import { UiLanguageProvider, useI18n } from '../../contexts/UiLanguageContext';
import type { ScannerRunDetail, ScannerRunHistoryResponse } from '../../types/scanner';

const { getRuns, getRun, runScan, analyzeAsync } = vi.hoisted(() => ({
  getRuns: vi.fn(),
  getRun: vi.fn(),
  runScan: vi.fn(),
  analyzeAsync: vi.fn(),
}));

vi.mock('../../api/scanner', () => ({
  scannerApi: {
    getRuns,
    getRun,
    run: runScan,
  },
}));

vi.mock('../../api/analysis', () => ({
  analysisApi: {
    analyzeAsync,
  },
  DuplicateTaskError: class DuplicateTaskError extends Error {},
}));

function makeRunDetail(): ScannerRunDetail {
  return {
    id: 11,
    market: 'cn',
    profile: 'cn_preopen_v1',
    profileLabel: 'A股盘前扫描 v1',
    status: 'completed',
    runAt: '2026-04-22T08:30:00',
    completedAt: '2026-04-22T08:31:00',
    watchlistDate: '2026-04-22',
    triggerMode: 'manual',
    universeName: 'cn_a_liquid_watchlist_v1',
    shortlistSize: 1,
    universeSize: 300,
    preselectedSize: 60,
    evaluatedSize: 40,
    sourceSummary: 'Manual scanner results for the current signed-in account.',
    headline: '我的手动扫描：600001 算力龙头',
    universeNotes: [],
    scoringNotes: [],
    diagnostics: {},
    notification: {
      attempted: false,
      status: 'not_attempted',
      success: null,
      channels: [],
      message: null,
      reportPath: null,
      sentAt: null,
    },
    failureReason: null,
    comparisonToPrevious: {
      available: false,
      previousRunId: null,
      previousWatchlistDate: null,
      newCount: 0,
      retainedCount: 0,
      droppedCount: 0,
      newSymbols: [],
      retainedSymbols: [],
      droppedSymbols: [],
    },
    reviewSummary: {
      available: false,
      reviewWindowDays: 3,
      reviewStatus: 'pending',
      candidateCount: 0,
      reviewedCount: 0,
      pendingCount: 0,
      hitRatePct: null,
      outperformRatePct: null,
      avgSameDayCloseReturnPct: null,
      avgReviewWindowReturnPct: null,
      avgMaxFavorableMovePct: null,
      avgMaxAdverseMovePct: null,
      strongCount: 0,
      mixedCount: 0,
      weakCount: 0,
      bestSymbol: null,
      bestReturnPct: null,
      weakestSymbol: null,
      weakestReturnPct: null,
    },
    shortlist: [
      {
        symbol: '600001',
        name: '算力龙头',
        rank: 1,
        score: 82.1,
        qualityHint: '高优先级',
        reasonSummary: '趋势结构完整。',
        reasons: ['趋势结构完整。'],
        keyMetrics: [{ label: '最新价', value: '18.4' }],
        featureSignals: [],
        riskNotes: ['避免追高。'],
        watchContext: [{ label: '观察', value: '关注量能。' }],
        boards: [],
        appearedInRecentRuns: 1,
        lastTradeDate: '2026-04-21',
        scanTimestamp: '2026-04-22T08:30:00',
        aiInterpretation: {
          available: true,
          status: 'generated',
          summary: '优先看竞价承接。',
          opportunityType: null,
          riskInterpretation: null,
          watchPlan: null,
          reviewCommentary: null,
          provider: 'gemini',
          model: 'gemini/gemini-2.5-flash',
          generatedAt: '2026-04-22T08:30:10',
          message: null,
        },
        realizedOutcome: {
          reviewStatus: 'pending',
          outcomeLabel: 'pending',
          thesisMatch: 'pending',
          reviewWindowDays: 3,
          anchorDate: '2026-04-21',
          windowEndDate: '2026-04-24',
          sameDayCloseReturnPct: null,
          nextDayReturnPct: null,
          reviewWindowReturnPct: null,
          maxFavorableMovePct: null,
          maxAdverseMovePct: null,
          benchmarkCode: null,
          benchmarkReturnPct: null,
          outperformedBenchmark: null,
        },
        diagnostics: {},
      },
    ],
  };
}

function makeHistoryResponse(): ScannerRunHistoryResponse {
  return {
    total: 1,
    page: 1,
    limit: 8,
    items: [
      {
        id: 11,
        market: 'cn',
        profile: 'cn_preopen_v1',
        profileLabel: 'A股盘前扫描 v1',
        status: 'completed',
        runAt: '2026-04-22T08:30:00',
        completedAt: '2026-04-22T08:31:00',
        watchlistDate: '2026-04-22',
        triggerMode: 'manual',
        universeName: 'cn_a_liquid_watchlist_v1',
        shortlistSize: 1,
        universeSize: 300,
        preselectedSize: 60,
        evaluatedSize: 40,
        sourceSummary: 'test',
        headline: '我的手动扫描：600001 算力龙头',
        topSymbols: ['600001'],
        notificationStatus: 'not_attempted',
        failureReason: null,
        changeSummary: {
          available: false,
          previousRunId: null,
          previousWatchlistDate: null,
          newCount: 0,
          retainedCount: 0,
          droppedCount: 0,
          newSymbols: [],
          retainedSymbols: [],
          droppedSymbols: [],
        },
        reviewSummary: {
          available: false,
          reviewWindowDays: 3,
          reviewStatus: 'pending',
          candidateCount: 0,
          reviewedCount: 0,
          pendingCount: 0,
          hitRatePct: null,
          outperformRatePct: null,
          avgSameDayCloseReturnPct: null,
          avgReviewWindowReturnPct: null,
          avgMaxFavorableMovePct: null,
          avgMaxAdverseMovePct: null,
          strongCount: 0,
          mixedCount: 0,
          weakCount: 0,
          bestSymbol: null,
          bestReturnPct: null,
          weakestSymbol: null,
          weakestReturnPct: null,
        },
      },
    ],
  };
}

function LanguageSwitch() {
  const { setLanguage } = useI18n();
  return (
    <button type="button" onClick={() => setLanguage('en')}>
      switch-language-en
    </button>
  );
}

function renderUserScannerPage(withLanguageSwitch = false) {
  return render(
    <UiLanguageProvider>
      <MemoryRouter initialEntries={['/scanner']}>
        {withLanguageSwitch ? <LanguageSwitch /> : null}
        <Routes>
          <Route path="/scanner" element={<UserScannerPage />} />
          <Route path="/" element={<div>Home Landing</div>} />
          <Route path="/backtest" element={<div>Backtest Landing</div>} />
        </Routes>
      </MemoryRouter>
    </UiLanguageProvider>,
  );
}

describe('UserScannerPage', () => {
  beforeEach(() => {
    getRuns.mockReset();
    getRun.mockReset();
    runScan.mockReset();
    analyzeAsync.mockReset();

    getRuns.mockResolvedValue(makeHistoryResponse());
    getRun.mockResolvedValue(makeRunDetail());
    runScan.mockResolvedValue(makeRunDetail());
    analyzeAsync.mockResolvedValue({ taskId: 'task-1' });
  });

  it('shows user-facing copy without admin jargon in zh', async () => {
    renderUserScannerPage();

    expect(await screen.findByTestId('user-scanner-bento-page')).toHaveClass('bg-[#030303]', 'text-white');
    expect((await screen.findAllByText('我的手动扫描：600001 算力龙头')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/运营空间|产品面|运营界面/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('user-scanner-bento-drawer-trigger'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('user-scanner-bento-drawer')).toBeInTheDocument();
    expect(screen.getByText('这个页面把手动运行、候选复核和后续动作都限制在当前登录用户自己的账户范围内。')).toBeInTheDocument();
    expect(screen.getByText('运行状态、系统观察名单、调度和通道配置继续保留在仅管理员可见的管理页面。')).toBeInTheDocument();
    expect(screen.getByText('历史记录与页面边界')).toBeInTheDocument();
  });

  it('reuses shared market defaults and cn option labels after switching language', async () => {
    renderUserScannerPage(true);

    expect(await screen.findAllByRole('option', { name: '300 只' })).not.toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'switch-language-en' }));

    await waitFor(() => {
      expect(screen.queryByRole('option', { name: '300 只' })).not.toBeInTheDocument();
    });
    expect(screen.getAllByRole('option', { name: '300' }).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('Market'), { target: { value: 'us' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run scanner' }));

    await waitFor(() => {
      expect(runScan).toHaveBeenCalledWith({
        market: 'us',
        profile: 'us_preopen_v1',
        shortlistSize: 5,
        universeLimit: 180,
        detailLimit: 40,
      });
    });
  });

  it('does not render placeholder candidates after a failed manual run', async () => {
    runScan.mockRejectedValueOnce({
      response: {
        status: 400,
        data: {
          detail: {
            error: 'validation_error',
            message: 'A 股全市场快照不可用。',
          },
        },
      },
    });

    renderUserScannerPage();

    fireEvent.click(await screen.findByRole('button', { name: /run scanner|运行扫描/i }));

    expect(await screen.findByText('A 股全市场快照不可用。')).toBeInTheDocument();
    expect(screen.queryByText('NVIDIA')).not.toBeInTheDocument();
    expect(screen.queryByText('Tesla')).not.toBeInTheDocument();
    expect(screen.queryByText('Meta')).not.toBeInTheDocument();
    expect(screen.queryByText('Apple')).not.toBeInTheDocument();
  });
});
