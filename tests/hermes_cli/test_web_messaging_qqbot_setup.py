"""QQ Bot channel-card setup payload (`qqbot_setup`) — env-bridge precedence.

The gateway's env bridge (gateway/config_env.py) overwrites matching
``platforms.qqbot.extra`` keys when the env var is set, so the effective value
is env-then-yaml. These tests pin that relationship for the dashboard payload,
never a snapshot of specific config.
"""

import asyncio

import pytest

from hermes_cli.web_routers.messaging import _messaging_platform_payload

_QQ_ENTRY = {
    "id": "qqbot",
    "name": "QQ Bot",
    "description": "d",
    "docs_url": "u",
    "env_vars": (),
    "required_env": (),
}


@pytest.fixture(autouse=True)
def _qq_env(monkeypatch):
    for key in ("QQ_APP_ID", "QQ_CLIENT_SECRET", "QQ_ALLOW_ALL_USERS", "QQ_ALLOWED_USERS",
                "QQ_GROUP_POLICY", "QQ_GROUP_ALLOWED_USERS"):
        monkeypatch.delenv(key, raising=False)


def _payload(env_on_disk):
    return _messaging_platform_payload(_QQ_ENTRY, env_on_disk, None, scoped=True)


def test_qqbot_setup_env_overrides_yaml_extra(monkeypatch, tmp_path):
    import hermes_cli.config as cfg

    monkeypatch.setattr(cfg, "load_config", lambda: {
        "platforms": {"qqbot": {"enabled": True, "extra": {"group_policy": "disabled"}}}})
    payload = _payload({"QQ_GROUP_POLICY": "open"})
    # env wins over config.yaml extra — same precedence as the gateway bridge
    assert payload["qqbot_setup"]["group_policy"] == "open"

    payload = _payload({})
    # env unset → yaml extra survives
    assert payload["qqbot_setup"]["group_policy"] == "disabled"


def test_qqbot_setup_dm_policy_and_group_list_flags():
    payload = _payload({
        "QQ_ALLOWED_USERS": "u1,u2", "QQ_ALLOW_ALL_USERS": "true",
        "QQ_GROUP_ALLOWED_USERS": "g1,g2"})
    setup = payload["qqbot_setup"]
    # allow-all outranks the allowlist (gateway authz: ALLOW_ALL short-circuits)
    assert setup["dm_policy"] == "open"
    assert setup["group_allowed_users_set"] is True
    assert setup["group_policy"] == ""

    payload = _payload({"QQ_ALLOWED_USERS": "u1,u2"})
    assert payload["qqbot_setup"]["dm_policy"] == "allowlist"

    payload = _payload({})
    assert payload["qqbot_setup"]["dm_policy"] == "pairing"
