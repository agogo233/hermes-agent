"""Tests for Weixin and QQBot QR onboarding endpoints.

Covers start/status/apply/cancel, supersede, TTL prune, secret non-leak,
invalid dm_policy 400 responses, and the qqbot group_policy tri-state.
"""

import asyncio
import threading
import time
from unittest.mock import AsyncMock, patch

import pytest

import hermes_cli.config as _cfg_mod
import hermes_cli.web_models as _web_models
import hermes_cli.web_routers.messaging as _rt_messaging
import hermes_cli.web_server_messaging as _ws_messaging


def _make_connected_weixin_record(pairing_id="p1", profile="default"):
    record = _ws_messaging._WeixinOnboardingSession(
        pairing_id=pairing_id,
        status="connected",
        account_id="bot-123",
        user_id="wxid_abc",
        base_url="https://ilinkai.weixin.qq.com",
        expires_at="2099-01-01T00:00:00Z",
        expires_at_ts=time.time() + 600,
        profile=profile,
        cancel_event=threading.Event(),
        _token="secret-token",
        _hermes_home="/tmp/fake-home",
    )
    return record


def _make_connected_qqbot_record(pairing_id="p1", profile="default"):
    record = _ws_messaging._QqbotOnboardingSession(
        pairing_id=pairing_id,
        status="connected",
        account_id="102123456",
        user_id="openid_user_1",
        expires_at="2099-01-01T00:00:00Z",
        expires_at_ts=time.time() + 600,
        profile=profile,
        cancel_event=threading.Event(),
        _client_secret="secret-secret",
    )
    return record


@pytest.fixture(autouse=True)
def _clean_sessions():
    _ws_messaging._weixin_onboarding_sessions.clear()
    _ws_messaging._qqbot_onboarding_sessions.clear()
    yield
    _ws_messaging._weixin_onboarding_sessions.clear()
    _ws_messaging._qqbot_onboarding_sessions.clear()


def test_weixin_start_returns_pairing_and_no_secret(monkeypatch):
    monkeypatch.setattr(
        _rt_messaging, "_start_weixin_onboarding_thread", lambda record, home: None
    )
    monkeypatch.setattr(_cfg_mod, "get_env_value", lambda key: None)

    with patch.object(
        _rt_messaging.secrets, "token_urlsafe", return_value="weixin-pair"
    ):
        result = asyncio.run(_rt_messaging.start_weixin_onboarding(profile="default"))

    assert result["pairing_id"] == "weixin-pair"
    assert result["status"] == "waiting"
    assert "token" not in result
    assert "_token" not in result
    assert "expires_at" in result


def test_weixin_get_status_returns_non_secret_payload():
    record = _make_connected_weixin_record("weixin-1")
    _ws_messaging._weixin_onboarding_sessions["weixin-1"] = record

    status = asyncio.run(_rt_messaging.get_weixin_onboarding_status("weixin-1"))
    assert "pairing_id" in status
    assert "token" not in status
    assert "_token" not in status
    assert "qr_payload" in status


def test_weixin_get_status_404_when_missing():
    with pytest.raises(Exception) as exc_info:
        asyncio.run(_rt_messaging.get_weixin_onboarding_status("nope"))
    assert getattr(exc_info.value, "status_code", 500) == 404


def test_weixin_apply_saves_credentials(monkeypatch):
    saved = {}
    enabled = []

    monkeypatch.setattr(
        _cfg_mod, "save_env_value", lambda key, value: saved.setdefault(key, value)
    )
    monkeypatch.setattr(
        _ws_messaging, "_write_platform_enabled",
        lambda platform, value: enabled.append((platform, value)),
    )
    monkeypatch.setattr(
        _rt_messaging, "_restart_gateway_after",
        lambda profile, **kw: {"restart_started": True, "restart_pid": 12345},
    )

    record = _make_connected_weixin_record("weixin-apply")
    _ws_messaging._weixin_onboarding_sessions["weixin-apply"] = record

    result = asyncio.run(
        _rt_messaging.apply_weixin_onboarding(
            "weixin-apply",
            _web_models.WeixinOnboardingApply(dm_policy="pairing", allowed_users=""),
        )
    )

    assert result["ok"] is True
    assert result["platform"] == "weixin"
    assert saved["WEIXIN_ACCOUNT_ID"] == "bot-123"
    assert saved["WEIXIN_TOKEN"] == "secret-token"
    assert saved["WEIXIN_DM_POLICY"] == "pairing"
    assert saved["WEIXIN_ALLOW_ALL_USERS"] == "false"
    assert enabled == [("weixin", True)]
    assert "weixin-apply" not in _ws_messaging._weixin_onboarding_sessions


def test_weixin_apply_invalid_dm_policy_400():
    record = _make_connected_weixin_record("weixin-bad")
    _ws_messaging._weixin_onboarding_sessions["weixin-bad"] = record

    with pytest.raises(Exception) as exc_info:
        asyncio.run(
            _rt_messaging.apply_weixin_onboarding(
                "weixin-bad",
                _web_models.WeixinOnboardingApply(dm_policy="bogus"),
            )
        )
    assert getattr(exc_info.value, "status_code", 500) == 400


