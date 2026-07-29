from __future__ import annotations

import json
import shutil
import stat
import subprocess
from pathlib import Path

from scripts import web_build_artifact as artifact
from scripts.uat_fresh_build_verifier import VerificationResult


def _write_fixture(tmp_path: Path) -> tuple[Path, Path]:
    repo = tmp_path
    web = repo / "apps" / "dsa-web"
    static = repo / "static"
    for path in (web / "src" / "i18n", static / "assets"):
        path.mkdir(parents=True, exist_ok=True)
    for name in ("package.json", "vite.config.ts", "tsconfig.json", "tsconfig.app.json", "tsconfig.node.json", "package-lock.json"):
        (web / name).write_text("{}\n", encoding="utf-8")
    (web / "src" / "i18n" / "catalog.ts").write_text("export {}\n", encoding="utf-8")
    (static / "index.html").write_text('<script type="module" src="/assets/index.js"></script>', encoding="utf-8")
    (static / "assets" / "index.js").write_text("console.log('ok')\n", encoding="utf-8")
    return repo, static / artifact.ARTIFACT_FILENAME


def _manifest(repo: Path, artifact_path: Path) -> dict[str, object]:
    web = repo / "apps" / "dsa-web"
    candidate = {"commit": "candidate", "tree": "tree", "dirty": False}
    integrity = {"command": "npm --prefix apps/dsa-web ls --all --json", "sha256": "d" * 64, "valid": True}
    manifest: dict[str, object] = {
        "contract": artifact.ARTIFACT_CONTRACT,
        "candidate": candidate,
        "packageLock": {"path": "apps/dsa-web/package-lock.json", "sha256": artifact._sha256_file(web / "package-lock.json")},
        "dependencyIntegrity": integrity,
        "toolchain": {"node": "v1", "npm": "1"},
        "configuration": {"sha256": artifact._config_hashes(web)[0]},
        "environment": artifact._environment_contract(repo)[0],
        "commands": [
            {
                "command": "npm --prefix apps/dsa-web run build:bundle -- --outDir $ARTIFACT_STAGING",
                "exitCode": 0,
            }
        ],
        "index": artifact._index_inventory(repo / "static" / "index.html", web),
        "assets": artifact._assets(repo / "static"),
    }
    manifest["fingerprint"] = artifact._sha256_json(manifest)
    artifact_path.write_text(json.dumps(manifest), encoding="utf-8")
    return manifest


def _patch_current(monkeypatch) -> None:
    def resolved_vite_environment(web_root: Path) -> tuple[dict[str, object], list[str]]:
        return {
            "viteEnvFiles": artifact._vite_env_file_hashes(web_root),
            "viteResolvedValues": {
                "mode": "production",
                "envDirMatchesWebRoot": True,
                "values": {
                    "BASE_URL": "a" * 64,
                    "DEV": "b" * 64,
                    "MODE": "c" * 64,
                    "PROD": "d" * 64,
                },
            },
        }, []

    monkeypatch.setattr(artifact, "_vite_environment_contract", resolved_vite_environment)
    monkeypatch.setattr(artifact, "_candidate", lambda _repo, expected_sha=None: ({"commit": "candidate", "tree": "tree", "dirty": False}, [] if expected_sha in (None, "candidate") else ["candidate_sha_mismatch"]))
    monkeypatch.setattr(artifact, "_npm_integrity", lambda _repo: ({"command": "npm --prefix apps/dsa-web ls --all --json", "sha256": "d" * 64, "valid": True}, []))
    monkeypatch.setattr(artifact, "_version", lambda _repo, *command: "v1" if command[0] == "node" else "1")
    monkeypatch.setattr(
        artifact,
        "_environment_contract",
        lambda _repo, *, vite_environment=None: (
            {
                "managed": {
                    "schemaVersion": "wolfystock_environment_evidence_v1",
                    "environmentPolicyVersion": "wolfystock_test_environment_policy_v1",
                    "environmentFingerprint": "e" * 64,
                    "componentFingerprints": {
                        "python": {"input": "1" * 64, "installed": "2" * 64},
                        "web": {"input": "3" * 64, "installed": "4" * 64},
                        "browser": {"input": "5" * 64, "installed": "6" * 64},
                        "rg": {"input": "7" * 64, "installed": "8" * 64},
                    },
                },
                "buildVariables": {"NODE_ENV": "9" * 64},
                **(vite_environment or resolved_vite_environment(_repo / "apps" / "dsa-web")[0]),
            },
            [],
        ),
    )


