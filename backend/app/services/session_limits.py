from app.core.config import MAX_CONCURRENT_SESSIONS_PER_CLIENT

# In-memory, per-process concurrency tracking -- resets on restart and isn't
# shared across multiple backend workers. Good enough for the single-worker
# dev/small-deployment shape this repo targets; a real multi-worker
# deployment would need this in Redis or similar. Shared by run-ws and
# debug-ws (one pool) since both hold a compiled child process open for the
# same client, and a student opening many tabs of either shouldn't be able
# to bypass the cap by mixing session types.
_active_sessions: dict[str, int] = {}


def acquire_slot(client_key: str) -> bool:
    count = _active_sessions.get(client_key, 0)
    if count >= MAX_CONCURRENT_SESSIONS_PER_CLIENT:
        return False
    _active_sessions[client_key] = count + 1
    return True


def release_slot(client_key: str) -> None:
    count = _active_sessions.get(client_key, 0)
    if count <= 1:
        _active_sessions.pop(client_key, None)
    else:
        _active_sessions[client_key] = count - 1
