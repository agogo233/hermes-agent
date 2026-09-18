"""A configured custom (OpenAI-compatible) endpoint is explicit provider intent.

Regression for #108383: ``resolve_provider("auto")`` recognised only registry providers from
``model.provider``, so the boot inventory (``free_tier_bootstrap``) read a llama.cpp / vLLM /
ollama install as "nothing configured" and ``setup.status`` reported ``provider_configured:
False`` — the dashboard's Ink chat parked every new session on "Setup Required" while
``hermes chat`` (which resolves the runtime directly) worked against the same config.

Sibling bug (LAN relay): the same asymmetry for a ``providers.<key>`` pin spelled with the bare
config key (``model.provider: b`` + a non-loopback base_url) — legal for the runtime resolver
and the /model picker, invisible to the auto ladder.
"""

from __future__ import annotations

import pytest


@pytest.fixture
def isolated_home(tmp_path, monkeypatch):
    home = tmp_path / "hermes"
    home.mkdir()
    (home / ".env").write_text("", encoding="utf-8")
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.delenv("HERMES_GUEST_ONBOARDING", raising=False)
    for var in ("OPENAI_API_KEY", "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_BASE_URL",
                "OPENROUTER_BASE_URL", "HERMES_INFERENCE_PROVIDER", "NOUS_API_KEY",
                "HERMES_CUSTOM_B_API_KEY"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setattr("agent.bedrock_adapter.has_aws_credentials", lambda: False)
    from hermes_cli import free_tier_bootstrap as fb
    fb.reset_for_tests()
    return home


@pytest.mark.parametrize(
    "model_block",
    [
        pytest.param(
            "model:\n  default: nvidia/Nemotron\n  provider: custom\n"
            "  base_url: http://127.0.0.1:8000/v1\n  api_key: dummy\n",
            id="provider-custom",
        ),
        pytest.param(
            "model:\n  default: qwen3\n  provider: vllm\n  base_url: http://127.0.0.1:8000/v1\n",
            id="local-server-alias",
        ),
        pytest.param(
            "model:\n  default: qwen3\n  base_url: http://localhost:8080/v1\n",
            id="loopback-base-url-only",
        ),
        pytest.param(
            "model:\n  default: some-model\n  provider: custom:my-gateway\n"
            "providers:\n  my-gateway:\n    name: My Gateway\n"
            "    base_url: http://192.168.1.10:8000/v1\n  unrelated:\n    name: Other\n"
            "    base_url: http://10.0.0.1:9/v1\n",
            id="custom-prefixed-key",
        ),
    ],
)
def test_configured_custom_endpoint_resolves_as_a_provider(isolated_home, model_block):
    (isolated_home / "config.yaml").write_text(model_block, encoding="utf-8")
    from hermes_cli.auth import resolve_provider
    from hermes_cli.free_tier_bootstrap import run_bootstrap

    assert resolve_provider("auto") == "custom"
    record = run_bootstrap(announce=False)
    assert record.provider_configured is True
    assert record.other_providers is True
    assert record.inference_provider == "custom"


def test_named_custom_endpoint_with_bare_config_key_pin(isolated_home):
    """``model.provider: b`` naming a ``providers.b`` entry (LAN base_url, no ``custom:``
    prefix) is the same explicit intent the runtime resolver already honours — the auto
    ladder must not read it as "nothing configured"."""
    (isolated_home / "config.yaml").write_text(
        "model:\n  default: dots3-note-prev\n  provider: b\n"
        "  base_url: http://192.168.31.25:13000/v1\n  key_env: HERMES_CUSTOM_B_API_KEY\n"
        "providers:\n  b:\n    name: custom\n    base_url: http://192.168.31.25:13000/v1\n",
        encoding="utf-8",
    )
    from hermes_cli.auth import resolve_provider
    from hermes_cli.free_tier_bootstrap import run_bootstrap

    assert resolve_provider("auto") == "custom"
    assert run_bootstrap(announce=False).provider_configured is True


def test_stale_remote_base_url_without_a_custom_pin_is_not_a_provider(isolated_home):
    """The URL rung follows the runtime's own trust rule: a non-loopback ``base_url`` left behind
    under another provider's pin is not custom intent (#14676), so a blank machine still reads
    as unconfigured."""
    (isolated_home / "config.yaml").write_text(
        "model:\n  default: some/model\n  provider: openrouter\n  base_url: https://api.z.ai/v1\n",
        encoding="utf-8",
    )
    from hermes_cli.auth import AuthError, resolve_provider
    from hermes_cli.free_tier_bootstrap import run_bootstrap

    with pytest.raises(AuthError):
        resolve_provider("auto")
    assert run_bootstrap(announce=False).provider_configured is False


def test_bare_pin_without_a_matching_providers_entry_is_not_a_provider(isolated_home):
    """A ``model.provider`` name that matches no registry provider AND no ``providers:`` entry
    stays unconfigured — the new rung accepts pins backed by the user's own endpoint table,
    never arbitrary strings."""
    (isolated_home / "config.yaml").write_text(
        "model:\n  default: some/model\n  provider: b\n"
        "  base_url: http://192.168.31.25:13000/v1\n",
        encoding="utf-8",
    )
    from hermes_cli.auth import AuthError, resolve_provider

    with pytest.raises(AuthError):
        resolve_provider("auto")


def test_auto_provider_with_loopback_base_url_resolves_without_recursing(isolated_home, monkeypatch):
    """A fresh setup keeps ``provider: auto`` until the picker stores its choice (#110926)."""
    (isolated_home / "config.yaml").write_text(
        "model:\n  provider: auto\n  base_url: http://127.0.0.1:8000/v1\n",
        encoding="utf-8",
    )
    from hermes_cli import runtime_provider
    from hermes_cli.auth import resolve_provider

    def unexpected_provider_resolution(_name):
        raise AssertionError("the bare custom trust check must not resolve model.provider=auto")

    monkeypatch.setattr(runtime_provider, "_resolves_to_custom", unexpected_provider_resolution)

    assert resolve_provider("auto") == "custom"
