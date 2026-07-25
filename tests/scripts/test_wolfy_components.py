from __future__ import annotations

import hashlib
import io
import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest

from scripts.environment.components import (
    PythonComponent,
    WebComponent,
    _bootstrap_environment,
    _content_tree_identity,
    _filesystem_path,
    _normalize_npm_tree,
    _normalize_distribution_records,
)
from scripts.environment.errors import EnvironmentFailure, OfflineMaterialUnavailable
from scripts.environment.identity import ToolchainIdentity
from scripts.environment.python_artifacts import LockedArtifact


TOOLCHAIN = ToolchainIdentity(
    os_name="Darwin",
    architecture="arm64",
    python_implementation="CPython",
    python_version="3.11.15",
    node_version="20.20.2",
    npm_version="10.8.2",
    install_mode="pip-requirements+npm-ci",
)


def fixture_wheel() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_STORED) as archive:
        entries = {
            "fixture/__init__.py": "VALUE = 1\n",
            "fixture-1.0.dist-info/METADATA": (
                "Metadata-Version: 2.1\nName: fixture\nVersion: 1.0\n"
            ),
            "fixture-1.0.dist-info/WHEEL": (
                "Wheel-Version: 1.0\n"
                "Generator: wolfystock-test\n"
                "Root-Is-Purelib: true\n"
                "Tag: py3-none-any\n"
            ),
            "fixture-1.0.dist-info/RECORD": (
                "fixture/__init__.py,,\n"
                "fixture-1.0.dist-info/METADATA,,\n"
                "fixture-1.0.dist-info/WHEEL,,\n"
                "fixture-1.0.dist-info/RECORD,,\n"
            ),
        }
        for name, content in entries.items():
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.external_attr = 0o644 << 16
            archive.writestr(info, content)
    return buffer.getvalue()


FIXTURE_ARTIFACT = fixture_wheel()
FIXTURE_ARTIFACT_HASH = hashlib.sha256(FIXTURE_ARTIFACT).hexdigest()
FIXTURE_ARTIFACT_NAME = "fixture-1.0-py3-none-any.whl"
SETUPTOOLS_ARTIFACT = b"reviewed setuptools wheel"
SETUPTOOLS_ARTIFACT_HASH = hashlib.sha256(SETUPTOOLS_ARTIFACT).hexdigest()
SETUPTOOLS_ARTIFACT_NAME = "setuptools-82.0.1-py3-none-any.whl"


def completed(command: list[str], stdout: str = "", returncode: int = 0) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(command, returncode, stdout, "fixture error" if returncode else "")


def lock_contract(tmp_path: Path, *, version: str = "1.0") -> SimpleNamespace:
    path = tmp_path / "requirements-python311-dev.lock"
    path.write_text(
        f"fixture=={version} --hash=sha256:{FIXTURE_ARTIFACT_HASH}\n",
        encoding="utf-8",
    )
    return SimpleNamespace(
        lock_path=path,
        distributions={"fixture": frozenset({version})},
        hash_verification=True,
        artifacts={
            "fixture": (
                LockedArtifact(
                    FIXTURE_ARTIFACT_NAME,
                    FIXTURE_ARTIFACT_HASH,
                    "wheel",
                ),
            )
        },
        artifact_hashes={"fixture": frozenset({FIXTURE_ARTIFACT_HASH})},
        artifact_files={FIXTURE_ARTIFACT_NAME: FIXTURE_ARTIFACT_HASH},
        build_requirements={},
        content_hash="c" * 64,
        profile="development",
        target={
            "architecture": "arm64",
            "implementation": "CPython",
            "os": "Darwin",
            "pythonVersion": "3.11",
        },
    )


def seed_reviewed_artifacts(component: PythonComponent) -> None:
    directory = component._ensure_artifact_directory()
    (directory / FIXTURE_ARTIFACT_NAME).write_bytes(FIXTURE_ARTIFACT)


def make_python_snapshot(tmp_path: Path) -> Path:
    snapshot = tmp_path / "python-snapshot"
    python = snapshot / "bin" / "python"
    python.parent.mkdir(parents=True)
    python.write_bytes(b"fixture-python")
    metadata = snapshot / "lib" / "python3.11" / "site-packages" / "fixture-1.0.dist-info"
    metadata.mkdir(parents=True)
    (metadata / "METADATA").write_text("Name: fixture\nVersion: 1.0\n", encoding="utf-8")
    (metadata / "RECORD").write_text("fixture.py,,\n", encoding="utf-8")
    (metadata.parent / "fixture.py").write_text("VALUE = 1\n", encoding="utf-8")
    return snapshot


