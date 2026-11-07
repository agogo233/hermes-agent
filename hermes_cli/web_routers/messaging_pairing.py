import contextlib
import subprocess

from hermes_cli.process_identity import release_process_group_once_empty


def _terminate_whatsapp_pairing(proc: subprocess.Popen | None) -> None:
    if proc is None:
        return
    if proc.poll() is None:
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:  # health: allow BLE001 -- fork teardown: any proc error falls back to kill
            with contextlib.suppress(Exception):
                proc.kill()
                proc.wait(timeout=3)
    if proc.poll() is not None:
        # Stopped; one we failed to stop stays covered by the owner-death supervisor. timeout=0:
        # callers run on the event loop.
        release_process_group_once_empty(proc.pid, proc=proc, timeout=0)
