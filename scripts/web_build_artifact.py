#!/usr/bin/env python3
"""Create and verify an immutable, single-build Web artifact for local UAT."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


ARTIFACT_CONTRACT = "wolfystock_web_build_artifact_v1"
ARTIFACT_FILENAME = ".wolfystock-web-build-artifact.json"
WEB_RELATIVE = Path("apps/dsa-web")
STATIC_RELATIVE = Path("static")
PLAYWRIGHT_ARTIFACT_DIRECTORY = "playwright-web-artifact"
CONFIG_FILES = (
    Path("package.json"),
    Path("vite.config.ts"),
    Path("tsconfig.json"),
    Path("tsconfig.app.json"),
    Path("tsconfig.node.json"),
)
VITE_ENV_FILES = (
    Path(".env"),
    Path(".env.local"),
    Path(".env.production"),
    Path(".env.production.local"),
)
VITE_RESOLVED_ENV_SCRIPT = """
import { createHash } from "node:crypto";
import path from "node:path";
import { resolveConfig } from "vite";

const resolved = await resolveConfig(
  { root: process.cwd(), logLevel: "silent" },
  "build",
  "production",
  "production",
);
const values = Object.fromEntries(
  Object.keys(resolved.env).sort().map((key) => {
    const serialized = JSON.stringify({ value: resolved.env[key] });
    if (typeof serialized !== "string") {
      throw new TypeError("nonserializable Vite environment value");
    }
    return [key, createHash("sha256").update(serialized).digest("hex")];
  }),
);
process.stdout.write(JSON.stringify({
  mode: resolved.mode,
  envDirMatchesWebRoot: path.resolve(resolved.envDir) === path.resolve(process.cwd()),
  values,
}));
"""


@dataclass(frozen=True)
class ArtifactResult:
    ok: bool
    payload: dict[str, Any]
    error_codes: list[str] = field(default_factory=list)
    warning_codes: list[str] = field(default_factory=list)


def _run(repo_root: Path, *args: str, capture: bool = True) -> subprocess.CompletedProcess[str]:
    command = list(args)
    if command and command[0] == "npm":
        command[0] = shutil.which("npm.cmd") or shutil.which("npm") or "npm"
    return subprocess.run(command, cwd=repo_root, check=False, capture_output=capture, text=True)


def _git(repo_root: Path, *args: str) -> tuple[str | None, bool]:
    result = _run(repo_root, "git", *args)
    if result.returncode != 0:
        return None, False
    return result.stdout.strip(), True


def _sha256_file(path: Path) -> str | None:
    if not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sha256_json(payload: Any) -> str:
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def _npm_integrity(repo_root: Path) -> tuple[dict[str, Any], list[str]]:
    result = _run(repo_root, "npm", "--prefix", str(WEB_RELATIVE), "ls", "--all", "--json")
    try:
        payload = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        payload = {"unreadable": True}
    errors: list[str] = []
    if result.returncode != 0 or payload.get("problems"):
        errors.append("installed_dependency_tree_invalid")
    return {
        "command": "npm --prefix apps/dsa-web ls --all --json",
        "sha256": _sha256_json(payload),
        "valid": not errors,
    }, errors


def _version(repo_root: Path, *command: str) -> str | None:
    result = _run(repo_root, *command)
    return result.stdout.strip() if result.returncode == 0 else None


def _candidate(repo_root: Path, expected_sha: str | None = None) -> tuple[dict[str, Any], list[str]]:
    sha, sha_available = _git(repo_root, "rev-parse", "HEAD")
    tree, tree_available = _git(repo_root, "rev-parse", "HEAD^{tree}")
    status, status_available = _git(repo_root, "status", "--porcelain")
    errors: list[str] = []
    if not status_available:
        errors.append("worktree_status_unavailable")
    elif status:
        errors.append("worktree_dirty")
    if not sha_available or not tree_available or not sha or not tree:
        errors.append("candidate_unavailable")
    if expected_sha and sha != expected_sha:
        errors.append("candidate_sha_mismatch")
    return {
        "commit": sha or None,
        "tree": tree or None,
        "dirty": bool(status) if status_available else None,
    }, errors


def _config_hashes(web_root: Path) -> tuple[dict[str, str], list[str]]:
    hashes: dict[str, str] = {}
    errors: list[str] = []
    for relative in CONFIG_FILES:
        digest = _sha256_file(web_root / relative)
        if not digest:
            errors.append(f"config_missing:{relative.as_posix()}")
        else:
            hashes[relative.as_posix()] = digest
    return hashes, errors


def _vite_env_file_hashes(web_root: Path) -> dict[str, dict[str, str | bool | None]]:
    """Bind Vite's dotenv sources without parsing or exposing their values."""
    hashes: dict[str, dict[str, str | bool | None]] = {}
    for relative in VITE_ENV_FILES:
        digest = _sha256_file(web_root / relative)
        hashes[relative.as_posix()] = {
            "present": digest is not None,
            "sha256": digest,
        }
    return hashes


