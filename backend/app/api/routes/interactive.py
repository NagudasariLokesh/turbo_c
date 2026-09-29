import asyncio
import json
import os
import shutil
import signal
import tempfile
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.config import (
    MAX_CONCURRENT_SESSIONS_PER_CLIENT,
    MAX_OUTPUT_BYTES,
    MAX_SOURCE_BYTES,
    MAX_STDIN_CHUNK_BYTES,
    SESSION_MAX_DURATION_SECONDS,
)
from app.services.compiler_service import compile_in_workspace
from app.services.pty_session import PtySession

router = APIRouter(prefix="/api/compiler", tags=["compiler"])

# In-memory, per-process concurrency tracking -- resets on restart and isn't
# shared across multiple backend workers. Good enough for the single-worker
# dev/small-deployment shape this repo targets; a real multi-worker
# deployment would need this in Redis or similar.
_active_sessions: dict[str, int] = {}


def _acquire_slot(client_key: str) -> bool:
    count = _active_sessions.get(client_key, 0)
    if count >= MAX_CONCURRENT_SESSIONS_PER_CLIENT:
        return False
    _active_sessions[client_key] = count + 1
    return True


def _release_slot(client_key: str) -> None:
    count = _active_sessions.get(client_key, 0)
    if count <= 1:
        _active_sessions.pop(client_key, None)
    else:
        _active_sessions[client_key] = count - 1


def _blocking_waitpid(pid: int) -> int | None:
    """Runs in a worker thread -- os.waitpid blocks the whole thread until
    the child exits, which would freeze the event loop if called directly."""
    try:
        _, status = os.waitpid(pid, 0)
    except ChildProcessError:
        return None
    if os.WIFEXITED(status):
        return os.WEXITSTATUS(status)
    if os.WIFSIGNALED(status):
        return -os.WTERMSIG(status)
    return None


def _kill(pid: int | None) -> None:
    if pid is None:
        return
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


async def _safe_send_json(websocket: WebSocket, payload: dict) -> None:
    try:
        await websocket.send_json(payload)
    except RuntimeError:
        pass  # socket already closed (e.g. client disconnected)


@router.websocket("/run-ws")
async def run_interactive(websocket: WebSocket) -> None:
    await websocket.accept()
    client_key = websocket.client.host if websocket.client else "unknown"

    try:
        init = await websocket.receive_json()
    except Exception:
        await websocket.close()
        return

    source_code = init.get("source_code")
    c_standard = init.get("c_standard", "c11")
    if not isinstance(source_code, str) or not source_code:
        await _safe_send_json(websocket, {"type": "error", "message": "source_code is required."})
        await websocket.close()
        return
    if len(source_code.encode("utf-8")) > MAX_SOURCE_BYTES:
        await _safe_send_json(
            websocket, {"type": "error", "message": "Source code exceeds the maximum allowed size."}
        )
        await websocket.close()
        return

    if not _acquire_slot(client_key):
        await _safe_send_json(
            websocket,
            {
                "type": "error",
                "message": "Too many concurrent runs from this connection. Close another running tab first.",
            },
        )
        await websocket.close()
        return

    workspace = Path(tempfile.mkdtemp(prefix="c-interactive-"))
    session: PtySession | None = None
    loop = asyncio.get_event_loop()

    try:
        compile_response, binary_path = compile_in_workspace(workspace, source_code, c_standard)
        if not compile_response.success:
            await _safe_send_json(
                websocket,
                {
                    "type": "compile_error",
                    "compiler_output": compile_response.compiler_output,
                    "errors": [e.model_dump() for e in compile_response.errors],
                    "warnings": [w.model_dump() for w in compile_response.warnings],
                },
            )
            return

        await _safe_send_json(websocket, {"type": "started"})

        session = PtySession(workspace, binary_path)
        master_fd = session.start()
        os.set_blocking(master_fd, False)

        output_queue: asyncio.Queue[bytes | None] = asyncio.Queue()

        def on_readable() -> None:
            try:
                data = os.read(master_fd, 65536)
            except OSError:
                # EIO is how Linux signals "the slave side is gone" on a PTY
                # (unlike a pipe, which would just read as empty instead).
                data = b""
            if data:
                output_queue.put_nowait(data)
            else:
                output_queue.put_nowait(None)
                try:
                    loop.remove_reader(master_fd)
                except (ValueError, OSError):
                    pass

        loop.add_reader(master_fd, on_readable)

        async def pump_output() -> None:
            total = 0
            while True:
                chunk = await output_queue.get()
                if chunk is None:
                    return
                total += len(chunk)
                if total > MAX_OUTPUT_BYTES:
                    await websocket.send_bytes(
                        b"\r\n[output limit exceeded -- program terminated]\r\n"
                    )
                    _kill(session.pid if session else None)
                    return
                await websocket.send_bytes(chunk)

        async def pump_input() -> None:
            while True:
                message = await websocket.receive()
                if message.get("type") == "websocket.disconnect":
                    return
                data = message.get("bytes")
                if data:
                    assert session is not None
                    session.write(data[:MAX_STDIN_CHUNK_BYTES])
                    continue
                text = message.get("text")
                if text:
                    try:
                        control = json.loads(text)
                    except ValueError:
                        continue
                    if control.get("type") == "resize" and session is not None:
                        session.resize(int(control.get("rows", 24)), int(control.get("cols", 80)))

        output_task = asyncio.create_task(pump_output())
        input_task = asyncio.create_task(pump_input())
        # run_in_executor already returns an awaitable Future -- wrapping it
        # in create_task() would fail since that expects a coroutine.
        exit_task = loop.run_in_executor(None, _blocking_waitpid, session.pid)

        done, _pending = await asyncio.wait(
            {exit_task, input_task},
            timeout=SESSION_MAX_DURATION_SECONDS,
            return_when=asyncio.FIRST_COMPLETED,
        )

        if exit_task not in done:
            # Either the session timed out, or the client disconnected
            # before the program finished -- either way, nothing is going
            # to read further input, so stop the program.
            _kill(session.pid)
            exit_code = await exit_task
        else:
            exit_code = exit_task.result()

        # Let any already-buffered output drain before announcing exit.
        try:
            await asyncio.wait_for(output_task, timeout=1.0)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            output_task.cancel()

        if not input_task.done():
            input_task.cancel()

        await _safe_send_json(websocket, {"type": "exit", "exit_code": exit_code})
    except WebSocketDisconnect:
        if session is not None:
            _kill(session.pid)
    finally:
        _release_slot(client_key)
        if session is not None:
            session.close()
        shutil.rmtree(workspace, ignore_errors=True)
        try:
            await websocket.close()
        except RuntimeError:
            pass
