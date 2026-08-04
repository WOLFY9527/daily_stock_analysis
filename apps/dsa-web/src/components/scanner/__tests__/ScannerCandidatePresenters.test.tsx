import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ScannerCandidateDiagnosticRow } from '../ScannerCandidatePresenters';
import type { ScannerCandidateDiagnostic } from '../../../types/scanner';

const candidate: ScannerCandidateDiagnostic = {
  symbol: 'NVDA',
  name: 'NVIDIA',
  rank: 1,
  score: 88,
  status: 'selected',
  reason: 'Relative strength improved.',
};

function renderDiagnosticRow(sourceAsOf: string | null = '2026-08-01', fixtureEvidence = true) {
  const handlers = {
    onSelect: vi.fn(),
    onAnalyze: vi.fn(),
    onBacktest: vi.fn(),
    onTrack: vi.fn(),
    onCopy: vi.fn(),
    onExport: vi.fn(),
    onToggleMore: vi.fn(),
  };

  render(
    <ScannerCandidateDiagnosticRow
      candidate={candidate}
      language="zh"
      isSelectedCandidate={false}
      isExpanded={false}
      isMoreOpen
      displayName="NVIDIA"
      keyReason="相对强度改善，进入研究观察队列。"
      previewLabel="观察"
      previewBadgeClassName="border-[color:var(--wolfy-divider)] text-[color:var(--wolfy-text-secondary)]"
      dataQualityLabel="部分可用"
      watchSummary="等待下一次证据复核。"
      rangeSummary="风险边界待确认。"
      evidenceSummary={null}
      historicalOhlcvAsOf={sourceAsOf}
      historicalOhlcvIsFixtureEvidence={fixtureEvidence}
      scoreLabel="88/100"
      statusLabel="已入选"
      watchlistActionLabel="加入观察"
      copyLabel="复制"
      exportLabel="导出"
      isTracked={false}
      isTrackPending={false}
      isWatchlistAuthBlocked={false}
      isAnalyzing={false}
      backtestLabel="回测"
      {...handlers}
    />,
  );

  return handlers;
}

describe('ScannerCandidateDiagnosticRow', () => {
  it('makes scanner result rows keyboard-operable without conflicting with nested actions', () => {
    const handlers = renderDiagnosticRow();

    const row = screen.getByRole('row', { name: /NVDA.*NVIDIA.*详情/i });
    expect(row).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(row, { key: 'Enter' });
    expect(handlers.onSelect).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(row, { key: ' ' });
    expect(handlers.onSelect).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '加入观察' }));
    expect(handlers.onTrack).toHaveBeenCalledTimes(1);
    expect(handlers.onSelect).toHaveBeenCalledTimes(1);
  });

  it('renders the exact non-live historical source date in desktop and mobile rows without fixture metadata', () => {
    renderDiagnosticRow('2026-08-01');

    const sourceAsOf = screen.getAllByTestId('scanner-candidate-source-as-of-NVDA');
    expect(sourceAsOf).toHaveLength(2);
    sourceAsOf.forEach((item) => expect(item).toHaveTextContent('非实时 · 2026-08-01'));
    expect(screen.queryByText(/fixture_evidence|fixtureId|r06-nonlive/i)).not.toBeInTheDocument();
  });

  it('keeps a non-fixture source date neutral instead of calling it non-live', () => {
    renderDiagnosticRow('2026-08-01', false);

    const sourceAsOf = screen.getAllByTestId('scanner-candidate-source-as-of-NVDA');
    sourceAsOf.forEach((item) => {
      expect(item).toHaveTextContent('来源时点 · 2026-08-01');
      expect(item).not.toHaveTextContent('非实时');
    });
  });

  it('omits source freshness when no safe source date is available', () => {
    renderDiagnosticRow(null);

    expect(screen.queryByTestId('scanner-candidate-source-as-of-NVDA')).not.toBeInTheDocument();
  });
});
