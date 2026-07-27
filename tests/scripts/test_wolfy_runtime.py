from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.environment.errors import EnvironmentFailure
from scripts.environment.runtime import (
    cleanup_run,
    create_run_context,
    parse_test_config_overrides,
    project_test_environment,
)


MANAGED_PATHS = {
    "managed_rg_dir": Path("/managed/tools/rg"),
    "verified_git_executable": Path("/verified/tools/git/git.exe"),
    "browser_path": Path("/managed/browsers/chromium-1208"),
    "browser_executable": Path("/managed/browsers/chromium-1208/chrome"),
}


def test_test_projection_strips_credentials_dsns_admin_flags_and_startup_modifiers(tmp_path: Path) -> None:
    context = create_run_context(tmp_path, run_id="run-projection")
    source = {
        "PATH": "/host/bin",
        "LANG": "en_US.UTF-8",
        "ALPACA_API_KEY": "provider-secret",
        "AWS_SECRET_ACCESS_KEY": "cloud-secret",
        "DATABASE_URL": "postgresql://user:secret@prod.example/prod",
        "DATABASE_PATH": "/tmp/untrusted-user/financial.db",
        "ADMIN_AUTH_ENABLED": "true",
        "PYTHONPATH": "/unsafe/python",
        "PYTHONSTARTUP": "/unsafe/startup.py",
        "NODE_OPTIONS": "--require /unsafe/hook.js",
        "npm_config_registry": "https://private.example",
        "HTTPS_PROXY": "http://proxy.example",
    }

    projected = project_test_environment(
        source,
        context,
        managed_python=Path("/managed/.venv/bin/python"),
        node_bin=Path("/managed/node/bin"),
        command=["python", "-c", "pass"],
        **MANAGED_PATHS,
    )

    for name in (
        "ALPACA_API_KEY",
        "AWS_SECRET_ACCESS_KEY",
        "DATABASE_URL",
        "ADMIN_AUTH_ENABLED",
        "PYTHONPATH",
        "PYTHONSTARTUP",
        "NODE_OPTIONS",
        "npm_config_registry",
        "HTTPS_PROXY",
    ):
        assert name not in projected
    assert projected["DATABASE_PATH"] == str(context.database_path)
    assert projected["ENV_FILE"] == str(context.root / "empty.env")
    assert not Path(projected["ENV_FILE"]).exists()
    assert projected["PATH"].split(os.pathsep)[0] == str(
        Path("/managed/.venv/bin")
    )


def test_app_env_is_preserved_only_when_explicitly_present(tmp_path: Path) -> None:
    context = create_run_context(tmp_path, run_id="run-app-env")
    common = {
        "context": context,
        "managed_python": Path("/managed/.venv/bin/python"),
        "node_bin": Path("/managed/node/bin"),
        "command": ["python", "-c", "pass"],
        **MANAGED_PATHS,
    }

    assert "APP_ENV" not in project_test_environment({}, **common)
    assert project_test_environment({"APP_ENV": "production"}, **common)["APP_ENV"] == "production"


def test_windows_process_runtime_is_preserved_without_host_path(
    tmp_path: Path,
) -> None:
    context = create_run_context(tmp_path, run_id="run-windows-process")
    source = {
        "COMSPEC": r"C:\Windows\System32\cmd.exe",
        "PATH": r"C:\unreviewed\host",
        "PATHEXT": ".COM;.EXE;.BAT;.CMD",
        "PROCESSOR_ARCHITECTURE": "AMD64",
        "PROCESSOR_ARCHITEW6432": "AMD64",
        "SYSTEMROOT": r"C:\Windows",
    }

    projected = project_test_environment(
        source,
        context,
        managed_python=Path(r"C:\managed\.venv\Scripts\python.exe"),
        node_bin=Path(r"C:\managed\node"),
        command=["python", "-c", "pass"],
        **MANAGED_PATHS,
    )

    assert projected["COMSPEC"] == source["COMSPEC"]
    assert projected["PATHEXT"] == source["PATHEXT"]
    assert projected["PROCESSOR_ARCHITECTURE"] == "AMD64"
    assert projected["PROCESSOR_ARCHITEW6432"] == "AMD64"
    assert projected["SYSTEMROOT"] == source["SYSTEMROOT"]
    assert source["PATH"] not in projected["PATH"]
    assert str(MANAGED_PATHS["verified_git_executable"].parent) in projected[
        "PATH"
    ].split(os.pathsep)


