from __future__ import annotations

import json
import os
import shutil
import stat
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from scripts.environment import snapshots
from scripts.environment.errors import EnvironmentFailure, OfflineMaterialUnavailable
from scripts.environment.identity import stable_hash
from scripts.environment.locking import SnapshotLock
from scripts.environment.snapshots import (
    STAGING_MARKER,
    STAGING_SCHEMA,
    ensure_snapshot,
    sweep_interrupted_builds,
    verify_cached_snapshot,
)


@dataclass
class FakeComponent:
    name: str = "python"
    input_fingerprint: str = "a" * 64
    build_count: int = 0
    fail: bool = False
    offline_available: bool = True
    network_builds: int = 0
    corrupt_on_promotion: bool = False
    build_started: threading.Event | None = None
    release_build: threading.Event | None = None
    build_destination: Path | None = None
    immutable: bool = False
    promotion_source: Path | None = None
    promotion_writable: bool | None = None
    verification_paths: list[Path] = field(default_factory=list)
    duplicate_final: bool = False
    nested_payload: Path | None = None

    def build(self, destination: Path, *, offline: bool) -> None:
        self.build_destination = destination
        self.build_count += 1
        if self.build_started:
            self.build_started.set()
        if self.release_build:
            assert self.release_build.wait(timeout=5)
        if offline and not self.offline_available:
            raise OfflineMaterialUnavailable("offline_python_material_unavailable")
        if not offline:
            self.network_builds += 1
        destination.mkdir(parents=True, exist_ok=True)
        (destination / "payload.txt").write_text("verified-content\n", encoding="utf-8")
        if self.nested_payload is not None:
            nested = destination / self.nested_payload
            nested.parent.mkdir(parents=True)
            nested.write_text("long-path-content\n", encoding="utf-8")
        if self.fail:
            raise EnvironmentFailure("fixture_install_failed", "fixture install failed")

    def inspect(self, snapshot: Path) -> dict[str, object]:
        payload = snapshot / "payload.txt"
        if not payload.is_file():
            raise EnvironmentFailure("snapshot_payload_missing", "snapshot payload is missing")
        return {"payload": payload.read_text(encoding="utf-8")}

    def verify(self, snapshot: Path, manifest: dict[str, object]) -> None:
        self.verification_paths.append(snapshot)
        if self.inspect(snapshot) != manifest.get("installed"):
            raise EnvironmentFailure("snapshot_payload_mismatch", "snapshot payload does not match")

    def prepare_promotion(self, temporary: Path, final: Path) -> None:
        self.promotion_source = temporary
        self.promotion_writable = bool(temporary.stat().st_mode & stat.S_IWUSR)
        if self.corrupt_on_promotion:
            (temporary / "payload.txt").write_text("corrupt-after-inspection\n", encoding="utf-8")
        if self.duplicate_final:
            shutil.copytree(temporary, final)


def _windows_filesystem_path(path: Path) -> Path:
    absolute = os.path.abspath(path)
    if absolute.startswith("\\\\?\\"):
        return Path(absolute)
    if absolute.startswith("\\\\"):
        return Path("\\\\?\\UNC\\" + absolute[2:])
    return Path("\\\\?\\" + absolute)


def _remove_windows_test_tree(path: Path) -> None:
    def remove_readonly(function: Any, child: str, _error: object) -> None:
        os.chmod(child, stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)
        function(child)

    filesystem_path = _windows_filesystem_path(path)
    if filesystem_path.exists():
        shutil.rmtree(filesystem_path, onerror=remove_readonly)


def _long_windows_snapshot_relative(cache_root: Path) -> Path:
    promotion = (
        cache_root
        / "snapshots"
        / "python"
        / f".promotion-{'a' * 12}-{'b' * 32}"
    )
    base = Path("Lib") / "site-packages"
    filename = "payload.txt"
    padding = 262 - len(str(promotion / base / filename)) - 1
    relative = base / ("nested-" + "x" * padding) / filename
    assert len(str(promotion / relative)) >= 261
    assert len(str(cache_root / "staging" / ("c" * 32) / relative)) < 260
    return relative


