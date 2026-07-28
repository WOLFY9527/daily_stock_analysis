from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from scripts.environment import cli as environment_cli
from scripts.environment.cli import (
    _execute,
    _format_development_result,
    _managed_reexec,
    _parser,
)
from scripts.environment.errors import EnvironmentFailure
from tests import offline_network


ROOT = Path(__file__).resolve().parents[2]
WOLFY = ROOT / "wolfy"
WOLFY_POWERSHELL = ROOT / "wolfy.ps1"
CLI = ROOT / "scripts" / "wolfy.py"
SERVICE_ENTRYPOINT = ROOT / "scripts" / "wolfy_service.py"
BOOTSTRAP_SH = ROOT / "scripts" / "bootstrap_worktree.sh"
BOOTSTRAP_PS1 = ROOT / "scripts" / "bootstrap_worktree.ps1"
PREFLIGHT = ROOT / "scripts" / "worktree_preflight.py"
CI_GATES = (ROOT / "scripts" / "ci_gate.sh", ROOT / "scripts" / "ci_gate_fast.sh")
WINDOWS_BOOTSTRAP_PROBE_SOURCE = (
    "import platform,sys; print(platform.python_implementation(), 'CPython', "
    "sys.version_info[0], sys.version_info[1], sep='|')"
)


def _write_windows_bootstrap_probe_fixture(path: Path) -> None:
    path.write_text(
        "@echo off\r\n"
        "setlocal EnableExtensions EnableDelayedExpansion\r\n"
        'if /I "%~4"=="-c" (\r\n'
        '  set "probe=%~5"\r\n'
        '  > "%WOLFYSTOCK_TEST_T692_PROBE_RECORD%" echo(!probe!\r\n'
        '  if /I "%WOLFYSTOCK_TEST_T692_PROBE_MODE%"=="supported" (\r\n'
        "    echo CPython^|CPython^|3^|11\r\n"
        "    exit /b 0\r\n"
        "  )\r\n"
        '  if /I "%WOLFYSTOCK_TEST_T692_PROBE_MODE%"=="unsupported-implementation" (\r\n'
        "    echo PyPy^|CPython^|3^|11\r\n"
        "    exit /b 0\r\n"
        "  )\r\n"
        '  if /I "%WOLFYSTOCK_TEST_T692_PROBE_MODE%"=="unsupported-version" (\r\n'
        "    echo CPython^|CPython^|3^|12\r\n"
        "    exit /b 0\r\n"
        "  )\r\n"
        '  if /I "%WOLFYSTOCK_TEST_T692_PROBE_MODE%"=="invalid-output" (\r\n'
        "    echo malformed\r\n"
        "    exit /b 0\r\n"
        "  )\r\n"
        "  echo unsupported fixture probe mode 1>&2\r\n"
        "  exit /b 18\r\n"
        ")\r\n"
        "exit /b 0\r\n",
        encoding="utf-8",
        newline="",
    )