def python_runner(snapshot: Path, *, broken_import: bool = False):
    def run(command: list[str], **_kwargs) -> subprocess.CompletedProcess[str]:
        if "-I" in command:
            assert "-B" in command
        if command[-2:] == ["-m", "pip"]:
            raise AssertionError("unexpected incomplete pip command")
        if "check" in command:
            return completed(command, "No broken requirements found.\n")
        if "list" in command:
            return completed(command, '[{"name":"fixture","version":"1.0"}]\n')
        probe = {
            "implementation": "CPython",
            "version": "3.11.15",
            "prefix": str(snapshot),
            "basePrefix": "/bootstrap",
            "imports": {"fastapi": not broken_import, "pytest": True, "sqlalchemy": True},
        }
        return completed(command, json.dumps(probe))

    return run


def test_broken_python_import_is_detected(tmp_path: Path) -> None:
    snapshot = make_python_snapshot(tmp_path)
    component = PythonComponent(
        tmp_path,
        "a" * 64,
        TOOLCHAIN,
        lock_contract=lock_contract(tmp_path),
        artifact_cache_root=tmp_path / "artifact-cache",
        command_runner=python_runner(snapshot, broken_import=True),
    )

    with pytest.raises(EnvironmentFailure, match="python_critical_import_failed"):
        component.inspect(snapshot)


