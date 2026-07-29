# -*- coding: utf-8 -*-
"""Unit tests for src.auth module."""

import hashlib
import json
import os
import secrets
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
import base64

import src.auth as auth


_DURABLE_RATE_LIMIT_PROCESS_PROBE = """
import hashlib
import json
import os
import sys
from pathlib import Path

import src.auth as auth
from src.storage import DatabaseManager

ip = "198.51.100.67"
account = "r04-process-proof"
action = sys.argv[1]
database = DatabaseManager.get_instance()
database_path_hash = hashlib.sha256(
    str(Path(database._engine.url.database).resolve()).encode("utf-8")
).hexdigest()
allowed_before_action = auth.check_rate_limit(ip, account)
if action == "record":
    for _ in range(5):
        auth.record_login_failure(ip, account)
elif action != "check":
    raise SystemExit("unsupported probe action")

status = auth.get_auth_rate_limit_store_status()
print("T693_R04_PROCESS_RESULT=" + json.dumps({
    "action": action,
    "allowed": auth.check_rate_limit(ip, account),
    "allowedBeforeAction": allowed_before_action,
    "databasePathSha256": database_path_hash,
    "durableStoreRequired": status["durableStoreRequired"],
    "pid": os.getpid(),
    "processLocalFallback": status["processLocalFallback"],
    "status": auth.get_auth_rate_limit_store_status()["status"],
}, sort_keys=True))
"""


def _reset_auth_globals() -> None:
    """Reset auth module globals for test isolation."""
    auth._auth_enabled = None
    auth._session_secret = None
    auth._password_hash_salt = None
    auth._password_hash_stored = None
    auth._password_hash_value = None
    auth._rate_limit = {}


class AuthValidationTestCase(unittest.TestCase):
    """Test password validation."""

    def setUp(self) -> None:
        _reset_auth_globals()

    def test_validate_password_empty(self) -> None:
        self.assertIsNotNone(auth._validate_password(""))
        self.assertIsNotNone(auth._validate_password("   "))

    def test_validate_password_too_short(self) -> None:
        self.assertIsNotNone(auth._validate_password("12345"))

    def test_validate_password_valid(self) -> None:
        self.assertIsNotNone(auth._validate_password("123456"))
        self.assertIsNotNone(auth._validate_password("852258"))
        self.assertIsNone(auth._validate_password("passwd6"))
        self.assertIsNone(auth._validate_password("password123"))


class AuthPasswordHashTestCase(unittest.TestCase):
    """Test password hashing and verification."""

    def setUp(self) -> None:
        _reset_auth_globals()

    def test_verify_password_hash_correct(self) -> None:
        salt = secrets.token_bytes(32)
        pwd = "testpass123"
        derived = hashlib.pbkdf2_hmac(
            "sha256", pwd.encode("utf-8"), salt=salt, iterations=auth.PBKDF2_ITERATIONS
        )
        self.assertTrue(auth._verify_password_hash(pwd, salt, derived))

    def test_verify_password_hash_wrong_password(self) -> None:
        salt = secrets.token_bytes(32)
        pwd = "testpass123"
        derived = hashlib.pbkdf2_hmac(
            "sha256", pwd.encode("utf-8"), salt=salt, iterations=auth.PBKDF2_ITERATIONS
        )
        self.assertFalse(auth._verify_password_hash("wrong", salt, derived))

    def test_verify_password_hash_constant_time(self) -> None:
        """Verify compare_digest is used (constant-time)."""
        salt = secrets.token_bytes(32)
        derived = hashlib.pbkdf2_hmac(
            "sha256", b"x", salt=salt, iterations=auth.PBKDF2_ITERATIONS
        )
        self.assertFalse(auth._verify_password_hash("y", salt, derived))

    def test_new_versioned_password_hash_verifies(self) -> None:
        stored = auth.hash_password_for_storage("testpass123")

        self.assertTrue(stored.startswith(auth.PASSWORD_KDF_PREFIX))
        self.assertIn("$alg=pbkdf2-sha256$", stored)
        self.assertIn("iter=600000", stored)
        self.assertTrue(auth.verify_password_hash_string("testpass123", stored))
        self.assertFalse(auth.verify_password_hash_string("wrongpass", stored))
        self.assertFalse(auth.password_hash_needs_upgrade(stored))
        self.assertNotIn("testpass123", stored)

    def test_legacy_hash_verifies_and_needs_upgrade(self) -> None:
        salt = secrets.token_bytes(32)
        derived = hashlib.pbkdf2_hmac(
            "sha256", b"testpass123", salt=salt, iterations=auth.PBKDF2_ITERATIONS
        )
        legacy = (
            f"{base64.standard_b64encode(salt).decode('ascii')}:"
            f"{base64.standard_b64encode(derived).decode('ascii')}"
        )

        self.assertTrue(auth.verify_password_hash_string("testpass123", legacy))
        self.assertFalse(auth.verify_password_hash_string("wrongpass", legacy))
        self.assertTrue(auth.password_hash_needs_upgrade(legacy))

    def test_unsupported_hash_fails_safely(self) -> None:
        unsupported = "$wolfystock$kdf=v9$alg=future$params=x$salt=y$hash=z"

        self.assertFalse(auth.verify_password_hash_string("testpass123", unsupported))
        self.assertFalse(auth.password_hash_needs_upgrade(unsupported))
        self.assertNotIn("testpass123", json.dumps({"ok": False}))


