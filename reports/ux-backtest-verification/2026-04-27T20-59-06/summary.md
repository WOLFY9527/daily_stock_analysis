# WolfyStock Backtest Full E2E Verification

- Run directory: `reports/ux-backtest-verification/2026-04-27T20-59-06`
- Generated at: `2026-04-27T21:46:06.531127`
- Overall verdict: **FAILED**
- Reason: Critical API preflight/auth failures block all signed-in write actions from the preview origin.

## Environment

- Frontend preview: `http://127.0.0.1:4173`
- Backend: `http://127.0.0.1:8000`
- Database: `/Users/yehengli/daily_stock_analysis/data/stock_analysis.db`
- Admin login used: `admin` via empty username field + password `852258`
- Runtime adjustment: restarted local `uvicorn api.app:app --reload --host 127.0.0.1 --port 8000` with `CORS_ORIGINS=http://127.0.0.1:4173` so the preview origin could authenticate and read state.

## What Passed

- Guest home, login, create-account mode, logout, and re-login all rendered correctly.
- Home Bento desktop/mobile shells rendered with intact spacing, glass panels, hero treatment, and no obvious column-collapse.
- Home strategy drawer opened successfully in exact viewport WebKit capture.
- Scanner page can read and render existing CN/US run history, including the populated US result set.
- Chat page can read and render existing history/sidebar state.
- Portfolio page can read and render account selector, holdings, KPI cards, and mobile history drawer.
- Backtest ordinary mode shows the expanded deterministic template catalog; professional mode shows executable vs unsupported catalog sections.
- `/__preview/report` and `/__preview/full-report` are reachable on desktop and mobile.

## Critical Failures

- Home write path is not trustworthy from preview. The visible ORCL card updated, but no new `analysis_history` row was proven, and the browser/backend trace showed `OPTIONS /api/v1/analysis/analyze -> 401`.
- Scanner fresh run is blocked. Existing runs load, but creating a new run fails at `OPTIONS /api/v1/scanner/run -> 401`; `market_scanner_runs` and `market_scanner_candidates` deltas stayed `0`.
- Chat send is blocked. `OPTIONS /api/v1/agent/chat/stream -> 401`; the UI falls back to the local-service error banner; conversation table deltas stayed `0`.
- Portfolio writes are blocked. `OPTIONS /api/v1/portfolio/accounts`, `/trades`, `/cash-ledger`, and `/corporate-actions` all return `401`; all related table deltas stayed `0`.
- Backtest execution is blocked. `OPTIONS /api/v1/backtest/rule/parse -> 401`, so neither ordinary nor professional execution can progress to stored runs; run/trade deltas stayed `0`.
- Backtest page also emits a read-side defect: `GET /api/v1/backtest/performance -> 404` during page bootstrap.

## DB Write Verification

Baseline and final SQLite counts are identical:

```json
{
  "analysis_history": 0,
  "conversation_sessions": 0,
  "conversation_messages": 0,
  "market_scanner_runs": 0,
  "market_scanner_candidates": 0,
  "portfolio_accounts": 0,
  "portfolio_trades": 0,
  "portfolio_corporate_actions": 0,
  "portfolio_cash_ledger": 0,
  "backtest_runs": 0,
  "rule_backtest_runs": 0,
  "rule_backtest_trades": 0
}
```

This means the attempted preview-origin user journey did **not** create new scanner runs, chat messages, portfolio objects, or backtest runs.

## Responsive Evidence

- Exact viewport captures were generated with local WebKit at `1440x900` and `390x844`.
- See `webkit_viewport_report.json` plus screenshots under `screenshots/desktop-1440x900-*` and `screenshots/mobile-390x844-*`.

## Key Artifacts

- JSON summary: `reports/ux-backtest-verification/2026-04-27T20-59-06/verification_report.json`
- Markdown summary: `reports/ux-backtest-verification/2026-04-27T20-59-06/summary.md`
- Baseline DB snapshot: `reports/ux-backtest-verification/2026-04-27T20-59-06/baseline_state.json`
- Final DB snapshot: `reports/ux-backtest-verification/2026-04-27T20-59-06/final_state.json`
- DB delta: `reports/ux-backtest-verification/2026-04-27T20-59-06/db_delta.json`
- Preflight failures: `reports/ux-backtest-verification/2026-04-27T20-59-06/preflight_failures.json`
- WebKit viewport evidence: `reports/ux-backtest-verification/2026-04-27T20-59-06/webkit_viewport_report.json`
- Backend process probe: `reports/ux-backtest-verification/2026-04-27T20-59-06/backend_process_probe.json`
- Auth status snapshot: `reports/ux-backtest-verification/2026-04-27T20-59-06/auth_status.json`

## Recommended Next Fixes

1. Exempt authenticated `OPTIONS` preflight requests from the login gate, or place CORS middleware ahead of auth handling for preview-origin API calls.
2. Re-run this exact verification after fixing preflight/auth behavior; the blocked write paths prevent meaningful persistence or result-page validation today.
3. Decide whether `GET /api/v1/backtest/performance` should exist or the frontend should stop treating its `404` as a local-service failure.