def test_verify_artifact_accepts_matching_candidate(monkeypatch, tmp_path: Path) -> None:
    repo, artifact_path = _write_fixture(tmp_path)
    _patch_current(monkeypatch)
    _manifest(repo, artifact_path)

    result = artifact.verify_artifact(repo, artifact_path, expected_sha="candidate")

    assert result.ok is True


def test_verify_runtime_artifact_is_read_only_and_never_invokes_dependency_tools(monkeypatch, tmp_path: Path) -> None:
    repo, artifact_path = _write_fixture(tmp_path)
    _patch_current(monkeypatch)
    _manifest(repo, artifact_path)
    monkeypatch.setattr(
        artifact,
        "_npm_integrity",
        lambda _repo: (_ for _ in ()).throw(AssertionError("runtime verification must not invoke npm")),
    )
    monkeypatch.setattr(
        artifact,
        "_version",
        lambda _repo, *_command: (_ for _ in ()).throw(AssertionError("runtime verification must not invoke node or npm")),
    )
    monkeypatch.setattr(
        artifact,
        "_environment_contract",
        lambda _repo: (_ for _ in ()).throw(AssertionError("runtime verification must not invoke environment tooling")),
    )
    paths = [*sorted((repo / "static").rglob("*"), reverse=True), repo / "static"]
    for path in paths:
        path.chmod(path.stat().st_mode & ~stat.S_IWRITE)

    try:
        result = artifact.verify_runtime_artifact(repo, artifact_path, expected_sha="candidate")
    finally:
        for path in reversed(paths):
            path.chmod(path.stat().st_mode | stat.S_IWRITE)

    assert result.ok is True


def test_verify_runtime_artifact_rejects_missing_malformed_and_wrong_candidate(monkeypatch, tmp_path: Path) -> None:
    repo, artifact_path = _write_fixture(tmp_path)
    _patch_current(monkeypatch)

    missing = artifact.verify_runtime_artifact(repo, artifact_path, expected_sha="candidate")
    artifact_path.write_text("{not-json", encoding="utf-8")
    malformed = artifact.verify_runtime_artifact(repo, artifact_path, expected_sha="candidate")
    manifest = _manifest(repo, artifact_path)
    manifest.pop("dependencyIntegrity")
    manifest["fingerprint"] = artifact._sha256_json({key: value for key, value in manifest.items() if key != "fingerprint"})
    artifact_path.write_text(json.dumps(manifest), encoding="utf-8")
    missing_metadata = artifact.verify_runtime_artifact(repo, artifact_path, expected_sha="candidate")
    manifest = _manifest(repo, artifact_path)
    manifest["configuration"] = []
    manifest["fingerprint"] = artifact._sha256_json(
        {key: value for key, value in manifest.items() if key != "fingerprint"}
    )
    artifact_path.write_text(json.dumps(manifest), encoding="utf-8")
    malformed_metadata = artifact.verify_runtime_artifact(repo, artifact_path, expected_sha="candidate")
    _manifest(repo, artifact_path)
    monkeypatch.setattr(
        artifact,
        "_candidate",
        lambda _repo, expected_sha=None: ({"commit": "other", "tree": "other-tree", "dirty": False}, []),
    )
    wrong_candidate = artifact.verify_runtime_artifact(repo, artifact_path, expected_sha="candidate")

    assert missing.error_codes == ["artifact_manifest_unreadable"]
    assert malformed.error_codes == ["artifact_manifest_unreadable"]
    assert "artifact_provenance_invalid" in missing_metadata.error_codes
    assert "artifact_metadata_invalid" in malformed_metadata.error_codes
    assert "artifact_candidate_mismatch" in wrong_candidate.error_codes


