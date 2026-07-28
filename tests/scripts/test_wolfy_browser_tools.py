from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import subprocess
import threading
import time
import zipfile
from pathlib import Path

import pytest

from scripts.environment.browser import BrowserComponent, load_browser_contract
from scripts.environment.errors import EnvironmentFailure, OfflineMaterialUnavailable
from scripts.environment.identity import ToolchainIdentity
from scripts.environment.managed_tools import (
    ManagedRgComponent,
    ManagedRgContract,
    ManagedUvComponent,
    ManagedUvContract,
    load_managed_rg_contract,
    load_managed_uv_contract,
    qualify_windows_git,
    verify_windows_git,
)
from scripts.environment.runtime import cleanup_run, create_run_context
from scripts.environment.snapshots import ensure_snapshot, sweep_interrupted_builds


TOOLCHAIN = ToolchainIdentity(
    os_name="Darwin",
    architecture="arm64",
    python_implementation="CPython",
    python_version="3.11.15",
    node_version="20.20.2",
    npm_version="10.8.2",
    install_mode="pip-hash-lock+npm-ci",
)
WINDOWS_AMD64_TOOLCHAIN = ToolchainIdentity(
    os_name="Windows",
    architecture="AMD64",
    python_implementation="CPython",
    python_version="3.11.15",
    node_version="20.20.2",
    npm_version="10.8.2",
    install_mode="pip-hash-lock+npm-ci",
)


def completed(
    command: list[str], stdout: str = "", returncode: int = 0
) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(command, returncode, stdout, "fixture error" if returncode else "")


