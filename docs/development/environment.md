# Development Environment

> Status: Canonical
> Scope: dependency authority, bootstrap, supported targets, local services, and configuration entrypoints
> Audience: contributors and agents preparing or changing the development/runtime environment

Repository permission and protected-domain rules are in
[`AGENTS.md`](../../AGENTS.md). Validation selection is in
[`docs/development/validation.md`](validation.md).

## Environment Authority

`./wolfy` is the only repository-owned dependency environment authority.
From any checkout or worktree:

```bash
./wolfy bootstrap --ensure
./wolfy lock python --check
./wolfy env verify
./wolfy qualify-env
```

`requirements.txt` preserves direct production-environment intent in explicit
owner sections for application runtime integrations and projection-only
lock/build tools. `requirements-dev.txt` inherits that intent and separately
owns development and test tools. Each direct declaration has one owner and an
inline reason; a package being installed transitively is not a reason to repeat
it as direct intent. For example, the application owns the direct LiteLLM
client, while its resolved `openai` dependency remains in the install closure
without becoming an application direct dependency. These files are not install
locks. `requirements-lock.json` and its CPython 3.11/3.12 lock family are the
reviewed install authority. Each target/profile projection exact-pins
distributions and compatible artifact filenames with SHA-256 coverage. Reviewed
source distributions also bind their build backend and exact build requirements.

Only an explicit dependency review may run:

```bash
./wolfy lock python --update
```

That command uses `uv 0.11.19` only as the resolver and reports direct and
transitive changes separately. Bootstrap, tests, development, CI, and release
qualification never update the lock implicitly. Runtime installation remains
pip-based with `--no-deps --require-hashes`.

`./wolfy bootstrap --ensure` is a required preparation step before
`./wolfy lock python --check`. Bootstrap materializes the exact reviewed uv
archive selected for the normalized host target, verifies its SHA-256 and
version, and records its immutable snapshot in the worktree environment
pointer. The check verifies that pointer and invokes that explicit executable;
it never discovers a resolver through the host `PATH`. A missing or changed
resolver snapshot fails closed. `./wolfy lock python --update` materializes the
same reviewed resolver only as part of that explicit dependency-review action.

The raw-byte-hashed generated Python lock files are checked out as LF on every
platform. Online artifact materialization derives a marker-free download input
from the selected target projection, not from the aggregate marker-rich lock.
Before pip installation, the artifact cache must contain at least one exact
reviewed filename and SHA-256 for every selected distribution; missing,
unexpected, or hash-mismatched cache entries fail closed.

The content-addressed target projection remains the sole artifact authority and
the only download destination. Pip installation consumes a unique temporary
hard-link view directly below the selected cache root only after that projection
passes completeness, unexpected-file, and SHA-256 validation. The shared local
and container installer uses the same view for locked build backends and final
dependencies, validates exact file identity before use, enforces the normal
Windows path boundary, and removes the view after success or failure.

PyArrow is the single reviewed Parquet read/write authority in supported
projections. Do not add a second engine or silent fallback.

## Supported Matrix

Reviewed runtime/development targets are:

- CPython 3.11 Linux x86_64: runtime and development;
- CPython 3.11 Linux aarch64: runtime only;
- CPython 3.11 macOS arm64/x86_64: runtime and development;
- CPython 3.11 Windows AMD64: runtime and development;
- CPython 3.12 macOS arm64/x86_64: runtime and development;
- CPython 3.12 Windows AMD64: runtime and development.

Docker `linux/arm64` and Python-detected Linux `aarch64` select the same
`manylinux_2_36_aarch64` runtime projection. Unsupported target/profile pairs
fail before installation. Static marker, wheel-tag, ABI, and source-build
checks are not real-platform execution evidence.

Release containers map BuildKit `amd64` and `arm64` to the reviewed CPython
3.11 Linux runtime projections. Their dependency builder uses the same lock
authority with `--no-deps --require-hashes --no-build-isolation`; requirements
intent, development locks, and uv do not enter the image install path.

## Snapshots And Offline Bootstrap

Online and offline bootstrap select the same normalized graph and artifact
projection. Offline mode requires verified snapshots and package caches:

```bash
./wolfy bootstrap --ensure --offline
```

A missing artifact fails without network fallback. Python, Web, browser, and
managed-tool snapshots are content-addressed under the OS cache root or the
explicit `WOLFYSTOCK_ENV_CACHE` override. Worktrees link to those immutable
snapshots, never another checkout's mutable `.venv` or `node_modules`. Mutable
snapshot builds use a short cache-root staging directory before atomic
content-addressed promotion. Each final snapshot directory uses one combined
input-and-installed fingerprint so nested Windows package paths do not inherit
two fingerprint directory levels. Windows content verification uses
extended-length filesystem paths while retaining logical relative paths in the
content identity. Location-bearing npm diagnostic strings are normalized to the
snapshot root without removing dependency problem evidence.

The environment authority provisions ripgrep 15.1.0 from the single pinned
release archive selected by normalized OS and architecture. Online bootstrap
materializes that archive under
`artifacts/rg/<reviewed-archive-sha256>/<exact-filename>` and accepts it only
when the selected directory contains that filename alone and its SHA-256
matches. Offline bootstrap can reuse the validated archive but cannot download
or discover host `rg`. The resulting immutable snapshot records the source
archive identity, probes the exact reviewed version, and supplies its explicit
path to managed commands.