def test_candidate_rejects_unavailable_worktree_status(monkeypatch, tmp_path: Path) -> None:
    def run(_repo: Path, *args: str, capture: bool = True) -> subprocess.CompletedProcess[str]:
        if args == ("git", "rev-parse", "HEAD"):
            return subprocess.CompletedProcess(args, 0, "candidate\n", "")
        if args == ("git", "rev-parse", "HEAD^{tree}"):
            return subprocess.CompletedProcess(args, 0, "tree\n", "")
        if args == ("git", "status", "--porcelain"):
            return subprocess.CompletedProcess(args, 128, "", "fatal: index unavailable")
        raise AssertionError(f"unexpected command: {args}")

    monkeypatch.setattr(artifact, "_run", run)

    candidate, errors = artifact._candidate(tmp_path)

    assert candidate == {"commit": "candidate", "tree": "tree", "dirty": None}
    assert errors == ["worktree_status_unavailable"]


def test_vite_resolved_environment_binds_unprefixed_expansion(monkeypatch, tmp_path: Path) -> None:
    web_root = tmp_path / "apps" / "dsa-web"
    web_root.mkdir(parents=True)
    managed_node_modules = Path(__file__).resolve().parents[2] / "apps" / "dsa-web" / "node_modules"
    (web_root / "node_modules").symlink_to(managed_node_modules, target_is_directory=True)
    (web_root / ".env.production").write_text("VITE_API_URL=${WOLFYSTOCK_TEST_API_BASE_URL}\n", encoding="utf-8")
    monkeypatch.delenv("VITE_API_URL", raising=False)
    monkeypatch.setenv("WOLFYSTOCK_TEST_API_BASE_URL", "https://first.invalid")

    first, first_errors = artifact._vite_environment_contract(web_root)

    monkeypatch.setenv("WOLFYSTOCK_TEST_API_BASE_URL", "https://second.invalid")
    second, second_errors = artifact._vite_environment_contract(web_root)

    assert first_errors == []
    assert second_errors == []
    assert first["viteEnvFiles"] == second["viteEnvFiles"]
    assert first["viteResolvedValues"]["mode"] == "production"
    assert second["viteResolvedValues"]["mode"] == "production"
    assert (
        first["viteResolvedValues"]["values"]["VITE_API_URL"]
        != second["viteResolvedValues"]["values"]["VITE_API_URL"]
    )


def test_vite_resolved_environment_rejects_malformed_resolver_output(monkeypatch, tmp_path: Path) -> None:
    web_root = tmp_path / "apps" / "dsa-web"
    web_root.mkdir(parents=True)
    monkeypatch.setattr(
        artifact,
        "_run",
        lambda _root, *_args, capture=True: subprocess.CompletedProcess(_args, 0, "not-json", ""),
    )

    identity, errors = artifact._vite_environment_contract(web_root)

    assert identity["viteEnvFiles"] == artifact._vite_env_file_hashes(web_root)
    assert errors == ["vite_environment_resolution_failed"]


def test_build_artifact_rejects_vite_environment_changed_during_build(monkeypatch, tmp_path: Path) -> None:
    repo, artifact_path = _write_fixture(tmp_path)
    shutil.rmtree(repo / "static")
    _patch_current(monkeypatch)
    snapshots = iter(
        [
            {
                "viteEnvFiles": artifact._vite_env_file_hashes(repo / "apps" / "dsa-web"),
                "viteResolvedValues": {
                    "mode": "production",
                    "envDirMatchesWebRoot": True,
                    "values": {"VITE_API_URL": "a" * 64},
                },
            },
            {
                "viteEnvFiles": artifact._vite_env_file_hashes(repo / "apps" / "dsa-web"),
                "viteResolvedValues": {
                    "mode": "production",
                    "envDirMatchesWebRoot": True,
                    "values": {"VITE_API_URL": "b" * 64},
                },
            },
        ]
    )
    monkeypatch.setattr(artifact, "_vite_environment_contract", lambda _web: (next(snapshots), []))

    def run(_repo: Path, *args: str, capture: bool = True) -> subprocess.CompletedProcess[str]:
        command = list(args)
        if "build:bundle" in command:
            output_dir = Path(command[command.index("--outDir") + 1])
            (output_dir / "assets").mkdir(parents=True)
            (output_dir / "index.html").write_text(
                '<script type="module" src="/assets/index.js"></script>',
                encoding="utf-8",
            )
            (output_dir / "assets" / "index.js").write_text("console.log('ok')\n", encoding="utf-8")
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(artifact, "_run", run)

    result = artifact.build_artifact(repo, artifact_path, expected_sha="candidate")

    assert result.ok is False
    assert result.error_codes == ["vite_environment_changed_during_build"]
    assert not artifact_path.exists()


