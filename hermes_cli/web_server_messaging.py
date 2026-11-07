"""Messaging-platform catalog and onboarding helpers: platform overrides/env discovery, WhatsApp
and Telegram onboarding state.
"""

import asyncio
import logging
import os
import subprocess
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from fastapi import HTTPException
from pathlib import Path
from typing import Any, Optional
from hermes_cli.config import OPTIONAL_ENV_VARS, write_platform_config_field
from hermes_cli.setup_hidden_env import is_setup_hidden_env as _is_setup_hidden_env
from hermes_cli.version_info import hermes_user_agent

# Same logger the code used before extraction (record parity).
_log = logging.getLogger("hermes_cli.web_server")


# Card metadata for core-only platforms (no plugin, so no PlatformEntry to declare it). Plugin
# platforms declare theirs on their PlatformEntry (``dashboard_*`` / ``docs_url``, see
# :func:`_plugin_card_fields`). Entries omit fields they don't need; the catalog builder fills in
# env_vars from OPTIONAL_ENV_VARS via prefix matching when not specified.
_PLATFORM_OVERRIDES: dict[str, dict[str, Any]] = {
    "api_server": {
        "name": "API server",
        "description": "Expose Hermes as an OpenAI-compatible HTTP API for tools like Open WebUI.",
        "docs_url": "https://hermes-agent.nousresearch.com/docs/user-guide/messaging/",
        "env_vars": (
            "API_SERVER_ENABLED", "API_SERVER_KEY", "API_SERVER_PORT", "API_SERVER_HOST",
            "API_SERVER_MODEL_NAME",
        ),
        "required_env": (),
    },
    "webhook": {
        "name": "Webhooks",
        "description": "Receive events from GitHub, GitLab, and other webhook sources.",
        "docs_url": "https://hermes-agent.nousresearch.com/docs/user-guide/messaging/webhooks/",
        "env_vars": ("WEBHOOK_ENABLED", "WEBHOOK_PORT", "WEBHOOK_SECRET"), "required_env": (),
    },
    "msgraph_webhook": {
        "name": "Microsoft Graph Webhook",
        "description": "Receive Microsoft Graph change notifications (Teams meetings, Outlook, …).",
        "docs_url": "https://hermes-agent.nousresearch.com/docs/user-guide/messaging/msgraph-webhook",
        "required_env": (),
    },
    "relay": {
        "name": "Relay (experimental)",
        "description": "Generic relay adapter fronted by the Hermes Relay connector.",
        "docs_url": "", "required_env": (),
    },
}

# Display order: well-known platforms surface first; unknown plugins fall to
# the end alphabetically.
_PLATFORM_ORDER: tuple[str, ...] = (
    "telegram", "discord", "slack", "mattermost", "matrix", "whatsapp", "signal", "bluebubbles",
    "email", "sms", "dingtalk", "feishu", "google_chat", "wecom", "wecom_callback",
    "weixin", "qqbot", "yuanbao", "api_server", "webhook",
)


def _messaging_platform_catalog() -> tuple[dict[str, Any], ...]:
    """Build the messaging catalog from the gateway's Platform enum + plugin registry.

    Built-ins come from ``gateway.config.Platform`` (LOCAL excluded); plugin platforms from
    ``platform_registry.plugin_entries()`` so new adapters appear without a code change here.
    UI metadata comes from each plugin's PlatformEntry, or :data:`_PLATFORM_OVERRIDES` for core-only
    platforms; the rest is derived from id/required_env.
    """
    from gateway.config import Platform

    # Resolve plugin entries FIRST: plugin platforms leak into ``Platform.__members__`` as
    # pseudo-members once anything calls ``Platform("<plugin id>")``, and iterating the enum
    # first would claim them with no plugin metadata (nameless "Irc"/"Ntfy" cards).
    plugin_map: dict[str, Any] = {}
    try:
        # Plugin discovery normally runs as a side effect of importing model_tools, which this
        # server process doesn't do — trigger it explicitly (idempotent).
        from hermes_cli.plugins import discover_plugins
        discover_plugins()
        from gateway.platform_registry import platform_registry
        for plugin_entry in platform_registry.plugin_entries():
            plugin_map[plugin_entry.name] = plugin_entry
    except Exception:
        _log.debug("plugin platform registry unavailable", exc_info=True)

    seen: set[str] = set()
    entries: list[dict[str, Any]] = []
    builtin = [m.value for m in Platform.__members__.values() if m.value != "local"]
    for pid in builtin + list(plugin_map):
        if pid in seen:
            continue
        seen.add(pid)
        entries.append(_build_catalog_entry(pid, plugin_map.get(pid)))

    order = {pid: idx for idx, pid in enumerate(_PLATFORM_ORDER)}
    entries.sort(key=lambda e: (order.get(e["id"], len(_PLATFORM_ORDER)), e["name"].lower()))
    return tuple(entries)


