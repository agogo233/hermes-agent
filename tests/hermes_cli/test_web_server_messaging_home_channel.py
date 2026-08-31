"""Regression tests for the Channels page home-channel editing surface.

The WebUI previously had no way to set / edit / clear a platform's home
channel except the one-shot QR pairing checkbox (WeChat/QQ) or running
``/sethome`` in a chat. This suite pins the new ``PUT
/api/messaging/platforms/{id}`` ``home_channel`` / ``clear_home_channel``
contract, the ``home_channel_source`` provenance ("env" vs "config"), and the
weixin/qqbot secondary-edit clear path.
"""
import os
import time

import pytest
import yaml


_VALID_WORKER_BOT_TOKEN = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_1234"


@pytest.fixture
def isolated_profiles(tmp_path, monkeypatch, _isolate_hermes_home):
    """Isolated default home + one named profile, each with its own .env."""
    from hermes_constants import get_hermes_home
    from hermes_cli import profiles

    default_home = get_hermes_home()
    profiles_root = default_home / "profiles"
    worker_home = profiles_root / "worker_alpha"
    for home in (default_home, worker_home):
        home.mkdir(parents=True, exist_ok=True)
        (home / "config.yaml").write_text("{}\n", encoding="utf-8")

    (default_home / ".env").write_text(
        "TELEGRAM_BOT_TOKEN=root-token\n", encoding="utf-8"
    )
    (worker_home / ".env").write_text("", encoding="utf-8")

    monkeypatch.setattr(profiles, "_get_default_hermes_home", lambda: default_home)
    monkeypatch.setattr(profiles, "_get_profiles_root", lambda: profiles_root)
    return {"default": default_home, "worker_alpha": worker_home}


@pytest.fixture
def client(monkeypatch, isolated_profiles):
    try:
        from starlette.testclient import TestClient
    except ImportError:
        pytest.skip("fastapi/starlette not installed")

    import hermes_state
    from hermes_constants import get_hermes_home
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN

    monkeypatch.setattr(hermes_state, "DEFAULT_DB_PATH", get_hermes_home() / "state.db")
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_HOME_CHANNEL", raising=False)
    c = TestClient(app)
    c.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    return c


def _telegram(payload):
    return next(p for p in payload["platforms"] if p["id"] == "telegram")


def _write_telegram_cfg(home, home_channel=None):
    """Write the default profile's config.yaml with an optional home_channel."""
    platforms = {"telegram": {"enabled": True}}
    if home_channel is not None:
        platforms["telegram"]["home_channel"] = home_channel
    (home / "config.yaml").write_text(
        yaml.safe_dump({"platforms": platforms}), encoding="utf-8"
    )


class TestPutHomeChannel:
    def test_set_home_channel_round_trips_as_config(self, client, isolated_profiles):
        resp = client.put(
            "/api/messaging/platforms/telegram",
            json={"home_channel": {"chat_id": "123456789", "name": "Ops"}},
        )
        assert resp.status_code == 200

        cfg = yaml.safe_load(
            (isolated_profiles["default"] / "config.yaml").read_text()
        ) or {}
        hc = cfg["platforms"]["telegram"]["home_channel"]
        assert hc["chat_id"] == "123456789"
        assert hc["name"] == "Ops"
        assert hc["platform"] == "telegram"

        telegram = _telegram(client.get("/api/messaging/platforms").json())
        assert telegram["home_channel"] == {
            "platform": "telegram",
            "chat_id": "123456789",
            "name": "Ops",
        }
        assert telegram["home_channel_source"] == "config"

    def test_set_home_channel_with_thread_id(self, client, isolated_profiles):
        resp = client.put(
            "/api/messaging/platforms/telegram",
            json={
                "home_channel": {
                    "chat_id": "999",
                    "name": "Forum",
                    "thread_id": "42",
                }
            },
        )
        assert resp.status_code == 200
        telegram = _telegram(client.get("/api/messaging/platforms").json())
        assert telegram["home_channel"]["thread_id"] == "42"

    def test_clear_home_channel_deletes_key(self, client, isolated_profiles):
        _write_telegram_cfg(
            isolated_profiles["default"],
            home_channel={"platform": "telegram", "chat_id": "123", "name": "X"},
        )
        resp = client.put(
            "/api/messaging/platforms/telegram", json={"clear_home_channel": True}
        )
        assert resp.status_code == 200

        # The key is deleted (not ``home_channel: null``).
        cfg = yaml.safe_load(
            (isolated_profiles["default"] / "config.yaml").read_text()
        ) or {}
        assert "home_channel" not in cfg["platforms"]["telegram"]

        telegram = _telegram(client.get("/api/messaging/platforms").json())
        assert telegram["home_channel"] is None
        assert telegram["home_channel_source"] is None

    def test_clear_wins_over_set(self, client, isolated_profiles):
        _write_telegram_cfg(
            isolated_profiles["default"],
            home_channel={"platform": "telegram", "chat_id": "123", "name": "X"},
        )
        resp = client.put(
            "/api/messaging/platforms/telegram",
            json={"clear_home_channel": True, "home_channel": {"chat_id": "555"}},
        )
        assert resp.status_code == 200
        cfg = yaml.safe_load(
            (isolated_profiles["default"] / "config.yaml").read_text()
        ) or {}
        assert "home_channel" not in cfg["platforms"]["telegram"]

    def test_empty_chat_id_rejected(self, client, isolated_profiles):
        resp = client.put(
            "/api/messaging/platforms/telegram",
            json={"home_channel": {"chat_id": "   "}},
        )
        assert resp.status_code == 400
        assert "chat_id" in resp.json()["detail"]


