from __future__ import annotations

import json
import os
import shutil
import stat
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from .errors import EnvironmentFailure, OfflineMaterialUnavailable
from .identity import stable_hash
from .locking import SnapshotLock


SNAPSHOT_SCHEMA = "wolfystock_dependency_snapshot_v1"
STAGING_SCHEMA = "wolfystock_dependency_staging_v1"
STAGING_MARKER = ".wolfy-build.json"
PROMOTION_PREFIX = ".promotion-"


class SnapshotComponent(Protocol):
    name: str
    input_fingerprint: str

    def build(self, destination: Path, *, offline: bool) -> None:
        ...

    def inspect(self, snapshot: Path) -> dict[str, object]:
        ...

    def verify(self, snapshot: Path, manifest: dict[str, object]) -> None:
        ...

    def prepare_promotion(self, temporary: Path, final: Path) -> None:
        ...


@dataclass(frozen=True)
class SnapshotResult:
    component: str
    path: Path
    input_fingerprint: str
    installed_fingerprint: str
    network_used: bool
    reused: bool


def _snapshot_fingerprint(
    component: str,
    input_fingerprint: str,
    installed_fingerprint: str,
) -> str:
    return stable_hash(
        {
            "component": component,
            "inputFingerprint": input_fingerprint,
            "installedFingerprint": installed_fingerprint,
        }
    )


def _write_json(path: Path, payload: dict[str, object]) -> None:
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def _filesystem_path(path: Path) -> Path:
    if os.name != "nt":
        return path
    absolute = os.path.abspath(path)
    if absolute.startswith("\\\\?\\"):
        return Path(absolute)
    if absolute.startswith("\\\\"):
        return Path("\\\\?\\UNC\\" + absolute[2:])
    return Path("\\\\?\\" + absolute)


def _quarantine(cache_root: Path, path: Path, label: str) -> Path:
    quarantine = cache_root / "quarantine"
    quarantine.mkdir(parents=True, exist_ok=True)
    target = quarantine / f"{label}-{int(time.time())}-{uuid.uuid4().hex}"
    _make_directory_writable_for_move(path)
    path.rename(target)
    retained = sorted(quarantine.iterdir(), key=lambda item: item.stat().st_mtime, reverse=True)
    for expired in retained[8:]:
        if expired.is_dir() and not expired.is_symlink():
            shutil.rmtree(expired, onerror=_remove_readonly)
        else:
            expired.unlink(missing_ok=True)
    return target


def _make_directory_writable_for_move(path: Path) -> None:
    if path.is_symlink() or not path.is_dir():
        return
    try:
        mode = path.stat().st_mode
        if mode & stat.S_IWUSR:
            return
        path.chmod(mode | stat.S_IWUSR | stat.S_IXUSR)
    except OSError as exc:
        raise EnvironmentFailure(
            "snapshot_quarantine_failed", "unable to prepare dependency snapshot for quarantine"
        ) from exc


def _remove_readonly(function: Any, path: str, _error: object) -> None:
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)
    function(path)


def verify_cached_snapshot(snapshot: Path, component: SnapshotComponent) -> dict[str, Any]:
    manifest_path = snapshot / "provenance.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise EnvironmentFailure("snapshot_provenance_invalid", "snapshot provenance manifest is invalid") from exc
    if not isinstance(manifest, dict):
        raise EnvironmentFailure("snapshot_provenance_invalid", "snapshot provenance manifest is invalid")
    if (
        manifest.get("schemaVersion") != SNAPSHOT_SCHEMA
        or manifest.get("component") != component.name
        or manifest.get("inputFingerprint") != component.input_fingerprint
        or not isinstance(manifest.get("installed"), dict)
    ):
        raise EnvironmentFailure("snapshot_provenance_mismatch", "snapshot provenance manifest does not match")
    installed_fingerprint = stable_hash(manifest["installed"])
    snapshot_fingerprint = _snapshot_fingerprint(
        component.name,
        component.input_fingerprint,
        installed_fingerprint,
    )
    if (
        manifest.get("installedFingerprint") != installed_fingerprint
        or snapshot.name != snapshot_fingerprint
    ):
        raise EnvironmentFailure("snapshot_provenance_mismatch", "snapshot installed fingerprint does not match")
    component.verify(snapshot, manifest)
    if bool(getattr(component, "immutable", False)):
        filesystem_snapshot = _filesystem_path(snapshot)
        try:
            items = (filesystem_snapshot, *filesystem_snapshot.rglob("*"))
            for item in items:
                if item.is_symlink():
                    continue
                writable = item.stat().st_mode & (stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH)
                if writable:
                    raise EnvironmentFailure("snapshot_immutability_invalid", "dependency snapshot is writable")
        except OSError as exc:
            raise EnvironmentFailure("snapshot_immutability_invalid", "snapshot immutability check failed") from exc
    return manifest