def _channel_managed_env_keys() -> frozenset[str]:
    """Env-var keys owned by a Channels page platform card; the Keys/Env page hides them so the
    same fields aren't duplicated. Best-effort: if the catalog can't be built, nothing is hidden."""
    try:
        return frozenset(k for entry in _messaging_platform_catalog() for k in entry.get("env_vars", ()))
    except Exception:
        _log.debug("could not build channel-managed env key set", exc_info=True)
        return frozenset()


# Cross-cutting gateway / relay knobs stay on the Keys → Settings tab even though
# they use the ``messaging`` category in OPTIONAL_ENV_VARS. Platform-scoped vars
# (``DISCORD_*``, ``MATRIX_*``, …) are owned by the Messaging UI instead.
_MESSAGING_KEYS_PAGE_KEYS = frozenset({
    "GATEWAY_ALLOW_ALL_USERS", "GATEWAY_PROXY_KEY", "GATEWAY_PROXY_URL"})


def _platform_env_prefixes(platform_id: str) -> tuple[str, ...]:
    """Env-var prefixes owned by a messaging platform card (shared with the profile-clone
    channel stripper so a card and a clone agree on which keys belong to a platform)."""
    from hermes_cli.profile_channels import platform_env_prefixes
    return platform_env_prefixes(platform_id)


def _discover_platform_env_vars(platform_id: str) -> tuple[str, ...]:
    """All messaging-category env vars for a platform (override + plugin + prefix)."""
    prefixes = _platform_env_prefixes(platform_id)
    return tuple(sorted({
        name for name, info in OPTIONAL_ENV_VARS.items()
        if info.get("category") == "messaging"
        and name not in _MESSAGING_KEYS_PAGE_KEYS
        and not _is_setup_hidden_env(name)
        and any(name.startswith(prefix) for prefix in prefixes)}))


def _merge_platform_env_vars(platform_id: str, override: dict[str, Any], plugin_entry: Any | None) -> tuple[str, ...]:
    """Canonical env-var list for a platform card. Required credentials always survive: hiding a
    required field would make the platform unconfigurable."""
    discovered = _discover_platform_env_vars(platform_id)
    if "env_vars" in override:
        explicit = tuple(key for key in override["env_vars"] if not _is_setup_hidden_env(key))
        return tuple(dict.fromkeys((*explicit, *discovered)))
    if plugin_entry is not None and plugin_entry.required_env:
        return tuple(dict.fromkeys((*tuple(plugin_entry.required_env), *discovered)))
    return discovered


def _plugin_card_fields(plugin_entry: Any) -> dict[str, Any]:
    """A plugin's declared card metadata in override shape; undeclared fields are left out so
    the builder falls back exactly as for a platform with no metadata."""
    fields: dict[str, Any] = {
        "name": plugin_entry.dashboard_label, "description": plugin_entry.dashboard_description,
        "docs_url": plugin_entry.docs_url,
    }
    if plugin_entry.dashboard_env_vars:
        fields["env_vars"] = plugin_entry.dashboard_env_vars
    if plugin_entry.dashboard_required_env is not None:
        fields["required_env"] = plugin_entry.dashboard_required_env
    return fields


def _build_catalog_entry(platform_id: str, plugin_entry: Any | None = None) -> dict[str, Any]:
    override = _PLATFORM_OVERRIDES.get(platform_id) or (
        _plugin_card_fields(plugin_entry) if plugin_entry is not None else {})
    if "required_env" in override:
        required_env = tuple(override["required_env"])
    else:
        required_env = tuple(plugin_entry.required_env or ()) if plugin_entry is not None else ()
    plugin_label = plugin_entry.label if plugin_entry is not None else None
    plugin_hint = (plugin_entry.install_hint or "") if plugin_entry is not None else None
    return {
        "id": platform_id,
        "name": override.get("name") or plugin_label or platform_id.replace("_", " ").title(),
        "description": override.get("description") or plugin_hint or "",
        "docs_url": override.get("docs_url", ""),
        "env_vars": _merge_platform_env_vars(platform_id, override, plugin_entry),
        "required_env": required_env,
    }


def _write_platform_enabled(platform_id: str, enabled: bool) -> None:
    write_platform_config_field(platform_id, "enabled", enabled)