def test_corrupt_provenance_manifest_is_rejected_and_rebuilt(tmp_path: Path) -> None:
    component = FakeComponent()
    first = ensure_snapshot(tmp_path, component, offline=True)
    (first.path / "provenance.json").write_text("{broken", encoding="utf-8")

    second = ensure_snapshot(tmp_path, component, offline=True)

    assert component.build_count == 2
    assert second.path == first.path
    assert verify_cached_snapshot(second.path, component)["installedFingerprint"] == second.installed_fingerprint
    assert any((tmp_path / "quarantine").iterdir())


def test_failed_installation_never_creates_a_valid_final_snapshot(tmp_path: Path) -> None:
    component = FakeComponent(fail=True)

    with pytest.raises(EnvironmentFailure, match="fixture install failed"):
        ensure_snapshot(tmp_path, component, offline=True)

    final_root = tmp_path / "snapshots" / "python"
    assert not list(final_root.glob("*"))


def test_failed_promotion_verification_never_exposes_final_snapshot(tmp_path: Path) -> None:
    component = FakeComponent(corrupt_on_promotion=True)

    with pytest.raises(EnvironmentFailure, match="snapshot payload does not match"):
        ensure_snapshot(tmp_path, component, offline=True)

    final_root = tmp_path / "snapshots" / "python"
    assert not list(final_root.glob("*"))


def test_snapshot_build_uses_short_cache_root_staging_path(tmp_path: Path) -> None:
    component = FakeComponent()

    result = ensure_snapshot(tmp_path, component, offline=True)

    assert component.build_destination is not None
    assert component.build_destination.parent == tmp_path / "staging"
    assert len(component.build_destination.name) == 32
    assert int(component.build_destination.name, 16) >= 0
    assert result.path.parent == tmp_path / "snapshots" / component.name
    assert result.path.name == stable_hash(
        {
            "component": component.name,
            "inputFingerprint": component.input_fingerprint,
            "installedFingerprint": result.installed_fingerprint,
        }
    )