@pytest.mark.skipif(os.name != "nt", reason="requires Windows executable resolution")
def test_windows_projected_profile_executes_verified_git_and_r01_identity(
    tmp_path: Path,
) -> None:
    discovered = shutil.which("git.exe")
    assert discovered is not None
    git_executable = Path(discovered).resolve(strict=True)
    repository_root = Path(__file__).resolve().parents[2]
    expected_revision = subprocess.run(
        [str(git_executable), "rev-parse", "HEAD"],
        cwd=repository_root,
        text=True,
        capture_output=True,
        check=False,
    )
    assert expected_revision.returncode == 0, expected_revision.stderr
    context = create_run_context(tmp_path, run_id="run-windows-verified-git")
    source = {
        key: os.environ[key]
        for key in ("COMSPEC", "PATHEXT", "SYSTEMROOT")
        if os.environ.get(key)
    }
    source["PATH"] = r"C:\unreviewed\host"
    projected = project_test_environment(
        source,
        context,
        managed_python=Path(sys.executable),
        node_bin=Path(sys.executable).parent,
        managed_rg_dir=tmp_path / "managed-rg",
        verified_git_executable=git_executable,
        browser_path=tmp_path / "managed-browser",
        browser_executable=tmp_path / "managed-browser" / "chrome.exe",
        command=["python", "-c", "pass"],
    )

    where_result = subprocess.run(
        ["where.exe", "git"],
        cwd=repository_root,
        env=projected,
        text=True,
        capture_output=True,
        check=False,
    )
    assert where_result.returncode == 0, where_result.stderr
    assert [
        Path(line).resolve(strict=True)
        for line in where_result.stdout.splitlines()
        if line.strip()
    ] == [git_executable]

    version_result = subprocess.run(
        ["git", "--version"],
        cwd=repository_root,
        env=projected,
        text=True,
        capture_output=True,
        check=False,
    )
    assert version_result.returncode == 0, version_result.stderr
    assert version_result.stdout.startswith("git version ")

    subprocess_result = subprocess.run(
        [
            str(Path(sys.executable)),
            "-c",
            "import subprocess, sys; result = subprocess.run(['git', 'rev-parse', 'HEAD'], text=True, capture_output=True); print(result.stdout.strip()); raise SystemExit(result.returncode)",
        ],
        cwd=repository_root,
        env=projected,
        text=True,
        capture_output=True,
        check=False,
    )
    assert subprocess_result.returncode == 0, subprocess_result.stderr
    assert subprocess_result.stdout.strip() == expected_revision.stdout.strip()

    r01_probe = (
        "from pathlib import Path\n"
        "import sys\n"
        "sys.path.insert(0, str(Path.cwd() / 'scripts'))\n"
        "from release_restore_rollback_drill import _git_revision\n"
        "print(_git_revision(Path.cwd(), 'HEAD'))\n"
    )
    r01_identity_result = subprocess.run(
        [
            str(Path(sys.executable)),
            "-c",
            r01_probe,
        ],
        cwd=repository_root,
        env=projected,
        text=True,
        capture_output=True,
        check=False,
    )
    assert r01_identity_result.returncode == 0, r01_identity_result.stderr
    assert r01_identity_result.stdout.strip() == expected_revision.stdout.strip()


def test_release_projection_preserves_only_non_secret_identity_controls(tmp_path: Path) -> None:
    context = create_run_context(tmp_path, run_id="run-release-controls")
    source = {
        "WOLFYSTOCK_RELEASE_CANDIDATE_SHA": "a" * 40,
        "DSA_WEB_PLAYWRIGHT_EXTERNAL_SERVER": "1",
        "PLAYWRIGHT_JSON_OUTPUT_NAME": "output/release/playwright.json",
        "PLAYWRIGHT_OUTPUT_DIR": "output/release/results",
        "DOCKERHUB_TOKEN": "must-not-survive",
    }

    projected = project_test_environment(
        source,
        context,
        managed_python=Path("/managed/.venv/bin/python"),
        node_bin=Path("/managed/node/bin"),
        command=["npm", "exec", "playwright"],
        **MANAGED_PATHS,
    )

    assert projected["WOLFYSTOCK_RELEASE_CANDIDATE_SHA"] == "a" * 40
    assert projected["DSA_WEB_PLAYWRIGHT_EXTERNAL_SERVER"] == "1"
    assert projected["PLAYWRIGHT_JSON_OUTPUT_NAME"] == "output/release/playwright.json"
    assert projected["PLAYWRIGHT_OUTPUT_DIR"] == "output/release/results"
    assert "DOCKERHUB_TOKEN" not in projected


