"""Tests for Weixin and QQBot QR onboarding endpoints."""

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ── helpers ──────────────────────────────────────────────────────────────────


def _make_ws(monkeypatch):
    """Import web_server with minimal monkeypatches so imports succeed."""
    from hermes_cli import web_server as ws
    from hermes_cli import config as cfg

    monkeypatch.setattr(ws, "get_hermes_home", lambda: "/tmp/fake-hermes-home")
    monkeypatch.setattr(
        ws, "_config_profile_scope", lambda profile: _fake_profile_scope(profile)
    )
    monkeypatch.setattr(cfg, "get_env_value", lambda key: None)
    return ws


class _FakeProfileScope:
    def __init__(self, home: str):
        self._home = home

    def __enter__(self):
        return self._home

    def __exit__(self, *args):
        pass


def _fake_profile_scope(profile):
    return _FakeProfileScope("/tmp/fake-hermes-home")


def _wait_for_status(session_dict, pairing_id, target, timeout=3.0):
    """Block until the daemon thread reaches *target* status (or error)."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        rec = session_dict.get(pairing_id)
        if rec and rec.status in (target, "error"):
            return rec.status
        time.sleep(0.1)
    return None


# ── weixin ───────────────────────────────────────────────────────────────────


_FAKE_QR_VALUE = "fake-qrcode-value"
_FAKE_QR_URL = "https://ilinkai.weixin.qq.com/qr?x=1"


def test_weixin_start_returns_pairing_and_waiting(monkeypatch):
    ws = _make_ws(monkeypatch)
    ws._weixin_onboarding_sessions.clear()

    with patch.object(ws.secrets, "token_urlsafe", return_value="weixin-pair"):
        result = asyncio.run(ws.start_weixin_onboarding(profile="default"))

    assert result["pairing_id"] == "weixin-pair"
    assert result["status"] in ("waiting", "starting")
    # token must never leak into the response payload regardless.
    assert "token" not in result
    assert "_token" not in result
    assert "expires_at" in result
    # The daemon thread will set qr_payload once fetch completes. Verify the
    # session record exists and has the expected shape; exact qr_payload value
    # depends on timing so we only assert non-None for the pairing_id check.
    rec = ws._weixin_onboarding_sessions.get("weixin-pair")
    assert rec is not None
    assert rec.pairing_id == "weixin-pair"
    assert rec.profile == "default"


def test_weixin_get_status_returns_non_secret_payload(monkeypatch):
    ws = _make_ws(monkeypatch)
    ws._weixin_onboarding_sessions.clear()

    with (
        patch.object(ws.secrets, "token_urlsafe", return_value="p1"),
        patch("gateway.platforms.weixin.fetch_bot_qrcode", new=AsyncMock(return_value=(_FAKE_QR_VALUE, _FAKE_QR_URL))),
        patch("gateway.platforms.weixin.poll_qr_status", new=AsyncMock(side_effect=Exception("stop"))),
    ):
        start = asyncio.run(ws.start_weixin_onboarding())

    _wait_for_status(ws._weixin_onboarding_sessions, start["pairing_id"], "waiting")
    status = asyncio.run(ws.get_weixin_onboarding_status(start["pairing_id"]))
    assert "pairing_id" in status
    assert "token" not in status
    assert "_token" not in status
    assert "qr_payload" in status


def test_weixin_apply_saves_credentials(monkeypatch, tmp_path):
    ws = _make_ws(monkeypatch)
    ws._weixin_onboarding_sessions.clear()

    saved = {}

    def fake_save(key, value):
        saved[key] = value

    monkeypatch.setattr(ws, "save_env_value", fake_save)
    monkeypatch.setattr(ws, "_write_platform_enabled", lambda pid, val: None)
    monkeypatch.setattr(
        ws, "_restart_gateway_after_whatsapp_onboarding", lambda profile=None: {"restart_started": True}
    )
    monkeypatch.setattr(ws, "get_hermes_home", lambda: str(tmp_path))

    with (
        patch.object(ws.secrets, "token_urlsafe", return_value="p2"),
        patch("gateway.platforms.weixin.fetch_bot_qrcode", new=AsyncMock(return_value=(_FAKE_QR_VALUE, _FAKE_QR_URL))),
        patch("gateway.platforms.weixin.poll_qr_status", new=AsyncMock(side_effect=Exception("stop"))),
        patch("gateway.platforms.weixin.save_weixin_account"),
    ):
        start = asyncio.run(ws.start_weixin_onboarding())

    record = ws._weixin_onboarding_sessions[start["pairing_id"]]
    record.status = "connected"
    record.account_id = "bot-123"
    record.user_id = "user-456"
    record.base_url = "https://ilink.example.com"
    record._token = "super-secret-token"

    result = asyncio.run(
        ws.apply_weixin_onboarding(
            start["pairing_id"],
            ws.WeixinOnboardingApply(dm_policy="pairing", allowed_users="u1,u2", home_channel=True),
        )
    )

    assert result["ok"] is True
    assert saved["WEIXIN_ACCOUNT_ID"] == "bot-123"
    assert saved["WEIXIN_TOKEN"] == "super-secret-token"
    assert saved["WEIXIN_BASE_URL"] == "https://ilink.example.com"
    assert saved["WEIXIN_DM_POLICY"] == "pairing"
    assert saved["WEIXIN_ALLOWED_USERS"] == "u1,u2"
    assert saved["WEIXIN_HOME_CHANNEL"] == "user-456"
    assert "WEIXIN_CDN_BASE_URL" in saved
    assert start["pairing_id"] not in ws._weixin_onboarding_sessions


def test_weixin_apply_requires_connected(monkeypatch):
    ws = _make_ws(monkeypatch)
    ws._weixin_onboarding_sessions.clear()

    with patch.object(ws.secrets, "token_urlsafe", return_value="p3"):
        start = asyncio.run(ws.start_weixin_onboarding())

    with pytest.raises(Exception) as exc_info:
        asyncio.run(
            ws.apply_weixin_onboarding(
                start["pairing_id"],
                ws.WeixinOnboardingApply(),
            )
        )
    assert exc_info.value.status_code == 409


def test_weixin_cancel_clears_session(monkeypatch):
    ws = _make_ws(monkeypatch)
    ws._weixin_onboarding_sessions.clear()

    with patch.object(ws.secrets, "token_urlsafe", return_value="p4"):
        start = asyncio.run(ws.start_weixin_onboarding())

    result = asyncio.run(ws.cancel_weixin_onboarding(start["pairing_id"]))
    assert result["ok"] is True
    assert start["pairing_id"] not in ws._weixin_onboarding_sessions


def test_weixin_supersede_same_profile(monkeypatch):
    ws = _make_ws(monkeypatch)
    ws._weixin_onboarding_sessions.clear()

    with patch.object(ws.secrets, "token_urlsafe", side_effect=["old-id", "new-id"]):
        old = asyncio.run(ws.start_weixin_onboarding(profile="default"))
        new = asyncio.run(ws.start_weixin_onboarding(profile="default"))

    # Old record was mutated in-place by supersede; verify via the dict.
    old_record = ws._weixin_onboarding_sessions.get("old-id")
    assert old_record is None or old_record.status == "cancelled"
    assert new["status"] in ("waiting", "starting")
    assert new["pairing_id"] == "new-id"


def test_weixin_prune_expired(monkeypatch):
    ws = _make_ws(monkeypatch)
    ws._weixin_onboarding_sessions.clear()

    with patch.object(ws.secrets, "token_urlsafe", return_value="p5"):
        start = asyncio.run(ws.start_weixin_onboarding())

    record = ws._weixin_onboarding_sessions[start["pairing_id"]]
    record.expires_at_ts = time.time() - 100  # expired but within buffer
    record.status = "waiting"

    ws._prune_weixin_onboarding_sessions()
    # still present: terminal status needs extra 300s past buffer
    assert start["pairing_id"] in ws._weixin_onboarding_sessions

    record.expires_at_ts = time.time() - 500  # past buffer
    ws._prune_weixin_onboarding_sessions()
    assert start["pairing_id"] not in ws._weixin_onboarding_sessions


def test_weixin_get_not_found(monkeypatch):
    ws = _make_ws(monkeypatch)
    with pytest.raises(Exception) as exc_info:
        asyncio.run(ws.get_weixin_onboarding_status("nonexistent"))
    assert exc_info.value.status_code == 404


def test_weixin_invalid_dm_policy_raises_400(monkeypatch):
    ws = _make_ws(monkeypatch)
    ws._weixin_onboarding_sessions.clear()

    with patch.object(ws.secrets, "token_urlsafe", return_value="w4"):
        start = asyncio.run(ws.start_weixin_onboarding())
    record = ws._weixin_onboarding_sessions[start["pairing_id"]]
    record.status = "connected"
    record.account_id = "a"
    record._token = "t"

    with pytest.raises(Exception) as exc_info:
        asyncio.run(
            ws.apply_weixin_onboarding(
                start["pairing_id"],
                ws.WeixinOnboardingApply(dm_policy="bogus"),
            )
        )
    assert exc_info.value.status_code == 400


# ── qqbot ────────────────────────────────────────────────────────────────────


_FAKE_TASK_ID = "task-abc"
_FAKE_CONNECT_URL = "https://q.qq.com/qqbot/openclaw/connect.html?task_id=abc&_wv=2&source=hermes"


def test_qqbot_start_returns_pairing_and_waiting(monkeypatch):
    ws = _make_ws(monkeypatch)
    ws._qqbot_onboarding_sessions.clear()

    with patch.object(ws.secrets, "token_urlsafe", return_value="qq-pair"):
        result = asyncio.run(ws.start_qqbot_onboarding(profile="default"))

    assert result["pairing_id"] == "qq-pair"
    assert result["status"] in ("waiting", "starting")
    # secrets must never leak into the response payload.
    assert "client_secret" not in result
    assert "_client_secret" not in result
    assert "expires_at" in result


def test_qqbot_apply_saves_credentials(monkeypatch, tmp_path):
    ws = _make_ws(monkeypatch)
    ws._qqbot_onboarding_sessions.clear()

    saved = {}
    monkeypatch.setattr(ws, "save_env_value", lambda k, v: saved.setdefault(k, v))
    monkeypatch.setattr(ws, "_write_platform_enabled", lambda pid, val: None)
    monkeypatch.setattr(
        ws, "_restart_gateway_after_whatsapp_onboarding", lambda profile=None: {"restart_started": True}
    )
    monkeypatch.setattr(ws, "get_hermes_home", lambda: str(tmp_path))

    with patch.object(ws.secrets, "token_urlsafe", return_value="q1"):
        start = asyncio.run(ws.start_qqbot_onboarding())

    record = ws._qqbot_onboarding_sessions[start["pairing_id"]]
    record.status = "connected"
    record.account_id = "app-999"
    record.user_id = "openid-abc"
    record._client_secret = "secret-xyz"

    result = asyncio.run(
        ws.apply_qqbot_onboarding(
            start["pairing_id"],
            ws.QqbotOnboardingApply(dm_policy="pairing"),
        )
    )

    assert result["ok"] is True
    assert saved["QQ_APP_ID"] == "app-999"
    assert saved["QQ_CLIENT_SECRET"] == "secret-xyz"
    assert saved["QQ_ALLOW_ALL_USERS"] == "false"
    # pairing without explicit allowlist or home_channel: nothing extra written
    assert "QQ_ALLOWED_USERS" not in saved
    assert "QQBOT_HOME_CHANNEL" not in saved
    assert start["pairing_id"] not in ws._qqbot_onboarding_sessions


def test_qqbot_open_policy(monkeypatch, tmp_path):
    ws = _make_ws(monkeypatch)
    ws._qqbot_onboarding_sessions.clear()
    saved = {}
    monkeypatch.setattr(ws, "save_env_value", lambda k, v: saved.setdefault(k, v))
    monkeypatch.setattr(ws, "_write_platform_enabled", lambda pid, val: None)
    monkeypatch.setattr(
        ws, "_restart_gateway_after_whatsapp_onboarding", lambda profile=None: {"restart_started": True}
    )
    monkeypatch.setattr(ws, "get_hermes_home", lambda: str(tmp_path))

    with patch.object(ws.secrets, "token_urlsafe", return_value="q2"):
        start = asyncio.run(ws.start_qqbot_onboarding())
    record = ws._qqbot_onboarding_sessions[start["pairing_id"]]
    record.status = "connected"
    record.account_id = "app-1"
    record.user_id = "oid-1"
    record._client_secret = "cs-1"

    asyncio.run(
        ws.apply_qqbot_onboarding(
            start["pairing_id"],
            ws.QqbotOnboardingApply(dm_policy="open"),
        )
    )
    assert saved["QQ_ALLOW_ALL_USERS"] == "true"
    assert "QQ_ALLOWED_USERS" not in saved


def test_qqbot_cancel_clears_session(monkeypatch):
    ws = _make_ws(monkeypatch)
    ws._qqbot_onboarding_sessions.clear()

    with patch.object(ws.secrets, "token_urlsafe", return_value="q3"):
        start = asyncio.run(ws.start_qqbot_onboarding())

    result = asyncio.run(ws.cancel_qqbot_onboarding(start["pairing_id"]))
    assert result["ok"] is True
    assert start["pairing_id"] not in ws._qqbot_onboarding_sessions


def test_qqbot_supersede_same_profile(monkeypatch):
    ws = _make_ws(monkeypatch)
    ws._qqbot_onboarding_sessions.clear()

    with patch.object(ws.secrets, "token_urlsafe", side_effect=["old-q", "new-q"]):
        old = asyncio.run(ws.start_qqbot_onboarding(profile="default"))
        new = asyncio.run(ws.start_qqbot_onboarding(profile="default"))

    old_record = ws._qqbot_onboarding_sessions.get("old-q")
    assert old_record is None or old_record.status == "cancelled"
    assert new["status"] in ("waiting", "starting")


def test_qqbot_get_not_found(monkeypatch):
    ws = _make_ws(monkeypatch)
    with pytest.raises(Exception) as exc_info:
        asyncio.run(ws.get_qqbot_onboarding_status("nope"))
    assert exc_info.value.status_code == 404


def test_qqbot_invalid_dm_policy_raises_400(monkeypatch):
    ws = _make_ws(monkeypatch)
    ws._qqbot_onboarding_sessions.clear()

    with patch.object(ws.secrets, "token_urlsafe", return_value="q4"):
        start = asyncio.run(ws.start_qqbot_onboarding())
    record = ws._qqbot_onboarding_sessions[start["pairing_id"]]
    record.status = "connected"
    record.account_id = "a"
    record._client_secret = "s"

    with pytest.raises(Exception) as exc_info:
        asyncio.run(
            ws.apply_qqbot_onboarding(
                start["pairing_id"],
                ws.QqbotOnboardingApply(dm_policy="bogus"),
            )
        )
    assert exc_info.value.status_code == 400
