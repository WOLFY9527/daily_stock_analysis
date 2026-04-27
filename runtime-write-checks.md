# Runtime Write Checks

- Generated at: `2026-04-27T17:14:26.477Z`
- Source report: `reports/ux-verification-2026-04-27T17-14-26-477Z/ux-verification-report.json`
- Username: `ux_mohgiw4u`
- Overall: `pass`

## Flow Deltas

### visitor-home
- No tracked table delta recorded in this pass.

### create-account
- `app_users`: 25 -> 26 (`delta +1`)
- `app_user_sessions`: 149 -> 150 (`delta +1`)

### logout-login
- No tracked table delta recorded in this pass.

### home-analysis
- No tracked table delta recorded in this pass.

### scanner-run
- `market_scanner_runs`: 33 -> 34 (`delta +1`)
- `market_scanner_candidates`: 78 -> 83 (`delta +5`)

### chat-query
- `conversation_sessions`: 26 -> 27 (`delta +1`)
- `conversation_messages`: 51 -> 53 (`delta +2`)

### portfolio-actions
- `portfolio_accounts`: 21 -> 22 (`delta +1`)
- `portfolio_cash_ledger`: 14 -> 15 (`delta +1`)
- `portfolio_corporate_actions`: 14 -> 15 (`delta +1`)

### backtest-runs
- `rule_backtest_runs`: 13 -> 17 (`delta +4`)
- step `moving_average_crossover`: `api_fallback_persisted` run_id=14
- step `macd_crossover`: `api_fallback_persisted` run_id=15
- step `rsi_threshold`: `api_fallback_persisted` run_id=16
- step `periodic_accumulation`: `api_fallback_persisted` run_id=17

### report-previews
- No tracked table delta recorded in this pass.

### settings-locale
- No tracked table delta recorded in this pass.

### surface-check-chromium-mobile
- No tracked table delta recorded in this pass.

### surface-check-webkit-desktop
- No tracked table delta recorded in this pass.

### surface-check-webkit-mobile
- No tracked table delta recorded in this pass.

## Failed Requests

- None

## Surface Checks

- `chromium` / `mobile`: `pass`
- `webkit` / `desktop`: `pass`
- `webkit` / `mobile`: `pass`