@dataclass
class _WhatsAppOnboardingSession:
    proc: subprocess.Popen | None
    mode: str
    allowed_users: str
    session_path: str
    expires_at: str
    expires_at_ts: float
    profile: str | None = None
    status: str = "starting"
    qr_payload: str | None = None
    account_id: str | None = None
    account_name: str | None = None
    account_phone: str | None = None
    error: str | None = None
    starting_process: bool = False
    session_reserved: bool = False
    expiry_timer: threading.Timer | None = None


_whatsapp_onboarding_sessions: dict[str, _WhatsAppOnboardingSession] = {}


def _whatsapp_session_path() -> Path:
    from hermes_constants import get_hermes_dir
    return get_hermes_dir("platforms/whatsapp/session", "whatsapp/session")


_WHATSAPP_PAYLOAD_FIELDS = (
    "status", "qr_payload", "expires_at", "mode", "allowed_users", "account_id", "account_name",
    "account_phone", "error",
)


def _whatsapp_onboarding_payload(pairing_id: str, record: _WhatsAppOnboardingSession) -> dict[str, Any]:
    return {"pairing_id": pairing_id, **{f: getattr(record, f) for f in _WHATSAPP_PAYLOAD_FIELDS}}


def _restart_gateway_after_whatsapp_onboarding(profile: Optional[str] = None) -> dict[str, Any]:
    from hermes_cli.web_server_gateway import _restart_gateway_after
    return _restart_gateway_after(profile, what="WhatsApp onboarding", label="WhatsApp onboarding")


_TELEGRAM_ONBOARDING_DEFAULT_URL = "https://setup.hermes-agent.nousresearch.com"


@dataclass
class _TelegramOnboardingPairing:
    poll_token: str
    expires_at: str
    expires_at_ts: float
    bot_token: str | None = None
    bot_username: str | None = None
    owner_user_id: str | None = None


_telegram_onboarding_pairings: dict[str, _TelegramOnboardingPairing] = {}
_telegram_onboarding_lock = threading.RLock()


def _telegram_onboarding_base_url() -> str:
    return os.getenv("TELEGRAM_ONBOARDING_URL", _TELEGRAM_ONBOARDING_DEFAULT_URL).strip().rstrip("/")


def _telegram_onboarding_error_message(error: str, fallback: str) -> str:
    return {
        "not_found": "Telegram pairing was not found. Start a new setup.",
        "expired": "Telegram setup expired. Start a new setup.",
        "claimed": "Telegram setup was already claimed. Start a new setup.",
        "unauthorized": "Telegram setup service rejected this request.",
        "telegram_manager_bot_token_not_configured": "Telegram setup service is not configured.",
        "telegram_token_fetch_failed": "Telegram could not finish bot setup. Try again.",
    }.get(error, fallback)


_TELEGRAM_UNAVAILABLE = "Telegram setup service is unavailable. Try again shortly."
_TELEGRAM_INVALID = "Telegram setup service returned an invalid response."


def _telegram_onboarding_request_sync(
    method: str, path: str, *, body: dict[str, Any] | None = None, bearer_token: str | None = None
) -> dict[str, Any]:
    import httpx
    headers = {"Accept": "application/json", "User-Agent": hermes_user_agent("HermesDashboard")}
    request_kwargs: dict[str, Any] = {}
    if body is not None:
        headers["Content-Type"] = "application/json"
        request_kwargs["json"] = body
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"
    try:
        with httpx.Client(timeout=httpx.Timeout(10.0)) as client:
            response = client.request(method, f"{_telegram_onboarding_base_url()}{path}", headers=headers, **request_kwargs)
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        try:
            parsed = exc.response.json()
        except Exception:
            parsed = {}
        error = str(parsed.get("error") or parsed.get("status") or "")
        detail = _telegram_onboarding_error_message(error, "Telegram setup service returned an error.")
        if error in {"expired", "claimed"}:
            status_code = 410
        else:
            status_code = 404 if exc.response.status_code == 404 else 502
        raise HTTPException(status_code=status_code, detail=detail) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=_TELEGRAM_UNAVAILABLE) from exc

    try:
        parsed = response.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=_TELEGRAM_INVALID) from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=502, detail=_TELEGRAM_INVALID)
    return parsed


# ── Weixin QR onboarding state ─────────────────────────────────────

_WEIXIN_ONBOARDING_TTL_SECONDS = 600
_WEIXIN_ONBOARDING_TERMINAL_STATUSES = {"connected", "error", "expired", "cancelled"}

_DM_POLICY_CHOICES = ("pairing", "open", "allowlist", "disabled")