def test_weixin_cancel_removes_session():
    record = _make_connected_weixin_record("weixin-cancel")
    _ws_messaging._weixin_onboarding_sessions["weixin-cancel"] = record

    result = asyncio.run(_rt_messaging.cancel_weixin_onboarding("weixin-cancel"))
    assert result["ok"] is True
    assert "weixin-cancel" not in _ws_messaging._weixin_onboarding_sessions
    assert record.status == "cancelled"


def test_weixin_supersede_cancels_same_profile():
    record_a = _make_connected_weixin_record("weixin-a", profile="default")
    record_b = _make_connected_weixin_record("weixin-b", profile="other")
    _ws_messaging._weixin_onboarding_sessions["weixin-a"] = record_a
    _ws_messaging._weixin_onboarding_sessions["weixin-b"] = record_b

    _ws_messaging._supersede_weixin_onboarding_sessions("default")
    assert record_a.status == "cancelled"
    assert record_b.status == "connected"


def test_weixin_prune_expired_sessions():
    record = _make_connected_weixin_record("weixin-expired")
    record.expires_at_ts = time.time() - 10
    record.status = "waiting"
    _ws_messaging._weixin_onboarding_sessions["weixin-expired"] = record

    _ws_messaging._prune_weixin_onboarding_sessions()
    assert record.status == "expired"
    assert record.error == "Weixin QR setup expired. Start a new setup."


def test_qqbot_start_returns_pairing_and_no_secret(monkeypatch):
    monkeypatch.setattr(
        _rt_messaging, "_start_qqbot_onboarding_thread", lambda record: None
    )

    with patch.object(
        _rt_messaging.secrets, "token_urlsafe", return_value="qqbot-pair"
    ):
        result = asyncio.run(_rt_messaging.start_qqbot_onboarding(profile="default"))

    assert result["pairing_id"] == "qqbot-pair"
    assert result["status"] == "waiting"
    assert "client_secret" not in result
    assert "_client_secret" not in result


def test_qqbot_get_status_returns_non_secret_payload():
    record = _make_connected_qqbot_record("qqbot-1")
    _ws_messaging._qqbot_onboarding_sessions["qqbot-1"] = record

    status = asyncio.run(_rt_messaging.get_qqbot_onboarding_status("qqbot-1"))
    assert "pairing_id" in status
    assert "client_secret" not in status
    assert "_client_secret" not in status


def test_qqbot_apply_saves_credentials(monkeypatch):
    saved = {}
    enabled = []

    monkeypatch.setattr(
        _cfg_mod, "save_env_value", lambda key, value: saved.setdefault(key, value)
    )
    monkeypatch.setattr(
        _ws_messaging, "_write_platform_enabled",
        lambda platform, value: enabled.append((platform, value)),
    )
    monkeypatch.setattr(
        _rt_messaging, "_restart_gateway_after",
        lambda profile, **kw: {"restart_started": True, "restart_pid": 12345},
    )

    record = _make_connected_qqbot_record("qqbot-apply")
    _ws_messaging._qqbot_onboarding_sessions["qqbot-apply"] = record

    result = asyncio.run(
        _rt_messaging.apply_qqbot_onboarding(
            "qqbot-apply",
            _web_models.QqbotOnboardingApply(
                dm_policy="allowlist",
                allowed_users="openid_user_1",
                group_policy="allowlist",
                group_allowed_users="group_1",
                home_channel=True,
            ),
        )
    )

    assert result["ok"] is True
    assert result["platform"] == "qqbot"
    assert saved["QQ_APP_ID"] == "102123456"
    assert saved["QQ_CLIENT_SECRET"] == "secret-secret"
    assert saved["QQ_ALLOW_ALL_USERS"] == "false"
    assert saved["QQ_ALLOWED_USERS"] == "openid_user_1"
    assert saved["QQ_GROUP_POLICY"] == "allowlist"
    assert saved["QQ_GROUP_ALLOWED_USERS"] == "group_1"
    assert saved["QQBOT_HOME_CHANNEL"] == "openid_user_1"
    assert enabled == [("qqbot", True)]
    assert "qqbot-apply" not in _ws_messaging._qqbot_onboarding_sessions


def test_qqbot_apply_open_group_policy_does_not_set_allow_all(monkeypatch):
    saved = {}

    monkeypatch.setattr(
        _cfg_mod, "save_env_value", lambda key, value: saved.setdefault(key, value)
    )
    monkeypatch.setattr(
        _ws_messaging, "_write_platform_enabled", lambda platform, value: None
    )
    monkeypatch.setattr(
        _rt_messaging, "_restart_gateway_after",
        lambda profile, **kw: {"restart_started": True},
    )

    record = _make_connected_qqbot_record("qqbot-open")
    _ws_messaging._qqbot_onboarding_sessions["qqbot-open"] = record

    asyncio.run(
        _rt_messaging.apply_qqbot_onboarding(
            "qqbot-open",
            _web_models.QqbotOnboardingApply(
                dm_policy="pairing", group_policy="open"
            ),
        )
    )

    assert saved["QQ_GROUP_POLICY"] == "open"
    assert "QQ_ALLOW_ALL_USERS" not in saved or saved["QQ_ALLOW_ALL_USERS"] == "false"