def _valid_vite_resolved_values(payload: Any) -> bool:
    return (
        isinstance(payload, dict)
        and set(payload) == {"mode", "envDirMatchesWebRoot", "values"}
        and payload.get("mode") == "production"
        and payload.get("envDirMatchesWebRoot") is True
        and isinstance(payload.get("values"), dict)
        and bool(payload["values"])
        and all(
            isinstance(key, str)
            and bool(key)
            and re.fullmatch(r"[0-9a-f]{64}", str(value or ""))
            for key, value in payload["values"].items()
        )
    )


def _vite_environment_contract(web_root: Path) -> tuple[dict[str, Any], list[str]]:
    """Capture Vite's resolved production inputs without exposing their values."""
    sources = _vite_env_file_hashes(web_root)
    result = _run(web_root, "node", "--input-type=module", "--eval", VITE_RESOLVED_ENV_SCRIPT)
    try:
        resolved_values = json.loads(result.stdout)
    except json.JSONDecodeError:
        resolved_values = None
    if result.returncode != 0 or not _valid_vite_resolved_values(resolved_values):
        return {
            "viteEnvFiles": sources,
            "viteResolvedValues": {},
        }, ["vite_environment_resolution_failed"]
    return {
        "viteEnvFiles": sources,
        "viteResolvedValues": resolved_values,
    }, []


def _managed_environment_identity(repo_root: Path) -> tuple[dict[str, Any], list[str]]:
    result = _run(
        repo_root,
        sys.executable,
        "-E",
        "-s",
        "-B",
        str(repo_root / "scripts" / "wolfy.py"),
        "env",
        "verify",
    )
    try:
        report = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        report = {}
    if not isinstance(report, dict):
        report = {}
    evidence = report.get("environmentEvidence")
    errors: list[str] = []
    if result.returncode != 0 or report.get("status") != "ok" or not isinstance(evidence, dict):
        errors.append("managed_environment_unverified")
        evidence = {}
    identity = {
        "schemaVersion": evidence.get("schemaVersion"),
        "environmentPolicyVersion": evidence.get("environmentPolicyVersion"),
        "environmentFingerprint": evidence.get("environmentFingerprint"),
        "componentFingerprints": evidence.get("componentFingerprints"),
    }
    if not re.fullmatch(r"[0-9a-f]{64}", str(identity["environmentFingerprint"] or "")):
        errors.append("managed_environment_fingerprint_invalid")
    components = identity.get("componentFingerprints")
    required_components = ("python", "web", "browser", "rg")
    if not isinstance(components, dict) or set(components) != set(required_components):
        errors.append("managed_environment_components_invalid")
    else:
        for component in required_components:
            values = components.get(component)
            if not isinstance(values, dict) or any(
                not re.fullmatch(r"[0-9a-f]{64}", str(values.get(field) or ""))
                for field in ("input", "installed")
            ):
                errors.append(f"managed_environment_{component}_identity_invalid")
    return identity, sorted(set(errors))