@dataclass
class _WeixinOnboardingSession:
    pairing_id: str
    status: str = "waiting"
    qr_payload: str | None = None
    account_id: str | None = None
    user_id: str | None = None
    base_url: str | None = None
    error: str | None = None
    expires_at: str = ""
    expires_at_ts: float = 0.0
    profile: str | None = None
    cancel_event: threading.Event | None = None
    # We keep these only inside the loop; never exposed via GET payload.
    _token: str = ""
    _hermes_home: str = ""


_weixin_onboarding_sessions: dict[str, _WeixinOnboardingSession] = {}
_weixin_onboarding_lock = threading.RLock()


def _prune_weixin_onboarding_sessions() -> None:
    now = time.time()
    remove_ids: list[str] = []
    for pid, record in _weixin_onboarding_sessions.items():
        if record.expires_at_ts <= now and record.status not in _WEIXIN_ONBOARDING_TERMINAL_STATUSES:
            if record.cancel_event:
                record.cancel_event.set()
            record.status = "expired"
            record.error = "Weixin QR setup expired. Start a new setup."
        if record.status in _WEIXIN_ONBOARDING_TERMINAL_STATUSES and record.expires_at_ts + 300 <= now:
            remove_ids.append(pid)
    for pid in remove_ids:
        _weixin_onboarding_sessions.pop(pid, None)


def _supersede_weixin_onboarding_sessions(profile: str) -> None:
    for record in _weixin_onboarding_sessions.values():
        if record.profile == profile and record.status not in _WEIXIN_ONBOARDING_TERMINAL_STATUSES:
            record.status = "cancelled"
            record.error = "Superseded by a newer Weixin setup session."
            if record.cancel_event:
                record.cancel_event.set()


def _weixin_onboarding_payload(pid: str, record: _WeixinOnboardingSession) -> dict[str, Any]:
    return {
        "pairing_id": pid,
        "status": record.status,
        "qr_payload": record.qr_payload,
        "expires_at": record.expires_at,
        "account_id": record.account_id,
        "user_id": record.user_id,
        "error": record.error,
    }


async def _weixin_onboarding_loop(
    session: Any,
    hermes_home: str,
    record: _WeixinOnboardingSession,
) -> None:
    """Run the QR scan loop for a single weixin onboarding session."""
    from plugins.platforms.weixin.adapter import (
        ILINK_BASE_URL, fetch_bot_qrcode, poll_qr_status, save_weixin_account)

    qrcode_value = ""
    current_base_url = ILINK_BASE_URL
    refresh_count = 0

    async def _fetch_qr() -> None:
        nonlocal qrcode_value
        try:
            qrcode_value, qrcode_url = await fetch_bot_qrcode(session)
        except Exception as exc:
            record.status = "error"
            record.error = f"Failed to fetch QR code: {exc}"
            return
        record.qr_payload = qrcode_url or qrcode_value
        record.status = "waiting"

    await _fetch_qr()
    if record.status == "error":
        return

    deadline = time.monotonic() + _WEIXIN_ONBOARDING_TTL_SECONDS
    while time.monotonic() < deadline:
        if record.cancel_event and record.cancel_event.is_set():
            record.status = "cancelled"
            return
        try:
            status_resp = await poll_qr_status(
                session, base_url=current_base_url, qrcode_value=qrcode_value
            )
        except Exception:
            await asyncio.sleep(1)
            continue

        status = str(status_resp.get("status") or "wait")
        if status in ("wait", "scaned"):
            await asyncio.sleep(1)
            continue
        if status == "scaned_but_redirect":
            redirect_host = str(status_resp.get("redirect_host") or "")
            if redirect_host:
                current_base_url = f"https://{redirect_host}"
            await asyncio.sleep(1)
            continue
        if status == "expired":
            refresh_count += 1
            if refresh_count > 3:
                record.status = "expired"
                record.error = "QR code expired too many times. Start a new setup."
                return
            await _fetch_qr()
            if record.status == "error":
                return
            continue
        if status == "confirmed":
            account_id = str(status_resp.get("ilink_bot_id") or "")
            token = str(status_resp.get("bot_token") or "")
            base_url = str(status_resp.get("baseurl") or current_base_url)
            user_id = str(status_resp.get("ilink_user_id") or "")
            if not account_id or not token:
                record.status = "error"
                record.error = "Incomplete credential payload on confirm"
                return
            record.account_id = account_id
            record.user_id = user_id
            record.base_url = base_url
            record._token = token
            save_weixin_account(
                hermes_home,
                account_id=account_id,
                token=token,
                base_url=base_url,
                user_id=user_id,
            )
            record.status = "connected"
            return
        await asyncio.sleep(1)

    record.status = "expired"
    record.error = "QR login timed out. Start a new setup."


