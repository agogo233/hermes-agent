"""Owner-run bulk sweeps the dashboard forwards over the control socket.

A standalone dashboard writing the store under a live gateway would be a second
writer, so the bulk sweeps (delete empty, bulk delete, prune) forward to the
owner instead of taking the offline exclusive-maintenance reservation (which
loses to any owner holding the lock — #138915). The owner runs them on its own
store connection through the same ``track_mutation`` / ``retire_live_sessions``
path housekeeping uses.

Unlike ``session.prune`` (the CLI's ``hermes sessions prune``), these verbs do
not require ``native_owner``: the dashboard's authenticated principal carries
``session:operator`` and the owner's own admission gates the write. Store-wide
deletion across every principal's rows is still operator-only, never a remote
or unauthenticated grant.
"""
import asyncio
from pathlib import Path

from hermes_state_runtime import RuntimeStoreError
from gateway.session_prune import _filters


async def delete_empty(connection, ref, params):
    """``session.delete_empty``: the owner deletes every empty, ended, non-archived
    session in its own store (the same ``delete_empty_sessions`` the offline sweep runs)."""
    authority, actor = connection.authority, connection.actor
    if 'session:operator' not in actor.capabilities:
        raise RuntimeStoreError('permission_denied')
    if actor.profile_id != authority.profile_id:
        raise RuntimeStoreError('profile_mismatch')
    authority._require_admission_open()
    from gateway.session_runtime_workers import track_mutation
    task = track_mutation(authority, _apply_delete_empty(authority))
    return await asyncio.shield(task)


async def _apply_delete_empty(authority):
    from hermes_constants import get_hermes_home
    sessions_dir = Path(get_hermes_home()) / 'sessions'
    deleted = await asyncio.to_thread(
        authority.db.delete_empty_sessions, sessions_dir=sessions_dir)
    return {'deleted': deleted}


async def bulk_delete(connection, ref, params):
    """``session.bulk_delete``: the owner deletes the requested session ids (compression
    chains expanded, active write guards skipped) on its own store connection."""
    authority, actor = connection.authority, connection.actor
    if 'session:operator' not in actor.capabilities:
        raise RuntimeStoreError('permission_denied')
    if actor.profile_id != authority.profile_id:
        raise RuntimeStoreError('profile_mismatch')
    ids = params.get('ids')
    if not isinstance(ids, list) or not all(isinstance(i, str) and i for i in ids):
        raise RuntimeStoreError('invalid_params')
    include_chain = params.get('include_compression_chain', True)
    authority._require_admission_open()
    from gateway.session_runtime_workers import track_mutation
    task = track_mutation(authority, _apply_bulk_delete(authority, ids, include_chain))
    return await asyncio.shield(task)


async def _apply_bulk_delete(authority, ids, include_chain):
    from hermes_constants import get_hermes_home
    from gateway.session_mutations import retire_live_sessions
    sessions_dir = Path(get_hermes_home()) / 'sessions'
    skipped: list[str] = []
    deleted = await asyncio.to_thread(
        authority.db.delete_sessions, ids, sessions_dir=sessions_dir,
        exclude_active_write_guards=True, skipped_ids=skipped,
        include_compression_chain=include_chain)
    retire_live_sessions(authority, [i for i in ids if i])
    return {'deleted': deleted, 'skipped': skipped}


async def dashboard_prune(connection, ref, params):
    """``session.bulk_prune``: the dashboard's ``POST /api/sessions/prune`` forwarded to
    the owner. Same filters / ``never_active_days`` contract as ``session.prune`` but
    operator-gated instead of native-owner-gated, so an authenticated dashboard user
    can run it while a separate gateway owns the store."""
    authority, actor = connection.authority, connection.actor
    if 'session:operator' not in actor.capabilities:
        raise RuntimeStoreError('permission_denied')
    if actor.profile_id != authority.profile_id:
        raise RuntimeStoreError('profile_mismatch')
    never_active = params.get('never_active_days')
    if ('filters' in params) == (never_active is not None) or (
            never_active is not None and (isinstance(never_active, bool)
                                          or not isinstance(never_active, (int, float))
                                          or never_active < 0)):
        raise RuntimeStoreError('invalid_params')
    filters = _filters(params['filters']) if 'filters' in params else None
    authority._require_admission_open()
    from gateway.session_prune import _apply
    from gateway.session_runtime_workers import track_mutation
    task = track_mutation(authority, _apply(authority, filters, never_active))
    return await asyncio.shield(task)