def test_destructive_postgres_dsn_requires_full_explicit_command_contract(tmp_path: Path) -> None:
    context = create_run_context(tmp_path, run_id="run-pg")
    source = {
        "POSTGRES_PHASE_A_REAL_DSN": (
            "postgresql://user:secret@127.0.0.1:55432/wolfystock_destructive_test_t509"
        )
    }
    common = {
        "source": source,
        "context": context,
        "managed_python": Path("/managed/.venv/bin/python"),
        "node_bin": Path("/managed/node/bin"),
        **MANAGED_PATHS,
    }

    denied = project_test_environment(command=["pytest"], **common)
    allowed = project_test_environment(
        command=[
            "pytest",
            "-m",
            "destructive_postgres",
            "--allow-destructive-postgres",
            "--destructive-postgres-audit",
            "T509",
            "--destructive-postgres-target",
            "127.0.0.1:55432/wolfystock_destructive_test_t509",
        ],
        **common,
    )

    assert "POSTGRES_PHASE_A_REAL_DSN" not in denied
    assert allowed["POSTGRES_PHASE_A_REAL_DSN"] == source["POSTGRES_PHASE_A_REAL_DSN"]


def test_profile_defaults_are_deterministic_without_freezing_product_settings(tmp_path: Path) -> None:
    context = create_run_context(tmp_path, run_id="run-defaults")

    projected = project_test_environment(
        {
            "PATH": "/unreviewed/bin",
            "WOLFYSTOCK_HISTORICAL_OHLCV_RUNTIME_ENABLED": "true",
            "WOLFYSTOCK_YFINANCE_US_OHLCV_CACHE_ENABLED": "true",
        },
        context,
        managed_python=Path("/managed/.venv/bin/python"),
        node_bin=Path("/managed/node/bin"),
        command=["python", "-c", "pass"],
        **MANAGED_PATHS,
    )

    assert "WOLFYSTOCK_HISTORICAL_OHLCV_RUNTIME_ENABLED" not in projected
    assert "WOLFYSTOCK_YFINANCE_US_OHLCV_CACHE_ENABLED" not in projected
    assert projected["WOLFYSTOCK_UAT_NO_LIVE_PROVIDERS"] == "true"
    assert projected["PATH"].split(os.pathsep) == [
        str(Path("/managed/.venv/bin")),
        str(Path("/managed/node/bin")),
        str(Path("/managed/tools/rg")),
        str(Path("/verified/tools/git")),
        "/usr/bin",
        "/bin",
    ]
    assert "/unreviewed/bin" not in projected["PATH"]
    assert projected["PLAYWRIGHT_BROWSERS_PATH"] == str(
        Path("/managed/browsers/chromium-1208")
    )
    assert projected["WOLFYSTOCK_MANAGED_CHROMIUM_EXECUTABLE"] == (
        str(Path("/managed/browsers/chromium-1208/chrome"))
    )


def test_reviewed_process_override_is_allowlisted_and_order_isolated(tmp_path: Path) -> None:
    context = create_run_context(tmp_path, run_id="run-overrides")
    common = {
        "source": {},
        "context": context,
        "managed_python": Path("/managed/.venv/bin/python"),
        "node_bin": Path("/managed/node/bin"),
        "command": ["python", "-c", "pass"],
        **MANAGED_PATHS,
    }
    enabled = parse_test_config_overrides(
        [
            "WOLFYSTOCK_HISTORICAL_OHLCV_RUNTIME_ENABLED=true",
            "WOLFYSTOCK_YFINANCE_US_OHLCV_CACHE_ENABLED=true",
        ]
    )

    first_enabled = project_test_environment(config_overrides=enabled, **common)
    first_default = project_test_environment(config_overrides={}, **common)
    second_default = project_test_environment(config_overrides={}, **common)
    second_enabled = project_test_environment(config_overrides=enabled, **common)

    for projected in (first_enabled, second_enabled):
        assert projected["WOLFYSTOCK_HISTORICAL_OHLCV_RUNTIME_ENABLED"] == "true"
        assert projected["WOLFYSTOCK_YFINANCE_US_OHLCV_CACHE_ENABLED"] == "true"
    for projected in (first_default, second_default):
        assert "WOLFYSTOCK_HISTORICAL_OHLCV_RUNTIME_ENABLED" not in projected
        assert "WOLFYSTOCK_YFINANCE_US_OHLCV_CACHE_ENABLED" not in projected


