# -*- coding: utf-8 -*-
"""Smoke harness for formal database doctor verification."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Iterable

from src.database_doctor import (
    _DEFAULT_JSON_OUTPUT,
    _DEFAULT_MARKDOWN_OUTPUT,
    _DEFAULT_REAL_PG_JSON_OUTPUT,
    _DEFAULT_REAL_PG_MARKDOWN_OUTPUT,
    build_database_doctor_report,
    build_database_real_pg_bundle_report,
    render_database_doctor_json,
    render_database_doctor_markdown,
    write_database_doctor_outputs,
)


def build_database_doctor_smoke_report() -> dict:
    return build_database_doctor_report()


def build_database_real_pg_bundle_smoke_report(*, real_pg_dsn: str | None = None) -> dict:
    return build_database_real_pg_bundle_report(real_pg_dsn=real_pg_dsn)


def _parse_args(argv: Iterable[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate a smoke database doctor support bundle using the formal reporting entrypoints."
    )
    parser.add_argument(
        "--real-pg-bundle",
        action="store_true",
        help="run the isolated disposable-DSN verification bundle using POSTGRES_PHASE_A_REAL_DSN or --real-pg-dsn",
    )
    parser.add_argument(
        "--real-pg-dsn",
        default=None,
        help="explicit disposable DSN for --real-pg-bundle; defaults to POSTGRES_PHASE_A_REAL_DSN",
    )
    parser.add_argument(
        "--format",
        choices=("markdown", "json"),
        default="markdown",
        help="stdout format",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="write both markdown and json reports into tmp/ as well as printing stdout",
    )
    parser.add_argument(
        "--markdown-output",
        default=None,
        help="custom markdown output path",
    )
    parser.add_argument(
        "--json-output",
        default=None,
        help="custom json output path",
    )
    return parser.parse_args(list(argv) if argv is not None else None)


def main(argv: Iterable[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        if args.real_pg_bundle:
            report = build_database_real_pg_bundle_smoke_report(real_pg_dsn=args.real_pg_dsn)
        else:
            report = build_database_doctor_smoke_report()
    except ValueError as exc:
        sys.stderr.write(f"{exc}\n")
        return 2

    markdown_output = Path(args.markdown_output).expanduser() if args.markdown_output else None
    json_output = Path(args.json_output).expanduser() if args.json_output else None
    if args.write:
        if args.real_pg_bundle:
            markdown_output = markdown_output or _DEFAULT_REAL_PG_MARKDOWN_OUTPUT.with_name(
                "database-real-pg-bundle-smoke.md"
            )
            json_output = json_output or _DEFAULT_REAL_PG_JSON_OUTPUT.with_name(
                "database-real-pg-bundle-smoke.json"
            )
        else:
            markdown_output = markdown_output or _DEFAULT_MARKDOWN_OUTPUT.with_name(
                "database-doctor-report-smoke.md"
            )
            json_output = json_output or _DEFAULT_JSON_OUTPUT.with_name(
                "database-doctor-report-smoke.json"
            )

    written = write_database_doctor_outputs(
        report,
        markdown_path=markdown_output,
        json_path=json_output,
    )

    if args.format == "json":
        sys.stdout.write(render_database_doctor_json(report) + "\n")
    else:
        sys.stdout.write(render_database_doctor_markdown(report))

    for label, path in written.items():
        sys.stderr.write(f"Wrote smoke {label} report to {path}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
