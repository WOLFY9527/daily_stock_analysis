import test from 'node:test';
import assert from 'node:assert/strict';

import {
  diffTableCounts,
  summarizeFlowOutcomes,
} from './ux-verification-helpers.mjs';

test('diffTableCounts reports inserts and removes for tracked tables', () => {
  const before = {
    app_users: 4,
    analysis_history: 10,
    conversation_messages: 25,
    portfolio_trades: 3,
  };
  const after = {
    app_users: 5,
    analysis_history: 12,
    conversation_messages: 25,
    portfolio_trades: 2,
  };

  assert.deepEqual(diffTableCounts(before, after), {
    app_users: { before: 4, after: 5, delta: 1, direction: 'up' },
    analysis_history: { before: 10, after: 12, delta: 2, direction: 'up' },
    portfolio_trades: { before: 3, after: 2, delta: -1, direction: 'down' },
  });
});

test('summarizeFlowOutcomes classifies pass partial fail counts', () => {
  const summary = summarizeFlowOutcomes([
    { name: 'auth', status: 'pass' },
    { name: 'home', status: 'pass' },
    { name: 'scanner', status: 'partial' },
    { name: 'chat', status: 'fail' },
  ]);

  assert.deepEqual(summary, {
    total: 4,
    passed: 2,
    partial: 1,
    failed: 1,
    overallStatus: 'partial',
  });
});