def _start_weixin_onboarding_thread(
    record: _WeixinOnboardingSession, hermes_home: str
) -> None:
    """Spawn the async weixin QR loop in a daemon thread (context-bound)."""
    from agent.memory_provider import spawn_context_thread
    from plugins.platforms.weixin.adapter import _new_session

    async def _run() -> None:
        async with _new_session() as sess:
            await _weixin_onboarding_loop(sess, hermes_home, record)

    spawn_context_thread(
        lambda: asyncio.run(_run()), name="weixin-onboarding", daemon=True
    ).start()


# ── QQBot QR onboarding state ──────────────────────────────────────

_QQBOT_ONBOARDING_TTL_SECONDS = 600
_QQBOT_ONBOARDING_TERMINAL_STATUSES = {"connected", "error", "expired", "cancelled"}
_QQBOT_DM_POLICY_CHOICES = ("pairing", "open", "allowlist")
_QQBOT_GROUP_POLICY_CHOICES = ("open", "allowlist", "disabled")


@dataclass
class _QqbotOnboardingSession:
    pairing_id: str
    status: str = "waiting"
    qr_payload: str | None = None
    account_id: str | None = None
    user_id: str | None = None
    error: str | None = None
    expires_at: str = ""
    expires_at_ts: float = 0.0
    profile: str | None = None
    cancel_event: threading.Event | None = None
    _client_secret: str = ""


_qqbot_onboarding_sessions: dict[str, _QqbotOnboardingSession] = {}
_qqbot_onboarding_lock = threading.RLock()


def _prune_qqbot_onboarding_sessions() -> None:
    now = time.time()
    remove_ids: list[str] = []
    for pid, record in _qqbot_onboarding_sessions.items():
        if record.expires_at_ts <= now and record.status not in _QQBOT_ONBOARDING_TERMINAL_STATUSES:
            if record.cancel_event:
                record.cancel_event.set()
            record.status = "expired"
            record.error = "QQBot QR setup expired. Start a new setup."
        if record.status in _QQBOT_ONBOARDING_TERMINAL_STATUSES and record.expires_at_ts + 300 <= now:
            remove_ids.append(pid)
    for pid in remove_ids:
        _qqbot_onboarding_sessions.pop(pid, None)


def _supersede_qqbot_onboarding_sessions(profile: str) -> None:
    for record in _qqbot_onboarding_sessions.values():
        if record.profile == profile and record.status not in _QQBOT_ONBOARDING_TERMINAL_STATUSES:
            record.status = "cancelled"
            record.error = "Superseded by a newer QQBot setup session."
            if record.cancel_event:
                record.cancel_event.set()


def _qqbot_onboarding_payload(pid: str, record: _QqbotOnboardingSession) -> dict[str, Any]:
    return {
        "pairing_id": pid,
        "status": record.status,
        "qr_payload": record.qr_payload,
        "expires_at": record.expires_at,
        "account_id": record.account_id,
        "user_id": record.user_id,
        "error": record.error,
    }


def _run_qqbot_onboarding(
    record: _QqbotOnboardingSession,
) -> None:
    """Synchronous QR registration loop for QQBot, run in a daemon thread."""
    from plugins.platforms.qqbot.onboard import qr_register_stream

    def _on_qr(url: str) -> None:
        record.qr_payload = url
        record.status = "waiting"

    def _on_complete(app_id: str, user_openid: str) -> None:
        record.account_id = app_id
        record.user_id = user_openid

    result = qr_register_stream(
        on_qr=_on_qr,
        on_complete=_on_complete,
        cancel_event=record.cancel_event,
        timeout_seconds=_QQBOT_ONBOARDING_TTL_SECONDS,
    )
    if result:
        record._client_secret = result.get("client_secret", "")
        record.status = "connected"
    elif record.cancel_event and record.cancel_event.is_set():
        record.status = "cancelled"
    else:
        record.status = "expired"
        record.error = "QR login timed out or expired. Start a new setup."


def _start_qqbot_onboarding_thread(record: _QqbotOnboardingSession) -> None:
    """Spawn the synchronous qqbot QR loop in a daemon thread (context-bound)."""
    from agent.memory_provider import spawn_context_thread

    spawn_context_thread(
        _run_qqbot_onboarding, args=(record,), name="qqbot-onboarding", daemon=True
    ).start()