def test_qqbot_apply_invalid_dm_policy_400():
    record = _make_connected_qqbot_record("qqbot-bad")
    _ws_messaging._qqbot_onboarding_sessions["qqbot-bad"] = record

    with pytest.raises(Exception) as exc_info:
        asyncio.run(
            _rt_messaging.apply_qqbot_onboarding(
                "qqbot-bad",
                _web_models.QqbotOnboardingApply(dm_policy="bogus"),
            )
        )
    assert getattr(exc_info.value, "status_code", 500) == 400


def test_qqbot_apply_invalid_group_policy_400():
    record = _make_connected_qqbot_record("qqbot-badg")
    _ws_messaging._qqbot_onboarding_sessions["qqbot-badg"] = record

    with pytest.raises(Exception) as exc_info:
        asyncio.run(
            _rt_messaging.apply_qqbot_onboarding(
                "qqbot-badg",
                _web_models.QqbotOnboardingApply(group_policy="bogus"),
            )
        )
    assert getattr(exc_info.value, "status_code", 500) == 400


def test_qqbot_cancel_removes_session():
    record = _make_connected_qqbot_record("qqbot-cancel")
    _ws_messaging._qqbot_onboarding_sessions["qqbot-cancel"] = record

    result = asyncio.run(_rt_messaging.cancel_qqbot_onboarding("qqbot-cancel"))
    assert result["ok"] is True
    assert "qqbot-cancel" not in _ws_messaging._qqbot_onboarding_sessions
    assert record.status == "cancelled"


def test_qqbot_supersede_cancels_same_profile():
    record_a = _make_connected_qqbot_record("qqbot-a", profile="default")
    record_b = _make_connected_qqbot_record("qqbot-b", profile="other")
    _ws_messaging._qqbot_onboarding_sessions["qqbot-a"] = record_a
    _ws_messaging._qqbot_onboarding_sessions["qqbot-b"] = record_b

    _ws_messaging._supersede_qqbot_onboarding_sessions("default")
    assert record_a.status == "cancelled"
    assert record_b.status == "connected"


def test_qqbot_prune_expired_sessions():
    record = _make_connected_qqbot_record("qqbot-expired")
    record.expires_at_ts = time.time() - 10
    record.status = "waiting"
    _ws_messaging._qqbot_onboarding_sessions["qqbot-expired"] = record

    _ws_messaging._prune_qqbot_onboarding_sessions()
    assert record.status == "expired"
    assert record.error == "QQBot QR setup expired. Start a new setup."


def test_qqbot_onboarding_loop_streaming(monkeypatch):
    """The qqbot daemon loop drives qr_register_stream and updates the record."""
    record = _make_connected_qqbot_record("qqbot-loop")
    record.status = "waiting"

    def fake_stream(**kwargs):
        kwargs["on_qr"]("https://q.qq.com/scan")
        kwargs["on_complete"]("102123456", "openid_user_1")
        return {
            "app_id": "102123456",
            "client_secret": "secret-secret",
            "user_openid": "openid_user_1",
        }

    monkeypatch.setattr(
        "plugins.platforms.qqbot.onboard.qr_register_stream", fake_stream
    )

    _ws_messaging._run_qqbot_onboarding(record)
    assert record.status == "connected"
    assert record.account_id == "102123456"
    assert record.user_id == "openid_user_1"
    assert record.qr_payload == "https://q.qq.com/scan"


def test_weixin_onboarding_loop_confirmed(monkeypatch):
    """The weixin daemon loop processes confirmed status and saves credentials."""
    import plugins.platforms.weixin.adapter as _weixin_adapter

    record = _ws_messaging._WeixinOnboardingSession(
        pairing_id="wx-loop",
        status="waiting",
        expires_at="2099-01-01T00:00:00Z",
        expires_at_ts=time.time() + 600,
        cancel_event=threading.Event(),
    )
    session = AsyncMock()

    async def fake_fetch(session, **kw):
        return ("qrcode-val", "https://ilinkai.weixin.qq.com/qr")

    async def fake_poll(session, **kw):
        return {
            "status": "confirmed",
            "ilink_bot_id": "bot-123",
            "bot_token": "secret-token",
            "baseurl": "https://ilinkai.weixin.qq.com",
            "ilink_user_id": "wxid_abc",
        }

    monkeypatch.setattr(_weixin_adapter, "fetch_bot_qrcode", fake_fetch)
    monkeypatch.setattr(_weixin_adapter, "poll_qr_status", fake_poll)
    monkeypatch.setattr(_weixin_adapter, "save_weixin_account", lambda *a, **kw: None)

    asyncio.run(_ws_messaging._weixin_onboarding_loop(session, "/tmp/fake", record))
    assert record.status == "connected"
    assert record.account_id == "bot-123"
    assert record.user_id == "wxid_abc"
    assert record._token == "secret-token"
