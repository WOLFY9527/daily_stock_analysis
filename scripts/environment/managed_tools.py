from __future__ import annotations

import os
import re
import shutil
import subprocess
import tarfile
import urllib.request
import uuid
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable

from .errors import EnvironmentFailure, OfflineMaterialUnavailable
from .identity import ToolchainIdentity, file_hash, stable_hash


MANAGED_RG_POLICY_VERSION = "wolfystock_managed_rg_v2"
MANAGED_RG_VERSION = "15.1.0"
MANAGED_RG_RELEASE_ROOT = (
    "https://github.com/BurntSushi/ripgrep/releases/download/15.1.0"
)
CommandRunner = Callable[..., subprocess.CompletedProcess[str]]
Downloader = Callable[[str, Path], None]
ExecutableFinder = Callable[[str], str | None]


def _run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, text=True, capture_output=True, check=False, **kwargs)


def _download(url: str, destination: Path) -> None:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "WolfyStock-reviewed-rg/1"},
    )
    with (
        urllib.request.urlopen(request, timeout=60) as source,
        destination.open("xb") as target,
    ):
        shutil.copyfileobj(source, target)


def _platform_identity(toolchain: ToolchainIdentity) -> str:
    architecture = toolchain.architecture.lower()
    architecture = {"aarch64": "arm64", "amd64": "x86_64"}.get(
        architecture, architecture
    )
    return f"{toolchain.os_name.lower()}-{architecture}"


@dataclass(frozen=True)
class WindowsGitIdentity:
    executable: Path
    executable_sha256: str
    resolved_path_sha256: str
    version: str

    def evidence(self) -> dict[str, str]:
        return {
            "executableSha256": self.executable_sha256,
            "resolvedPathSha256": self.resolved_path_sha256,
            "version": self.version,
        }


def _inspect_windows_git(
    executable: Path,
    *,
    command_runner: CommandRunner,
) -> WindowsGitIdentity:
    try:
        resolved = executable.resolve(strict=True)
    except OSError as exc:
        raise EnvironmentFailure(
            "windows_git_invalid", "resolved Windows Git executable is unavailable"
        ) from exc
    if (
        not resolved.is_file()
        or resolved.is_symlink()
        or resolved.name.casefold() != "git.exe"
    ):
        raise EnvironmentFailure(
            "windows_git_invalid", "resolved Windows Git executable is invalid"
        )
    environment = {
        key: os.environ[key]
        for key in ("COMSPEC", "LANG", "LC_ALL", "PATHEXT", "SYSTEMROOT")
        if os.environ.get(key)
    }
    environment["PATH"] = str(resolved.parent)
    try:
        result = command_runner(
            [str(resolved), "--version"],
            env=environment,
            timeout=10,
        )
        executable_sha256 = file_hash(resolved)
    except (OSError, subprocess.SubprocessError) as exc:
        raise EnvironmentFailure(
            "windows_git_probe_failed", "resolved Windows Git identity probe failed"
        ) from exc
    match = re.fullmatch(
        r"git version ([0-9]+\.[0-9]+\.[0-9]+(?:\.[0-9A-Za-z]+)*)",
        result.stdout.strip(),
    )
    if result.returncode != 0 or match is None:
        raise EnvironmentFailure(
            "windows_git_probe_failed", "resolved Windows Git identity probe failed"
        )
    normalized_path = str(resolved).replace("\\", "/").casefold()
    return WindowsGitIdentity(
        executable=resolved,
        executable_sha256=executable_sha256,
        resolved_path_sha256=stable_hash(
            {"windowsGitExecutable": normalized_path}
        ),
        version=match.group(1),
    )


def qualify_windows_git(
    toolchain: ToolchainIdentity,
    *,
    executable_finder: ExecutableFinder = shutil.which,
    command_runner: CommandRunner = _run,
) -> WindowsGitIdentity | None:
    if toolchain.os_name.casefold() != "windows":
        return None
    discovered = executable_finder("git.exe")
    if not discovered:
        raise EnvironmentFailure(
            "windows_git_missing",
            "Git is required for repository-managed Windows profiles",
        )
    return _inspect_windows_git(Path(discovered), command_runner=command_runner)


def verify_windows_git(
    identity: WindowsGitIdentity,
    *,
    command_runner: CommandRunner = _run,
) -> WindowsGitIdentity:
    current = _inspect_windows_git(
        identity.executable,
        command_runner=command_runner,
    )
    if current != identity:
        raise EnvironmentFailure(
            "windows_git_identity_mismatch",
            "resolved Windows Git identity does not match retained environment evidence",
        )
    return current


@dataclass(frozen=True)
class ManagedRgContract:
    version: str
    platform: str
    archive_filename: str
    archive_sha256: str
    archive_member: str
    download_url: str


def _contract(
    platform: str,
    target: str,
    archive_sha256: str,
    *,
    extension: str,
) -> ManagedRgContract:
    archive_filename = f"ripgrep-{MANAGED_RG_VERSION}-{target}.{extension}"
    executable_name = "rg.exe" if platform.startswith("windows-") else "rg"
    return ManagedRgContract(
        version=MANAGED_RG_VERSION,
        platform=platform,
        archive_filename=archive_filename,
        archive_sha256=archive_sha256,
        archive_member=(
            f"ripgrep-{MANAGED_RG_VERSION}-{target}/{executable_name}"
        ),
        download_url=f"{MANAGED_RG_RELEASE_ROOT}/{archive_filename}",
    )


