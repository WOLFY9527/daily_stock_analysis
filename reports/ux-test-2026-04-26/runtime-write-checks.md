# Runtime Write Checks

- Generated at: `2026-04-25T17:20:52.870733Z`
- Database: `/Users/yehengli/daily_stock_analysis/data/stock_analysis.db`
- Backend base URL: `http://127.0.0.1:8000`
- Auth status: `{"authEnabled": false, "loggedIn": false, "passwordSet": false, "passwordChangeable": false, "setupState": "no_password", "currentUser": {"id": "bootstrap-admin", "username": "admin", "displayName": "Bootstrap Admin", "role": "admin", "isAdmin": true, "isAuthenticated": false, "transitional": true, "authEnabled": false, "legacyAdmin": false}}`

| Check | HTTP | DB delta | Result | Notes |
| --- | --- | --- | --- | --- |
| portfolio_account_create | 200 | portfolio_accounts:+1 | PASS | Codex UX Verify 172027 |
| portfolio_trade_create | 200 | portfolio_trades:+1 | PASS | account_id=3 |
| scanner_run_attempt | 200 | market_scanner_runs:+1 | PASS | Run may still return an upstream/data availability error; this check verifies row creation. |
| rule_backtest_run_create | 200 | rule_backtest_runs:+1 | PASS | Async rule backtest kickoff. |
| chat_session_message_create | 200 | conversation_sessions:+1, conversation_messages:+2 | PASS | Agent response may still carry upstream model failures; this check verifies session/message persistence. |
