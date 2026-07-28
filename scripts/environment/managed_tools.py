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
from .python_lock import RESOLVER_IMPLEMENTATION, RESOLVER_VERSION


MANAGED_RG_POLICY_VERSION = "wolfystock_managed_rg_v2"
MANAGED_RG_VERSION = "15.1.0"
MANAGED_RG_RELEASE_ROOT = (
    "https://github.com/BurntSushi/ripgrep/releases/download/15.1.0"
)
MANAGED_UV_POLICY_VERSION = "wolfystock_managed_uv_v1"
MANAGED_UV_RELEASE_ROOT = (
    "https://releases.astral.sh/github/uv/releases/download/" + RESOLVER_VERSION
)
CommandRunner = Callable[..., subprocess.CompletedProcess[str]]
Downloader = Callable[[str, Path], None]
ExecutableFinder = Callable[[str], str | None]


def _run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, text=True, capture_output=True, check=False, **kwargs)


def _download(url: str, destination: Path) -> None:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "WolfyStock-reviewed-tool/1"},
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


@dataclass(frozen=True)
class ManagedUvContract:
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


def _uv_contract(
    platform: str,
    target: str,
    archive_sha256: str,
    *,
    extension: str,
    archive_member: str | None = None,
) -> ManagedUvContract:
    archive_filename = f"{RESOLVER_IMPLEMENTATION}-{target}.{extension}"
    executable_name = "uv.exe" if platform.startswith("windows-") else "uv"
    return ManagedUvContract(
        version=RESOLVER_VERSION,
        platform=platform,
        archive_filename=archive_filename,
        archive_sha256=archive_sha256,
        archive_member=archive_member or f"{RESOLVER_IMPLEMENTATION}-{target}/{executable_name}",
        download_url=f"{MANAGED_UV_RELEASE_ROOT}/{archive_filename}",
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


MANAGED_UV_CONTRACTS = {
    "darwin-arm64": _uv_contract(
        "darwin-arm64",
        "aarch64-apple-darwin",
        "d8f59c38e8c4168ee468d423cd63184be12fa6995a4283d41ee1a14d003c9453",
        extension="tar.gz",
    ),
    "darwin-x86_64": _uv_contract(
        "darwin-x86_64",
        "x86_64-apple-darwin",
        "1585f415cade9f061e7f00fe5b00030a79ccfac60c650242ce639ba946138d40",
        extension="tar.gz",
    ),
    "linux-arm64": _uv_contract(
        "linux-arm64",
        "aarch64-unknown-linux-gnu",
        "83b13ab184a45b7d9a3b0e4b10eaebd50ad41e66cb16dcce8e60aa7be13ae399",
        extension="tar.gz",
    ),
    "linux-x86_64": _uv_contract(
        "linux-x86_64",
        "x86_64-unknown-linux-gnu",
        "7035608168e106375b36d0c818d537a889c51a8625fe7f8f7cad5e62b947c368",
        extension="tar.gz",
    ),
    "windows-x86_64": _uv_contract(
        "windows-x86_64",
        "x86_64-pc-windows-msvc",
        "1665fc8e37b5d70a134820d6d7891747471a2ac8bc940ee7af0b69fd03b28d61",
        extension="zip",
        archive_member="uv.exe",
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


def load_managed_uv_contract(toolchain: ToolchainIdentity) -> ManagedUvContract:
    platform = _platform_identity(toolchain)
    try:
        return MANAGED_UV_CONTRACTS[platform]
    except KeyError as exc:
        raise EnvironmentFailure(
            "managed_uv_platform_unsupported",
            f"reviewed uv source does not support platform: {platform}",
        ) from exc


class ManagedRgComponent:
    name = "tool-rg"
    immutable = True
    policy_version = MANAGED_RG_POLICY_VERSION
    tool_name = "rg"
    error_prefix = "managed_rg"
    source_label = "rg"

    def __init__(
        self,
        toolchain: ToolchainIdentity,
        *,
        source_cache_root: Path,
        contract: ManagedRgContract | ManagedUvContract | None = None,
        downloader: Downloader = _download,
        command_runner: CommandRunner = _run,
    ) -> None:
        self.contract = contract or load_managed_rg_contract(toolchain)
        self.platform = self.contract.platform
        self.input_fingerprint = stable_hash(
            {
                "policyVersion": self.policy_version,
                "tool": self.tool_name,
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

    def _failure(self, suffix: str, detail: str) -> EnvironmentFailure:
        return EnvironmentFailure(f"{self.error_prefix}_{suffix}", detail)

    def _parse_version(self, first_line: str) -> str | None:
        match = re.fullmatch(
            r"ripgrep ([0-9]+\.[0-9]+\.[0-9]+)(?: \(rev [0-9a-f]+\))?",
            first_line.strip(),
        )
        return match.group(1) if match is not None else None

    def _verified_source(self) -> Path:
        directory = self.source_cache_directory
        if not directory.is_dir():
            raise OfflineMaterialUnavailable(
                f"offline_{self.error_prefix}_source_missing",
                f"reviewed {self.source_label} source is absent; run online ./wolfy bootstrap --ensure",
            )
        if directory.is_symlink():
            raise self._failure(
                "source_unexpected",
                f"reviewed {self.source_label} source cache contains unexpected material",
            )
        try:
            entries = tuple(directory.iterdir())
        except OSError as exc:
            raise self._failure(
                "source_validation_failed",
                f"reviewed {self.source_label} source cache could not be inspected",
            ) from exc
        if (
            {entry.name for entry in entries} != {self.contract.archive_filename}
            or any(not entry.is_file() or entry.is_symlink() for entry in entries)
        ):
            raise self._failure(
                "source_unexpected",
                f"reviewed {self.source_label} source cache contains unexpected material",
            )
        archive = self.source_archive
        try:
            digest = file_hash(archive)
        except OSError as exc:
            raise self._failure(
                "source_validation_failed",
                f"reviewed {self.source_label} source could not be hashed",
            ) from exc
        if digest != self.contract.archive_sha256:
            raise self._failure(
                "source_hash_mismatch",
                f"reviewed {self.source_label} source hash does not match: {self.contract.archive_filename}",
            )
        return archive

    def _materialize_source(self) -> Path:
        directory = self.source_cache_directory
        try:
            directory.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise self._failure(
                "source_cache_creation_failed",
                f"reviewed {self.source_label} source cache could not be created",
            ) from exc
        if not directory.is_dir() or directory.is_symlink():
            raise self._failure(
                "source_cache_creation_failed",
                f"reviewed {self.source_label} source cache is not a local directory",
            )
        temporary = directory / (
            f".{self.contract.archive_filename}.{uuid.uuid4().hex}.tmp"
        )
        try:
            try:
                self.downloader(self.contract.download_url, temporary)
            except (OSError, ValueError) as exc:
                raise self._failure(
                    "source_download_failed",
                    f"reviewed {self.source_label} source download failed",
                ) from exc
            try:
                valid = (
                    temporary.is_file()
                    and not temporary.is_symlink()
                    and file_hash(temporary) == self.contract.archive_sha256
                )
            except OSError as exc:
                raise self._failure(
                    "source_validation_failed",
                    f"downloaded reviewed {self.source_label} source could not be validated",
                ) from exc
            if not valid:
                raise self._failure(
                    "source_hash_mismatch",
                    f"reviewed {self.source_label} source hash does not match: {self.contract.archive_filename}",
                )
            try:
                os.replace(temporary, self.source_archive)
            except OSError as exc:
                raise self._failure(
                    "source_promotion_failed",
                    f"reviewed {self.source_label} source could not be promoted",
                ) from exc
        finally:
            try:
                temporary.unlink(missing_ok=True)
            except OSError as exc:
                raise self._failure(
                    "source_cleanup_failed",
                    f"temporary reviewed {self.source_label} source could not be removed",
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
                        raise self._failure(
                            "source_archive_invalid",
                            f"reviewed {self.source_label} archive does not contain exactly one executable",
                        )
                    with bundle.open(matches[0]) as source, executable.open("xb") as target:
                        shutil.copyfileobj(source, target)
            else:
                with tarfile.open(archive, mode="r:gz") as bundle:
                    member = bundle.getmember(self.contract.archive_member)
                    source = bundle.extractfile(member) if member.isfile() else None
                    if source is None:
                        raise self._failure(
                            "source_archive_invalid",
                            f"reviewed {self.source_label} archive does not contain its executable",
                        )
                    with source, executable.open("xb") as target:
                        shutil.copyfileobj(source, target)
        except EnvironmentFailure:
            raise
        except (KeyError, OSError, tarfile.TarError, zipfile.BadZipFile) as exc:
            raise self._failure(
                "source_archive_invalid",
                f"reviewed {self.source_label} source archive is invalid",
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
            raise self._failure(
                "executable_missing", f"managed {self.source_label} executable is missing"
            )
        environment = {
            key: os.environ[key]
            for key in ("COMSPEC", "LANG", "LC_ALL", "PATHEXT", "SYSTEMROOT")
            if os.environ.get(key)
        }
        environment["PATH"] = os.pathsep.join((str(snapshot), "/usr/bin", "/bin"))
        result = self.command_runner([str(executable), "--version"], env=environment)
        first_line = result.stdout.splitlines()[0] if result.stdout.splitlines() else ""
        version = self._parse_version(first_line)
        if result.returncode != 0 or version is None:
            raise self._failure(
                "probe_failed", f"managed {self.source_label} identity probe failed"
            )
        if version != self.contract.version:
            raise self._failure(
                "version_mismatch",
                f"managed {self.source_label} version does not match the reviewed source",
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
            raise self._failure(
                "identity_mismatch", f"managed {self.source_label} installed identity does not match"
            )

    def prepare_promotion(self, temporary: Path, final: Path) -> None:
        return None


class ManagedUvComponent(ManagedRgComponent):
    name = "tool-uv"
    policy_version = MANAGED_UV_POLICY_VERSION
    tool_name = RESOLVER_IMPLEMENTATION
    error_prefix = "managed_uv"
    source_label = "uv resolver"

    def __init__(
        self,
        toolchain: ToolchainIdentity,
        *,
        source_cache_root: Path,
        contract: ManagedUvContract | None = None,
        downloader: Downloader = _download,
        command_runner: CommandRunner = _run,
    ) -> None:
        super().__init__(
            toolchain,
            source_cache_root=source_cache_root,
            contract=contract or load_managed_uv_contract(toolchain),
            downloader=downloader,
            command_runner=command_runner,
        )

    @property
    def executable_name(self) -> str:
        return "uv.exe" if self.platform.startswith("windows-") else "uv"

    def _parse_version(self, first_line: str) -> str | None:
        identity = first_line.strip().split()
        if (
            len(identity) < 2
            or identity[0] != RESOLVER_IMPLEMENTATION
            or re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", identity[1]) is None
        ):
            return None
        return identity[1]