def sweep_interrupted_builds(
    cache_root: Path,
    component_name: str,
    input_fingerprint: str,
    *,
    older_than_seconds: float = 1800.0,
) -> int:
    staging_root = cache_root / "staging"
    if not staging_root.is_dir():
        return 0
    now = time.time()
    swept = 0
    legacy_prefix = f"{component_name}-{input_fingerprint[:12]}-"
    for path in staging_root.iterdir():
        if not path.is_dir():
            continue
        marker_matches = False
        try:
            marker = json.loads((path / STAGING_MARKER).read_text(encoding="utf-8"))
            marker_matches = (
                isinstance(marker, dict)
                and marker.get("schemaVersion") == STAGING_SCHEMA
                and marker.get("component") == component_name
                and marker.get("inputFingerprint") == input_fingerprint
            )
        except (OSError, json.JSONDecodeError):
            pass
        if not marker_matches and not path.name.startswith(legacy_prefix):
            continue
        try:
            old = now - path.stat().st_mtime > older_than_seconds
        except OSError as exc:
            raise EnvironmentFailure("snapshot_sealing_failed", "unable to seal dependency snapshot") from exc
        if old:
            try:
                _quarantine(cache_root, path, f"interrupted-{component_name}")
            except FileNotFoundError:
                continue
            swept += 1
    return swept


def _promotion_prefix(input_fingerprint: str) -> str:
    return f"{PROMOTION_PREFIX}{input_fingerprint[:12]}-"


def _promotion_path(component_root: Path, input_fingerprint: str) -> Path:
    promotion = component_root / f"{_promotion_prefix(input_fingerprint)}{uuid.uuid4().hex}"
    if promotion.exists():
        raise EnvironmentFailure(
            "snapshot_promotion_collision", "dependency snapshot promotion path already exists"
        )
    return promotion


def _is_promotion_directory(path: Path, input_fingerprint: str) -> bool:
    identifier = path.name.removeprefix(_promotion_prefix(input_fingerprint))
    return (
        path.name.startswith(_promotion_prefix(input_fingerprint))
        and len(identifier) == 32
        and all(character in "0123456789abcdef" for character in identifier)
    )


def sweep_interrupted_promotions(
    cache_root: Path,
    component_root: Path,
    component_name: str,
    input_fingerprint: str,
    *,
    older_than_seconds: float = 1800.0,
) -> int:
    if not component_root.is_dir():
        return 0
    now = time.time()
    swept = 0
    for path in component_root.iterdir():
        if not path.is_dir() or not _is_promotion_directory(path, input_fingerprint):
            continue
        try:
            old = now - path.stat().st_mtime > older_than_seconds
        except OSError as exc:
            raise EnvironmentFailure(
                "snapshot_promotion_cleanup_failed", "unable to inspect dependency snapshot promotion"
            ) from exc
        if old:
            try:
                _quarantine(cache_root, path, f"interrupted-promotion-{component_name}")
            except FileNotFoundError:
                continue
            swept += 1
    return swept


def _valid_existing(cache_root: Path, component_root: Path, component: SnapshotComponent) -> SnapshotResult | None:
    for candidate in sorted(component_root.iterdir() if component_root.is_dir() else ()):
        if not candidate.is_dir() or candidate.name.startswith(".") or len(candidate.name) != 64:
            continue
        try:
            candidate_manifest = json.loads(
                (candidate / "provenance.json").read_text(encoding="utf-8")
            )
        except (OSError, json.JSONDecodeError):
            candidate_manifest = None
        if (
            isinstance(candidate_manifest, dict)
            and candidate_manifest.get("schemaVersion") == SNAPSHOT_SCHEMA
            and candidate_manifest.get("component") == component.name
            and candidate_manifest.get("inputFingerprint") != component.input_fingerprint
        ):
            continue
        try:
            manifest = verify_cached_snapshot(candidate, component)
        except EnvironmentFailure:
            _quarantine(cache_root, candidate, f"corrupt-{component.name}")
            continue
        return SnapshotResult(
            component=component.name,
            path=candidate,
            input_fingerprint=component.input_fingerprint,
            installed_fingerprint=str(manifest["installedFingerprint"]),
            network_used=False,
            reused=True,
        )
    return None