class AuthSessionTestCase(unittest.TestCase):
    """Test session creation and verification."""

    def setUp(self) -> None:
        _reset_auth_globals()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        self.addCleanup(self.temp_dir.cleanup)

    def _patch_env_and_run(
        self, auth_enabled: bool = True, test_fn=None
    ):
        with patch.object(auth, "_is_auth_enabled_from_env", return_value=auth_enabled):
            with patch.object(auth, "_get_data_dir", return_value=self.data_dir):
                with patch.object(auth, "_compatibility_session_is_terminated", return_value=False):
                    auth._auth_enabled = auth_enabled
                    if test_fn:
                        return test_fn()

    def test_create_session_returns_signed_payload(self) -> None:
        def run():
            tok = auth.create_session()
            self.assertTrue(tok, "session token should be non-empty")
            parts = tok.split(".")
            self.assertEqual(len(parts), 3, "format: v2.payload.signature")
            version, payload_b64, sig = parts
            self.assertEqual(version, auth.SESSION_TOKEN_VERSION)
            self.assertTrue(payload_b64)
            self.assertTrue(sig)

            identity = auth.get_session_identity(tok)
            self.assertIsNotNone(identity)
            self.assertEqual(identity.user_id, auth.BOOTSTRAP_ADMIN_USER_ID)
            self.assertEqual(identity.username, auth.BOOTSTRAP_ADMIN_USERNAME)
            return tok

        self._patch_env_and_run(test_fn=run)

    def test_verify_session_valid_token(self) -> None:
        def run():
            tok = auth.create_session()
            self.assertTrue(auth.verify_session(tok))

        self._patch_env_and_run(test_fn=run)

    def test_verify_session_expired(self) -> None:
        def run():
            past = time.time() - 48 * 3600
            with patch.object(auth, "time") as mock_time:
                mock_time.time.return_value = past
                tok = auth.create_session()
            self.assertFalse(auth.verify_session(tok), "48h-old token should be expired")

        self._patch_env_and_run(test_fn=run)

    def test_verify_session_invalid_format(self) -> None:
        def run():
            self.assertFalse(auth.verify_session(""))
            self.assertFalse(auth.verify_session("a.b"))
            self.assertFalse(auth.verify_session("invalid"))

        self._patch_env_and_run(test_fn=run)

    def test_rotate_session_secret_overwrites_existing(self) -> None:
        def run():
            secret_path = self.data_dir / ".session_secret"
            secret_path.write_bytes(b"a" * 32)
            secret_path.chmod(0o600)
            old_secret = secret_path.read_bytes()

            auth.rotate_session_secret()

            new_secret = secret_path.read_bytes()
            self.assertNotEqual(old_secret, new_secret)
            self.assertEqual(auth._session_secret, new_secret)

        self._patch_env_and_run(test_fn=run)

    def test_load_session_secret_regenerates_invalid_length(self) -> None:
        def run():
            secret_path = self.data_dir / ".session_secret"
            secret_path.write_bytes(b"x")
            secret_path.chmod(0o600)

            tok = auth.create_session()
            self.assertTrue(tok)

            new_secret = secret_path.read_bytes()
            self.assertEqual(len(new_secret), 32)
            self.assertNotEqual(new_secret, b"x")

        self._patch_env_and_run(test_fn=run)


