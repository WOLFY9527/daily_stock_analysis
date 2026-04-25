#!/usr/bin/env python3
import json
import sqlite3
from datetime import date, datetime
from pathlib import Path

import requests


REPO_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = REPO_ROOT / "data" / "stock_analysis.db"
REPORT_DIR = REPO_ROOT / "reports" / "ux-test-2026-04-26"
JSON_PATH = REPORT_DIR / "runtime-write-checks.json"
MD_PATH = REPORT_DIR / "runtime-write-checks.md"
BASE_URL = "http://127.0.0.1:8000"

TABLES = (
    "app_users",
    "portfolio_accounts",
    "portfolio_trades",
    "market_scanner_runs",
    "rule_backtest_runs",
    "conversation_sessions",
    "conversation_messages",
)


def fetch_counts(conn: sqlite3.Connection) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table in TABLES:
        counts[table] = int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
    return counts


def post_json(session: requests.Session, path: str, payload: dict) -> tuple[int, dict | str]:
    response = session.post(f"{BASE_URL}{path}", json=payload, timeout=120)
    try:
        body = response.json()
    except ValueError:
        body = response.text
    return response.status_code, body


def build_markdown(report: dict) -> str:
    lines = [
        "# Runtime Write Checks",
        "",
        f"- Generated at: `{report['generated_at']}`",
        f"- Database: `{DB_PATH}`",
        f"- Backend base URL: `{BASE_URL}`",
        f"- Auth status: `{json.dumps(report['auth_status'], ensure_ascii=False)}`",
        "",
        "| Check | HTTP | DB delta | Result | Notes |",
        "| --- | --- | --- | --- | --- |",
    ]
    for check in report["checks"]:
        delta_text = ", ".join(f"{key}:{value:+d}" for key, value in check["db_delta"].items()) or "-"
        notes = check.get("notes") or "-"
        lines.append(
            f"| {check['name']} | {check['http_status']} | {delta_text} | {check['result'].upper()} | {notes} |"
        )
    return "\n".join(lines) + "\n"


def main() -> None:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    session = requests.Session()

    baseline = fetch_counts(conn)
    auth_status = session.get(f"{BASE_URL}/api/v1/auth/status", timeout=30).json()
    checks: list[dict] = []

    account_name = f"Codex UX Verify {datetime.utcnow().strftime('%H%M%S')}"
    account_status, account_body = post_json(
        session,
        "/api/v1/portfolio/accounts",
        {
            "name": account_name,
            "broker": "Codex Verify",
            "market": "us",
            "base_currency": "USD",
        },
    )
    after_account = fetch_counts(conn)
    account_id = account_body.get("id") if isinstance(account_body, dict) else None
    checks.append(
        {
            "name": "portfolio_account_create",
            "http_status": account_status,
            "result": "pass" if account_status == 200 and after_account["portfolio_accounts"] > baseline["portfolio_accounts"] else "fail",
            "db_delta": {
                "portfolio_accounts": after_account["portfolio_accounts"] - baseline["portfolio_accounts"],
            },
            "notes": account_name,
            "response": account_body,
        }
    )

    trade_baseline = after_account
    trade_status = 0
    trade_body: dict | str = "skipped"
    if account_id is not None:
        trade_status, trade_body = post_json(
            session,
            "/api/v1/portfolio/trades",
            {
                "account_id": account_id,
                "symbol": "AAPL",
                "trade_date": date.today().isoformat(),
                "side": "buy",
                "quantity": 1,
                "price": 100,
                "fee": 0,
                "tax": 0,
                "market": "us",
                "currency": "USD",
                "note": "codex ux verify",
            },
        )
    after_trade = fetch_counts(conn)
    checks.append(
        {
            "name": "portfolio_trade_create",
            "http_status": trade_status,
            "result": "pass" if trade_status == 200 and after_trade["portfolio_trades"] > trade_baseline["portfolio_trades"] else "fail",
            "db_delta": {
                "portfolio_trades": after_trade["portfolio_trades"] - trade_baseline["portfolio_trades"],
            },
            "notes": f"account_id={account_id}",
            "response": trade_body,
        }
    )

    scanner_baseline = after_trade
    scanner_status, scanner_body = post_json(
        session,
        "/api/v1/scanner/run",
        {
            "market": "us",
            "profile": "us_preopen_v1",
            "shortlist_size": 5,
            "universe_limit": 180,
            "detail_limit": 40,
        },
    )
    after_scanner = fetch_counts(conn)
    checks.append(
        {
            "name": "scanner_run_attempt",
            "http_status": scanner_status,
            "result": "pass" if after_scanner["market_scanner_runs"] > scanner_baseline["market_scanner_runs"] else "fail",
            "db_delta": {
                "market_scanner_runs": after_scanner["market_scanner_runs"] - scanner_baseline["market_scanner_runs"],
            },
            "notes": "Run may still return an upstream/data availability error; this check verifies row creation.",
            "response": scanner_body,
        }
    )

    backtest_baseline = after_scanner
    backtest_status, backtest_body = post_json(
        session,
        "/api/v1/backtest/rule/run",
        {
            "code": "AAPL",
            "strategy_text": "Buy when Close > MA3. Sell when Close < MA3.",
            "confirmed": True,
            "wait_for_completion": False,
        },
    )
    after_backtest = fetch_counts(conn)
    checks.append(
        {
            "name": "rule_backtest_run_create",
            "http_status": backtest_status,
            "result": "pass" if after_backtest["rule_backtest_runs"] > backtest_baseline["rule_backtest_runs"] else "fail",
            "db_delta": {
                "rule_backtest_runs": after_backtest["rule_backtest_runs"] - backtest_baseline["rule_backtest_runs"],
            },
            "notes": "Async rule backtest kickoff.",
            "response": backtest_body,
        }
    )

    chat_baseline = after_backtest
    chat_status, chat_body = post_json(
        session,
        "/api/v1/agent/chat",
        {
            "message": "请用一句话总结 AAPL 当前趋势。",
            "skills": [],
        },
    )
    after_chat = fetch_counts(conn)
    checks.append(
        {
            "name": "chat_session_message_create",
            "http_status": chat_status,
            "result": "pass"
            if (
                after_chat["conversation_sessions"] > chat_baseline["conversation_sessions"]
                and after_chat["conversation_messages"] > chat_baseline["conversation_messages"]
            )
            else "fail",
            "db_delta": {
                "conversation_sessions": after_chat["conversation_sessions"] - chat_baseline["conversation_sessions"],
                "conversation_messages": after_chat["conversation_messages"] - chat_baseline["conversation_messages"],
            },
            "notes": "Agent response may still carry upstream model failures; this check verifies session/message persistence.",
            "response": chat_body,
        }
    )

    report = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "db_path": str(DB_PATH),
        "auth_status": auth_status,
        "baseline_counts": baseline,
        "final_counts": after_chat,
        "checks": checks,
    }

    JSON_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    MD_PATH.write_text(build_markdown(report), encoding="utf-8")


if __name__ == "__main__":
    main()