def test_runtime_artifact_rejects_missing_vite_resolved_values(monkeypatch, tmp_path: Path) -> None:
    repo, artifact_path = _write_fixture(tmp_path)
    _patch_current(monkeypatch)
    manifest = _manifest(repo, artifact_path)
    environment = manifest["environment"]
    assert isinstance(environment, dict)
    environment.pop("viteResolvedValues")
    manifest["fingerprint"] = artifact._sha256_json({key: value for key, value in manifest.items() if key != "fingerprint"})
    artifact_path.write_text(json.dumps(manifest), encoding="utf-8")

    result = artifact.verify_runtime_artifact(repo, artifact_path, expected_sha="candidate")

    assert result.ok is False
    assert "artifact_provenance_invalid" in result.error_codes


def test_runtime_artifact_rejects_changed_vite_env_source(monkeypatch, tmp_path: Path) -> None:
    repo, artifact_path = _write_fixture(tmp_path)
    _patch_current(monkeypatch)
    vite_env = repo / "apps" / "dsa-web" / ".env"
    vite_env.write_text("VITE_API_URL=https://first.invalid\n", encoding="utf-8")
    _manifest(repo, artifact_path)
    vite_env.write_text("VITE_API_URL=https://second.invalid\n", encoding="utf-8")

    result = artifact.verify_runtime_artifact(repo, artifact_path, expected_sha="candidate")

    assert result.ok is False
    assert "artifact_vite_env_mismatch" in result.error_codes


def test_runtime_artifact_rejects_removed_vite_env_source(monkeypatch, tmp_path: Path) -> None:
    repo, artifact_path = _write_fixture(tmp_path)
    _patch_current(monkeypatch)
    vite_env = repo / "apps" / "dsa-web" / ".env.local"
    vite_env.write_text("VITE_API_URL=https://present.invalid\n", encoding="utf-8")
    _manifest(repo, artifact_path)
    vite_env.unlink()

    result = artifact.verify_runtime_artifact(repo, artifact_path, expected_sha="candidate")

    assert result.ok is False
    assert "artifact_vite_env_mismatch" in result.error_codes


def test_runtime_artifact_rejects_new_vite_env_source(monkeypatch, tmp_path: Path) -> None:
    repo, artifact_path = _write_fixture(tmp_path)
    _patch_current(monkeypatch)
    _manifest(repo, artifact_path)
    vite_env = repo / "apps" / "dsa-web" / ".env.production"
    vite_env.write_text("VITE_API_URL=https://new.invalid\n", encoding="utf-8")

    result = artifact.verify_runtime_artifact(repo, artifact_path, expected_sha="candidate")

    assert result.ok is False
    assert "artifact_vite_env_mismatch" in result.error_codes


def test_manifest_regeneration_is_deterministic(monkeypatch, tmp_path: Path) -> None:
    repo, _artifact_path = _write_fixture(tmp_path)
    _patch_current(monkeypatch)

    first = artifact.generate_manifest(repo)
    second = artifact.generate_manifest(repo)

    assert first.ok is True
    assert second.ok is True
    assert first.payload == second.payload


def test_release_typecheck_uses_non_incremental_configs_without_snapshot_writes(monkeypatch, tmp_path: Path) -> None:
    repo, _artifact_path = _write_fixture(tmp_path)
    commands: list[list[str]] = []

    def run(_repo: Path, *args: str, capture: bool = True) -> subprocess.CompletedProcess[str]:
        commands.append(list(args))
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(artifact, "_run", run)

    result = artifact.run_typecheck(repo)

    assert result.ok is True
    assert commands == [
        [
            "npm",
            "--prefix",
            "apps/dsa-web",
            "exec",
            "--",
            "tsc",
            "--noEmit",
            "--incremental",
            "false",
            "-p",
            "apps/dsa-web/tsconfig.app.json",
        ],
        [
            "npm",
            "--prefix",
            "apps/dsa-web",
            "exec",
            "--",
            "tsc",
            "--noEmit",
            "--incremental",
            "false",
            "-p",
            "apps/dsa-web/tsconfig.node.json",
        ],
    ]
    assert all("node_modules/.tmp" not in " ".join(command) for command in commands)
    assert str(repo) not in json.dumps(result.payload)