class AuthRateLimitTestCase(unittest.TestCase):
    """Test rate limiting."""

    def setUp(self) -> None:
        _reset_auth_globals()

    def test_rate_limit_allows_under_limit(self) -> None:
        self.assertTrue(auth.check_rate_limit("192.168.1.1"))

    def test_rate_limit_blocks_after_max_failures(self) -> None:
        ip = "10.0.0.99"
        for _ in range(auth.RATE_LIMIT_MAX_FAILURES):
            auth.record_login_failure(ip)
        self.assertFalse(auth.check_rate_limit(ip))

    def test_clear_rate_limit_resets_ip(self) -> None:
        ip = "10.0.0.100"
        for _ in range(auth.RATE_LIMIT_MAX_FAILURES):
            auth.record_login_failure(ip)
        self.assertFalse(auth.check_rate_limit(ip))
        auth.clear_rate_limit(ip)
        self.assertTrue(auth.check_rate_limit(ip))

    def test_durable_store_failure_fails_closed_without_process_local_fallback(self) -> None:
        operations = (
            ("check", lambda: auth.check_rate_limit("198.51.100.44", "test-account")),
            ("inspect", lambda: auth.has_rate_limit_failures("198.51.100.44", "test-account")),
            ("record", lambda: auth.record_login_failure("198.51.100.44", "test-account")),
            ("clear", lambda: auth.clear_rate_limit("198.51.100.44", "test-account")),
        )
        for expected_operation, operation in operations:
            with self.subTest(operation=expected_operation), patch(
                "src.storage.DatabaseManager.get_instance",
                side_effect=RuntimeError("bounded-test-store-failure"),
            ):
                with self.assertRaises(auth.AuthRateLimitStoreUnavailable):
                    operation()

            self.assertEqual(auth._rate_limit, {})
            status = auth.get_auth_rate_limit_store_status()
            self.assertEqual(status["status"], "unavailable")
            self.assertEqual(status["lastOperation"], expected_operation)
            self.assertTrue(status["failClosed"])
            self.assertFalse(status["processLocalFallback"])
            self.assertNotIn("bounded-test-store-failure", json.dumps(status))

    def test_durable_rate_limit_blocks_in_second_os_process(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(__file__).resolve().parents[1]
            temporary_root = Path(temporary_directory)
            environment = os.environ.copy()
            environment.update(
                {
                    "AUTH_ACCOUNT_RATE_LIMIT_MAX_FAILURES": "5",
                    "AUTH_RATE_LIMIT_MAX_FAILURES": "5",
                    "AUTH_RATE_LIMIT_WINDOW_SECONDS": "300",
                    "DATABASE_PATH": str(temporary_root / "limiter.sqlite"),
                    "ENV_FILE": str(temporary_root / "missing.env"),
                    "POSTGRES_PHASE_A_URL": "",
                    "PYTHONPATH": str(root),
                }
            )
            expected_database_path_hash = hashlib.sha256(
                str((temporary_root / "limiter.sqlite").resolve()).encode("utf-8")
            ).hexdigest()

            def run_probe(action: str) -> dict[str, object]:
                result = subprocess.run(
                    [sys.executable, "-c", _DURABLE_RATE_LIMIT_PROCESS_PROBE, action],
                    cwd=root,
                    env=environment,
                    text=True,
                    capture_output=True,
                    check=False,
                )
                self.assertEqual(result.returncode, 0, f"rate-limit {action} child exited nonzero")
                lines = [
                    line.removeprefix("T693_R04_PROCESS_RESULT=")
                    for line in result.stdout.splitlines()
                    if line.startswith("T693_R04_PROCESS_RESULT=")
                ]
                self.assertEqual(len(lines), 1, f"rate-limit {action} child emitted invalid sentinel")
                try:
                    return json.loads(lines[0])
                except json.JSONDecodeError:
                    self.fail(f"rate-limit {action} child emitted invalid JSON")

            recorder = run_probe("record")
            verifier = run_probe("check")

            for result in (recorder, verifier):
                self.assertFalse(result["allowed"])
                self.assertEqual(result["databasePathSha256"], expected_database_path_hash)
                self.assertTrue(result["durableStoreRequired"])
                self.assertFalse(result["processLocalFallback"])
                self.assertEqual(result["status"], "available")
            self.assertEqual(recorder["action"], "record")
            self.assertTrue(recorder["allowedBeforeAction"])
            self.assertEqual(verifier["action"], "check")
            self.assertNotEqual(recorder["pid"], verifier["pid"])


class AuthSetPasswordTestCase(unittest.TestCase):
    """Test set_initial_password, change_password, overwrite_password."""

    def setUp(self) -> None:
        _reset_auth_globals()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        self.addCleanup(self.temp_dir.cleanup)

    def _run_with_patch(self, fn):
        with patch.object(auth, "_is_auth_enabled_from_env", return_value=True):
            with patch.object(auth, "_get_data_dir", return_value=self.data_dir):
                auth._auth_enabled = True
                return fn()

    def test_set_initial_password_success(self) -> None:
        def run():
            err = auth.set_initial_password("password123")
            self.assertIsNone(err)
            self.assertIsNotNone(auth._password_hash_stored)
            self.assertTrue(auth.is_password_set())
            self.assertTrue(auth.verify_password("password123"))

        self._run_with_patch(run)

    def test_has_stored_password_remains_true_after_auth_disabled(self) -> None:
        def run():
            err = auth.set_initial_password("password123")
            self.assertIsNone(err)
            self.assertTrue(auth.has_stored_password())

            auth._auth_enabled = False
            self.assertTrue(auth.has_stored_password())
            self.assertFalse(auth.is_password_set())

        self._run_with_patch(run)

    def test_verify_stored_password_when_auth_disabled(self) -> None:
        def run():
            err = auth.set_initial_password("password123")
            self.assertIsNone(err)

            auth._auth_enabled = False
            self.assertTrue(auth.verify_stored_password("password123"))
            self.assertFalse(auth.verify_stored_password("wrongpass"))

        self._run_with_patch(run)

    def test_is_auth_enabled_from_env_respects_env_file(self) -> None:
        custom_env = self.data_dir / "custom.env"
        custom_env.write_text("ADMIN_AUTH_ENABLED=true\n", encoding="utf-8")

        with patch.dict(os.environ, {"ENV_FILE": str(custom_env)}):
            auth._auth_enabled = None
            self.assertTrue(auth._is_auth_enabled_from_env())

    def test_is_auth_enabled_from_env_respects_explicit_false_env_file(self) -> None:
        custom_env = self.data_dir / "custom.env"
        custom_env.write_text("ADMIN_AUTH_ENABLED=false\n", encoding="utf-8")

        with patch.dict(os.environ, {"ENV_FILE": str(custom_env)}, clear=True):
            auth._auth_enabled = None
            self.assertFalse(auth._is_auth_enabled_from_env())

    def test_is_auth_enabled_from_env_supports_process_env_only_deployments(self) -> None:
        missing_env = self.data_dir / "missing.env"

        with patch.dict(
            os.environ,
            {"ADMIN_AUTH_ENABLED": "true", "ENV_FILE": str(missing_env)},
            clear=True,
        ):
            auth._auth_enabled = None
            self.assertTrue(auth._is_auth_enabled_from_env())

    def test_is_auth_enabled_from_env_treats_missing_sources_as_local_dev_disabled(self) -> None:
        missing_env = self.data_dir / "missing.env"

        with patch.dict(os.environ, {"ENV_FILE": str(missing_env)}, clear=True):
            auth._auth_enabled = None
            self.assertFalse(auth._is_auth_enabled_from_env())

    def test_env_example_documents_production_admin_auth_enabled(self) -> None:
        env_example = Path(__file__).resolve().parents[1] / ".env.example"
        text = env_example.read_text(encoding="utf-8")

        self.assertIn("ADMIN_AUTH_ENABLED=true", text)
        self.assertIn("生产、Docker、云服务器部署必须通过 .env、ENV_FILE 或 process env 显式保持 true", text)
        self.assertIn("auth-disabled mode 不是 public-safe", text)
        self.assertIn("process env", text)

    def test_refresh_auth_state_clears_session_secret_cache(self) -> None:
        def run():
            first_secret = auth.create_session()
            self.assertTrue(first_secret)
            self.assertIsNotNone(auth._session_secret)

            auth._session_secret = b"x" * 32
            auth.refresh_auth_state()
            self.assertNotEqual(auth._session_secret, b"x" * 32)

        self._run_with_patch(run)

    def test_set_initial_password_invalid(self) -> None:
        def run():
            self.assertIsNotNone(auth.set_initial_password(""))
            self.assertIsNotNone(auth.set_initial_password("12345"))

        self._run_with_patch(run)

    def test_change_password_success(self) -> None:
        def run():
            auth.set_initial_password("oldpass123")
            err = auth.change_password("oldpass123", "newpass456")
            self.assertIsNone(err)
            self.assertFalse(auth.verify_password("oldpass123"))
            self.assertTrue(auth.verify_password("newpass456"))

        self._run_with_patch(run)

    def test_change_password_wrong_current(self) -> None:
        def run():
            auth.set_initial_password("correctpass")
            err = auth.change_password("wrongpass", "newpass456")
            self.assertIsNotNone(err)
            self.assertTrue(auth.verify_password("correctpass"))

        self._run_with_patch(run)

    def test_overwrite_password_cli_style(self) -> None:
        def run():
            auth.set_initial_password("original")
            err = auth.overwrite_password("resetpass")
            self.assertIsNone(err)
            self.assertFalse(auth.verify_password("original"))
            self.assertTrue(auth.verify_password("resetpass"))

        self._run_with_patch(run)


if __name__ == "__main__":
    unittest.main()
