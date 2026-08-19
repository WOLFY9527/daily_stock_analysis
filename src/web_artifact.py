"""Shared immutable Web artifact primitives for source and packaged runtimes."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


ARTIFACT_CONTRACT = "wolfystock_web_build_artifact_v1"
ARTIFACT_FILENAME = ".wolfystock-web-build-artifact.json"
LEGACY_BUILD_IDENTITY_FILENAME = ".wolfystock-build-identity.json"
PACKAGE_IDENTITY_CONTRACT = "wolfystock_packaged_web_artifact_v1"
PACKAGE_IDENTITY_FILENAME = ".wolfystock-package-identity.json"
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
HEX_RE = re.compile(r"^[0-9a-f]{64}$")
VITE_ENV_PATHS = (".env", ".env.local", ".env.production", ".env.production.local")


@dataclass(frozen=True)
class ArtifactResult:
    ok: bool
    payload: dict[str, Any]
    error_codes: list[str] = field(default_factory=list)
    warning_codes: list[str] = field(default_factory=list)


def sha256_file(path: Path) -> str | None:
    if not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_digest(payload: Any) -> str:
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def _safe_asset_path(value: Any) -> bool:
    if not isinstance(value, str) or not value or value.startswith("/"):
        return False
    path = Path(value)
    return ".." not in path.parts and path.as_posix() == value


def asset_inventory(static_root: Path) -> list[dict[str, Any]]:
    inventory: list[dict[str, Any]] = []
    for path in sorted(item for item in static_root.rglob("*") if item.is_file() and item.name != ARTIFACT_FILENAME):
        inventory.append(
            {
                "path": path.relative_to(static_root).as_posix(),
                "size": path.stat().st_size,
                "sha256": sha256_file(path),
            }
        )
    return inventory


def index_inventory(index_path: Path) -> dict[str, Any]:
    text = index_path.read_text(encoding="utf-8")
    tags = re.findall(r"<(?:script|link)\b[^>]*>", text, flags=re.IGNORECASE)

    def references(tag: str) -> list[str]:
        return re.findall(r"(?:src|href)=[\"']([^\"']+)[\"']", tag, flags=re.IGNORECASE)

    def asset_references(predicate: Any) -> list[str]:
        return sorted(
            {ref for tag in tags if predicate(tag) for ref in references(tag) if ref.startswith("/assets/")}
        )

    return {
        "indexSha256": sha256_file(index_path),
        "entry": asset_references(lambda tag: tag.lower().startswith("<script")),
        "css": asset_references(lambda tag: bool(re.search(r"rel=[\"']stylesheet[\"']", tag, flags=re.IGNORECASE))),
        "preload": asset_references(
            lambda tag: bool(re.search(r"rel=[\"'](?:modulepreload|preload)[\"']", tag, flags=re.IGNORECASE))
        ),
    }


def _index_references_are_packaged(index: dict[str, Any], static_root: Path) -> bool:
    for section in ("entry", "css", "preload"):
        references = index.get(section)
        if not isinstance(references, list):
            return False
        for reference in references:
            if not isinstance(reference, str) or not reference.startswith("/assets/"):
                return False
            relative = reference.lstrip("/")
            if not _safe_asset_path(relative) or not (static_root / relative).is_file():
                return False
    return True


def source_index_inventory(index_path: Path, web_root: Path) -> dict[str, Any]:
    inventory = index_inventory(index_path)
    inventory["localeSourceFiles"] = sorted(
        path.relative_to(web_root).as_posix() for path in (web_root / "src" / "i18n").rglob("*.ts")
    ) if (web_root / "src" / "i18n").is_dir() else []
    return inventory


def _manifest_provenance_errors(manifest: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    integrity = manifest.get("dependencyIntegrity")
    if not isinstance(integrity, dict) or (
        integrity.get("command") != "npm --prefix apps/dsa-web ls --all --json"
        or integrity.get("valid") is not True
        or not HEX_RE.fullmatch(str(integrity.get("sha256") or ""))
    ):
        errors.append("artifact_provenance_invalid")

    toolchain = manifest.get("toolchain")
    if not isinstance(toolchain, dict) or set(toolchain) != {"node", "npm"} or any(
        not isinstance(toolchain.get(name), str) or not toolchain[name] for name in ("node", "npm")
    ):
        errors.append("artifact_provenance_invalid")

    environment = manifest.get("environment")
    managed = environment.get("managed") if isinstance(environment, dict) else None
    components = managed.get("componentFingerprints") if isinstance(managed, dict) else None
    vite_env_files = environment.get("viteEnvFiles") if isinstance(environment, dict) else None
    vite_resolved_values = environment.get("viteResolvedValues") if isinstance(environment, dict) else None
    if (
        not isinstance(environment, dict)
        or not isinstance(environment.get("buildVariables"), dict)
        or not environment["buildVariables"]
        or any(not isinstance(key, str) or not HEX_RE.fullmatch(str(value or "")) for key, value in environment["buildVariables"].items())
        or not isinstance(managed, dict)
        or not isinstance(managed.get("schemaVersion"), str)
        or not managed["schemaVersion"].strip()
        or not isinstance(managed.get("environmentPolicyVersion"), str)
        or not managed["environmentPolicyVersion"].strip()
        or not HEX_RE.fullmatch(str(managed.get("environmentFingerprint") or ""))
        or not isinstance(components, dict)
        or set(components) != {"python", "web", "browser", "rg"}
    ):
        errors.append("artifact_provenance_invalid")
    elif any(
        not isinstance(components.get(component), dict)
        or any(not HEX_RE.fullmatch(str(components[component].get(field) or "")) for field in ("input", "installed"))
        for component in ("python", "web", "browser", "rg")
    ):
        errors.append("artifact_provenance_invalid")

    if not isinstance(vite_env_files, dict) or set(vite_env_files) != set(VITE_ENV_PATHS):
        errors.append("artifact_provenance_invalid")
    else:
        for source in vite_env_files.values():
            if not isinstance(source, dict) or set(source) != {"present", "sha256"}:
                errors.append("artifact_provenance_invalid")
                break
            present = source.get("present")
            digest = source.get("sha256")
            if not isinstance(present, bool) or (present and not HEX_RE.fullmatch(str(digest or ""))) or (
                not present and digest is not None
            ):
                errors.append("artifact_provenance_invalid")
                break

    if (
        not isinstance(vite_resolved_values, dict)
        or set(vite_resolved_values) != {"mode", "envDirMatchesWebRoot", "values"}
        or vite_resolved_values.get("mode") != "production"
        or vite_resolved_values.get("envDirMatchesWebRoot") is not True
        or not isinstance(vite_resolved_values.get("values"), dict)
        or not vite_resolved_values["values"]
        or any(not isinstance(key, str) or not HEX_RE.fullmatch(str(value or "")) for key, value in vite_resolved_values["values"].items())
    ):
        errors.append("artifact_provenance_invalid")

    commands = manifest.get("commands")
    if (
        not isinstance(commands, list)
        or not commands
        or any(
            not isinstance(command, dict)
            or set(command) != {"command", "exitCode"}
            or not isinstance(command.get("command"), str)
            or not command["command"].strip()
            or command.get("exitCode") != 0
            for command in commands
        )
    ):
        errors.append("artifact_provenance_invalid")
    return sorted(set(errors))


def verify_manifest_contents(
    artifact: Path,
    *,
    expected_candidate: dict[str, Any] | None = None,
    expected_fingerprint: str | None = None,
) -> ArtifactResult:
    try:
        manifest = json.loads(artifact.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return ArtifactResult(False, {}, ["artifact_manifest_unreadable"])
    if not isinstance(manifest, dict) or manifest.get("contract") != ARTIFACT_CONTRACT:
        return ArtifactResult(False, manifest if isinstance(manifest, dict) else {}, ["artifact_contract_mismatch"])

    errors = _manifest_provenance_errors(manifest)
    candidate = manifest.get("candidate")
    if (
        not isinstance(candidate, dict)
        or set(candidate) != {"commit", "tree", "dirty"}
        or not isinstance(candidate.get("commit"), str)
        or not candidate["commit"].strip()
        or not isinstance(candidate.get("tree"), str)
        or not candidate["tree"].strip()
        or candidate.get("dirty") is not False
    ):
        errors.append("artifact_metadata_invalid")
    if expected_candidate is not None and candidate != expected_candidate:
        errors.append("artifact_candidate_mismatch")

    package_lock = manifest.get("packageLock")
    configuration = manifest.get("configuration")
    if (
        not isinstance(package_lock, dict)
        or package_lock.get("path") != "apps/dsa-web/package-lock.json"
        or not HEX_RE.fullmatch(str(package_lock.get("sha256") or ""))
        or not isinstance(configuration, dict)
        or not isinstance(configuration.get("sha256"), dict)
    ):
        errors.append("artifact_metadata_invalid")

    index_path = artifact.parent / "index.html"
    index = manifest.get("index")
    try:
        observed_index = index_inventory(index_path)
        index_matches = (
            isinstance(index, dict)
            and all(index.get(field) == observed_index[field] for field in ("indexSha256", "entry", "css", "preload"))
            and isinstance(index.get("localeSourceFiles"), list)
            and _index_references_are_packaged(observed_index, artifact.parent)
        )
    except (OSError, UnicodeError):
        index_matches = False
    if not index_matches:
        errors.append("artifact_index_mismatch")

    assets = manifest.get("assets")
    assets_valid = isinstance(assets, list) and all(
        isinstance(item, dict)
        and set(item) == {"path", "size", "sha256"}
        and _safe_asset_path(item.get("path"))
        and item.get("path") != ARTIFACT_FILENAME
        and type(item.get("size")) is int
        and item["size"] >= 0
        and HEX_RE.fullmatch(str(item.get("sha256") or ""))
        for item in assets
    )
    try:
        assets_match = assets_valid and assets == asset_inventory(artifact.parent)
    except OSError:
        assets_match = False
    if not assets_match:
        errors.append("artifact_asset_mismatch")

    fingerprint_payload = dict(manifest)
    fingerprint = fingerprint_payload.pop("fingerprint", None)
    if not isinstance(fingerprint, str) or fingerprint != canonical_digest(fingerprint_payload):
        errors.append("artifact_manifest_tampered")
    if expected_fingerprint is not None and fingerprint != expected_fingerprint:
        errors.append("artifact_fingerprint_mismatch")
    return ArtifactResult(not errors, manifest, sorted(set(errors)))


def build_package_identity(manifest: dict[str, Any]) -> dict[str, Any]:
    candidate = manifest.get("candidate")
    if (
        not isinstance(candidate, dict)
        or candidate.get("dirty") is not False
        or not SHA_RE.fullmatch(str(candidate.get("commit") or ""))
        or not SHA_RE.fullmatch(str(candidate.get("tree") or ""))
        or not HEX_RE.fullmatch(str(manifest.get("fingerprint") or ""))
    ):
        raise ValueError("package_identity_source_manifest_invalid")
    payload: dict[str, Any] = {
        "contract": PACKAGE_IDENTITY_CONTRACT,
        "candidate": {"commit": candidate["commit"], "tree": candidate["tree"]},
        "artifact": {
            "path": "static/" + ARTIFACT_FILENAME,
            "contract": ARTIFACT_CONTRACT,
            "fingerprint": manifest["fingerprint"],
        },
    }
    payload["fingerprint"] = canonical_digest(payload)
    return payload


def verify_packaged_artifact(
    package_root: Path | str,
    *,
    expected_sha: str | None = None,
    expected_tree: str | None = None,
    expected_fingerprint: str | None = None,
) -> ArtifactResult:
    root = Path(package_root).resolve()
    identity_path = root / PACKAGE_IDENTITY_FILENAME
    try:
        identity = json.loads(identity_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return ArtifactResult(False, {}, ["package_identity_unreadable"])
    if not isinstance(identity, dict) or identity.get("contract") != PACKAGE_IDENTITY_CONTRACT:
        return ArtifactResult(False, {}, ["package_identity_contract_mismatch"])
    identity_payload = dict(identity)
    fingerprint = identity_payload.pop("fingerprint", None)
    errors: list[str] = []
    if fingerprint != canonical_digest(identity_payload):
        errors.append("package_identity_tampered")
    candidate = identity.get("candidate")
    artifact_identity = identity.get("artifact")
    if (
        not isinstance(candidate, dict)
        or set(candidate) != {"commit", "tree"}
        or not SHA_RE.fullmatch(str(candidate.get("commit") or ""))
        or not SHA_RE.fullmatch(str(candidate.get("tree") or ""))
        or not isinstance(artifact_identity, dict)
        or artifact_identity.get("path") != "static/" + ARTIFACT_FILENAME
        or artifact_identity.get("contract") != ARTIFACT_CONTRACT
        or not HEX_RE.fullmatch(str(artifact_identity.get("fingerprint") or ""))
    ):
        errors.append("package_identity_invalid")
        return ArtifactResult(False, {"packageIdentity": identity}, sorted(set(errors)))
    if expected_sha and candidate["commit"] != expected_sha.strip().lower():
        errors.append("package_candidate_sha_mismatch")
    if expected_tree and candidate["tree"] != expected_tree.strip().lower():
        errors.append("package_candidate_tree_mismatch")
    if expected_fingerprint and artifact_identity["fingerprint"] != expected_fingerprint.strip().lower():
        errors.append("package_artifact_fingerprint_mismatch")

    artifact = root / "static" / ARTIFACT_FILENAME
    immutable = verify_manifest_contents(
        artifact,
        expected_candidate={"commit": candidate["commit"], "tree": candidate["tree"], "dirty": False},
        expected_fingerprint=artifact_identity["fingerprint"],
    )
    errors.extend(immutable.error_codes)
    payload = {"packageIdentity": identity, "artifact": immutable.payload}
    return ArtifactResult(not errors, payload, sorted(set(errors)))


def write_package_identity(package_root: Path | str, manifest: dict[str, Any]) -> ArtifactResult:
    root = Path(package_root).resolve()
    try:
        identity = build_package_identity(manifest)
    except ValueError as exc:
        return ArtifactResult(False, {}, [str(exc)])
    destination = root / PACKAGE_IDENTITY_FILENAME
    try:
        destination.write_text(
            json.dumps(identity, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    except OSError:
        return ArtifactResult(False, identity, ["package_identity_write_failed"])
    return ArtifactResult(True, identity)