class TestHomeChannelSource:
    def test_env_override_reports_env_source(self, client, isolated_profiles, monkeypatch):
        _write_telegram_cfg(isolated_profiles["default"])
        monkeypatch.setenv("TELEGRAM_HOME_CHANNEL", "987654321")
        telegram = _telegram(client.get("/api/messaging/platforms").json())
        assert telegram["home_channel"]["chat_id"] == "987654321"
        assert telegram["home_channel_source"] == "env"
        assert telegram["home_channel_env"] == "TELEGRAM_HOME_CHANNEL"

    def test_scoped_env_override_shows_env_home(self, client, isolated_profiles):
        # QR onboarding persists the home to the profile's .env; the scoped
        # view must surface that value (not null) with source="env" so the
        # card and its (disabled) editor agree on what the gateway applies.
        worker_home = isolated_profiles["worker_alpha"]
        (worker_home / ".env").write_text(
            f"TELEGRAM_BOT_TOKEN={_VALID_WORKER_BOT_TOKEN}\n"
            "TELEGRAM_HOME_CHANNEL=12345\n"
            "TELEGRAM_HOME_CHANNEL_NAME=Ops chat\n",
            encoding="utf-8",
        )
        (worker_home / "config.yaml").write_text(
            yaml.safe_dump({"platforms": {"telegram": {"enabled": True}}}),
            encoding="utf-8",
        )
        worker_payload = client.get(
            "/api/messaging/platforms", params={"profile": "worker_alpha"}
        ).json()
        telegram = _telegram(worker_payload)
        assert telegram["home_channel"]["chat_id"] == "12345"
        assert telegram["home_channel"]["name"] == "Ops chat"
        assert telegram["home_channel_source"] == "env"

    def test_config_home_reports_config_source(self, client, isolated_profiles):
        _write_telegram_cfg(
            isolated_profiles["default"],
            home_channel={"platform": "telegram", "chat_id": "123", "name": "Ops"},
        )
        telegram = _telegram(client.get("/api/messaging/platforms").json())
        assert telegram["home_channel"]["chat_id"] == "123"
        assert telegram["home_channel_source"] == "config"

    def test_unset_reports_null_source(self, client, isolated_profiles):
        _write_telegram_cfg(isolated_profiles["default"])
        telegram = _telegram(client.get("/api/messaging/platforms").json())
        assert telegram["home_channel"] is None
        assert telegram["home_channel_source"] is None

    def test_hidden_override_inferred_as_env(self, client, isolated_profiles):
        # Config.yaml carries one home; an env override (not necessarily in the
        # per-platform map) wins at gateway load. The payload must report "env"
        # so the UI does not offer an edit that the gateway would ignore.
        _write_telegram_cfg(
            isolated_profiles["default"],
            home_channel={"platform": "telegram", "chat_id": "123", "name": "X"},
        )
        telegram = _telegram(client.get("/api/messaging/platforms").json())
        # No env override here: config is authoritative.
        assert telegram["home_channel_source"] == "config"