def _build_once(
    cache_root: Path,
    component: SnapshotComponent,
    *,
    offline: bool,
) -> tuple[Path, dict[str, object]]:
    staging_root = cache_root / "staging"
    staging_root.mkdir(parents=True, exist_ok=True)
    temporary = staging_root / uuid.uuid4().hex
    temporary.mkdir()
    _write_json(
        temporary / STAGING_MARKER,
        {
            "schemaVersion": STAGING_SCHEMA,
            "component": component.name,
            "inputFingerprint": component.input_fingerprint,
        },
    )
    try:
        component.build(temporary, offline=offline)
        (temporary / STAGING_MARKER).unlink(missing_ok=True)
        installed = component.inspect(temporary)
        installed_fingerprint = stable_hash(installed)
        manifest: dict[str, object] = {
            "schemaVersion": SNAPSHOT_SCHEMA,
            "component": component.name,
            "inputFingerprint": component.input_fingerprint,
            "installedFingerprint": installed_fingerprint,
            "installed": installed,
        }
        _write_json(temporary / "provenance.json", manifest)
        component.verify(temporary, manifest)
        return temporary, manifest
    except Exception:
        if temporary.exists():
            _quarantine(cache_root, temporary, f"failed-{component.name}")
        raise


def _seal_snapshot_entry(path: Path) -> None:
    if path.is_symlink():
        return
    mode = path.stat().st_mode
    path.chmod(mode & ~stat.S_IWUSR & ~stat.S_IWGRP & ~stat.S_IWOTH)


def _seal_snapshot(path: Path) -> None:
    try:
        filesystem_path = _filesystem_path(path)
        for item in sorted(filesystem_path.rglob("*"), reverse=True):
            _seal_snapshot_entry(item)
        _seal_snapshot_entry(filesystem_path)
    except OSError as exc:
        raise EnvironmentFailure("snapshot_sealing_failed", "unable to seal dependency snapshot") from exc


def ensure_snapshot(
    cache_root: Path,
    component: SnapshotComponent,
    *,
    offline: bool,
    lock_timeout: float = 120.0,
) -> SnapshotResult:
    component_root = cache_root / "snapshots" / component.name
    component_root.mkdir(parents=True, exist_ok=True)
    sweep_interrupted_builds(cache_root, component.name, component.input_fingerprint)
    lock = SnapshotLock(
        cache_root / "locks" / f"{component.name}-{component.input_fingerprint}.lock",
        timeout=lock_timeout,
    )
    with lock:
        sweep_interrupted_promotions(
            cache_root,
            component_root,
            component.name,
            component.input_fingerprint,
        )
        existing = _valid_existing(cache_root, component_root, component)
        if existing:
            return existing
        network_used = False
        if offline:
            temporary, manifest = _build_once(cache_root, component, offline=True)
        else:
            try:
                temporary, manifest = _build_once(cache_root, component, offline=True)
            except OfflineMaterialUnavailable:
                temporary, manifest = _build_once(cache_root, component, offline=False)
                network_used = True
        installed_fingerprint = str(manifest["installedFingerprint"])
        final = component_root / _snapshot_fingerprint(
            component.name,
            component.input_fingerprint,
            installed_fingerprint,
        )
        promotion: Path | None = None
        published = False
        duplicate = False
        try:
            component.prepare_promotion(temporary, final)
            component.verify(temporary, manifest)
            promotion = _promotion_path(component_root, component.input_fingerprint)
            temporary.rename(promotion)
            temporary = None
            if bool(getattr(component, "immutable", False)):
                _seal_snapshot(promotion)
            if final.exists():
                duplicate_promotion = promotion
                promotion = None
                _quarantine(cache_root, duplicate_promotion, f"duplicate-{component.name}")
                duplicate = True
            else:
                promotion.rename(final)
                promotion = None
                published = True
            verify_cached_snapshot(final, component)
        except Exception:
            if temporary is not None and temporary.exists():
                _quarantine(cache_root, temporary, f"failed-promotion-{component.name}")
            if promotion is not None and promotion.exists():
                _quarantine(cache_root, promotion, f"failed-promotion-{component.name}")
            if (published or duplicate) and final.exists():
                _quarantine(cache_root, final, f"failed-final-{component.name}")
            raise
        return SnapshotResult(
            component=component.name,
            path=final,
            input_fingerprint=component.input_fingerprint,
            installed_fingerprint=installed_fingerprint,
            network_used=network_used,
            reused=False,
        )