The authority provisions the reviewed Python lock resolver in the same way.
The exact `uv 0.11.19` archive is selected by normalized OS and architecture,
validated by SHA-256, extracted into an immutable `tool-uv` snapshot, and
probed before it can resolve or check the lock family. Offline bootstrap can
reuse that verified material but cannot discover or substitute a global `uv`.

On Windows, bootstrap also discovers one host `git.exe` through the environment
authority, probes its exact version, hashes the executable, and records a
path-redacted resolved-path identity in the worktree pointer, environment
evidence, and combined fingerprint. Verification fails if Git is absent,
invalid, changed, or inconsistent with that retained identity. Managed
profiles add only the verified executable's directory at a deterministic PATH
position; they do not inherit the remaining host PATH. Non-Windows profile
projection is unchanged.

The authority also provisions the declared Playwright Chromium revision,
verifies the executable can launch, and supplies it to Playwright. Host `PATH`,
a global browser, or a system-browser fallback is not an equivalent authority.

## Test Profile

The `test` profile removes credentials, production DSNs, admin bootstrap flags,
startup modifiers, proxy settings, and user-data paths. It allocates one
run-scoped SQLite database, cache, logs, uploads, temp files, coverage, pytest
cache, frontend output, and service metadata directory. Successful runs are
removed; a bounded number of failed runs may remain for diagnosis.

Run a command inside that profile with:

```bash
./wolfy exec --profile test -- python -m pytest -q tests/test_offline_network_policy.py
./wolfy exec --profile test -- npm --prefix apps/dsa-web run lint
```

## Task Promotion

`scripts/task_promotion.py` is the repository-owned Git promotion authority for
an already-qualified task candidate. It does not install an environment, run
tests, select validation, interpret release readiness, or own worktree setup and
cleanup. Environment identity comes from `./wolfy env verify`; cleanup delegates
to `scripts/worktree_preflight.py lifecycle`.

From any checkout that shares the candidate's Git common directory, inspect the
sealed plan before LAND:

```bash
python3 scripts/task_promotion.py plan \
  --worktree /absolute/task/worktree \
  --validation-evidence relative/evidence.json \
  --json
```

`plan` is read-only. It requires a clean registered task worktree, a clean
canonical `main` worktree, exact candidate and evidence identities, the current
environment fingerprint and dependency-lock identity, and equality between
local `main` and the explicitly observed remote target ref.

After reviewing the same plan, promote the unchanged candidate with:

```bash
python3 scripts/task_promotion.py land \
  --worktree /absolute/task/worktree \
  --validation-evidence relative/evidence.json \
  --json
```

LAND performs a final fetch, an atomic non-forced fast-forward push of the exact
candidate, fetches and verifies the result, fast-forwards canonical local
`main`, then delegates worktree and compare-and-delete branch cleanup to the
verified lifecycle authority. It never changes the candidate or automatically
replays it onto a newer base. A moved remote or rejected push preserves the
candidate and performs no cleanup. Once remote promotion succeeds, a later
local-main or cleanup failure is reported as partial completion and is not
automatically undone; cleanup refusal is stated as `LAND succeeded, cleanup
incomplete`.

## Environment Qualification

`./wolfy qualify-env` emits redacted environment evidence with a non-null
operation identity. A baseline comparison requires an explicitly clean
baseline checkout and the same environment fingerprint:

```bash
./wolfy qualify-env --findings baseline-findings.json --output baseline-evidence.json
./wolfy qualify-env --baseline-commit <full-clean-baseline-sha> \
  --baseline-evidence baseline-evidence.json --findings current-findings.json
```

The comparison keeps new, unchanged, and removed findings distinct. It does
not add findings to the baseline automatically, and an unchanged release
blocker remains a failure.

## Local Runtime

Start the complete local product from any directory by invoking the checkout's
`wolfy` launcher path:

```bash
/path/to/wolfystock/wolfy dev
/path/to/wolfystock/wolfy dev --stop
```

The command verifies or ensures the managed environment, resolves the checkout
from the launcher location, and starts the frontend at
`http://127.0.0.1:5173` and backend at `http://127.0.0.1:8000`. It loads the
checkout `.env` through the runtime settings authority, inherits configured
host proxy variables, keeps mutable database, cache, build, temporary, log,
upload, and service state outside immutable dependency snapshots, and does not
enable live financial providers.

Both ports are checked before either service starts. An unrelated listener is
reported and never stopped. A repeated start reports the healthy recorded
runtime, while stale metadata is removed only after recorded process identity
checks. Stop needs no run ID, verifies every recorded process before signaling,
and is idempotent.

Automation and concurrent qualification can retain isolated dynamic ports and
explicit run identity through the JSON interface:

```bash
./wolfy dev --json
./wolfy dev --stop <run-id> --json
```

The JSON start result includes environment fingerprint, run ID, URLs, process
IDs, log paths, and readiness.

Product entrypoint variants, under an explicitly configured runtime:

```bash
python main.py --debug
python main.py --dry-run
python main.py --stocks 600519,hk00700,AAPL
python main.py --market-review
python main.py --schedule
python main.py --serve
python main.py --serve-only
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

Desktop currently retains its own local build path:

```bash
cd apps/dsa-desktop
npm install
npm run build
```

This does not make Desktop a second release dependency authority.

## LiteLLM Router Configuration

`litellm_config.example.yaml` is an optional template. Reference secrets through
environment variables, keep the real config untracked, and set
`LITELLM_CONFIG` to the local configuration path. The template does not grant
provider activation or bypass the runtime provider/configuration owners.

Do not place real API keys, credentials, private service URLs, or environment
specific absolute paths in documentation or committed configuration.