def test_immutable_promotion_moves_writable_staging_then_publishes_same_parent(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    component = FakeComponent(immutable=True)
    rename_calls: list[tuple[Path, Path, int]] = []
    original_rename = Path.rename

    def model_macos_rename(source: Path, target: str | Path) -> Path:
        target_path = Path(target)
        mode = source.stat().st_mode
        if source.is_dir() and source.parent != target_path.parent and not (mode & stat.S_IWUSR):
            raise PermissionError("sealed cross-parent directory move")
        rename_calls.append((source, target_path, mode))
        return original_rename(source, target_path)

    monkeypatch.setattr(Path, "rename", model_macos_rename)

    result = ensure_snapshot(tmp_path, component, offline=True)

    component_root = tmp_path / "snapshots" / component.name
    staging_moves = [call for call in rename_calls if call[0].parent == tmp_path / "staging"]
    assert len(staging_moves) == 1
    staging, promotion, staging_mode = staging_moves[0]
    assert component.promotion_source == staging
    assert component.promotion_writable is True
    assert component.verification_paths[:2] == [staging, staging]
    assert staging_mode & stat.S_IWUSR
    assert promotion.parent == component_root
    assert promotion.name.startswith(".promotion-")

    publication_moves = [call for call in rename_calls if call[1] == result.path]
    assert len(publication_moves) == 1
    published_source, final, published_mode = publication_moves[0]
    assert published_source.parent == final.parent == component_root
    assert not (published_mode & (stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH))
    assert not (result.path.stat().st_mode & (stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH))
    assert not ((result.path / "payload.txt").stat().st_mode & (stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH))
    assert not list(component_root.glob(".promotion-*"))
    if os.name != "nt":
        with pytest.raises(PermissionError):
            (result.path / "payload.txt").write_text("mutation", encoding="utf-8")


@pytest.mark.skipif(os.name != "nt", reason="Windows extended-length path semantics")
def test_windows_long_snapshot_descendant_is_fully_sealed() -> None:
    cache_root = Path(tempfile.mkdtemp(prefix="wsp-"))
    component = FakeComponent(immutable=True)
    component.nested_payload = _long_windows_snapshot_relative(cache_root)
    try:
        result = ensure_snapshot(cache_root, component, offline=True)
        logical_payload = result.path / component.nested_payload
        filesystem_payload = _windows_filesystem_path(logical_payload)

        assert len(str(logical_payload)) >= 261
        assert not str(result.path).startswith("\\\\?\\")
        assert filesystem_payload.is_file()
        assert not (filesystem_payload.stat().st_mode & stat.S_IWRITE)
        assert "\\\\?\\" not in (result.path / "provenance.json").read_text(encoding="utf-8")
        assert verify_cached_snapshot(result.path, component)["installedFingerprint"] == result.installed_fingerprint
    finally:
        _remove_windows_test_tree(cache_root)


@pytest.mark.skipif(os.name != "nt", reason="Windows extended-length path semantics")
def test_windows_verification_rejects_readonly_root_with_writable_long_descendant() -> None:
    cache_root = Path(tempfile.mkdtemp(prefix="wsv-"))
    component = FakeComponent(immutable=True)
    component.nested_payload = _long_windows_snapshot_relative(cache_root)
    try:
        result = ensure_snapshot(cache_root, component, offline=True)
        filesystem_root = _windows_filesystem_path(result.path)
        filesystem_payload = _windows_filesystem_path(result.path / component.nested_payload)
        filesystem_payload.chmod(filesystem_payload.stat().st_mode | stat.S_IWRITE)

        assert not (filesystem_root.stat().st_mode & stat.S_IWRITE)
        assert filesystem_payload.stat().st_mode & stat.S_IWRITE
        with pytest.raises(EnvironmentFailure) as raised:
            verify_cached_snapshot(result.path, component)

        assert raised.value.code == "snapshot_immutability_invalid"
    finally:
        _remove_windows_test_tree(cache_root)


@pytest.mark.skipif(os.name != "nt", reason="Windows extended-length path semantics")
def test_windows_extended_paths_handle_local_and_unc_without_changing_logical_paths() -> None:
    local = Path(r"C:\cache\snapshot")
    unc = Path(r"\\server\share\snapshot")
    extended = Path(r"\\?\C:\cache\snapshot")

    assert snapshots._filesystem_path(local) == extended
    assert snapshots._filesystem_path(unc) == Path(r"\\?\UNC\server\share\snapshot")
    assert snapshots._filesystem_path(extended) == extended


def test_child_sealing_failure_is_fatal_before_publication(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    component = FakeComponent(immutable=True)
    component_root = tmp_path / "snapshots" / component.name
    original_seal_entry = snapshots._seal_snapshot_entry

    def fail_payload_seal(path: Path) -> None:
        if path.name == "payload.txt":
            raise OSError("fixture child sealing failure")
        original_seal_entry(path)

    monkeypatch.setattr(snapshots, "_seal_snapshot_entry", fail_payload_seal)

    with pytest.raises(EnvironmentFailure) as raised:
        ensure_snapshot(tmp_path, component, offline=True)

    assert raised.value.code == "snapshot_sealing_failed"
    assert not list(component_root.glob("[0-9a-f]" * 64))
    assert not list(component_root.glob(".promotion-*"))
    assert any(path.name.startswith("failed-promotion-python-") for path in (tmp_path / "quarantine").iterdir())


def test_stale_hidden_promotion_is_quarantined_before_building_snapshot(tmp_path: Path) -> None:
    component = FakeComponent(name="web", input_fingerprint="b" * 64)
    component_root = tmp_path / "snapshots" / component.name
    interrupted = component_root / f".promotion-{component.input_fingerprint[:12]}-{'c' * 32}"
    interrupted.mkdir(parents=True)
    (interrupted / "partial").write_text("partial", encoding="utf-8")
    old = time.time() - 7200
    os.utime(interrupted, (old, old))
    interrupted.chmod(0o555)

    result = ensure_snapshot(tmp_path, component, offline=True)

    assert result.path.is_dir()
    assert component.build_count == 1
    assert not interrupted.exists()
    assert not list(component_root.glob(".promotion-*"))
    assert any((tmp_path / "quarantine").iterdir())


def test_duplicate_final_is_validated_while_own_promotion_is_quarantined(tmp_path: Path) -> None:
    component = FakeComponent(duplicate_final=True)

    result = ensure_snapshot(tmp_path, component, offline=True)

    component_root = tmp_path / "snapshots" / component.name
    assert verify_cached_snapshot(result.path, component)["installedFingerprint"] == result.installed_fingerprint
    assert not list(component_root.glob(".promotion-*"))
    assert any(path.name.startswith("duplicate-python-") for path in (tmp_path / "quarantine").iterdir())


def test_seal_failure_quarantines_hidden_promotion_without_publishing(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    component = FakeComponent(immutable=True)
    component_root = tmp_path / "snapshots" / component.name

    def fail_seal(path: Path) -> None:
        assert path.parent == component_root
        raise EnvironmentFailure("fixture_seal_failed", "fixture seal failed")

    monkeypatch.setattr(snapshots, "_seal_snapshot", fail_seal)

    with pytest.raises(EnvironmentFailure, match="fixture seal failed"):
        ensure_snapshot(tmp_path, component, offline=True)

    assert not list(component_root.glob("[0-9a-f]" * 64))
    assert not list(component_root.glob(".promotion-*"))
    assert any((tmp_path / "quarantine").iterdir())


def test_final_verification_failure_quarantines_sealed_published_snapshot(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    component = FakeComponent(immutable=True)
    component_root = tmp_path / "snapshots" / component.name
    original_verify = snapshots.verify_cached_snapshot

    def fail_final_verification(snapshot: Path, selected: FakeComponent) -> dict[str, object]:
        if snapshot.parent == component_root and len(snapshot.name) == 64:
            raise EnvironmentFailure("fixture_final_verification_failed", "fixture final verification failed")
        return original_verify(snapshot, selected)

    monkeypatch.setattr(snapshots, "verify_cached_snapshot", fail_final_verification)

    with pytest.raises(EnvironmentFailure, match="fixture final verification failed"):
        ensure_snapshot(tmp_path, component, offline=True)

    assert not list(component_root.glob("[0-9a-f]" * 64))
    assert not list(component_root.glob(".promotion-*"))
    assert any((tmp_path / "quarantine").iterdir())


def test_snapshots_for_distinct_input_fingerprints_coexist(tmp_path: Path) -> None:
    first_component = FakeComponent(input_fingerprint="a" * 64)
    second_component = FakeComponent(input_fingerprint="b" * 64)

    first = ensure_snapshot(tmp_path, first_component, offline=True)
    second = ensure_snapshot(tmp_path, second_component, offline=True)
    reused_first = ensure_snapshot(tmp_path, first_component, offline=True)

    assert first.path != second.path
    assert first.path.is_dir()
    assert second.path.is_dir()
    assert reused_first.path == first.path
    assert reused_first.reused is True
    assert first_component.build_count == 1


def test_non_python_snapshots_also_use_short_staging_and_compact_address(
    tmp_path: Path,
) -> None:
    component = FakeComponent(name="web")

    result = ensure_snapshot(tmp_path, component, offline=True)

    assert component.build_destination is not None
    assert component.build_destination.parent == tmp_path / "staging"
    assert len(component.build_destination.name) == 32
    assert int(component.build_destination.name, 16) >= 0
    assert result.path.parent == tmp_path / "snapshots" / component.name
    assert result.path.name == stable_hash(
        {
            "component": component.name,
            "inputFingerprint": component.input_fingerprint,
            "installedFingerprint": result.installed_fingerprint,
        }
    )


@pytest.mark.skipif(os.name == "nt", reason="POSIX snapshot permissions")
def test_writable_cached_snapshot_is_not_accepted_as_immutable(tmp_path: Path) -> None:
    component = FakeComponent()
    component.immutable = True
    result = ensure_snapshot(tmp_path, component, offline=True)
    payload = result.path / "payload.txt"
    payload.chmod(0o600)

    with pytest.raises(EnvironmentFailure) as raised:
        verify_cached_snapshot(result.path, component)

    assert raised.value.code == "snapshot_immutability_invalid"


def test_interrupted_temporary_build_is_quarantined_and_ignored(tmp_path: Path) -> None:
    staging_root = tmp_path / "staging"
    interrupted = staging_root / ("c" * 32)
    interrupted.mkdir(parents=True)
    (interrupted / STAGING_MARKER).write_text(
        json.dumps(
            {
                "schemaVersion": STAGING_SCHEMA,
                "component": "web",
                "inputFingerprint": "b" * 64,
            }
        ),
        encoding="utf-8",
    )
    (interrupted / "partial").write_text("partial", encoding="utf-8")
    old = time.time() - 7200
    os.utime(interrupted, (old, old))

    swept = sweep_interrupted_builds(tmp_path, "web", "b" * 64, older_than_seconds=60)

    assert swept == 1
    assert not interrupted.exists()
    assert any((tmp_path / "quarantine").iterdir())


def test_two_concurrent_ensure_operations_converge_on_one_snapshot(tmp_path: Path) -> None:
    started = threading.Event()
    release = threading.Event()
    component = FakeComponent(build_started=started, release_build=release)
    results = []
    errors = []

    def worker() -> None:
        try:
            results.append(ensure_snapshot(tmp_path, component, offline=True, lock_timeout=5))
        except Exception as exc:  # pragma: no cover - assertion reports unexpected thread errors
            errors.append(exc)

    first = threading.Thread(target=worker)
    second = threading.Thread(target=worker)
    first.start()
    assert started.wait(timeout=2)
    second.start()
    release.set()
    first.join(timeout=5)
    second.join(timeout=5)

    assert not errors
    assert component.build_count == 1
    assert len(results) == 2
    assert results[0].path == results[1].path


def test_active_lock_is_not_stolen(tmp_path: Path) -> None:
    lock_path = tmp_path / "active.lock"
    first = SnapshotLock(lock_path, timeout=0.1, stale_after=0.0)
    first.acquire()
    try:
        with pytest.raises(EnvironmentFailure, match="lock_wait_timeout"):
            SnapshotLock(lock_path, timeout=0.05, stale_after=0.0).acquire()
        owner = json.loads((lock_path / "owner.json").read_text(encoding="utf-8"))
        assert owner["pid"] == os.getpid()
        assert "hostname" not in owner
        assert len(owner["hostId"]) == 64
    finally:
        first.release()


def test_stale_dead_owner_lock_is_recovered(tmp_path: Path) -> None:
    lock_path = tmp_path / "stale.lock"
    lock_path.mkdir()
    contender = SnapshotLock(lock_path, hostname="fixture-host")
    (lock_path / "owner.json").write_text(
        json.dumps({"pid": 99999999, "hostId": contender.host_id, "token": "old", "createdEpoch": 1}),
        encoding="utf-8",
    )

    lock = SnapshotLock(
        lock_path,
        timeout=0.2,
        stale_after=1,
        hostname="fixture-host",
        clock=lambda: 1000.0,
        pid_alive=lambda _pid: False,
    )
    lock.acquire()
    try:
        owner = json.loads((lock_path / "owner.json").read_text(encoding="utf-8"))
        assert owner["token"] != "old"
    finally:
        lock.release()


def test_offline_ensure_never_uses_online_builder(tmp_path: Path) -> None:
    component = FakeComponent(offline_available=False)

    with pytest.raises(OfflineMaterialUnavailable, match="offline_python_material_unavailable"):
        ensure_snapshot(tmp_path, component, offline=True)

    assert component.network_builds == 0


def test_online_ensure_reports_network_use_only_after_offline_material_miss(tmp_path: Path) -> None:
    component = FakeComponent(offline_available=False)

    result = ensure_snapshot(tmp_path, component, offline=False)

    assert result.network_used is True
    assert component.network_builds == 1
    assert component.build_count == 2
