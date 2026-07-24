import type { AnalysisReport, HistoryItem, TaskInfo } from '../types/analysis';
import { getSymbolDisplay } from '../utils/homeReportIdentity';

function trimHomeTickerValue(rawValue?: string | null): string {
  const trimmed = String(rawValue || '').trim();
  if (!trimmed || trimmed === '-' || trimmed === '--') {
    return '';
  }

  return trimmed;
}

function findCompletedTaskReportByTicker(activeTasks: TaskInfo[], ticker: string): AnalysisReport | null {
  if (!ticker) {
    return null;
  }

  return activeTasks.find(
    (task) => trimHomeTickerValue(task.stockCode) === ticker && task.status === 'completed' && task.result?.report,
  )?.result?.report || null;
}

export type HomeDashboardSelectionInput = {
  activeTasks: TaskInfo[];
  routeTaskId: string | null;
  routeSymbol: string | null;
  activeTicker: string | null;
  pendingAnalysisTicker: string | null;
  selectedReport: AnalysisReport | null;
  recentHistoryItems: Pick<HistoryItem, 'stockCode'>[];
  defaultTicker: string;
};

export type HomeDashboardSelectionResult = {
  selectedTicker: string;
  completedTaskReport: AnalysisReport | null;
  focusedTask: TaskInfo | null;
  effectiveTicker: string;
  dashboardReport: AnalysisReport | null;
  shouldUsePendingPlaceholder: boolean;
  activeTraceReport: AnalysisReport | null;
  activeEvidenceTicker: string;
  reanalysisTicker: string;
};

export function resolveHomeDashboardSelection(
  input: HomeDashboardSelectionInput,
): HomeDashboardSelectionResult {
  const routeSymbol = trimHomeTickerValue(input.routeSymbol);
  const activeTicker = trimHomeTickerValue(input.activeTicker);
  const pendingAnalysisTicker = trimHomeTickerValue(input.pendingAnalysisTicker);
  const selectedTicker = trimHomeTickerValue(getSymbolDisplay(input.selectedReport));
  const defaultTicker = trimHomeTickerValue(input.defaultTicker);

  const completedTaskReport = input.routeTaskId
    ? input.activeTasks.find(
      (task) => task.taskId === input.routeTaskId && task.status === 'completed' && task.result?.report,
    )?.result?.report || null
    : findCompletedTaskReportByTicker(input.activeTasks, pendingAnalysisTicker || activeTicker);

  const focusedTask = (() => {
    if (input.routeTaskId) {
      const matchedById = input.activeTasks.find((task) => task.taskId === input.routeTaskId);
      if (matchedById) {
        return matchedById;
      }
    }

    const taskTicker = pendingAnalysisTicker || activeTicker;
    if (taskTicker) {
      const matchedByTicker = input.activeTasks.find((task) => trimHomeTickerValue(task.stockCode) === taskTicker);
      if (matchedByTicker) {
        return matchedByTicker;
      }
    }

    return input.activeTasks[0] || null;
  })();

  const effectiveTicker = routeSymbol || activeTicker || selectedTicker || defaultTicker;
  const completedTaskTicker = trimHomeTickerValue(completedTaskReport?.meta.stockCode);

  const dashboardReport = (() => {
    if (completedTaskReport && effectiveTicker && completedTaskTicker === effectiveTicker) {
      return completedTaskReport;
    }

    if (input.selectedReport && effectiveTicker && selectedTicker === effectiveTicker) {
      return input.selectedReport;
    }

    return null;
  })();

  const shouldUsePendingPlaceholder = Boolean(
    !dashboardReport
    && pendingAnalysisTicker
    && effectiveTicker === pendingAnalysisTicker,
  );

  const activeTraceReport = (() => {
    const traceTicker = routeSymbol || activeTicker || pendingAnalysisTicker || selectedTicker || '';
    if (completedTaskReport && traceTicker && completedTaskTicker === traceTicker) {
      return completedTaskReport;
    }
    if (input.selectedReport && (!traceTicker || selectedTicker === traceTicker)) {
      return input.selectedReport;
    }
    if (!traceTicker) {
      return completedTaskReport || input.selectedReport || null;
    }
    return null;
  })();

  const activeEvidenceTicker = trimHomeTickerValue(
    activeTraceReport?.meta.stockCode
      || routeSymbol
      || activeTicker
      || selectedTicker
  );

  const reportTicker = trimHomeTickerValue(
    activeTraceReport ? getSymbolDisplay(activeTraceReport) : '',
  );
  const selectedReportOwnsSurfaceWithoutSymbol = Boolean(
    input.selectedReport
    && !selectedTicker
    && !completedTaskReport
    && !routeSymbol
    && !activeTicker
    && !pendingAnalysisTicker,
  );
  const reanalysisCandidate = selectedReportOwnsSurfaceWithoutSymbol
    ? ''
    : reportTicker || (activeTraceReport ? '' : activeEvidenceTicker || effectiveTicker);
  const reanalysisTicker = trimHomeTickerValue(reanalysisCandidate);

  return {
    selectedTicker,
    completedTaskReport,
    focusedTask,
    effectiveTicker,
    dashboardReport,
    shouldUsePendingPlaceholder,
    activeTraceReport,
    activeEvidenceTicker,
    reanalysisTicker,
  };
}