def test_python_probe_preserves_offline_windows_runtime_environment(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    snapshot = make_python_snapshot(tmp_path)
    monkeypatch.setenv("SYSTEMROOT", r"C:\Windows")
    monkeypatch.setenv("PROCESSOR_ARCHITECTURE", "AMD64")
    captured_environment: dict[str, str] = {}

    def runner(
        command: list[str],
        **kwargs,
    ) -> subprocess.CompletedProcess[str]:
        captured_environment.update(kwargs["env"])
        return python_runner(snapshot)(command)

    component = PythonComponent(
        tmp_path,
        "a" * 64,
        TOOLCHAIN,
        lock_contract=lock_contract(tmp_path),
        artifact_cache_root=tmp_path / "artifact-cache",
        command_runner=runner,
    )

    component._probe(snapshot)

    assert captured_environment["SYSTEMROOT"] == r"C:\Windows"
    assert captured_environment["PROCESSOR_ARCHITECTURE"] == "AMD64"
    assert captured_environment["PIP_NO_INDEX"] == "1"


def test_python_metadata_change_is_detected_against_provenance(tmp_path: Path) -> None:
    snapshot = make_python_snapshot(tmp_path)
    component = PythonComponent(
        tmp_path,
        "a" * 64,
        TOOLCHAIN,
        lock_contract=lock_contract(tmp_path),
        artifact_cache_root=tmp_path / "artifact-cache",
        command_runner=python_runner(snapshot),
    )
    state = component.inspect(snapshot)
    manifest = {"installed": state}
    metadata = next(snapshot.glob("**/*.dist-info/METADATA"))
    metadata.write_text("Name: fixture\nVersion: 2.0\n", encoding="utf-8")

    with pytest.raises(EnvironmentFailure, match="python_installed_identity_mismatch"):
        component.verify(snapshot, manifest)


def test_python_installed_file_change_is_detected_against_provenance(tmp_path: Path) -> None:
    snapshot = make_python_snapshot(tmp_path)
    component = PythonComponent(
        tmp_path,
        "a" * 64,
        TOOLCHAIN,
        lock_contract=lock_contract(tmp_path),
        artifact_cache_root=tmp_path / "artifact-cache",
        command_runner=python_runner(snapshot),
    )
    manifest = {"installed": component.inspect(snapshot)}
    installed_file = next(snapshot.glob("**/site-packages/fixture.py"))
    installed_file.write_text("VALUE = 2\n", encoding="utf-8")

    with pytest.raises(EnvironmentFailure, match="python_installed_identity_mismatch"):
        component.verify(snapshot, manifest)


def test_python_record_normalization_removes_temporary_console_script_hashes(tmp_path: Path) -> None:
    snapshot = make_python_snapshot(tmp_path)
    record = next(snapshot.glob("**/*.dist-info/RECORD"))
    record.write_text(
        "../../../bin/fixture,sha256=random-build-path-hash,123\nfixture.py,sha256=stable,10\n",
        encoding="utf-8",
    )

    _normalize_distribution_records(snapshot)

    assert record.read_text(encoding="utf-8") == (
        "../../../bin/fixture,,\nfixture.py,sha256=stable,10\n"
    )


def test_bootstrap_environment_preserves_windows_architecture_markers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("PROCESSOR_ARCHITECTURE", "AMD64")
    monkeypatch.setenv("PROCESSOR_ARCHITEW6432", "AMD64")

    with _bootstrap_environment(offline=True) as environment:
        assert environment["PROCESSOR_ARCHITECTURE"] == "AMD64"
        assert environment["PROCESSOR_ARCHITEW6432"] == "AMD64"


@pytest.mark.skipif(os.name != "nt", reason="Windows extended-length path semantics")
def test_content_tree_identity_accepts_long_windows_promoted_paths(
    tmp_path: Path,
) -> None:
    relative = (
        Path("Lib")
        / "site-packages"
        / ("nested-" + "a" * 48)
        / ("module-" + "b" * 48 + ".py")
    )
    temporary = tmp_path / "x"
    file_path = temporary / relative
    file_path.parent.mkdir(parents=True)
    file_path.write_bytes(b"reviewed long-path fixture")
    minimum_root_length = 261 - len(str(relative)) - 1
    promoted = tmp_path / (
        "promoted-" + "c" * max(1, minimum_root_length - len(str(tmp_path)) - 10)
    )
    temporary.rename(promoted)
    promoted_file = promoted / relative

    assert len(str(promoted_file)) >= 261
    identity = _content_tree_identity(
        promoted,
        (promoted / "Lib" / "site-packages",),
    )

    assert identity["fileCount"] == 1
    assert identity["totalBytes"] == len(b"reviewed long-path fixture")


def test_python_promotion_rewrites_full_prefix_and_prompt_identity(tmp_path: Path) -> None:
    temporary = make_python_snapshot(tmp_path)
    temporary = temporary.rename(tmp_path / ".build-fixture")
    final = tmp_path / ("f" * 64)
    activate = temporary / "bin" / "activate"
    activate.write_text(f"VIRTUAL_ENV={temporary}\nPROMPT=({temporary.name})\n", encoding="utf-8")
    config = temporary / "pyvenv.cfg"
    config.write_text(f"command = python -m venv {temporary}\n", encoding="utf-8")
    component = PythonComponent(
        tmp_path,
        "a" * 64,
        TOOLCHAIN,
        lock_contract=lock_contract(tmp_path),
        artifact_cache_root=tmp_path / "artifact-cache",
        command_runner=python_runner(temporary),
    )

    component.prepare_promotion(temporary, final)

    assert str(temporary) not in activate.read_text(encoding="utf-8")
    assert temporary.name not in activate.read_text(encoding="utf-8")
    assert str(final) in activate.read_text(encoding="utf-8")
    assert str(final) in config.read_text(encoding="utf-8")


def test_offline_wheel_index_preserves_conflicting_cache_material(tmp_path: Path) -> None:
    cache_prefix = "artifact-cache-"
    padding = max(1, 150 - len(str(tmp_path / cache_prefix)))
    cache = tmp_path / (cache_prefix + "x" * padding)
    contract = lock_contract(tmp_path)
    component = PythonComponent(
        tmp_path,
        "a" * 64,
        TOOLCHAIN,
        lock_contract=contract,
        artifact_cache_root=cache,
        command_runner=lambda command, **_kwargs: completed(command),
    )
    seed_reviewed_artifacts(component)

    canonical = component._artifact_directory()
    canonical_artifact = canonical / FIXTURE_ARTIFACT_NAME
    exposed_view: Path | None = None
    with component._pip_artifact_view(offline=True) as artifact_view:
        exposed_view = artifact_view
        arguments = component._locked_artifact_arguments(artifact_view)
        entries = tuple(artifact_view.iterdir())

        assert canonical == cache / ("c" * 64) / "darwin-arm64-cpython311-development"
        assert arguments == ["--no-index", "--find-links", str(artifact_view)]
        assert artifact_view.parent == cache
        assert artifact_view != _filesystem_path(canonical)
        assert [entry.name for entry in entries] == [FIXTURE_ARTIFACT_NAME]
        assert os.path.samefile(
            _filesystem_path(canonical_artifact),
            _filesystem_path(entries[0]),
        )
        if os.name == "nt":
            assert len(str(canonical_artifact)) >= 260
            assert len(str(artifact_view / FIXTURE_ARTIFACT_NAME)) < 260
            assert not str(artifact_view).startswith("\\\\?\\")

    assert exposed_view is not None
    assert not exposed_view.exists()
    assert _filesystem_path(canonical_artifact).is_file()

    if os.name == "nt":
        commands: list[list[str]] = []

        def real_runner(
            command: list[str],
            **kwargs,
        ) -> subprocess.CompletedProcess[str]:
            commands.append(command)
            return subprocess.run(
                command,
                text=True,
                encoding="utf-8",
                errors="replace",
                capture_output=True,
                check=False,
                timeout=120,
                **kwargs,
            )

        component.command_runner = real_runner
        destination = tmp_path / "real-pip-snapshot"
        component.build(destination, offline=True)

        install = next(command for command in commands if "install" in command)
        install_view = Path(install[install.index("--find-links") + 1])
        assert install_view.parent == cache
        assert install_view != _filesystem_path(canonical)
        assert len(str(install_view / FIXTURE_ARTIFACT_NAME)) < 260
        assert not install_view.exists()
        assert (destination / "Lib" / "site-packages" / "fixture" / "__init__.py").is_file()


@pytest.mark.parametrize("offline", [False, True])
def test_python_build_installs_only_from_selected_hashed_lock(tmp_path: Path, offline: bool) -> None:
    destination = tmp_path / "snapshot"
    cache = tmp_path / "artifact-cache"
    contract = lock_contract(tmp_path)
    commands: list[list[str]] = []
    downloaded_requirements: list[str] = []
    artifact_views: list[Path] = []

    def runner(command: list[str], **_kwargs) -> subprocess.CompletedProcess[str]:
        commands.append(command)
        if command[:4] == [sys.executable, "-I", "-B", "-m"] and "venv" in command:
            python = destination / "bin" / "python"
            python.parent.mkdir(parents=True)
            python.write_bytes(b"fixture-python")
            (destination / "lib" / "python3.11" / "site-packages").mkdir(parents=True)
        if command[-3:] == ["pip", "cache", "dir"]:
            return completed(command, str(cache))
        if "download" in command:
            requirements_path = Path(command[command.index("-r") + 1])
            downloaded_requirements.append(
                requirements_path.read_text(encoding="utf-8")
            )
        if "install" in command:
            artifact_view = Path(command[command.index("--find-links") + 1])
            artifact_views.append(artifact_view)
            assert artifact_view.is_dir()
            assert [path.name for path in artifact_view.iterdir()] == [
                FIXTURE_ARTIFACT_NAME
            ]
        return completed(command)

    component = PythonComponent(
        tmp_path,
        "a" * 64,
        TOOLCHAIN,
        lock_contract=contract,
        artifact_cache_root=cache,
        command_runner=runner,
    )
    seed_reviewed_artifacts(component)
    before = contract.lock_path.read_bytes()

    component.build(destination, offline=offline)

    install = next(command for command in commands if "install" in command)
    downloads = [command for command in commands if "download" in command]
    assert "--require-hashes" in install
    assert "--no-deps" in install
    assert "--no-index" in install
    assert "--find-links" in install
    assert Path(install[install.index("--find-links") + 1]) != _filesystem_path(
        component._artifact_directory()
    )
    assert install[install.index("-r") + 1] == str(contract.lock_path)
    assert len(downloads) == (0 if offline else 1)
    if downloads:
        assert "--require-hashes" in downloads[0]
        assert "--no-deps" in downloads[0]
        assert downloads[0][downloads[0].index("-r") + 1] != str(contract.lock_path)
        assert downloaded_requirements == [
            "fixture==1.0 \\\n"
            f"    --hash=sha256:{FIXTURE_ARTIFACT_HASH}\n"
        ]
    assert "requirements.txt" not in " ".join(install)
    assert "requirements-dev.txt" not in " ".join(install)
    assert contract.lock_path.read_bytes() == before
    assert artifact_views
    assert all(not artifact_view.exists() for artifact_view in artifact_views)


def test_python_installed_distribution_must_match_selected_lock(tmp_path: Path) -> None:
    snapshot = make_python_snapshot(tmp_path)

    def runner(command: list[str], **_kwargs) -> subprocess.CompletedProcess[str]:
        if "check" in command:
            return completed(command, "No broken requirements found.\n")
        if "list" in command:
            return completed(command, '[{"name":"fixture","version":"2.0"}]\n')
        return python_runner(snapshot)(command)

    component = PythonComponent(
        tmp_path,
        "a" * 64,
        TOOLCHAIN,
        lock_contract=lock_contract(tmp_path),
        artifact_cache_root=tmp_path / "artifact-cache",
        command_runner=runner,
    )

    with pytest.raises(EnvironmentFailure) as raised:
        component.inspect(snapshot)

    assert raised.value.code == "python_locked_distribution_mismatch"


@pytest.mark.parametrize("offline", [False, True])
def test_python_artifact_hash_mismatch_is_never_retried_as_resolution(
    tmp_path: Path, offline: bool
) -> None:
    destination = tmp_path / "snapshot"
    cache = tmp_path / "artifact-cache"
    artifact_views: list[Path] = []

    def runner(command: list[str], **_kwargs) -> subprocess.CompletedProcess[str]:
        if "venv" in command:
            python = destination / "bin" / "python"
            python.parent.mkdir(parents=True)
            python.write_bytes(b"fixture-python")
            (destination / "lib" / "python3.11" / "site-packages").mkdir(parents=True)
            return completed(command)
        if command[-3:] == ["pip", "cache", "dir"]:
            return completed(command, str(cache))
        if "install" in command:
            artifact_views.append(Path(command[command.index("--find-links") + 1]))
        return subprocess.CompletedProcess(
            command,
            1,
            "",
            "THESE PACKAGES DO NOT MATCH THE HASHES FROM THE REQUIREMENTS FILE",
        )

    component = PythonComponent(
        tmp_path,
        "a" * 64,
        TOOLCHAIN,
        lock_contract=lock_contract(tmp_path),
        artifact_cache_root=cache,
        command_runner=runner,
    )
    if offline:
        seed_reviewed_artifacts(component)

    with pytest.raises(EnvironmentFailure) as raised:
        component.build(destination, offline=offline)

    assert raised.value.code == "python_locked_artifact_hash_mismatch"
    if offline:
        assert artifact_views
        assert all(not artifact_view.exists() for artifact_view in artifact_views)


def test_missing_offline_locked_artifact_has_bounded_reason(tmp_path: Path) -> None:
    destination = tmp_path / "snapshot"
    cache = tmp_path / "artifact-cache"
    commands: list[list[str]] = []

    def runner(command: list[str], **_kwargs) -> subprocess.CompletedProcess[str]:
        commands.append(command)
        if "venv" in command:
            python = destination / "bin" / "python"
            python.parent.mkdir(parents=True)
            python.write_bytes(b"fixture-python")
            return completed(command)
        if command[-3:] == ["pip", "cache", "dir"]:
            return completed(command, str(cache))
        return subprocess.CompletedProcess(
            command,
            1,
            "",
            "No matching distribution found for fixture==1.0",
        )

    component = PythonComponent(
        tmp_path,
        "a" * 64,
        TOOLCHAIN,
        lock_contract=lock_contract(tmp_path),
        artifact_cache_root=cache,
        command_runner=runner,
    )
    directory = component._artifact_directory()
    assert not directory.exists()

    with pytest.raises(OfflineMaterialUnavailable) as raised:
        component.build(destination, offline=True)

    assert raised.value.code == "offline_python_locked_artifact_missing"
    assert directory.is_dir()
    assert not any("download" in command for command in commands)


def test_locked_setuptools_is_installed_before_source_builds(tmp_path: Path) -> None:
    destination = tmp_path / "snapshot"
    cache = tmp_path / "artifact-cache"
    contract = lock_contract(tmp_path)
    contract.distributions = {
        **contract.distributions,
        "setuptools": frozenset({"82.0.1"}),
    }
    contract.artifact_hashes = {
        **contract.artifact_hashes,
        "setuptools": frozenset({SETUPTOOLS_ARTIFACT_HASH}),
    }
    contract.artifacts = {
        **contract.artifacts,
        "setuptools": (
            LockedArtifact(
                SETUPTOOLS_ARTIFACT_NAME,
                SETUPTOOLS_ARTIFACT_HASH,
                "wheel",
            ),
        ),
    }
    contract.artifact_files = {
        **contract.artifact_files,
        SETUPTOOLS_ARTIFACT_NAME: SETUPTOOLS_ARTIFACT_HASH,
    }
    contract.build_requirements = {"setuptools": "82.0.1"}
    commands: list[list[str]] = []
    backend_requirements = ""

    def runner(command: list[str], **_kwargs) -> subprocess.CompletedProcess[str]:
        nonlocal backend_requirements
        commands.append(command)
        if "venv" in command:
            python = destination / "bin" / "python"
            python.parent.mkdir(parents=True)
            python.write_bytes(b"fixture-python")
            (destination / "lib" / "python3.11" / "site-packages").mkdir(parents=True)
        if "install" in command and "-r" in command:
            requirements = Path(command[command.index("-r") + 1])
            if requirements != contract.lock_path:
                backend_requirements = requirements.read_text(encoding="utf-8")
        return completed(command)

    component = PythonComponent(
        tmp_path,
        "a" * 64,
        TOOLCHAIN,
        lock_contract=contract,
        artifact_cache_root=cache,
        command_runner=runner,
    )
    seed_reviewed_artifacts(component)
    (component._artifact_directory() / SETUPTOOLS_ARTIFACT_NAME).write_bytes(
        SETUPTOOLS_ARTIFACT
    )

    component.build(destination, offline=True)

    backend = next(
        command
        for command in commands
        if "install" in command
        and "-r" in command
        and Path(command[command.index("-r") + 1]) != contract.lock_path
    )
    install = next(
        command
        for command in commands
        if "install" in command
        and "-r" in command
        and Path(command[command.index("-r") + 1]) == contract.lock_path
    )
    assert commands.index(backend) < commands.index(install)
    assert backend_requirements == (
        "setuptools==82.0.1 \\\n"
        f"    --hash=sha256:{SETUPTOOLS_ARTIFACT_HASH}\n"
    )
    assert "--no-deps" in backend
    assert "--require-hashes" in backend
    assert "--no-build-isolation" in backend
    assert "--no-build-isolation" in install
    backend_view = Path(backend[backend.index("--find-links") + 1])
    install_view = Path(install[install.index("--find-links") + 1])
    assert backend_view == install_view
    assert backend_view != _filesystem_path(component._artifact_directory())
    assert not backend_view.exists()


def test_locked_source_build_uses_managed_scripts_on_path(tmp_path: Path) -> None:
    destination = tmp_path / "snapshot"
    contract = lock_contract(tmp_path)
    install_path = ""

    def runner(command: list[str], **kwargs) -> subprocess.CompletedProcess[str]:
        nonlocal install_path
        if "venv" in command:
            python = destination / "bin" / "python"
            python.parent.mkdir(parents=True)
            python.write_bytes(b"fixture-python")
            (destination / "lib" / "python3.11" / "site-packages").mkdir(parents=True)
        if "-r" in command:
            install_path = kwargs["env"]["PATH"]
        return completed(command)

    component = PythonComponent(
        tmp_path,
        "a" * 64,
        TOOLCHAIN,
        lock_contract=contract,
        artifact_cache_root=tmp_path / "artifact-cache",
        command_runner=runner,
    )
    seed_reviewed_artifacts(component)

    component.build(destination, offline=True)

    assert install_path.split(os.pathsep, maxsplit=1)[0] == str(destination / "bin")


def test_tampered_cached_artifact_is_rejected_before_install(tmp_path: Path) -> None:
    destination = tmp_path / "snapshot"
    cache = tmp_path / "artifact-cache"
    contract = lock_contract(tmp_path)

    def runner(command: list[str], **_kwargs) -> subprocess.CompletedProcess[str]:
        if "venv" in command:
            python = destination / "bin" / "python"
            python.parent.mkdir(parents=True)
            python.write_bytes(b"fixture-python")
            (destination / "lib" / "python3.11" / "site-packages").mkdir(parents=True)
        return completed(command)

    component = PythonComponent(
        tmp_path,
        "a" * 64,
        TOOLCHAIN,
        lock_contract=contract,
        artifact_cache_root=cache,
        command_runner=runner,
    )
    directory = component._artifact_directory()
    directory.mkdir(parents=True)
    artifact = directory / "fixture-1.0-py3-none-any.whl"
    artifact.write_bytes(b"tampered")
    assert hashlib.sha256(artifact.read_bytes()).hexdigest() not in contract.artifact_hashes["fixture"]

    with pytest.raises(EnvironmentFailure) as raised:
        component.build(destination, offline=True)

    assert raised.value.code == "python_locked_artifact_hash_mismatch"


def test_missing_reviewed_artifact_is_rejected_before_install(tmp_path: Path) -> None:
    contract = lock_contract(tmp_path)
    component = PythonComponent(
        tmp_path,
        "a" * 64,
        TOOLCHAIN,
        lock_contract=contract,
        artifact_cache_root=tmp_path / "artifact-cache",
        command_runner=lambda command, **_kwargs: completed(command),
    )

    with pytest.raises(EnvironmentFailure) as raised:
        component._verify_artifact_cache()

    assert raised.value.code == "python_locked_artifact_missing"
    assert "fixture" in raised.value.detail
    assert FIXTURE_ARTIFACT_NAME in raised.value.detail


def test_unexpected_cached_artifact_is_rejected(tmp_path: Path) -> None:
    contract = lock_contract(tmp_path)
    component = PythonComponent(
        tmp_path,
        "a" * 64,
        TOOLCHAIN,
        lock_contract=contract,
        artifact_cache_root=tmp_path / "artifact-cache",
        command_runner=lambda command, **_kwargs: completed(command),
    )
    seed_reviewed_artifacts(component)
    unexpected = component._artifact_directory() / "unreviewed-1.0-py3-none-any.whl"
    unexpected.write_bytes(b"unreviewed")

    with pytest.raises(EnvironmentFailure) as raised:
        component._verify_artifact_cache()

    assert raised.value.code == "python_locked_artifact_unexpected"
    assert unexpected.name in raised.value.detail


def test_wrong_cached_artifact_hash_is_rejected(tmp_path: Path) -> None:
    contract = lock_contract(tmp_path)
    component = PythonComponent(
        tmp_path,
        "a" * 64,
        TOOLCHAIN,
        lock_contract=contract,
        artifact_cache_root=tmp_path / "artifact-cache",
        command_runner=lambda command, **_kwargs: completed(command),
    )
    directory = component._artifact_directory()
    directory.mkdir(parents=True)
    (directory / FIXTURE_ARTIFACT_NAME).write_bytes(b"wrong")

    with pytest.raises(EnvironmentFailure) as raised:
        component._verify_artifact_cache()

    assert raised.value.code == "python_locked_artifact_hash_mismatch"
    assert FIXTURE_ARTIFACT_NAME in raised.value.detail


def test_complete_reviewed_artifact_cache_passes_validation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    contract = lock_contract(tmp_path)
    component = PythonComponent(
        tmp_path,
        "a" * 64,
        TOOLCHAIN,
        lock_contract=contract,
        artifact_cache_root=tmp_path / "artifact-cache",
        command_runner=lambda command, **_kwargs: completed(command),
    )
    seed_reviewed_artifacts(component)

    component._verify_artifact_cache()
    with component._pip_artifact_view(offline=True) as artifact_view:
        with component._pip_artifact_view(offline=True) as concurrent_view:
            assert concurrent_view != artifact_view
            assert concurrent_view.parent == artifact_view.parent
        assert not concurrent_view.exists()
        assert [path.name for path in artifact_view.iterdir()] == [
            FIXTURE_ARTIFACT_NAME
        ]
    assert not artifact_view.exists()

    real_link = os.link

    def expose_unexpected(source: Path, destination: Path) -> None:
        real_link(source, destination)
        (Path(destination).parent / "unexpected.whl").write_bytes(b"unexpected")

    monkeypatch.setattr(os, "link", expose_unexpected)
    with pytest.raises(EnvironmentFailure) as raised:
        with component._pip_artifact_view(offline=True):
            pytest.fail("invalid artifact view was exposed")

    assert raised.value.code == "python_locked_artifact_view_invalid"
    assert not list(component.artifact_cache_root.glob("p-*"))

    def reject_link(_source: Path, _destination: Path) -> None:
        raise OSError("hard links unavailable")

    monkeypatch.setattr(os, "link", reject_link)
    with pytest.raises(EnvironmentFailure) as raised:
        with component._pip_artifact_view(offline=True):
            pytest.fail("incomplete artifact view was exposed")

    assert raised.value.code == "python_locked_artifact_view_creation_failed"
    assert not list(component.artifact_cache_root.glob("p-*"))


def test_online_download_uses_marker_free_target_projection(tmp_path: Path) -> None:
    contract = lock_contract(tmp_path)
    contract.lock_path.write_text(
        "fixture==1.0 ; platform_machine == 'AMD64' "
        f"--hash=sha256:{FIXTURE_ARTIFACT_HASH}\n",
        encoding="utf-8",
    )
    projection_suffix = Path("c" * 64) / "darwin-arm64-cpython311-development"
    for existing_directory in (False, True):
        state = "existing" if existing_directory else "absent"
        cache_prefix = f"artifact-cache-{state}-"
        padding = max(
            1,
            220 - len(str(tmp_path / cache_prefix / projection_suffix)),
        )
        cache = tmp_path / (cache_prefix + "x" * padding)
        captured: dict[str, object] = {}
        component = PythonComponent(
            tmp_path,
            "a" * 64,
            TOOLCHAIN,
            lock_contract=contract,
            artifact_cache_root=cache,
            command_runner=lambda command, **_kwargs: completed(command),
        )
        directory = component._artifact_directory()
        if existing_directory:
            seed_reviewed_artifacts(component)
        else:
            assert not directory.exists()

        def runner(command: list[str], **_kwargs) -> subprocess.CompletedProcess[str]:
            requirements_path = Path(command[command.index("-r") + 1])
            destination = Path(command[command.index("--dest") + 1])
            assert requirements_path.is_file()
            assert requirements_path.parent == _filesystem_path(directory)
            assert destination == _filesystem_path(directory)
            captured["requirements"] = requirements_path.read_text(encoding="utf-8")
            captured["requirements_length"] = len(str(requirements_path))
            (destination / FIXTURE_ARTIFACT_NAME).write_bytes(FIXTURE_ARTIFACT)
            return completed(command)

        component.command_runner = runner
        component._download_locked_artifacts(tmp_path / "python")
        component._verify_artifact_cache()

        assert directory.is_dir()
        assert (directory / FIXTURE_ARTIFACT_NAME).read_bytes() == FIXTURE_ARTIFACT
        assert captured["requirements"] == (
            "fixture==1.0 \\\n"
            f"    --hash=sha256:{FIXTURE_ARTIFACT_HASH}\n"
        )
        assert "platform_machine" not in str(captured["requirements"])
        if os.name == "nt":
            assert int(captured["requirements_length"]) >= 260


def test_missing_offline_build_backend_is_an_artifact_miss(tmp_path: Path) -> None:
    destination = tmp_path / "snapshot"
    contract = lock_contract(tmp_path)
    artifact_views: list[Path] = []
    contract.distributions = {
        **contract.distributions,
        "setuptools": frozenset({"82.0.1"}),
    }
    contract.artifact_hashes = {
        **contract.artifact_hashes,
        "setuptools": frozenset({SETUPTOOLS_ARTIFACT_HASH}),
    }
    contract.artifacts = {
        **contract.artifacts,
        "setuptools": (
            LockedArtifact(
                SETUPTOOLS_ARTIFACT_NAME,
                SETUPTOOLS_ARTIFACT_HASH,
                "wheel",
            ),
        ),
    }
    contract.artifact_files = {
        **contract.artifact_files,
        SETUPTOOLS_ARTIFACT_NAME: SETUPTOOLS_ARTIFACT_HASH,
    }
    contract.build_requirements = {"setuptools": "82.0.1"}

    def runner(command: list[str], **_kwargs) -> subprocess.CompletedProcess[str]:
        if "venv" in command:
            python = destination / "bin" / "python"
            python.parent.mkdir(parents=True)
            python.write_bytes(b"fixture-python")
            return completed(command)
        if (
            "install" in command
            and "-r" in command
            and Path(command[command.index("-r") + 1]) != contract.lock_path
        ):
            artifact_view = Path(command[command.index("--find-links") + 1])
            artifact_views.append(artifact_view)
            assert sorted(path.name for path in artifact_view.iterdir()) == sorted(
                (FIXTURE_ARTIFACT_NAME, SETUPTOOLS_ARTIFACT_NAME)
            )
            return subprocess.CompletedProcess(command, 1, "", "No matching distribution found")
        return completed(command)

    component = PythonComponent(
        tmp_path,
        "a" * 64,
        TOOLCHAIN,
        lock_contract=contract,
        artifact_cache_root=tmp_path / "artifact-cache",
        command_runner=runner,
    )
    seed_reviewed_artifacts(component)
    (component._ensure_artifact_directory() / SETUPTOOLS_ARTIFACT_NAME).write_bytes(
        SETUPTOOLS_ARTIFACT
    )

    with pytest.raises(OfflineMaterialUnavailable) as raised:
        component.build(destination, offline=True)

    assert raised.value.code == "offline_python_locked_artifact_missing"
    assert artifact_views
    assert all(not artifact_view.exists() for artifact_view in artifact_views)


def make_web_repo(tmp_path: Path) -> tuple[Path, Path]:
    web = tmp_path / "apps" / "dsa-web"
    web.mkdir(parents=True)
    lock = {
        "name": "fixture",
        "lockfileVersion": 3,
        "packages": {
            "": {"name": "fixture"},
            "node_modules/vite": {"version": "7.0.0"},
            "node_modules/rollup": {"version": "4.0.0"},
        },
    }
    (web / "package-lock.json").write_text(json.dumps(lock), encoding="utf-8")
    (web / "package.json").write_text('{"name":"fixture"}', encoding="utf-8")
    snapshot = tmp_path / "web-snapshot"
    (snapshot / "node_modules").mkdir(parents=True)
    (snapshot / "package-lock.json").write_text(json.dumps(lock), encoding="utf-8")
    (snapshot / "package.json").write_text('{"name":"fixture"}', encoding="utf-8")
    for name, version in (("vite", "7.0.0"), ("rollup", "4.0.0")):
        package = snapshot / "node_modules" / name
        package.mkdir(parents=True)
        (package / "package.json").write_text(json.dumps({"name": name, "version": version}), encoding="utf-8")
        (package / "index.js").write_text(f"export const version = '{version}'\n", encoding="utf-8")
    return tmp_path, snapshot


def test_npm_tree_normalization_preserves_problems_without_snapshot_paths() -> None:
    snapshot = Path(r"C:\wolfy-cache\staging\web-fixture")
    tree = {
        "name": "fixture",
        "problems": [
            f"extraneous: package@1.0.0 {snapshot}\\node_modules\\package",
        ],
    }

    assert _normalize_npm_tree(tree, snapshot) == {
        "name": "fixture",
        "problems": [
            r"extraneous: package@1.0.0 $SNAPSHOT\node_modules\package",
        ],
    }


def test_missing_transitive_web_dependency_is_detected(tmp_path: Path) -> None:
    root, snapshot = make_web_repo(tmp_path)
    (snapshot / "node_modules" / "rollup" / "package.json").unlink()
    component = WebComponent(
        root,
        "b" * 64,
        TOOLCHAIN,
        command_runner=lambda command, **_kwargs: completed(command, '{"dependencies":{}}'),
    )

    with pytest.raises(EnvironmentFailure, match="web_dependency_missing:node_modules/rollup"):
        component.inspect(snapshot)


def test_web_dependency_tree_command_failure_is_rejected(tmp_path: Path) -> None:
    root, snapshot = make_web_repo(tmp_path)
    component = WebComponent(
        root,
        "b" * 64,
        TOOLCHAIN,
        command_runner=lambda command, **_kwargs: completed(command, returncode=1),
    )

    with pytest.raises(EnvironmentFailure, match="web_dependency_tree_invalid"):
        component.inspect(snapshot)


def test_web_installed_file_change_is_detected_against_provenance(tmp_path: Path) -> None:
    root, snapshot = make_web_repo(tmp_path)
    component = WebComponent(
        root,
        "b" * 64,
        TOOLCHAIN,
        command_runner=lambda command, **_kwargs: completed(command, '{"dependencies":{}}'),
    )
    manifest = {"installed": component.inspect(snapshot)}
    (snapshot / "node_modules" / "vite" / "index.js").write_text("corrupt\n", encoding="utf-8")

    with pytest.raises(EnvironmentFailure, match="web_installed_identity_mismatch"):
        component.verify(snapshot, manifest)