def _environment_contract(
    repo_root: Path,
    *,
    vite_environment: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], list[str]]:
    managed, errors = _managed_environment_identity(repo_root)
    if vite_environment is None:
        vite_environment, vite_errors = _vite_environment_contract(repo_root / WEB_RELATIVE)
        errors.extend(vite_errors)
    keys = ["NODE_ENV", *sorted(key for key in os.environ if key.startswith("VITE_"))]
    return {
        "managed": managed,
        "buildVariables": {key: _sha256_json({"value": os.environ.get(key)}) for key in keys},
        **vite_environment,
    }, errors


def _index_inventory(index_path: Path, web_root: Path) -> dict[str, Any]:
    text = index_path.read_text(encoding="utf-8")
    tags = re.findall(r"<(?:script|link)\b[^>]*>", text, flags=re.IGNORECASE)

    def references(tag: str) -> list[str]:
        return re.findall(r"(?:src|href)=[\"']([^\"']+)[\"']", tag, flags=re.IGNORECASE)

    def asset_references(predicate: Any) -> list[str]:
        return sorted({ref for tag in tags if predicate(tag) for ref in references(tag) if ref.startswith("/assets/")})

    return {
        "indexSha256": _sha256_file(index_path),
        "entry": asset_references(lambda tag: tag.lower().startswith("<script")),
        "css": asset_references(lambda tag: re.search(r"rel=[\"']stylesheet[\"']", tag, flags=re.IGNORECASE)),
        "preload": asset_references(lambda tag: re.search(r"rel=[\"'](?:modulepreload|preload)[\"']", tag, flags=re.IGNORECASE)),
        "localeSourceFiles": sorted(
            path.relative_to(web_root).as_posix() for path in (web_root / "src" / "i18n").rglob("*.ts")
        ) if (web_root / "src" / "i18n").is_dir() else [],
    }


def _assets(static_root: Path) -> list[dict[str, Any]]:
    inventory: list[dict[str, Any]] = []
    for path in sorted(item for item in static_root.rglob("*") if item.is_file() and item.name != ARTIFACT_FILENAME):
        inventory.append({
            "path": path.relative_to(static_root).as_posix(),
            "size": path.stat().st_size,
            "sha256": _sha256_file(path),
        })
    return inventory


def _make_read_only(root: Path) -> None:
    for path in [*sorted(root.rglob("*")), root]:
        if path.exists():
            path.chmod(path.stat().st_mode & ~stat.S_IWRITE)


def generate_manifest(
    repo_root: Path | str,
    *,
    static_root: Path | str | None = None,
    expected_sha: str | None = None,
    environment: dict[str, Any] | None = None,
) -> ArtifactResult:
    repo = Path(repo_root).resolve()
    web_root = repo / WEB_RELATIVE
    output_root = Path(static_root).resolve() if static_root is not None else repo / STATIC_RELATIVE
    candidate, errors = _candidate(repo, expected_sha)
    integrity, integrity_errors = _npm_integrity(repo)
    errors.extend(integrity_errors)
    config_hashes, config_errors = _config_hashes(web_root)
    errors.extend(config_errors)
    if environment is None:
        environment, environment_errors = _environment_contract(repo)
        errors.extend(environment_errors)
    index_path = output_root / "index.html"
    if not index_path.is_file():
        errors.append("artifact_index_missing")
    assets = _assets(output_root)
    if not assets:
        errors.append("artifact_assets_missing")
    if errors:
        return ArtifactResult(False, {"candidate": candidate, "dependencyIntegrity": integrity}, sorted(set(errors)))
    manifest = {
        "contract": ARTIFACT_CONTRACT,
        "candidate": candidate,
        "packageLock": {"path": "apps/dsa-web/package-lock.json", "sha256": _sha256_file(web_root / "package-lock.json")},
        "dependencyIntegrity": integrity,
        "toolchain": {"node": _version(repo, "node", "--version"), "npm": _version(repo, "npm", "--version")},
        "configuration": {"sha256": config_hashes},
        "environment": environment,
        "index": _index_inventory(index_path, web_root),
        "assets": assets,
    }
    return ArtifactResult(True, manifest)


