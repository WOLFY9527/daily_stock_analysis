from __future__ import annotations

import importlib
import inspect
import sys
from types import SimpleNamespace

import pytest


def test_server_entrypoint_verifies_immutable_frontend_artifact_before_import(monkeypatch) -> None:
    calls: list[str] = []

    import api as api_package
    import src.webui_frontend as webui_frontend

    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.setattr(
        webui_frontend,
        "verify_webui_frontend_artifact",
        lambda: calls.append("verify") or SimpleNamespace(ok=True, error_codes=[]),
        raising=False,
    )
    monkeypatch.setattr(
        webui_frontend,
        "prepare_webui_frontend_assets",
        lambda: (_ for _ in ()).throw(AssertionError("direct server startup must not prepare or build")),
    )
    previous_api_app = sys.modules.pop("api.app", None)
    previous_package_app = getattr(api_package, "app", None)
    sys.modules.pop("server", None)

    try:
        server_module = importlib.import_module("server")
        container = server_module.app.state.runtime_container
        assert server_module.config.runtime_settings is container.runtime_settings
        assert container.config is server_module.config
        snapshot = server_module.config.runtime_settings
        server_source = inspect.getsource(server_module)
        assert "host=config.webui_host" in server_source
        assert "port=config.webui_port" in server_source
        monkeypatch.setenv("MAX_WORKERS", "99")
        importlib.reload(server_module)
        assert server_module.config.runtime_settings is snapshot
    finally:
        sys.modules.pop("server", None)
        if previous_api_app is not None:
            sys.modules["api.app"] = previous_api_app
        if previous_package_app is None and hasattr(api_package, "app"):
            delattr(api_package, "app")
        elif previous_package_app is not None:
            api_package.app = previous_package_app

    assert calls == ["verify", "verify"]


def test_server_entrypoint_rejects_invalid_artifact_before_app_import(monkeypatch) -> None:
    import api as api_package
    import src.webui_frontend as webui_frontend

    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.setattr(
        webui_frontend,
        "verify_webui_frontend_artifact",
        lambda: SimpleNamespace(ok=False, error_codes=["artifact_manifest_unreadable"]),
        raising=False,
    )
    previous_api_app = sys.modules.pop("api.app", None)
    previous_package_app = getattr(api_package, "app", None)
    sys.modules.pop("server", None)

    try:
        with pytest.raises(RuntimeError, match="artifact_manifest_unreadable"):
            importlib.import_module("server")
        assert "api.app" not in sys.modules
    finally:
        sys.modules.pop("server", None)
        if previous_api_app is not None:
            sys.modules["api.app"] = previous_api_app
        if previous_package_app is None and hasattr(api_package, "app"):
            delattr(api_package, "app")
        elif previous_package_app is not None:
            api_package.app = previous_package_app
