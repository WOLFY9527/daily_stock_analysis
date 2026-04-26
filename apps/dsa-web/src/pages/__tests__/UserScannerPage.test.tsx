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
    shortlistSize: 3,
    universeSize: 300,
    preselectedSize: 60,
    evaluatedSize: 40,
    sourceSummary: 'Manual scanner results for the current signed-in account.',
    headline: '我的手动扫描：NVDA / AVGO / AMD',
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
        symbol: 'NVDA',
        name: 'NVIDIA',
        companyName: 'NVIDIA Corp.',
        rank: 1,
        score: 94,
        qualityHint: 'AI 算力基建',
        reasonSummary: '量价共振，盘前强度领先。',
        reasons: ['量价共振，盘前强度领先。'],
        keyMetrics: [
          { label: '最新价', value: '912.4' },
          { label: '年化收益预测', value: '+87.1%' },
        ],
        featureSignals: [
          { label: '行业', value: '半导体设备' },
          { label: '主线', value: 'AI 算力基建' },
        ],
        tags: [
          { name: 'AI 算力基建', description: '涵盖 GPU、光模块、液冷等核心硬件，当前处于行业高景气周期，业绩确定性极强。', tone: 'indigo' },
          { name: '半导体设备', description: '提供芯片制造与封测设备，是半导体产业链的上游核心。', tone: 'emerald' },
        ],
        riskNotes: ['跌破 895 附近止损。'],
        watchContext: [{ label: '观察', value: '高开后看量能延续。' }],
        boards: ['数据中心'],
        appearedInRecentRuns: 1,
        lastTradeDate: '2026-04-21',
        scanTimestamp: '2026-04-22T08:30:00',
        aiInterpretation: {
          available: true,
          status: 'generated',
          summary: '竞价强度与主线共振，优先看高开后的第一次承接。',
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
      {
        symbol: 'AVGO',
        name: 'Broadcom',
        companyName: 'Broadcom Inc.',
        rank: 2,
        score: 88,
        qualityHint: '高速互联',
        reasonSummary: '板块联动强，趋势结构完整。',
        reasons: ['板块联动强，趋势结构完整。'],
        keyMetrics: [
          { label: '最新价', value: '1388.2' },
          { label: '年化收益预测', value: '+62.4%' },
        ],
        featureSignals: [
          { label: '行业', value: '网络芯片' },
          { label: '主线', value: '数据中心' },
        ],
        tags: [
          { name: '数据中心', description: '受益于云厂商与企业级算力扩容，订单兑现速度快。', tone: 'indigo' },
          { name: '网络芯片', description: '聚焦交换、互联与高速传输，是 AI 集群扩容的关键底座。', tone: 'emerald' },
        ],
        riskNotes: ['避免追高。'],
        watchContext: [{ label: '观察', value: '关注放量突破后的回踩确认。' }],
        boards: ['云基础设施'],
        appearedInRecentRuns: 1,
        lastTradeDate: '2026-04-21',
        scanTimestamp: '2026-04-22T08:30:00',
        aiInterpretation: {
          available: true,
          status: 'generated',
          summary: '趋势结构完整，优先观察突破后的二次确认。',
          opportunityType: null,
          riskInterpretation: null,
          watchPlan: null,
          reviewCommentary: null,
          provider: 'gemini',
          model: 'gemini/gemini-2.5-flash',
          generatedAt: '2026-04-22T08:30:12',
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
      {
        symbol: 'AMD',
        name: 'AMD',
        companyName: 'Advanced Micro Devices',
        rank: 3,
        score: 76,
        qualityHint: '边际转强',
        reasonSummary: '低位放量，等待开盘确认。',
        reasons: ['低位放量，等待开盘确认。'],
        keyMetrics: [
          { label: '最新价', value: '164.3' },
          { label: '年化收益预测', value: '+34.8%' },
        ],
        featureSignals: [
          { label: '行业', value: 'GPU' },
          { label: '主线', value: '边缘推理' },
        ],
        tags: [
          { name: '边缘推理', description: '终端侧 AI 推理正在扩散，具备成本与部署速度优势。', tone: 'indigo' },
          { name: 'GPU', description: '兼具训练与推理能力，是 AI 计算平台的核心芯片。', tone: 'emerald' },
        ],
        riskNotes: ['跌回平台下沿则撤退。'],
        watchContext: [{ label: '观察', value: '确认开盘量能后再决定。' }],
        boards: ['AI PC'],
        appearedInRecentRuns: 1,
        lastTradeDate: '2026-04-21',
        scanTimestamp: '2026-04-22T08:30:00',
        aiInterpretation: {
          available: true,
          status: 'generated',
          summary: '赔率尚可，但需要开盘后的量能确认。',
          opportunityType: null,
          riskInterpretation: null,
          watchPlan: null,
          reviewCommentary: null,
          provider: 'gemini',
          model: 'gemini/gemini-2.5-flash',
          generatedAt: '2026-04-22T08:30:14',
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
        shortlistSize: 5,
        universeSize: 300,
        preselectedSize: 60,
        evaluatedSize: 40,
        sourceSummary: 'test',
        headline: '我的手动扫描：AVGO / NVDA / AMZN / AMD / SMH',
        topSymbols: ['AVGO', 'NVDA', 'AMZN', 'AMD', 'SMH'],
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
    window.localStorage.clear();
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

    expect(await screen.findByTestId('user-scanner-workspace')).toHaveClass('w-full', 'flex-1', 'min-w-0', 'px-6', 'md:px-8', 'xl:px-12', 'py-8');
    expect(screen.getByTestId('user-scanner-workspace')).not.toHaveClass('max-w-[1920px]', 'mx-auto', 'px-4');
    expect(screen.getByTestId('user-scanner-bento-drawer-trigger')).toBeInTheDocument();
    const runButton = screen.getByRole('button', { name: /运行扫描|Run scanner/i });
    expect(runButton).toBeInTheDocument();
    expect(runButton).toHaveClass('bg-white', 'text-black');
    expect(runButton).not.toHaveClass('bg-emerald-500/10', 'text-emerald-400', 'border-emerald-500/30');
    expect(screen.getByRole('heading', { name: '扫描结果与战术计划' })).toBeInTheDocument();
    expect(screen.getByText('生成时间： 04/22 08:31')).toBeInTheDocument();
    expect(screen.getByText('耗时： 1分钟')).toBeInTheDocument();
    expect(screen.queryByText('我的手动扫描：NVDA / AVGO / AMD')).not.toBeInTheDocument();
    expect(screen.queryByText('美股盘前运行，结合 Live Quote 与开盘确认执行判断。')).not.toBeInTheDocument();
    expect(screen.queryByText(/运营空间|产品面|运营界面/)).not.toBeInTheDocument();
    expect(screen.getByTestId('user-scanner-bento-hero-shortlist-value')).not.toHaveClass('text-emerald-400', 'bg-emerald-500/10');

    fireEvent.click(screen.getByTestId('user-scanner-bento-drawer-trigger'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('user-scanner-bento-drawer')).toBeInTheDocument();
    expect(screen.queryByText('这个页面把手动运行、候选复核和后续动作都限制在当前登录用户自己的账户范围内。')).not.toBeInTheDocument();
    expect(screen.queryByText('运行状态、系统观察名单、调度和通道配置继续保留在仅管理员可见的管理页面。')).not.toBeInTheDocument();
    expect(screen.getAllByText('历史运行记录').length).toBeGreaterThan(0);
  });

  it('deduplicates symbol/name display and renders history symbols as wrapped tags', async () => {
    renderUserScannerPage();

    expect(await screen.findByText('AVGO')).toBeInTheDocument();
    expect(screen.queryByText(/^AVGO AVGO$/)).not.toBeInTheDocument();
    expect(screen.getByText(/NVIDIA Corp\./)).toBeInTheDocument();
    expect(screen.getByText('Broadcom Inc.')).toBeInTheDocument();
    expect(screen.getByText('Advanced Micro Devices')).toBeInTheDocument();
    expect(screen.getByText('AI 评分 94/100')).toBeInTheDocument();
    expect(screen.getByText('AI 评分 88/100')).toBeInTheDocument();
    expect(screen.getByText('AI 评分 88/100')).toBeInTheDocument();
    expect(screen.getByText('半导体设备')).toBeInTheDocument();
    expect(screen.getAllByText('数据中心').length).toBeGreaterThan(0);
    expect(screen.getByText('边缘推理')).toBeInTheDocument();
    expect(screen.getByText('+87.1%')).toBeInTheDocument();
    expect(screen.getAllByText('年化收益预测').length).toBe(3);
    expect(screen.queryByText('Trend')).not.toBeInTheDocument();
    expect(screen.queryByText('20.0 / 20')).not.toBeInTheDocument();
    expect(screen.getByText('涵盖 GPU、光模块、液冷等核心硬件，当前处于行业高景气周期，业绩确定性极强。')).toBeInTheDocument();
    expect(screen.getByText('提供芯片制造与封测设备，是半导体产业链的上游核心。')).toBeInTheDocument();

    const aiInfrastructureTag = screen.getByText('AI 算力基建').closest('div');
    expect(aiInfrastructureTag).toHaveClass('relative', 'group', 'cursor-help');

    fireEvent.click(screen.getByTestId('user-scanner-bento-drawer-trigger'));

    const avgoTags = await screen.findAllByText('AVGO');
    expect(avgoTags.length).toBeGreaterThan(0);
    expect((await screen.findAllByText('AMD')).length).toBeGreaterThan(0);
    expect(await screen.findByText('AMZN')).toBeInTheDocument();
    expect(await screen.findByText('SMH')).toBeInTheDocument();
    expect(screen.queryByText('AMZN AMZN / AMD AMD')).not.toBeInTheDocument();
    const historyTitle = screen.getByRole('heading', { name: '我的手动扫描' });
    expect(historyTitle).toHaveClass('truncate');

    const historySymbols = screen.getByTestId('scanner-history-symbols-11');
    expect(historySymbols).toHaveClass('product-chip-list', 'product-chip-list--tight', 'w-full');
    expect(historySymbols.querySelectorAll('span')).toHaveLength(5);
    expect(historyTitle.closest('button')).toHaveClass(
      'w-full',
      'flex',
      'flex-col',
      'gap-3',
      'rounded-2xl',
      'p-5',
    );
  });

  it('reuses shared market defaults and cn option labels after switching language', async () => {
    renderUserScannerPage(true);

    expect(await screen.findByRole('button', { name: '300 只' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'switch-language-en' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '300 只' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: '300' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'US' }));
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
    expect(screen.queryByText('Tesla')).not.toBeInTheDocument();
    expect(screen.queryByText('Meta')).not.toBeInTheDocument();
    expect(screen.queryByText('Apple')).not.toBeInTheDocument();
  });

  it('keeps pre-run candidates market-scoped instead of leaking fabricated us tickers into hk', async () => {
    getRuns.mockResolvedValue({
      total: 0,
      page: 1,
      limit: 8,
      items: [],
    });

    renderUserScannerPage();

    expect((await screen.findAllByText(/A股|A-share/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/美股|US/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/港股|HK/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/前 5|Top 5/i).length).toBeGreaterThan(0);

    expect(screen.getByRole('heading', { name: /扫描结果与战术计划|Scanner results and tactical plan/i })).toBeInTheDocument();
    expect(screen.getAllByText(/当前无匹配的扫描结果|No matching scanner results/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/请调整左侧参数或稍后再试|Adjust the filters on the left or try again later/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/当前还没有可展示的 A 股个人扫描结果。|No personal A-share scanner result is available yet./i)).not.toBeInTheDocument();
    expect(screen.queryByText('NVIDIA')).not.toBeInTheDocument();
    expect(screen.queryByText('Tesla')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /港股|HK/i }));

    expect(await screen.findByRole('heading', { name: /扫描结果与战术计划|Scanner results and tactical plan/i })).toBeInTheDocument();
    expect(screen.getAllByText(/当前无匹配的扫描结果|No matching scanner results/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/当前还没有可展示的港股个人扫描结果。|No personal Hong Kong scanner result is available yet./i)).not.toBeInTheDocument();
    expect(screen.queryByText('NVIDIA')).not.toBeInTheDocument();
    expect(screen.queryByText('Tesla')).not.toBeInTheDocument();
  });

  it('keeps the history drawer footer transparent without a ghost spacer block', async () => {
    renderUserScannerPage();

    fireEvent.click(await screen.findByTestId('user-scanner-bento-drawer-trigger'));

    const drawer = await screen.findByTestId('user-scanner-bento-drawer');
    expect(drawer).toHaveClass('p-6', 'sm:p-8');
    expect(drawer).not.toHaveClass('pb-24', 'pb-16', 'bg-black', 'bg-gray-900');
  });

  it('uses professional financial labels in history metadata', async () => {
    renderUserScannerPage();

    fireEvent.click(await screen.findByTestId('user-scanner-bento-drawer-trigger'));

    expect(await screen.findByText(/(入选标的|Selected symbols):\s*5/)).toBeInTheDocument();
    expect(screen.getByText(/(扫描标的池|Scan pool):\s*300/)).toBeInTheDocument();
    expect(screen.queryByText(/扫描宇宙|最终 shortlist/i)).not.toBeInTheDocument();
  });
});