def test_build_artifact_uses_temporary_output_and_binds_managed_environment(
    monkeypatch,
    tmp_path: Path,
) -> None:
    repo, artifact_path = _write_fixture(tmp_path)
    shutil.rmtree(repo / "static")
    playwright_output = repo / "playwright-output"
    monkeypatch.setenv("WOLFYSTOCK_FRONTEND_OUTPUT_DIR", str(playwright_output))
    _patch_current(monkeypatch)
    commands: list[list[str]] = []

    def run(_repo: Path, *args: str, capture: bool = True) -> subprocess.CompletedProcess[str]:
        command = list(args)
        commands.append(command)
        if "build:bundle" in command:
            output_dir = Path(command[command.index("--outDir") + 1])
            (output_dir / "assets").mkdir(parents=True)
            (output_dir / "index.html").write_text(
                '<script type="module" src="/assets/index.js"></script>',
                encoding="utf-8",
            )
            (output_dir / "assets" / "index.js").write_text("console.log('ok')\n", encoding="utf-8")
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(artifact, "_run", run)
    monkeypatch.setattr(
        "scripts.uat_fresh_build_verifier.write_frontend_build_identity",
        lambda **_kwargs: VerificationResult(ok=True, payload={}),
    )
    monkeypatch.setattr("scripts.uat_fresh_build_verifier.read_backend_info", lambda _repo: object())

    result = artifact.prepare_playwright_artifact(repo, expected_sha="candidate")

    assert result.ok is True
    prepared_artifact = playwright_output / artifact.PLAYWRIGHT_ARTIFACT_DIRECTORY / artifact.ARTIFACT_FILENAME
    assert prepared_artifact.is_file()
    assert not artifact_path.exists()
    assert result.payload["candidate"] == {"commit": "candidate", "tree": "tree", "dirty": False}
    assert result.payload["environment"]["managed"]["environmentFingerprint"] == "e" * 64
    assert set(result.payload["environment"]["managed"]["componentFingerprints"]) == {
        "python",
        "web",
        "browser",
        "rg",
    }
    assert [item["command"] for item in result.payload["typecheck"]["commands"]] == [
        "npm --prefix apps/dsa-web exec -- tsc --noEmit --incremental false -p apps/dsa-web/tsconfig.app.json",
        "npm --prefix apps/dsa-web exec -- tsc --noEmit --incremental false -p apps/dsa-web/tsconfig.node.json",
    ]
    assert result.payload["artifact"]["candidate"]["tree"] == "tree"
    bundle = next(command for command in commands if "build:bundle" in command)
    output_dir = Path(bundle[bundle.index("--outDir") + 1])
    assert output_dir != repo / "static"
    assert repo / "apps" / "dsa-web" / "node_modules" not in output_dir.parents
    assert all(command[-1] != "build" for command in commands)


def test_build_artifact_reuses_existing_verified_identity_without_rebuild(monkeypatch, tmp_path: Path) -> None:
    repo, artifact_path = _write_fixture(tmp_path)
    _patch_current(monkeypatch)
    expected = _manifest(repo, artifact_path)
    before = artifact_path.read_bytes()
    monkeypatch.setattr(artifact, "run_typecheck", lambda *_args: (_ for _ in ()).throw(AssertionError("must not rebuild")))

    result = artifact.build_artifact(repo, artifact_path, expected_sha="candidate")

    assert result.ok is True
    assert result.payload == expected
    assert artifact_path.read_bytes() == before


def test_build_artifact_rejects_existing_mismatch_without_replacing_identity(monkeypatch, tmp_path: Path) -> None:
    repo, artifact_path = _write_fixture(tmp_path)
    _patch_current(monkeypatch)
    _manifest(repo, artifact_path)
    (repo / "static" / "assets" / "index.js").write_text("tampered\n", encoding="utf-8")
    before = artifact_path.read_bytes()
    monkeypatch.setattr(artifact, "run_typecheck", lambda *_args: artifact.ArtifactResult(True, {"commands": []}))

    result = artifact.prepare_playwright_artifact(repo, artifact_path, expected_sha="candidate")

    assert result.ok is False
    assert {"existing_artifact_verification_failed", "artifact_asset_mismatch"} <= set(result.error_codes)
    assert artifact_path.read_bytes() == before