def run_typecheck(repo_root: Path | str) -> ArtifactResult:
    repo = Path(repo_root).resolve()
    commands = (
        (
            "npm",
            "--prefix",
            str(WEB_RELATIVE),
            "exec",
            "--",
            "tsc",
            "--noEmit",
            "--incremental",
            "false",
            "-p",
            str(WEB_RELATIVE / "tsconfig.app.json"),
        ),
        (
            "npm",
            "--prefix",
            str(WEB_RELATIVE),
            "exec",
            "--",
            "tsc",
            "--noEmit",
            "--incremental",
            "false",
            "-p",
            str(WEB_RELATIVE / "tsconfig.node.json"),
        ),
    )
    command_log: list[dict[str, Any]] = []
    for command in commands:
        result = _run(repo, *command, capture=False)
        command_log.append({"command": " ".join(command), "exitCode": result.returncode})
        if result.returncode != 0:
            return ArtifactResult(False, {"commands": command_log}, ["web_typecheck_failed"])
    return ArtifactResult(True, {"commands": command_log})


def _build_artifact(
    repo: Path,
    artifact: Path,
    *,
    expected_sha: str | None = None,
    prepared_typecheck: ArtifactResult | None = None,
) -> ArtifactResult:
    static_root = artifact.parent
    if artifact.exists():
        existing = verify_artifact(repo, artifact, expected_sha=expected_sha)
        if existing.ok:
            return existing
        return ArtifactResult(
            False,
            existing.payload,
            sorted(set(["existing_artifact_verification_failed", *existing.error_codes])),
            existing.warning_codes,
        )
    if static_root.exists() and any(static_root.iterdir()):
        return ArtifactResult(False, {}, ["artifact_destination_unverified"])

    candidate, errors = _candidate(repo, expected_sha)
    integrity, integrity_errors = _npm_integrity(repo)
    errors.extend(integrity_errors)
    if errors:
        return ArtifactResult(False, {"candidate": candidate, "dependencyIntegrity": integrity}, sorted(set(errors)))

    typecheck = prepared_typecheck or run_typecheck(repo)
    command_log = list(typecheck.payload.get("commands", []))
    if not typecheck.ok:
        return ArtifactResult(False, {"candidate": candidate, "commands": command_log}, typecheck.error_codes)
    with tempfile.TemporaryDirectory(prefix="wolfystock-web-artifact-") as temporary_root:
        staged_root = Path(temporary_root) / "static"
        command = (
            "npm",
            "--prefix",
            str(WEB_RELATIVE),
            "run",
            "build:bundle",
            "--",
            "--outDir",
            str(staged_root),
        )
        pre_vite_environment, vite_errors = _vite_environment_contract(repo / WEB_RELATIVE)
        if vite_errors:
            return ArtifactResult(
                False,
                {"candidate": candidate, "commands": command_log},
                sorted(set(vite_errors)),
            )
        environment, environment_errors = _environment_contract(repo, vite_environment=pre_vite_environment)
        if environment_errors:
            return ArtifactResult(
                False,
                {"candidate": candidate, "commands": command_log},
                sorted(set(environment_errors)),
            )
        result = _run(repo, *command, capture=False)
        command_log.append(
            {
                "command": "npm --prefix apps/dsa-web run build:bundle -- --outDir $ARTIFACT_STAGING",
                "exitCode": result.returncode,
            }
        )
        if result.returncode != 0:
            return ArtifactResult(False, {"candidate": candidate, "commands": command_log}, ["web_build_command_failed"])

        post_vite_environment, post_vite_errors = _vite_environment_contract(repo / WEB_RELATIVE)
        if post_vite_errors:
            return ArtifactResult(
                False,
                {"candidate": candidate, "commands": command_log},
                sorted(set(post_vite_errors)),
            )
        if post_vite_environment != pre_vite_environment:
            return ArtifactResult(
                False,
                {"candidate": candidate, "commands": command_log},
                ["vite_environment_changed_during_build"],
            )

        from scripts.uat_fresh_build_verifier import read_backend_info, write_frontend_build_identity

        legacy_identity = write_frontend_build_identity(
            static_root=staged_root,
            backend_info=read_backend_info(repo),
            repo_root=repo,
        )
        if not legacy_identity.ok:
            return ArtifactResult(False, legacy_identity.payload, legacy_identity.error_codes)

        generated = generate_manifest(
            repo,
            static_root=staged_root,
            expected_sha=expected_sha,
            environment=environment,
        )
        if not generated.ok:
            return ArtifactResult(False, generated.payload, generated.error_codes)
        manifest = {**generated.payload, "commands": command_log}
        manifest["fingerprint"] = _sha256_json(manifest)
        staged_artifact = staged_root / ARTIFACT_FILENAME
        staged_artifact.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        staged_verification = verify_artifact(repo, staged_artifact, expected_sha=expected_sha)
        if not staged_verification.ok:
            return staged_verification
        if static_root.exists():
            if any(static_root.iterdir()):
                return ArtifactResult(False, {}, ["artifact_destination_changed"])
            static_root.rmdir()
        static_root.parent.mkdir(parents=True, exist_ok=True)
        staged_root.replace(static_root)
        _make_read_only(static_root)
        return staged_verification