def _run_windows_wolfy_bootstrap_probe(
    tmp_path: Path,
    *,
    mode: str,
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[subprocess.CompletedProcess[str], Path]:
    powershell = shutil.which("powershell.exe")
    if powershell is None:
        pytest.skip("Windows PowerShell is required for the native launcher contract")

    fixture_root = tmp_path / "wolfy-probe-fixture"
    fixture_root.mkdir()
    fixture_wolfy = fixture_root / "wolfy.ps1"
    fixture_wolfy.write_text(WOLFY_POWERSHELL.read_text(encoding="utf-8"), encoding="utf-8")
    entrypoint = fixture_root / "scripts" / "wolfy.py"
    entrypoint.parent.mkdir()
    entrypoint.write_text("raise SystemExit(0)\n", encoding="utf-8")
    if mode == "execution-failure":
        bootstrap_python = Path(os.environ["SystemRoot"]) / "System32" / "where.exe"
    else:
        bootstrap_python = fixture_root / "bootstrap-python.cmd"
        _write_windows_bootstrap_probe_fixture(bootstrap_python)
    probe_record = fixture_root / "probe-source.txt"
    monkeypatch.setattr(
        offline_network,
        "CHILD_ENVIRONMENT_ALLOWLIST",
        offline_network.CHILD_ENVIRONMENT_ALLOWLIST | {"WOLFYSTOCK_BOOTSTRAP_PYTHON"},
    )
    environment = os.environ.copy()
    environment.update(
        {
            "WOLFYSTOCK_BOOTSTRAP_PYTHON": str(bootstrap_python),
            "WOLFYSTOCK_TEST_T692_PROBE_MODE": mode,
            "WOLFYSTOCK_TEST_T692_PROBE_RECORD": str(probe_record),
        }
    )

    result = subprocess.run(
        [
            powershell,
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(fixture_wolfy),
            "bootstrap",
            "--ensure",
        ],
        cwd=fixture_root,
        text=True,
        capture_output=True,
        check=False,
        env=environment,
    )
    return result, probe_record


@pytest.mark.skipif(os.name != "nt", reason="Windows PowerShell native argument handling")
def test_windows_noninteractive_wolfy_probe_preserves_cpython_literal_and_accepts_cpython_311(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    result, probe_record = _run_windows_wolfy_bootstrap_probe(
        tmp_path, mode="supported", monkeypatch=monkeypatch
    )

    assert result.returncode == 0, result.stderr
    assert probe_record.read_text(encoding="utf-8").strip() == WINDOWS_BOOTSTRAP_PROBE_SOURCE


@pytest.mark.skipif(os.name != "nt", reason="Windows PowerShell native argument handling")
@pytest.mark.parametrize("mode", ("unsupported-implementation", "unsupported-version"))
def test_windows_noninteractive_wolfy_probe_rejects_valid_unsupported_interpreters(
    tmp_path: Path,
    mode: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    result, probe_record = _run_windows_wolfy_bootstrap_probe(
        tmp_path, mode=mode, monkeypatch=monkeypatch
    )

    assert probe_record.read_text(encoding="utf-8").strip() == WINDOWS_BOOTSTRAP_PROBE_SOURCE
    assert result.returncode == 1
    assert '"reasonCode":"unsupported_bootstrap_python"' in result.stderr


@pytest.mark.skipif(os.name != "nt", reason="Windows PowerShell native argument handling")
@pytest.mark.parametrize(
    ("mode", "reason_code"),
    (
        ("execution-failure", "bootstrap_python_probe_execution_failed"),
        ("invalid-output", "bootstrap_python_probe_invalid"),
    ),
)
def test_windows_noninteractive_wolfy_probe_fails_closed_when_execution_or_parsing_fails(
    tmp_path: Path,
    mode: str,
    reason_code: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    result, probe_record = _run_windows_wolfy_bootstrap_probe(
        tmp_path, mode=mode, monkeypatch=monkeypatch
    )

    if mode == "execution-failure":
        assert not probe_record.exists()
    else:
        assert probe_record.read_text(encoding="utf-8").strip() == WINDOWS_BOOTSTRAP_PROBE_SOURCE
    assert result.returncode == 1
    assert f'"reasonCode":"{reason_code}"' in result.stderr
    assert '"reasonCode":"unsupported_bootstrap_python"' not in result.stderr


def test_root_launchers_select_supported_bootstrap_without_using_mutable_worktree_dependencies() -> None:
    posix = WOLFY.read_text(encoding="utf-8")
    powershell = WOLFY_POWERSHELL.read_text(encoding="utf-8")

    assert "python3.11" in posix
    assert "WOLFYSTOCK_BOOTSTRAP_PYTHON" in posix
    assert ".venv" not in posix
    assert "scripts/wolfy.py" in posix
    assert "3.11" in powershell
    assert "Get-Command py" in powershell
    assert "-3.11" in powershell
    assert "scripts/wolfy.py" in powershell.replace("\\", "/")


def test_cli_help_exposes_single_canonical_command_surface(monkeypatch, capsys) -> None:
    result = subprocess.run(
        [sys.executable, str(CLI), "--help"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
        env={**os.environ, "WOLFYSTOCK_SKIP_INTERPRETER_CHECK": "1"},
    )

    assert result.returncode == 0, result.stderr
    for command in ("bootstrap", "env", "exec", "qualify-env", "dev", "lock"):
        assert command in result.stdout

    parser = _parser()
    human_start = parser.parse_args(["dev"])
    human_stop = parser.parse_args(["dev", "--stop"])
    json_start = parser.parse_args(["dev", "--json"])
    isolated_stop = parser.parse_args(["dev", "--stop", "dev-fixture", "--json"])

    assert (human_start.json, human_start.stop) == (False, None)
    assert (human_stop.json, human_stop.stop) == (False, "")
    assert (json_start.json, json_start.stop) == (True, None)
    assert (isolated_stop.json, isolated_stop.stop) == (True, "dev-fixture")
    assert _format_development_result(
        {
            "status": "ready",
            "frontendUrl": "http://127.0.0.1:5173",
            "backendUrl": "http://127.0.0.1:8000",
        },
        launcher=Path("/repo/wolfy"),
    ) == (
        "WolfyStock is ready\n\n"
        "Frontend: http://127.0.0.1:5173\n"
        "Backend:  http://127.0.0.1:8000\n\n"
        f"Stop: {Path('/repo/wolfy')} dev --stop"
    )
    assert _format_development_result(
        {"status": "already_running", "frontendUrl": "http://127.0.0.1:5173", "backendUrl": "http://127.0.0.1:8000"},
        launcher=Path("/repo/wolfy"),
    ).startswith("WolfyStock is already running")
    assert _format_development_result(
        {"status": "already_stopped"}, launcher=Path("/repo/wolfy")
    ) == "WolfyStock stopped"

    monkeypatch.setattr(environment_cli, "_root", lambda: ROOT)
    monkeypatch.setattr(environment_cli, "require_managed_python", lambda _root: None)
    monkeypatch.setattr(environment_cli, "_managed_reexec", lambda _root, _argv: None)
    monkeypatch.setattr(
        environment_cli,
        "EnvironmentManager",
        lambda _root: SimpleNamespace(verify=lambda *, run_id=None: object()),
    )

    def transform_failure(_root, _manager, *, isolated: bool):
        assert isolated is False
        raise EnvironmentFailure("development_frontend_transform_failed", "frontend entrypoint transform failed")

    monkeypatch.setattr("scripts.environment.services.run_development_services", transform_failure)
    assert environment_cli.main(["dev"]) == 1
    output = capsys.readouterr()
    assert "WolfyStock could not start: frontend entrypoint transform failed" in output.err
    assert "WolfyStock is ready" not in output.out + output.err


def test_dev_preflight_rejects_retained_windows_git_identity_without_repair(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    root = tmp_path / "repo"
    ensure_calls: list[tuple[bool, str | None]] = []
    reexec_calls: list[list[str]] = []

    class RetainedMismatchManager:
        def verify(self, *, run_id=None):
            raise EnvironmentFailure(
                "windows_git_identity_mismatch",
                "retained Windows Git identity does not match",
            )

        def ensure(self, *, offline: bool, run_id=None):
            ensure_calls.append((offline, run_id))
            raise AssertionError("retained Git mismatch must not be repaired")

    def wrong_interpreter(_root: Path) -> None:
        raise EnvironmentFailure("wrong_managed_interpreter", "wrong_managed_interpreter")

    monkeypatch.setattr(environment_cli, "_root", lambda: root)
    monkeypatch.setattr(environment_cli, "EnvironmentManager", lambda _root: RetainedMismatchManager())
    monkeypatch.setattr(environment_cli, "require_managed_python", wrong_interpreter)
    monkeypatch.setattr(
        environment_cli,
        "_managed_reexec",
        lambda _root, argv: reexec_calls.append(list(argv)),
    )
    monkeypatch.setattr(
        "scripts.environment.services.run_development_services",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("services must not start")),
    )

    assert environment_cli.main(["dev", "--json"]) == 1
    payload = json.loads(capsys.readouterr().err)
    assert payload["reasonCode"] == "windows_git_identity_mismatch"
    assert ensure_calls == []
    assert reexec_calls == []


def test_dev_preflight_creates_missing_environment_and_preserves_valid_retained_environment(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = tmp_path / "repo"
    selected: dict[str, object] = {}
    reexec_calls: list[list[str]] = []
    service_managers: list[object] = []

    class MissingManager:
        def __init__(self) -> None:
            self.ensure_calls: list[tuple[bool, str | None]] = []

        def verify(self, *, run_id=None):
            raise EnvironmentFailure("worktree_pointer_missing", "worktree environment pointer is missing")

        def ensure(self, *, offline: bool, run_id=None):
            self.ensure_calls.append((offline, run_id))
            return object()

    class ValidManager:
        def __init__(self) -> None:
            self.verify_calls = 0

        def verify(self, *, run_id=None):
            self.verify_calls += 1
            return object()

        def ensure(self, *, offline: bool, run_id=None):
            raise AssertionError("valid retained environment must not be repaired")

    missing = MissingManager()
    valid = ValidManager()
    selected["manager"] = missing

    monkeypatch.setattr(environment_cli, "_root", lambda: root)
    monkeypatch.setattr(
        environment_cli,
        "EnvironmentManager",
        lambda _root: selected["manager"],
    )
    monkeypatch.setattr(environment_cli, "require_managed_python", lambda _root: None)
    monkeypatch.setattr(
        environment_cli,
        "_managed_reexec",
        lambda _root, argv: reexec_calls.append(list(argv)),
    )
    monkeypatch.setattr(environment_cli.secrets, "token_hex", lambda _count: "a" * 16)
    monkeypatch.setattr(
        "scripts.environment.services.run_development_services",
        lambda _root, manager, *, isolated: service_managers.append(manager)
        or {
            "status": "ready",
            "frontendUrl": "http://127.0.0.1:5173",
            "backendUrl": "http://127.0.0.1:8000",
        },
    )

    assert environment_cli.main(["dev", "--json"]) == 0
    assert missing.ensure_calls == [(False, "dev-bootstrap-" + "a" * 16)]
    assert service_managers == [missing]

    selected["manager"] = valid
    assert environment_cli.main(["dev", "--json"]) == 0
    assert valid.verify_calls == 1
    assert service_managers == [missing, valid]
    assert reexec_calls == [["dev", "--json"], ["dev", "--json"]]


def test_lock_command_has_one_bounded_python_check_and_update_surface(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    parser = _parser()

    check = parser.parse_args(["lock", "python", "--check"])
    update = parser.parse_args(["lock", "python", "--update"])

    assert (check.command, check.lock_family, check.lock_action) == ("lock", "python", "check")
    assert (update.command, update.lock_family, update.lock_action) == ("lock", "python", "update")

    root = tmp_path / "repo"
    root.mkdir()
    resolver = tmp_path / "cache" / "tool-uv" / "uv.exe"
    resolver.parent.mkdir(parents=True)
    resolver.write_bytes(b"reviewed")
    check_runner = object()
    update_runner = object()
    verify_calls: list[str | None] = []

    def verify(*, run_id: str | None = None) -> SimpleNamespace:
        verify_calls.append(run_id)
        return SimpleNamespace(resolver_executable=resolver)

    monkeypatch.setattr(environment_cli, "_root", lambda: root)
    monkeypatch.setattr(
        environment_cli, "EnvironmentManager", lambda _root: SimpleNamespace(verify=verify)
    )
    monkeypatch.setattr(
        environment_cli,
        "resolver_runner_for_executable",
        lambda actual_root, executable: (
            check_runner
            if (actual_root, executable) == (root, resolver)
            else pytest.fail("lock check must use the verified resolver executable")
        ),
    )
    monkeypatch.setattr(
        environment_cli,
        "check_python_lock",
        lambda actual_root, *, resolver_runner: (
            {"status": "ok", "resolver": "checked"}
            if (actual_root, resolver_runner) == (root, check_runner)
            else pytest.fail("lock check did not receive the managed resolver runner")
        ),
    )
    monkeypatch.setattr(
        environment_cli,
        "_managed_resolver_runner_for_update",
        lambda actual_root: (
            update_runner
            if actual_root == root
            else pytest.fail("lock update resolved the wrong repository")
        ),
    )
    monkeypatch.setattr(
        environment_cli,
        "update_python_lock",
        lambda actual_root, *, resolver_runner: (
            {"status": "updated", "resolver": "updated"}
            if (actual_root, resolver_runner) == (root, update_runner)
            else pytest.fail("lock update did not receive the managed resolver runner")
        ),
    )
    monkeypatch.setattr(environment_cli.secrets, "token_hex", lambda _count: "a" * 16)

    assert environment_cli.main(["lock", "python", "--check"]) == 0
    assert json.loads(capsys.readouterr().out) == {"resolver": "checked", "status": "ok"}
    assert verify_calls == ["lock-check-" + "a" * 16]

    assert environment_cli.main(["lock", "python", "--update"]) == 0
    assert json.loads(capsys.readouterr().out) == {"resolver": "updated", "status": "updated"}


def test_exec_parser_exposes_one_repeatable_reviewed_config_override_surface() -> None:
    parsed = _parser().parse_args(
        [
            "exec",
            "--profile",
            "test",
            "--config-override",
            "MARKET_CACHE_REMOTE_BACKEND=redis",
            "--config-override",
            "MARKET_CACHE_REMOTE_URL=redis://fixture.invalid/0",
            "--",
            "python",
            "-c",
            "pass",
        ]
    )

    assert parsed.config_override == [
        "MARKET_CACHE_REMOTE_BACKEND=redis",
        "MARKET_CACHE_REMOTE_URL=redis://fixture.invalid/0",
    ]
    assert parsed.child_command == ["--", "python", "-c", "pass"]


def test_windows_managed_reexec_runs_managed_cli_and_propagates_exit(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = tmp_path / "repo"
    expected = tmp_path / "managed" / "python.exe"
    expected.parent.mkdir(parents=True)
    expected.write_bytes(b"fixture")
    observed: dict[str, object] = {}

    def run(
        command: list[str],
        **kwargs: object,
    ) -> subprocess.CompletedProcess[str]:
        observed["command"] = command
        observed["environment"] = kwargs["env"]
        return subprocess.CompletedProcess(command, 23)

    monkeypatch.setattr(environment_cli, "managed_python_path", lambda _root: expected)
    monkeypatch.setattr(environment_cli.sys, "executable", str(tmp_path / "bootstrap.exe"))
    monkeypatch.setattr(environment_cli.os, "name", "nt")
    monkeypatch.setattr(environment_cli.subprocess, "run", run)

    with pytest.raises(SystemExit) as raised:
        _managed_reexec(root, ["env", "verify"])

    assert raised.value.code == 23
    assert observed["command"] == [
        str(expected),
        "-E",
        "-s",
        "-B",
        str(root / "scripts" / "wolfy.py"),
        "env",
        "verify",
    ]
    assert isinstance(observed["environment"], dict)


def test_existing_worktree_entrypoints_are_thin_wolfy_delegates() -> None:
    shell = BOOTSTRAP_SH.read_text(encoding="utf-8")
    powershell = BOOTSTRAP_PS1.read_text(encoding="utf-8")
    preflight = PREFLIGHT.read_text(encoding="utf-8")

    assert "wolfy" in shell
    assert "worktree_preflight.py" not in shell
    assert "wolfy.ps1" in powershell
    assert "environment.cli" in preflight
    for forbidden in ("hashlib", "node_modules", "requirements.txt", "canonical"):
        assert forbidden not in preflight


def test_local_backend_gates_delegate_to_hermetic_test_profile() -> None:
    for path in CI_GATES:
        content = path.read_text(encoding="utf-8")
        assert "WOLFYSTOCK_TEST_RUN_ID" in content
        assert 'wolfy" exec --profile test -- bash' in content


def test_managed_service_entrypoint_resolves_repository_without_pythonpath() -> None:
    content = SERVICE_ENTRYPOINT.read_text(encoding="utf-8")

    assert "Path(__file__).resolve().parents[1]" in content
    assert "sys.path.insert" in content
    assert "PYTHONPATH" not in content


def test_qualify_env_rejects_implicit_or_mismatched_baseline_identity(tmp_path: Path) -> None:
    baseline = tmp_path / "baseline.json"
    current = tmp_path / "current.json"
    baseline.write_text(
        json.dumps(
            {
                "schemaVersion": "wolfystock_qualification_findings_v1",
                "commit": "a" * 40,
                "checkoutClean": False,
                "environmentFingerprint": "b" * 64,
                "findings": [],
            }
        ),
        encoding="utf-8",
    )
    current.write_text("[]\n", encoding="utf-8")
    result = subprocess.run(
        [
            sys.executable,
            str(CLI),
            "qualify-env",
            "--baseline-commit",
            "a" * 40,
            "--baseline-evidence",
            str(baseline),
            "--findings",
            str(current),
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
        env={**os.environ, "WOLFYSTOCK_SKIP_INTERPRETER_CHECK": "1", "WOLFYSTOCK_TEST_FAKE_ENVIRONMENT": "1"},
    )

    assert result.returncode == 1
    payload = json.loads(result.stderr)
    assert payload["reasonCode"] == "baseline_checkout_not_clean"

    baseline.write_text(
        json.dumps(
            {
                "schemaVersion": "wolfystock_qualification_findings_v1",
                "commit": "short",
                "checkoutClean": True,
                "environmentFingerprint": "b" * 64,
                "findings": [],
            }
        ),
        encoding="utf-8",
    )
    invalid_commit = subprocess.run(
        [
            sys.executable,
            str(CLI),
            "qualify-env",
            "--baseline-commit",
            "short",
            "--baseline-evidence",
            str(baseline),
            "--findings",
            str(current),
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
        env=os.environ.copy(),
    )
    assert invalid_commit.returncode == 1
    assert json.loads(invalid_commit.stderr)["reasonCode"] == "baseline_commit_invalid"


def test_failed_exec_retains_run_scoped_environment_evidence(
    tmp_path: Path, monkeypatch
) -> None:
    observed: dict[str, object] = {}

    class Manager:
        cache_root = tmp_path / "cache"

        def verify(self, *, run_id=None):
            observed["runId"] = run_id
            return SimpleNamespace(
                combined_fingerprint="e" * 64,
                browser=SimpleNamespace(path=Path("/managed/browsers/browser-snapshot")),
                browser_executable=Path("/managed/browsers/browser-snapshot/chrome"),
                rg=SimpleNamespace(path=Path("/managed/tools/rg-snapshot")),
                git_executable=Path("/verified/tools/git/git.exe"),
                evidence={
                    "schemaVersion": "wolfystock_environment_evidence_v1",
                    "environmentFingerprint": "e" * 64,
                    "operational": {"runId": run_id},
                },
            )

    def child(command, **kwargs):
        observed["command"] = command
        observed["environment"] = kwargs["env"]
        return subprocess.CompletedProcess(command, 1)

    monkeypatch.setenv("ALPACA_API_KEY", "must-not-be-recorded")
    monkeypatch.setattr("scripts.environment.cli.secrets.token_hex", lambda _count: "a" * 16)
    monkeypatch.setattr("scripts.environment.cli.shutil.which", lambda _name: "/managed/node/bin/node")
    monkeypatch.setattr("scripts.environment.cli.managed_python_path", lambda _root: Path("/managed/bin/python"))
    monkeypatch.setattr("scripts.environment.cli.subprocess.run", child)

    result = _execute(
        tmp_path,
        Manager(),
        SimpleNamespace(
            child_command=["--", "python", "-c", "pass"],
            config_override=[
                "MARKET_CACHE_REMOTE_BACKEND=redis",
                "MARKET_CACHE_REMOTE_URL=redis://user:private-value@fixture.invalid/0",
            ],
        ),
    )

    run_id = "run-" + "a" * 16
    evidence_path = Manager.cache_root / "runs" / "failed" / run_id / "services" / "environment-evidence.json"
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    assert result == 1
    assert observed["runId"] == run_id
    assert observed["command"] == [str(Path("/managed/bin/python")), "-c", "pass"]
    assert evidence["operational"]["runId"] == run_id
    assert evidence["operational"]["configurationOverrideKeys"] == [
        "MARKET_CACHE_REMOTE_BACKEND",
        "MARKET_CACHE_REMOTE_URL",
    ]
    assert "must-not-be-recorded" not in evidence_path.read_text(encoding="utf-8")
    assert "private-value" not in evidence_path.read_text(encoding="utf-8")
    assert "ALPACA_API_KEY" not in observed["environment"]
    assert str(Path("/verified/tools/git")) in observed["environment"][
        "PATH"
    ].split(os.pathsep)