MANAGED_RG_CONTRACTS = {
    "darwin-arm64": _contract(
        "darwin-arm64",
        "aarch64-apple-darwin",
        "378e973289176ca0c6054054ee7f631a065874a352bf43f0fa60ef079b6ba715",
        extension="tar.gz",
    ),
    "darwin-x86_64": _contract(
        "darwin-x86_64",
        "x86_64-apple-darwin",
        "64811cb24e77cac3057d6c40b63ac9becf9082eedd54ca411b475b755d334882",
        extension="tar.gz",
    ),
    "linux-arm64": _contract(
        "linux-arm64",
        "aarch64-unknown-linux-gnu",
        "2b661c6ef508e902f388e9098d9c4c5aca72c87b55922d94abdba830b4dc885e",
        extension="tar.gz",
    ),
    "linux-x86_64": _contract(
        "linux-x86_64",
        "x86_64-unknown-linux-musl",
        "1c9297be4a084eea7ecaedf93eb03d058d6faae29bbc57ecdaf5063921491599",
        extension="tar.gz",
    ),
    "windows-arm64": _contract(
        "windows-arm64",
        "aarch64-pc-windows-msvc",
        "00d931fb5237c9696ca49308818edb76d8eb6fc132761cb2a1bd616b2df02f8e",
        extension="zip",
    ),
    "windows-x86_64": _contract(
        "windows-x86_64",
        "x86_64-pc-windows-msvc",
        "124510b94b6baa3380d051fdf4650eaa80a302c876d611e9dba0b2e18d87493a",
        extension="zip",
    ),
}


def load_managed_rg_contract(toolchain: ToolchainIdentity) -> ManagedRgContract:
    platform = _platform_identity(toolchain)
    try:
        return MANAGED_RG_CONTRACTS[platform]
    except KeyError as exc:
        raise EnvironmentFailure(
            "managed_rg_platform_unsupported",
            f"reviewed rg source does not support platform: {platform}",
        ) from exc