def build_artifact(
    repo_root: Path | str,
    artifact_path: Path | str | None = None,
    *,
    expected_sha: str | None = None,
    prepared_typecheck: ArtifactResult | None = None,
) -> ArtifactResult:
    """Build the canonical release/UAT Web artifact under static/."""
    repo = Path(repo_root).resolve()
    static_root = repo / STATIC_RELATIVE
    artifact = Path(artifact_path).resolve() if artifact_path else static_root / ARTIFACT_FILENAME
    canonical_artifact = (static_root / ARTIFACT_FILENAME).resolve()
    if artifact != canonical_artifact:
        return ArtifactResult(False, {}, ["artifact_path_not_canonical"])
    return _build_artifact(repo, artifact, expected_sha=expected_sha, prepared_typecheck=prepared_typecheck)


def prepare_playwright_artifact(
    repo_root: Path | str,
    artifact_path: Path | str | None = None,
    *,
    expected_sha: str | None = None,
) -> ArtifactResult:
    """Prepare the canonical artifact required by configured Playwright preview."""
    repo = Path(repo_root).resolve()
    if artifact_path is None:
        output_root = os.environ.get("WOLFYSTOCK_FRONTEND_OUTPUT_DIR", "").strip()
        if not output_root or not Path(output_root).is_absolute():
            return ArtifactResult(False, {}, ["playwright_output_directory_unavailable"])
        artifact = Path(output_root).resolve() / PLAYWRIGHT_ARTIFACT_DIRECTORY / ARTIFACT_FILENAME
    else:
        artifact = Path(artifact_path).resolve()
    candidate, errors = _candidate(repo, expected_sha)
    environment, environment_errors = _environment_contract(repo)
    errors.extend(environment_errors)
    if errors:
        return ArtifactResult(
            False,
            {"candidate": candidate, "environment": environment},
            sorted(set(errors)),
        )

    typecheck = run_typecheck(repo)
    if not typecheck.ok:
        return ArtifactResult(
            False,
            {"candidate": candidate, "environment": environment, "typecheck": typecheck.payload},
            typecheck.error_codes,
        )

    prepared = _build_artifact(
        repo,
        artifact,
        expected_sha=expected_sha,
        prepared_typecheck=typecheck,
    )
    artifact_environment = prepared.payload.get("environment") if isinstance(prepared.payload, dict) else None
    payload = {
        "candidate": candidate,
        "environment": artifact_environment,
        "environmentPreflight": environment,
        "typecheck": typecheck.payload,
        "artifact": prepared.payload,
    }
    return ArtifactResult(prepared.ok, payload, prepared.error_codes, prepared.warning_codes)


