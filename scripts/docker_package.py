#!/usr/bin/env python3
"""Create the explicit, source-bound Docker context for a candidate."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path, PurePosixPath
from typing import Sequence

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.web_build_artifact import build_artifact
from src.web_artifact import (
    ARTIFACT_FILENAME,
    LEGACY_BUILD_IDENTITY_FILENAME,
    ArtifactResult,
    build_package_identity,
    verify_packaged_artifact,
)


def _extract_archive(repo: Path, candidate: str, destination: Path) -> None:
    archive = destination.parent / (destination.name + ".tar")
    try:
        subprocess.run(
            ["git", "archive", "--format=tar", "--output", str(archive), candidate],
            cwd=repo,
            check=True,
            capture_output=True,
            text=True,
        )
        with tarfile.open(archive, "r") as handle:
            for member in handle.getmembers():
                name = PurePosixPath(member.name)
                if name.is_absolute() or ".." in name.parts:
                    raise ValueError("git_archive_path_unsafe")
            handle.extractall(destination)
    finally:
        archive.unlink(missing_ok=True)


def prepare_context(
    repo_root: Path | str,
    output: Path | str,
    *,
    expected_sha: str | None = None,
) -> ArtifactResult:
    repo = Path(repo_root).resolve()
    context = Path(output).resolve()
    if context.exists():
        if not context.is_dir() or any(context.iterdir()):
            return ArtifactResult(False, {}, ["docker_context_destination_unverified"])
    else:
        context.mkdir(parents=True)

    artifact = repo / "static" / ARTIFACT_FILENAME
    built = build_artifact(repo, artifact, expected_sha=expected_sha)
    if not built.ok:
        return built
    manifest = built.payload
    candidate = manifest.get("candidate") if isinstance(manifest, dict) else None
    if not isinstance(candidate, dict):
        return ArtifactResult(False, {}, ["package_identity_candidate_missing"])
    commit = str(candidate.get("commit") or "")
    tree = str(candidate.get("tree") or "")
    if not commit or not tree or candidate.get("dirty") is not False:
        return ArtifactResult(False, {"candidate": candidate}, ["package_identity_source_candidate_invalid"])
    if expected_sha and commit != expected_sha.strip().lower():
        return ArtifactResult(False, {"candidate": candidate}, ["candidate_sha_mismatch"])

    try:
        _extract_archive(repo, commit, context)
        shutil.copytree(
            artifact.parent,
            context / "static",
            ignore=shutil.ignore_patterns(LEGACY_BUILD_IDENTITY_FILENAME),
        )
        identity = build_package_identity(manifest)
        (context / ".wolfystock-package-identity.json").write_text(
            json.dumps(identity, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    except (OSError, ValueError, subprocess.CalledProcessError):
        return ArtifactResult(False, {"candidate": candidate}, ["docker_context_prepare_failed"])

    verified = verify_packaged_artifact(context, expected_sha=commit, expected_tree=tree)
    if not verified.ok:
        return ArtifactResult(False, verified.payload, verified.error_codes)
    return ArtifactResult(
        True,
        {
            "context": str(context),
            "candidate": {"commit": commit, "tree": tree},
            "artifactFingerprint": manifest.get("fingerprint"),
            "packageIdentity": identity,
            "verification": verified.payload,
        },
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create the verified Docker package context.")
    parser.add_argument("action", choices=("context",))
    parser.add_argument("--repo-root", type=Path, default=REPO_ROOT)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--expected-sha", default=None)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    result = prepare_context(args.repo_root, args.output, expected_sha=args.expected_sha)
    if args.json:
        print(json.dumps({"ok": result.ok, "errorCodes": result.error_codes, "package": result.payload}, indent=2, sort_keys=True))
    else:
        print(f"Docker package context: {'PASS' if result.ok else 'FAIL'}")
        if result.error_codes:
            print("Errors: " + ", ".join(result.error_codes), file=sys.stderr)
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