class ManagedRgComponent:
    name = "tool-rg"
    immutable = True

    def __init__(
        self,
        toolchain: ToolchainIdentity,
        *,
        source_cache_root: Path,
        contract: ManagedRgContract | None = None,
        downloader: Downloader = _download,
        command_runner: CommandRunner = _run,
    ) -> None:
        self.contract = contract or load_managed_rg_contract(toolchain)
        self.platform = self.contract.platform
        self.input_fingerprint = stable_hash(
            {
                "policyVersion": MANAGED_RG_POLICY_VERSION,
                "tool": "rg",
                "source": asdict(self.contract),
            }
        )
        self.source_cache_root = source_cache_root
        self.downloader = downloader
        self.command_runner = command_runner

    @property
    def executable_name(self) -> str:
        return "rg.exe" if self.platform.startswith("windows-") else "rg"

    @property
    def source_cache_directory(self) -> Path:
        return self.source_cache_root / self.contract.archive_sha256

    @property
    def source_archive(self) -> Path:
        return self.source_cache_directory / self.contract.archive_filename

    def _verified_source(self) -> Path:
        directory = self.source_cache_directory
        if not directory.is_dir():
            raise OfflineMaterialUnavailable(
                "offline_managed_rg_source_missing",
                "reviewed rg source is absent; run online ./wolfy bootstrap --ensure",
            )
        if directory.is_symlink():
            raise EnvironmentFailure(
                "managed_rg_source_unexpected",
                "reviewed rg source cache contains unexpected material",
            )
        try:
            entries = tuple(directory.iterdir())
        except OSError as exc:
            raise EnvironmentFailure(
                "managed_rg_source_validation_failed",
                "reviewed rg source cache could not be inspected",
            ) from exc
        if (
            {entry.name for entry in entries} != {self.contract.archive_filename}
            or any(not entry.is_file() or entry.is_symlink() for entry in entries)
        ):
            raise EnvironmentFailure(
                "managed_rg_source_unexpected",
                "reviewed rg source cache contains unexpected material",
            )
        archive = self.source_archive
        try:
            digest = file_hash(archive)
        except OSError as exc:
            raise EnvironmentFailure(
                "managed_rg_source_validation_failed",
                "reviewed rg source could not be hashed",
            ) from exc
        if digest != self.contract.archive_sha256:
            raise EnvironmentFailure(
                "managed_rg_source_hash_mismatch",
                f"reviewed rg source hash does not match: {self.contract.archive_filename}",
            )
        return archive

    def _materialize_source(self) -> Path:
        directory = self.source_cache_directory
        try:
            directory.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise EnvironmentFailure(
                "managed_rg_source_cache_creation_failed",
                "reviewed rg source cache could not be created",
            ) from exc
        if not directory.is_dir() or directory.is_symlink():
            raise EnvironmentFailure(
                "managed_rg_source_cache_creation_failed",
                "reviewed rg source cache is not a local directory",
            )
        temporary = directory / (
            f".{self.contract.archive_filename}.{uuid.uuid4().hex}.tmp"
        )
        try:
            try:
                self.downloader(self.contract.download_url, temporary)
            except (OSError, ValueError) as exc:
                raise EnvironmentFailure(
                    "managed_rg_source_download_failed",
                    "reviewed rg source download failed",
                ) from exc
            try:
                valid = (
                    temporary.is_file()
                    and not temporary.is_symlink()
                    and file_hash(temporary) == self.contract.archive_sha256
                )
            except OSError as exc:
                raise EnvironmentFailure(
                    "managed_rg_source_validation_failed",
                    "downloaded reviewed rg source could not be validated",
                ) from exc
            if not valid:
                raise EnvironmentFailure(
                    "managed_rg_source_hash_mismatch",
                    f"reviewed rg source hash does not match: {self.contract.archive_filename}",
                )
            try:
                os.replace(temporary, self.source_archive)
            except OSError as exc:
                raise EnvironmentFailure(
                    "managed_rg_source_promotion_failed",
                    "reviewed rg source could not be promoted",
                ) from exc
        finally:
            try:
                temporary.unlink(missing_ok=True)
            except OSError as exc:
                raise EnvironmentFailure(
                    "managed_rg_source_cleanup_failed",
                    "temporary reviewed rg source could not be removed",
                ) from exc
        return self._verified_source()

    def _extract_executable(self, archive: Path, executable: Path) -> None:
        try:
            if self.contract.archive_filename.endswith(".zip"):
                with zipfile.ZipFile(archive) as bundle:
                    matches = [
                        info
                        for info in bundle.infolist()
                        if info.filename == self.contract.archive_member
                        and not info.is_dir()
                    ]
                    if len(matches) != 1:
                        raise EnvironmentFailure(
                            "managed_rg_source_archive_invalid",
                            "reviewed rg archive does not contain exactly one executable",
                        )
                    with bundle.open(matches[0]) as source, executable.open("xb") as target:
                        shutil.copyfileobj(source, target)
            else:
                with tarfile.open(archive, mode="r:gz") as bundle:
                    member = bundle.getmember(self.contract.archive_member)
                    source = bundle.extractfile(member) if member.isfile() else None
                    if source is None:
                        raise EnvironmentFailure(
                            "managed_rg_source_archive_invalid",
                            "reviewed rg archive does not contain its executable",
                        )
                    with source, executable.open("xb") as target:
                        shutil.copyfileobj(source, target)
        except EnvironmentFailure:
            raise
        except (KeyError, OSError, tarfile.TarError, zipfile.BadZipFile) as exc:
            raise EnvironmentFailure(
                "managed_rg_source_archive_invalid",
                "reviewed rg source archive is invalid",
            ) from exc

    def build(self, destination: Path, *, offline: bool) -> None:
        try:
            source = self._verified_source()
        except OfflineMaterialUnavailable:
            if offline:
                raise
            source = self._materialize_source()
        destination.mkdir(parents=True, exist_ok=True)
        executable = destination / self.executable_name
        self._extract_executable(source, executable)
        if not self.platform.startswith("windows-"):
            executable.chmod(executable.stat().st_mode | 0o500)

    def inspect(self, snapshot: Path) -> dict[str, object]:
        executable = snapshot / self.executable_name
        if not executable.is_file():
            raise EnvironmentFailure(
                "managed_rg_executable_missing", "managed rg executable is missing"
            )
        environment = {
            key: os.environ[key]
            for key in ("COMSPEC", "LANG", "LC_ALL", "PATHEXT", "SYSTEMROOT")
            if os.environ.get(key)
        }
        environment["PATH"] = os.pathsep.join((str(snapshot), "/usr/bin", "/bin"))
        result = self.command_runner([str(executable), "--version"], env=environment)
        first_line = result.stdout.splitlines()[0] if result.stdout.splitlines() else ""
        match = re.fullmatch(
            r"ripgrep ([0-9]+\.[0-9]+\.[0-9]+)(?: \(rev [0-9a-f]+\))?",
            first_line.strip(),
        )
        if result.returncode != 0 or match is None:
            raise EnvironmentFailure(
                "managed_rg_probe_failed", "managed rg identity probe failed"
            )
        if match.group(1) != self.contract.version:
            raise EnvironmentFailure(
                "managed_rg_version_mismatch",
                "managed rg version does not match the reviewed source",
            )
        return {
            "executable": self.executable_name,
            "executableSha256": file_hash(executable),
            "platform": self.platform,
            "sourceArchive": self.contract.archive_filename,
            "sourceSha256": self.contract.archive_sha256,
            "version": self.contract.version,
        }

    def verify(self, snapshot: Path, manifest: dict[str, object]) -> None:
        if self.inspect(snapshot) != manifest.get("installed"):
            raise EnvironmentFailure(
                "managed_rg_identity_mismatch", "managed rg installed identity does not match"
            )

    def prepare_promotion(self, temporary: Path, final: Path) -> None:
        return None