def _manifest_provenance_errors(manifest: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    integrity = manifest.get("dependencyIntegrity")
    if not isinstance(integrity, dict) or (
        integrity.get("command") != "npm --prefix apps/dsa-web ls --all --json"
        or integrity.get("valid") is not True
        or not re.fullmatch(r"[0-9a-f]{64}", str(integrity.get("sha256") or ""))
    ):
        errors.append("artifact_provenance_invalid")

    toolchain = manifest.get("toolchain")
    if not isinstance(toolchain, dict) or set(toolchain) != {"node", "npm"} or any(
        not isinstance(toolchain.get(name), str) or not toolchain[name]
        for name in ("node", "npm")
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
        or any(
            not isinstance(key, str)
            or not re.fullmatch(r"[0-9a-f]{64}", str(value or ""))
            for key, value in environment["buildVariables"].items()
        )
        or not isinstance(managed, dict)
        or not isinstance(managed.get("schemaVersion"), str)
        or not managed["schemaVersion"].strip()
        or not isinstance(managed.get("environmentPolicyVersion"), str)
        or not managed["environmentPolicyVersion"].strip()
        or not re.fullmatch(r"[0-9a-f]{64}", str(managed.get("environmentFingerprint") or ""))
        or not isinstance(components, dict)
        or set(components) != {"python", "web", "browser", "rg"}
    ):
        errors.append("artifact_provenance_invalid")
    elif any(
        not isinstance(components.get(component), dict)
        or any(
            not re.fullmatch(r"[0-9a-f]{64}", str(components[component].get(field) or ""))
            for field in ("input", "installed")
        )
        for component in ("python", "web", "browser", "rg")
    ):
        errors.append("artifact_provenance_invalid")

    if not isinstance(vite_env_files, dict) or set(vite_env_files) != {path.as_posix() for path in VITE_ENV_FILES}:
        errors.append("artifact_provenance_invalid")
    else:
        for source in vite_env_files.values():
            if not isinstance(source, dict) or set(source) != {"present", "sha256"}:
                errors.append("artifact_provenance_invalid")
                break
            present = source.get("present")
            digest = source.get("sha256")
            if not isinstance(present, bool) or (present and not re.fullmatch(r"[0-9a-f]{64}", str(digest or ""))) or (
                not present and digest is not None
            ):
                errors.append("artifact_provenance_invalid")
                break

    if not _valid_vite_resolved_values(vite_resolved_values):
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


def _verify_manifest_artifact(
    repo: Path,
    artifact: Path,
    *,
    expected_sha: str | None,
    require_canonical: bool,
) -> ArtifactResult:
    canonical = (repo / STATIC_RELATIVE / ARTIFACT_FILENAME).resolve()
    resolved_artifact = artifact.resolve()
    if require_canonical and resolved_artifact != canonical:
        return ArtifactResult(False, {}, ["artifact_path_not_canonical"])
    try:
        manifest = json.loads(resolved_artifact.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return ArtifactResult(False, {}, ["artifact_manifest_unreadable"])
    if not isinstance(manifest, dict) or manifest.get("contract") != ARTIFACT_CONTRACT:
        return ArtifactResult(
            False,
            manifest if isinstance(manifest, dict) else {},
            ["artifact_contract_mismatch"],
        )

    errors = _manifest_provenance_errors(manifest)
    package_lock = manifest.get("packageLock")
    configuration = manifest.get("configuration")
    if (
        not isinstance(package_lock, dict)
        or package_lock.get("path") != "apps/dsa-web/package-lock.json"
        or not re.fullmatch(r"[0-9a-f]{64}", str(package_lock.get("sha256") or ""))
        or not isinstance(configuration, dict)
        or not isinstance(configuration.get("sha256"), dict)
    ):
        errors.append("artifact_metadata_invalid")
    candidate, candidate_errors = _candidate(repo, expected_sha)
    errors.extend(candidate_errors)
    if manifest.get("candidate") != candidate:
        errors.append("artifact_candidate_mismatch")
    web_root = repo / WEB_RELATIVE
    if not isinstance(package_lock, dict) or package_lock.get("sha256") != _sha256_file(web_root / "package-lock.json"):
        errors.append("artifact_lockfile_mismatch")
    config_hashes, config_errors = _config_hashes(web_root)
    errors.extend(config_errors)
    if not isinstance(configuration, dict) or configuration.get("sha256") != config_hashes:
        errors.append("artifact_config_mismatch")

    environment = manifest.get("environment")
    if not isinstance(environment, dict) or environment.get("viteEnvFiles") != _vite_env_file_hashes(web_root):
        errors.append("artifact_vite_env_mismatch")

    static_root = resolved_artifact.parent
    index_path = static_root / "index.html"
    try:
        index_matches = index_path.is_file() and manifest.get("index") == _index_inventory(index_path, web_root)
    except (OSError, UnicodeError):
        index_matches = False
    if not index_matches:
        errors.append("artifact_index_mismatch")
    try:
        assets_match = manifest.get("assets") == _assets(static_root)
    except OSError:
        assets_match = False
    if not assets_match:
        errors.append("artifact_asset_mismatch")
    fingerprint_payload = dict(manifest)
    fingerprint = fingerprint_payload.pop("fingerprint", None)
    if fingerprint != _sha256_json(fingerprint_payload):
        errors.append("artifact_manifest_tampered")
    return ArtifactResult(not errors, manifest, sorted(set(errors)))


def verify_runtime_artifact(
    repo_root: Path | str,
    artifact_path: Path | str,
    *,
    expected_sha: str | None = None,
) -> ArtifactResult:
    """Verify the canonical serve-only artifact without invoking build or dependency tools."""
    repo = Path(repo_root).resolve()
    return _verify_manifest_artifact(
        repo,
        Path(artifact_path),
        expected_sha=expected_sha,
        require_canonical=True,
    )


def verify_artifact(
    repo_root: Path | str,
    artifact_path: Path | str,
    *,
    expected_sha: str | None = None,
) -> ArtifactResult:
    repo = Path(repo_root).resolve()
    artifact = Path(artifact_path)
    runtime_result = _verify_manifest_artifact(
        repo,
        artifact,
        expected_sha=expected_sha,
        require_canonical=False,
    )
    if "artifact_manifest_unreadable" in runtime_result.error_codes or "artifact_contract_mismatch" in runtime_result.error_codes:
        return runtime_result
    manifest = runtime_result.payload
    errors = list(runtime_result.error_codes)
    integrity, integrity_errors = _npm_integrity(repo)
    errors.extend(integrity_errors)
    if manifest.get("dependencyIntegrity") != integrity:
        errors.append("artifact_dependency_integrity_mismatch")
    if manifest.get("toolchain") != {"node": _version(repo, "node", "--version"), "npm": _version(repo, "npm", "--version")}:
        errors.append("artifact_toolchain_mismatch")
    environment, environment_errors = _environment_contract(repo)
    errors.extend(environment_errors)
    if manifest.get("environment") != environment:
        errors.append("artifact_environment_mismatch")
    return ArtifactResult(not errors, manifest, sorted(set(errors)))


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create or verify an immutable Web build artifact.")
    parser.add_argument("action", choices=("build", "manifest", "playwright", "typecheck", "verify", "verify-runtime"))
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--artifact", type=Path, default=None)
    parser.add_argument("--expected-sha", default=None)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if args.action == "build":
        artifact = args.artifact or args.repo_root / STATIC_RELATIVE / ARTIFACT_FILENAME
        result = build_artifact(args.repo_root, artifact, expected_sha=args.expected_sha)
    elif args.action == "playwright":
        result = prepare_playwright_artifact(args.repo_root, args.artifact, expected_sha=args.expected_sha)
    elif args.action == "manifest":
        result = generate_manifest(args.repo_root)
    elif args.action == "typecheck":
        result = run_typecheck(args.repo_root)
    elif args.action == "verify":
        artifact = args.artifact or args.repo_root / STATIC_RELATIVE / ARTIFACT_FILENAME
        result = verify_artifact(args.repo_root, artifact, expected_sha=args.expected_sha)
    else:
        artifact = args.artifact or args.repo_root / STATIC_RELATIVE / ARTIFACT_FILENAME
        result = verify_runtime_artifact(args.repo_root, artifact, expected_sha=args.expected_sha)
    if args.json:
        print(json.dumps({"ok": result.ok, "errorCodes": result.error_codes, "manifest": result.payload}, ensure_ascii=False, indent=2, sort_keys=True))
    else:
        print(f"Web build artifact: {'PASS' if result.ok else 'FAIL'}")
        if result.error_codes:
            print("Errors: " + ", ".join(result.error_codes), file=sys.stderr)
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