def test_verify_artifact_rejects_dirty_tree_and_wrong_sha(monkeypatch, tmp_path: Path) -> None:
    repo, artifact_path = _write_fixture(tmp_path)
    _patch_current(monkeypatch)
    _manifest(repo, artifact_path)
    monkeypatch.setattr(artifact, "_candidate", lambda _repo, expected_sha=None: ({"commit": "other", "tree": "other-tree", "dirty": True}, ["worktree_dirty", "candidate_sha_mismatch"]))

    monkeypatch.setattr(artifact, "run_typecheck", lambda *_args: (_ for _ in ()).throw(AssertionError("must not typecheck")))

    result = artifact.prepare_playwright_artifact(repo, artifact_path, expected_sha="candidate")

    assert result.ok is False
    assert {"worktree_dirty", "candidate_sha_mismatch"} <= set(result.error_codes)


def test_verify_artifact_rejects_lock_config_missing_and_tampered_assets(monkeypatch, tmp_path: Path) -> None:
    repo, artifact_path = _write_fixture(tmp_path)
    _patch_current(monkeypatch)
    _manifest(repo, artifact_path)
    web = repo / "apps" / "dsa-web"
    (web / "package-lock.json").write_text("changed\n", encoding="utf-8")
    (web / "vite.config.ts").write_text("changed\n", encoding="utf-8")
    (repo / "static" / "assets" / "index.js").unlink()

    result = artifact.verify_artifact(repo, artifact_path)

    assert result.ok is False
    assert {"artifact_lockfile_mismatch", "artifact_config_mismatch", "artifact_asset_mismatch"} <= set(result.error_codes)


def test_verify_artifact_rejects_changed_asset_content(monkeypatch, tmp_path: Path) -> None:
    repo, artifact_path = _write_fixture(tmp_path)
    _patch_current(monkeypatch)
    _manifest(repo, artifact_path)
    (repo / "static" / "assets" / "index.js").write_text("console.log('tampered')\n", encoding="utf-8")

    result = artifact.verify_artifact(repo, artifact_path)

    assert result.ok is False
    assert "artifact_asset_mismatch" in result.error_codes


def test_verify_artifact_rejects_manifest_tampering(monkeypatch, tmp_path: Path) -> None:
    repo, artifact_path = _write_fixture(tmp_path)
    _patch_current(monkeypatch)
    manifest = _manifest(repo, artifact_path)
    manifest["toolchain"] = {"node": "v2", "npm": "2"}
    artifact_path.write_text(json.dumps(manifest), encoding="utf-8")

    result = artifact.verify_artifact(repo, artifact_path)

    assert result.ok is False
    assert "artifact_manifest_tampered" in result.error_codes

    source_repo = Path(__file__).resolve().parents[2]
    config = (source_repo / "apps" / "dsa-web" / "playwright.config.ts").read_text(encoding="utf-8")
    package = json.loads((source_repo / "apps" / "dsa-web" / "package.json").read_text(encoding="utf-8"))
    assert package["scripts"]["build:playwright-artifact"] == "python ../../scripts/web_build_artifact.py playwright"
    assert "WOLFYSTOCK_FRONTEND_OUTPUT_DIR" in config
    assert "WOLFYSTOCK_RELEASE_CANDIDATE_SHA" in config
    assert "fileURLToPath(import.meta.url)" in config
    assert "cwd: configRoot" in config
    assert "playwright-web-artifact" in config
    assert "npm run build:playwright-artifact -- --expected-sha ${candidateSha}" in config
    assert "&& ${preview}" in config
    assert "npm run build &&" not in config
    assert "usesExternalServer ? {}" in config
    assert "prebuiltArtifact" in config
    assert "--expected-sha" in config
    assert "executablePath: managedChromiumExecutable" in config
    assert "channel:" not in config
    assert "node_modules/.tmp" not in config
    assert "node_modules/.vite" not in config
