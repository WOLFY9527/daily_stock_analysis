# WolfyStock UX Verification Report

- Generated at: `2026-04-27T14:48:32.312Z`
- Base URL: `http://127.0.0.1:8000`
- Preview URL: `http://127.0.0.1:4174`
- Username: `ux_mohbb9dk`
- Overall: `partial`
- Passed / Partial / Failed: `6 / 7 / 0`

## Flow Summary

| Flow | Status | Notes |
| --- | --- | --- |
| visitor-home | PASS | - |
| create-account | PASS | - |
| logout-login | PASS | - |
| home-analysis | PASS | - |
| scanner-run | PARTIAL | 1 non-2xx request(s) captured during flow |
| chat-query | PARTIAL | Error: chat assistant reply timed out after 10000ms |
| portfolio-actions | PARTIAL | - |
| backtest-runs | PARTIAL | 1 non-2xx request(s) captured during flow |
| report-previews | PASS | - |
| settings-locale | PASS | - |
| surface-check-chromium-mobile | PARTIAL | 1 non-2xx request(s) captured during flow |
| surface-check-webkit-desktop | PARTIAL | 1 non-2xx request(s) captured during flow |
| surface-check-webkit-mobile | PARTIAL | 1 non-2xx request(s) captured during flow |

## Failed Requests

| Status | Method | URL | Payload |
| --- | --- | --- | --- |
| 400 | POST | `http://127.0.0.1:8000/api/v1/scanner/run` | `{"market":"cn","profile":"cn_preopen_v1","shortlist_size":5,"universe_limit":300,"detail_limit":60}` |
| 404 | GET | `http://127.0.0.1:8000/api/v1/backtest/performance` | `-` |
| 404 | GET | `http://127.0.0.1:8000/api/v1/backtest/performance` | `-` |
| 404 | GET | `http://127.0.0.1:8000/api/v1/backtest/performance` | `-` |
| 404 | GET | `http://127.0.0.1:8000/api/v1/backtest/performance` | `-` |

## Warnings

- scanner-run: 1 non-2xx request(s) captured during flow
- chat-query: Error: chat assistant reply timed out after 10000ms
- backtest-runs: 1 non-2xx request(s) captured during flow
- surface-check-chromium-mobile: 1 non-2xx request(s) captured during flow
- surface-check-webkit-desktop: 1 non-2xx request(s) captured during flow
- surface-check-webkit-mobile: 1 non-2xx request(s) captured during flow