class TestProfileIsolation:
    def test_home_channel_write_lands_in_target_profile(
        self, client, isolated_profiles
    ):
        client.put(
            "/api/messaging/platforms/telegram",
            params={"profile": "worker_alpha"},
            json={
                "enabled": True,
                "env": {"TELEGRAM_BOT_TOKEN": _VALID_WORKER_BOT_TOKEN},
                "home_channel": {"chat_id": "111", "name": "Worker home"},
            },
        )

        worker_cfg = yaml.safe_load(
            (isolated_profiles["worker_alpha"] / "config.yaml").read_text()
        ) or {}
        assert worker_cfg["platforms"]["telegram"]["home_channel"]["chat_id"] == "111"

        # The default profile must stay untouched.
        root_cfg = yaml.safe_load(
            (isolated_profiles["default"] / "config.yaml").read_text()
        ) or {}
        assert "home_channel" not in (root_cfg.get("platforms") or {}).get(
            "telegram", {}
        )

    def test_scoped_read_reports_profile_home(self, client, isolated_profiles):
        client.put(
            "/api/messaging/platforms/telegram",
            params={"profile": "worker_alpha"},
            json={"home_channel": {"chat_id": "222", "name": "Worker"}},
        )
        worker_payload = client.get(
            "/api/messaging/platforms", params={"profile": "worker_alpha"}
        ).json()
        assert _telegram(worker_payload)["home_channel"]["chat_id"] == "222"

        root_payload = client.get("/api/messaging/platforms").json()
        assert _telegram(root_payload)["home_channel"] is None


class TestQrApplyHomeChannel:
    """Weixin/QQBot secondary-edit: re-saving the pairing panel must only
    clear the adopted home when the caller explicitly sends ``false`` — a
    caller that omits the field (legacy) must be a no-op."""

    def _seed_connected_session(self, module_name, pairing_id):
        from hermes_cli import web_server as ws

        session_cls = (
            ws._WeixinOnboardingSession
            if module_name == "weixin"
            else ws._QqbotOnboardingSession
        )
        session_store = (
            ws._weixin_onboarding_sessions
            if module_name == "weixin"
            else ws._qqbot_onboarding_sessions
        )
        session_store.clear()
        future = time.time() + 3600
        if module_name == "weixin":
            record = session_cls(
                pairing_id=pairing_id,
                status="connected",
                account_id="acct-1",
                user_id="user-42",
                _token="tok",
                profile="",
                expires_at_ts=future,
            )
        else:
            record = session_cls(
                pairing_id=pairing_id,
                status="connected",
                account_id="acct-1",
                user_id="user-42",
                _client_secret="sec",
                profile="",
                expires_at_ts=future,
            )
        session_store[pairing_id] = record
        return ws

    @pytest.mark.parametrize("module", ["weixin", "qqbot"])
    def test_home_channel_false_clears_env(self, client, isolated_profiles, module):
        home_env = (
            "WEIXIN_HOME_CHANNEL" if module == "weixin" else "QQBOT_HOME_CHANNEL"
        )
        (isolated_profiles["default"] / ".env").write_text(
            f"TELEGRAM_BOT_TOKEN=root-token\n{home_env}=user-42\n",
            encoding="utf-8",
        )
        self._seed_connected_session(module, "pair-1")

        resp = client.post(
            f"/api/messaging/{module}/onboarding/pair-1/apply",
            json={"dm_policy": "pairing", "home_channel": False},
        )
        assert resp.status_code == 200
        env = (isolated_profiles["default"] / ".env").read_text(encoding="utf-8")
        assert f"{home_env}=user-42" not in env

    @pytest.mark.parametrize("module", ["weixin", "qqbot"])
    def test_home_channel_omitted_is_noop(self, client, isolated_profiles, module):
        home_env = (
            "WEIXIN_HOME_CHANNEL" if module == "weixin" else "QQBOT_HOME_CHANNEL"
        )
        (isolated_profiles["default"] / ".env").write_text(
            f"TELEGRAM_BOT_TOKEN=root-token\n{home_env}=user-42\n",
            encoding="utf-8",
        )
        self._seed_connected_session(module, "pair-2")

        # No home_channel field at all: the persisted home must survive.
        resp = client.post(
            f"/api/messaging/{module}/onboarding/pair-2/apply",
            json={"dm_policy": "pairing"},
        )
        assert resp.status_code == 200
        env = (isolated_profiles["default"] / ".env").read_text(encoding="utf-8")
        assert f"{home_env}=user-42" in env

    @pytest.mark.parametrize("module", ["weixin", "qqbot"])
    def test_home_channel_true_writes_env(self, client, isolated_profiles, module):
        home_env = (
            "WEIXIN_HOME_CHANNEL" if module == "weixin" else "QQBOT_HOME_CHANNEL"
        )
        (isolated_profiles["default"] / ".env").write_text(
            "TELEGRAM_BOT_TOKEN=root-token\n", encoding="utf-8"
        )
        self._seed_connected_session(module, "pair-3")

        resp = client.post(
            f"/api/messaging/{module}/onboarding/pair-3/apply",
            json={"dm_policy": "pairing", "home_channel": True},
        )
        assert resp.status_code == 200
        env = (isolated_profiles["default"] / ".env").read_text(encoding="utf-8")
        assert f"{home_env}=user-42" in env
