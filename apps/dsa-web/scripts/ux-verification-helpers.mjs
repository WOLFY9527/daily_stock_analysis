export function diffTableCounts(before = {}, after = {}) {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  const diff = {};

  for (const name of names) {
    const beforeCount = Number(before[name] ?? 0);
    const afterCount = Number(after[name] ?? 0);
    const delta = afterCount - beforeCount;
    if (delta === 0) {
      continue;
    }
    diff[name] = {
      before: beforeCount,
      after: afterCount,
      delta,
      direction: delta > 0 ? 'up' : 'down',
    };
  }

  return diff;
}

export function summarizeFlowOutcomes(flows = []) {
  const total = flows.length;
  const passed = flows.filter((flow) => flow.status === 'pass').length;
  const partial = flows.filter((flow) => flow.status === 'partial').length;
  const failed = flows.filter((flow) => flow.status === 'fail').length;

  let overallStatus = 'pass';
  if (failed > 0) {
    overallStatus = partial > 0 || passed > 0 ? 'partial' : 'fail';
  } else if (partial > 0) {
    overallStatus = 'partial';
  }

  return {
    total,
    passed,
    partial,
    failed,
    overallStatus,
  };
}

export function buildPreferredScannerConfigs() {
  return [
    { market: 'us', profile: 'us_preopen_v1' },
    { market: 'hk', profile: 'hk_preopen_v1' },
    { market: 'cn', profile: 'cn_preopen_v1' },
  ];
}

export function isRetryableScannerValidationError(result = {}) {
  if (Number(result.status || 0) !== 400) {
    return false;
  }

  const responseBody = String(result.responseBody || '').toLowerCase();
  return responseBody.includes('validation_error');
}