def make_web_snapshot(tmp_path: Path, *, revision: str = "1208") -> Path:
    snapshot = tmp_path / "web-snapshot"
    core = snapshot / "node_modules" / "playwright-core"
    playwright = snapshot / "node_modules" / "playwright"
    core.mkdir(parents=True)
    playwright.mkdir(parents=True)
    (core / "package.json").write_text(json.dumps({"version": "1.58.2"}), encoding="utf-8")
    (core / "browsers.json").write_text(
        json.dumps(
            {
                "browsers": [
                    {
                        "name": "chromium",
                        "revision": revision,
                        "installByDefault": True,
                        "browserVersion": "145.0.7632.6",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    (core / "cli.js").write_text("// fixture\n", encoding="utf-8")
    (playwright / "index.js").write_text("// fixture\n", encoding="utf-8")
    return snapshot


def make_browser_executable(snapshot: Path, *, revision: str = "1208") -> Path:
    executable = snapshot / f"chromium-{revision}" / "chrome-mac-arm64" / "chrome"
    executable.parent.mkdir(parents=True, exist_ok=True)
    if not executable.exists():
        executable.write_bytes(b"reviewed-chromium-executable")
        executable.chmod(0o700)
    return executable


def make_node_executable(tmp_path: Path) -> Path:
    executable = tmp_path / "managed" / "node"
    executable.parent.mkdir(parents=True, exist_ok=True)
    executable.write_text("node\n", encoding="utf-8")
    executable.chmod(0o700)
    return executable


def browser_runner(commands: list[list[str]]):
    def run(command: list[str], **kwargs) -> subprocess.CompletedProcess[str]:
        commands.append(command)
        browser_root = Path(kwargs["env"]["PLAYWRIGHT_BROWSERS_PATH"])
        if command[-2:] == ["install", "chromium"]:
            make_browser_executable(browser_root)
            return completed(command)
        executable = make_browser_executable(browser_root)
        return completed(
            command,
            json.dumps(
                {
                    "browserVersion": "145.0.7632.6",
                    "executablePath": str(executable),
                    "launchVerified": True,
                }
            ),
        )

    return run


def test_browser_contract_is_derived_from_reviewed_web_dependency_graph(tmp_path: Path) -> None:
    web_snapshot = make_web_snapshot(tmp_path)

    contract = load_browser_contract(web_snapshot, "a" * 64, TOOLCHAIN)

    assert contract.family == "chromium"
    assert contract.revision == "1208"
    assert contract.browser_version == "145.0.7632.6"
    assert contract.playwright_version == "1.58.2"
    assert contract.platform == "darwin-arm64"
    assert len(contract.input_fingerprint) == 64


def test_missing_browser_cannot_be_silently_skipped_offline(tmp_path: Path) -> None:
    component = BrowserComponent(
        make_web_snapshot(tmp_path),
        "a" * 64,
        TOOLCHAIN,
        node_executable=make_node_executable(tmp_path),
        command_runner=lambda command, **_kwargs: completed(command),
    )

    with pytest.raises(OfflineMaterialUnavailable) as raised:
        component.build(tmp_path / "browser", offline=True)

    assert raised.value.code == "offline_browser_snapshot_missing"


def test_online_browser_install_uses_reviewed_playwright_cli_and_launches_exact_revision(
    tmp_path: Path,
) -> None:
    commands: list[list[str]] = []
    web_snapshot = make_web_snapshot(tmp_path)
    destination = tmp_path / "browser"
    node_executable = make_node_executable(tmp_path)
    component = BrowserComponent(
        web_snapshot,
        "a" * 64,
        TOOLCHAIN,
        node_executable=node_executable,
        command_runner=browser_runner(commands),
    )

    component.build(destination, offline=False)
    installed = component.inspect(destination)

    assert commands[0] == [
        str(node_executable),
        str(web_snapshot / "node_modules" / "playwright-core" / "cli.js"),
        "install",
        "chromium",
    ]
    assert installed["family"] == "chromium"
    assert installed["revision"] == "1208"
    assert installed["platform"] == "darwin-arm64"
    assert installed["browserVersion"] == "145.0.7632.6"
    assert installed["launchVerified"] is True
    assert installed["executable"] == "chromium-1208/chrome-mac-arm64/chrome"
    assert installed["executableSha256"] == hashlib.sha256(
        b"reviewed-chromium-executable"
    ).hexdigest()
    assert str(tmp_path) not in json.dumps(installed, sort_keys=True)


def test_browser_snapshot_rejects_wrong_revision_even_when_executable_launches(tmp_path: Path) -> None:
    destination = tmp_path / "browser"
    wrong = make_browser_executable(destination, revision="1207")
    component = BrowserComponent(
        make_web_snapshot(tmp_path),
        "a" * 64,
        TOOLCHAIN,
        node_executable=make_node_executable(tmp_path),
        command_runner=lambda command, **_kwargs: completed(
            command,
            json.dumps(
                {
                    "browserVersion": "145.0.7632.6",
                    "executablePath": str(wrong),
                    "launchVerified": True,
                }
            ),
        ),
    )

    with pytest.raises(EnvironmentFailure) as raised:
        component.inspect(destination)

    assert raised.value.code == "browser_revision_mismatch"


def test_concurrent_browser_provisioning_builds_once_and_survives_interrupted_staging(
    tmp_path: Path,
) -> None:
    web_snapshot = make_web_snapshot(tmp_path)
    started = threading.Event()
    release = threading.Event()
    install_count = 0

    def runner(command: list[str], **kwargs) -> subprocess.CompletedProcess[str]:
        nonlocal install_count
        root = Path(kwargs["env"]["PLAYWRIGHT_BROWSERS_PATH"])
        if command[-2:] == ["install", "chromium"]:
            install_count += 1
            started.set()
            assert release.wait(timeout=5)
            make_browser_executable(root)
            return completed(command)
        executable = make_browser_executable(root)
        return completed(
            command,
            json.dumps(
                {
                    "browserVersion": "145.0.7632.6",
                    "executablePath": str(executable),
                    "launchVerified": True,
                }
            ),
        )

    component = BrowserComponent(
        web_snapshot,
        "a" * 64,
        TOOLCHAIN,
        node_executable=make_node_executable(tmp_path),
        command_runner=runner,
    )
    staging_root = tmp_path / "staging"
    interrupted = (
        staging_root / f"browser-{component.input_fingerprint[:12]}-interrupted"
    )
    interrupted.mkdir(parents=True)
    old = time.time() - 7200
    os.utime(interrupted, (old, old))
    assert sweep_interrupted_builds(
        tmp_path, "browser", component.input_fingerprint, older_than_seconds=60
    ) == 1
    results: list[Path] = []

    def ensure() -> None:
        results.append(
            ensure_snapshot(tmp_path, component, offline=False, lock_timeout=5).path
        )

    first = threading.Thread(target=ensure)
    second = threading.Thread(target=ensure)
    first.start()
    assert started.wait(timeout=2)
    second.start()
    release.set()
    first.join(timeout=5)
    second.join(timeout=5)

    assert install_count == 1
    assert len(results) == 2
    assert results[0] == results[1]
    assert results[0].is_dir()
    context = create_run_context(tmp_path, run_id="run-browser-cleanup")
    cleanup_run(context, success=True)
    assert results[0].is_dir()


def test_rg_is_copied_to_managed_snapshot_and_verified_by_content_identity(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    reviewed = load_managed_rg_contract(WINDOWS_AMD64_TOOLCHAIN)
    assert reviewed.version == "15.1.0"
    assert reviewed.platform == "windows-x86_64"
    assert (
        reviewed.archive_filename
        == "ripgrep-15.1.0-x86_64-pc-windows-msvc.zip"
    )
    assert (
        reviewed.archive_sha256
        == "124510b94b6baa3380d051fdf4650eaa80a302c876d611e9dba0b2e18d87493a"
    )
    assert reviewed.archive_member.endswith("/rg.exe")
    assert reviewed.download_url == (
        "https://github.com/BurntSushi/ripgrep/releases/download/15.1.0/"
        "ripgrep-15.1.0-x86_64-pc-windows-msvc.zip"
    )

    executable_content = b"reviewed-rg-executable"
    archive_member = "ripgrep-15.1.0-fixture/rg.exe"
    archive_buffer = io.BytesIO()
    with zipfile.ZipFile(archive_buffer, mode="w") as bundle:
        member = zipfile.ZipInfo(archive_member, date_time=(1980, 1, 1, 0, 0, 0))
        bundle.writestr(member, executable_content)
    archive_content = archive_buffer.getvalue()
    fixture_contract = ManagedRgContract(
        version="15.1.0",
        platform="windows-x86_64",
        archive_filename="ripgrep-15.1.0-fixture.zip",
        archive_sha256=hashlib.sha256(archive_content).hexdigest(),
        archive_member=archive_member,
        download_url="https://example.invalid/reviewed/ripgrep-15.1.0-fixture.zip",
    )
    cache_root = tmp_path / "empty-cache"
    source_cache_root = cache_root / "artifacts" / "rg"
    downloads: list[tuple[str, Path]] = []

    def downloader(url: str, destination: Path) -> None:
        downloads.append((url, destination))
        destination.write_bytes(archive_content)

    def reject_host_lookup(*_args: object, **_kwargs: object) -> str:
        raise AssertionError("managed rg must not inspect host PATH")

    monkeypatch.setattr(shutil, "which", reject_host_lookup)
    component = ManagedRgComponent(
        WINDOWS_AMD64_TOOLCHAIN,
        source_cache_root=source_cache_root,
        contract=fixture_contract,
        downloader=downloader,
        command_runner=lambda command, **_kwargs: completed(
            command,
            "ripgrep 15.1.0 (rev af60c2de9d)\n",
        ),
    )
    assert not source_cache_root.exists()

    with pytest.raises(OfflineMaterialUnavailable) as missing:
        component.build(tmp_path / "offline-missing", offline=True)
    assert missing.value.code == "offline_managed_rg_source_missing"
    assert downloads == []

    result = ensure_snapshot(cache_root, component, offline=False)
    assert result.network_used is True
    assert result.reused is False
    assert len(downloads) == 1
    assert downloads[0][0] == fixture_contract.download_url
    assert downloads[0][1].parent == component.source_cache_directory
    assert component.source_archive == (
        source_cache_root
        / fixture_contract.archive_sha256
        / fixture_contract.archive_filename
    )
    assert {
        path.name for path in component.source_cache_directory.iterdir()
    } == {fixture_contract.archive_filename}
    assert hashlib.sha256(component.source_archive.read_bytes()).hexdigest() == (
        fixture_contract.archive_sha256
    )
    assert (result.path / component.executable_name).read_bytes() == executable_content
    provenance = json.loads(
        (result.path / "provenance.json").read_text(encoding="utf-8")
    )
    installed = provenance["installed"]
    assert installed == {
        "executable": component.executable_name,
        "executableSha256": hashlib.sha256(executable_content).hexdigest(),
        "platform": "windows-x86_64",
        "sourceArchive": fixture_contract.archive_filename,
        "sourceSha256": fixture_contract.archive_sha256,
        "version": "15.1.0",
    }
    reused = ensure_snapshot(cache_root, component, offline=True)
    assert reused.path == result.path
    assert reused.reused is True
    assert len(downloads) == 1

    offline_destination = tmp_path / "offline-managed-rg"
    component.build(offline_destination, offline=True)
    assert (
        offline_destination / component.executable_name
    ).read_bytes() == executable_content
    assert len(downloads) == 1

    manifest = {"installed": installed}
    (offline_destination / component.executable_name).write_bytes(b"tampered")
    with pytest.raises(EnvironmentFailure) as raised:
        component.verify(offline_destination, manifest)
    assert raised.value.code == "managed_rg_identity_mismatch"

    unexpected_component = ManagedRgComponent(
        WINDOWS_AMD64_TOOLCHAIN,
        source_cache_root=tmp_path / "unexpected-cache",
        contract=fixture_contract,
        downloader=downloader,
    )
    unexpected_component.source_cache_directory.mkdir(parents=True)
    unexpected_component.source_archive.write_bytes(archive_content)
    (unexpected_component.source_cache_directory / "unexpected.zip").write_bytes(
        archive_content
    )
    with pytest.raises(EnvironmentFailure) as unexpected:
        unexpected_component.build(tmp_path / "unexpected-destination", offline=True)
    assert unexpected.value.code == "managed_rg_source_unexpected"

    invalid_component = ManagedRgComponent(
        WINDOWS_AMD64_TOOLCHAIN,
        source_cache_root=tmp_path / "invalid-cache",
        contract=fixture_contract,
        downloader=downloader,
    )
    invalid_component.source_cache_directory.mkdir(parents=True)
    invalid_component.source_archive.write_bytes(b"hash-invalid")
    with pytest.raises(EnvironmentFailure) as invalid:
        invalid_component.build(tmp_path / "invalid-destination", offline=True)
    assert invalid.value.code == "managed_rg_source_hash_mismatch"


def test_reviewed_uv_resolver_is_materialized_without_host_path_lookup(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    reviewed = load_managed_uv_contract(WINDOWS_AMD64_TOOLCHAIN)
    assert reviewed.version == "0.11.19"
    assert reviewed.platform == "windows-x86_64"
    assert reviewed.archive_filename == "uv-x86_64-pc-windows-msvc.zip"
    assert reviewed.archive_member == "uv.exe"
    assert reviewed.archive_sha256 == (
        "1665fc8e37b5d70a134820d6d7891747471a2ac8bc940ee7af0b69fd03b28d61"
    )
    assert reviewed.download_url == (
        "https://releases.astral.sh/github/uv/releases/download/0.11.19/"
        "uv-x86_64-pc-windows-msvc.zip"
    )

    executable_content = b"reviewed-uv-executable"
    archive_buffer = io.BytesIO()
    with zipfile.ZipFile(archive_buffer, mode="w") as bundle:
        member = zipfile.ZipInfo("uv.exe", date_time=(1980, 1, 1, 0, 0, 0))
        bundle.writestr(member, executable_content)
    archive_content = archive_buffer.getvalue()
    fixture_contract = ManagedUvContract(
        version="0.11.19",
        platform="windows-x86_64",
        archive_filename="uv-x86_64-pc-windows-msvc-fixture.zip",
        archive_sha256=hashlib.sha256(archive_content).hexdigest(),
        archive_member="uv.exe",
        download_url="https://example.invalid/reviewed/uv-0.11.19-fixture.zip",
    )
    cache_root = tmp_path / "empty-cache"
    source_cache_root = cache_root / "artifacts" / "uv"
    downloads: list[tuple[str, Path]] = []
    commands: list[list[str]] = []

    def downloader(url: str, destination: Path) -> None:
        downloads.append((url, destination))
        destination.write_bytes(archive_content)

    def command_runner(
        command: list[str], **_kwargs: object
    ) -> subprocess.CompletedProcess[str]:
        commands.append(command)
        return completed(command, "uv 0.11.19 (reviewed)\n")

    def reject_host_lookup(*_args: object, **_kwargs: object) -> str:
        raise AssertionError("managed uv must not inspect host PATH")

    monkeypatch.setattr(shutil, "which", reject_host_lookup)
    component = ManagedUvComponent(
        WINDOWS_AMD64_TOOLCHAIN,
        source_cache_root=source_cache_root,
        contract=fixture_contract,
        downloader=downloader,
        command_runner=command_runner,
    )

    with pytest.raises(OfflineMaterialUnavailable) as missing:
        component.build(tmp_path / "offline-missing", offline=True)
    assert missing.value.code == "offline_managed_uv_source_missing"
    result = ensure_snapshot(cache_root, component, offline=False)

    assert result.network_used is True
    assert downloads == [(fixture_contract.download_url, downloads[0][1])]
    assert downloads[0][1].parent == component.source_cache_directory
    assert (result.path / "uv.exe").read_bytes() == executable_content
    assert commands
    assert all(Path(command[0]).name == "uv.exe" and command[1:] == ["--version"] for command in commands)
    assert json.loads((result.path / "provenance.json").read_text(encoding="utf-8"))["installed"] == {
        "executable": "uv.exe",
        "executableSha256": hashlib.sha256(executable_content).hexdigest(),
        "platform": "windows-x86_64",
        "sourceArchive": fixture_contract.archive_filename,
        "sourceSha256": fixture_contract.archive_sha256,
        "version": "0.11.19",
    }


def test_windows_git_is_discovered_probed_and_bound_without_exposing_its_path(
    tmp_path: Path,
) -> None:
    executable = tmp_path / "Git" / "cmd" / "git.exe"
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b"reviewed-host-git")
    commands: list[list[str]] = []

    def runner(
        command: list[str], **_kwargs: object
    ) -> subprocess.CompletedProcess[str]:
        commands.append(command)
        return completed(command, "git version 2.54.0.windows.1\n")

    identity = qualify_windows_git(
        WINDOWS_AMD64_TOOLCHAIN,
        executable_finder=lambda name: str(executable) if name == "git.exe" else None,
        command_runner=runner,
    )

    assert identity is not None
    assert identity.executable == executable.resolve(strict=True)
    assert commands == [[str(identity.executable), "--version"]]
    assert identity.evidence() == {
        "executableSha256": hashlib.sha256(b"reviewed-host-git").hexdigest(),
        "resolvedPathSha256": identity.resolved_path_sha256,
        "version": "2.54.0.windows.1",
    }
    assert str(tmp_path) not in json.dumps(identity.evidence(), sort_keys=True)
    assert (
        verify_windows_git(identity, command_runner=runner).evidence()
        == identity.evidence()
    )


def test_windows_git_qualification_fails_closed_for_missing_invalid_or_changed_tool(
    tmp_path: Path,
) -> None:
    with pytest.raises(EnvironmentFailure) as missing:
        qualify_windows_git(
            WINDOWS_AMD64_TOOLCHAIN,
            executable_finder=lambda _name: None,
        )
    assert missing.value.code == "windows_git_missing"

    executable = tmp_path / "git.exe"
    executable.write_bytes(b"git-one")
    with pytest.raises(EnvironmentFailure) as invalid:
        qualify_windows_git(
            WINDOWS_AMD64_TOOLCHAIN,
            executable_finder=lambda name: str(executable) if name == "git.exe" else None,
            command_runner=lambda command, **_kwargs: completed(
                command, "not git\n"
            ),
        )
    assert invalid.value.code == "windows_git_probe_failed"

    identity = qualify_windows_git(
        WINDOWS_AMD64_TOOLCHAIN,
        executable_finder=lambda name: str(executable) if name == "git.exe" else None,
        command_runner=lambda command, **_kwargs: completed(
            command, "git version 2.54.0.windows.1\n"
        ),
    )
    assert identity is not None
    executable.write_bytes(b"git-two")
    with pytest.raises(EnvironmentFailure) as changed:
        verify_windows_git(
            identity,
            command_runner=lambda command, **_kwargs: completed(
                command, "git version 2.54.0.windows.1\n"
            ),
        )
    assert changed.value.code == "windows_git_identity_mismatch"


def test_non_windows_git_qualification_does_not_inspect_host_path() -> None:
    def reject_lookup(_name: str) -> str | None:
        raise AssertionError("non-Windows qualification must not inspect host Git")

    assert qualify_windows_git(TOOLCHAIN, executable_finder=reject_lookup) is None