def test_pytest_child_projection_extends_only_reviewed_override_keys(monkeypatch) -> None:
    from scripts.environment.pytest_projection import pytest_configure
    from scripts.environment.runtime import TEST_CONFIG_OVERRIDE_KEYS
    from tests import offline_network

    original = set(offline_network.CHILD_ENVIRONMENT_ALLOWLIST)
    monkeypatch.setattr(
        offline_network,
        "CHILD_ENVIRONMENT_ALLOWLIST",
        original.difference(TEST_CONFIG_OVERRIDE_KEYS),
    )

    pytest_configure()

    assert TEST_CONFIG_OVERRIDE_KEYS <= offline_network.CHILD_ENVIRONMENT_ALLOWLIST
    assert "UNREVIEWED_HOST_SETTING" not in offline_network.CHILD_ENVIRONMENT_ALLOWLIST


@pytest.mark.parametrize(
    "raw",
    [
        "UNKNOWN_FLAG=true",
        "WOLFYSTOCK_HISTORICAL_OHLCV_RUNTIME_ENABLED=maybe",
        "WOLFYSTOCK_HISTORICAL_OHLCV_RUNTIME_ENABLED=true=WAT",
    ],
)
def test_reviewed_process_override_rejects_unknown_or_invalid_values(raw: str) -> None:
    with pytest.raises(EnvironmentFailure) as raised:
        parse_test_config_overrides([raw])

    assert raised.value.code == "test_config_override_invalid"


def test_test_override_is_rejected_for_release_or_production_controls(tmp_path: Path) -> None:
    context = create_run_context(tmp_path, run_id="run-release-override")
    overrides = parse_test_config_overrides(
        ["WOLFYSTOCK_HISTORICAL_OHLCV_RUNTIME_ENABLED=true"]
    )

    for source in ({"APP_ENV": "production"}, {"WOLFYSTOCK_RELEASE_CANDIDATE_SHA": "a" * 40}):
        with pytest.raises(EnvironmentFailure) as raised:
            project_test_environment(
                source,
                context,
                managed_python=Path("/managed/.venv/bin/python"),
                node_bin=Path("/managed/node/bin"),
                command=["python", "-c", "pass"],
                config_overrides=overrides,
                **MANAGED_PATHS,
            )

        assert raised.value.code == "test_config_override_forbidden"


def test_multiple_runs_share_no_mutable_paths(tmp_path: Path) -> None:
    first = create_run_context(tmp_path, run_id="run-one")
    second = create_run_context(tmp_path, run_id="run-two")

    assert set(first.mutable_paths).isdisjoint(second.mutable_paths)
    assert first.database_path != second.database_path
    assert first.uploads_dir != second.uploads_dir


def test_cleanup_is_idempotent_and_failed_runs_are_bounded(tmp_path: Path) -> None:
    successful = create_run_context(tmp_path, run_id="run-success")
    readonly = successful.temp_dir / "sealed" / "payload.txt"
    readonly.parent.mkdir()
    readonly.write_text("sealed\n", encoding="utf-8")
    readonly.chmod(0o400)
    readonly.parent.chmod(0o500)
    cleanup_run(successful, success=True)
    cleanup_run(successful, success=True)
    assert not successful.root.exists()

    for index in range(5):
        failed = create_run_context(tmp_path, run_id=f"run-failed-{index}")
        cleanup_run(failed, success=False, retain_failures=2)
    retained = list((tmp_path / "runs" / "failed").glob("run-failed-*"))
    assert len(retained) == 2
