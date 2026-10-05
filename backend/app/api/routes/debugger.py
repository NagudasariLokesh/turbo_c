import asyncio
import json
import os
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.config import (
    MAX_OUTPUT_BYTES,
    MAX_SOURCE_BYTES,
    MAX_STDIN_CHUNK_BYTES,
    SESSION_MAX_DURATION_SECONDS,
)
from app.services.compiler_service import compile_in_workspace
from app.services.gdb_session import GdbError, GdbSession, exit_code_from_stopped
from app.services.session_limits import acquire_slot, release_slot

router = APIRouter(prefix="/api/compiler", tags=["compiler"])


async def _safe_send_json(websocket: WebSocket, payload: dict) -> None:
    try:
        await websocket.send_json(payload)
    except RuntimeError:
        pass  # socket already closed (e.g. client disconnected)


@router.websocket("/debug-ws")
async def run_debug(websocket: WebSocket) -> None:
    await websocket.accept()
    client_key = websocket.client.host if websocket.client else "unknown"

    try:
        init = await websocket.receive_json()
    except Exception:
        await websocket.close()
        return

    source_code = init.get("source_code")
    c_standard = init.get("c_standard", "c11")
    filename = init.get("filename") or "main.c"
    raw_breakpoints = init.get("breakpoints", [])
    breakpoints = [int(line) for line in raw_breakpoints if isinstance(line, (int, float, str))]

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

    if not acquire_slot(client_key):
        await _safe_send_json(
            websocket,
            {
                "type": "error",
                "message": "Too many concurrent sessions from this connection. Close another running or debugging tab first.",
            },
        )
        await websocket.close()
        return

    workspace = Path(tempfile.mkdtemp(prefix="c-debug-"))
    session: GdbSession | None = None
    loop = asyncio.get_event_loop()

    try:
        compile_response, binary_path = compile_in_workspace(
            workspace, source_code, c_standard, debug=True
        )
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

        session = GdbSession(workspace, binary_path, filename=filename)
        master_fd = await session.start()
        os.set_blocking(master_fd, False)

        try:
            await session.set_breakpoints(breakpoints)
        except GdbError as exc:
            await _safe_send_json(websocket, {"type": "error", "message": str(exc)})
            return

        output_queue: asyncio.Queue[bytes | None] = asyncio.Queue()

        def on_readable() -> None:
            try:
                data = os.read(master_fd, 65536)
            except OSError:
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
                    assert session is not None
                    session.kill_inferior()
                    return
                await websocket.send_bytes(chunk)

        async def watch_events() -> int | None:
            """Consumes gdb's async *stopped notifications. Returns the
            exit code once the debuggee actually terminates (normal exit,
            explicit exit code, or an unhandled signal killing it); keeps
            looping (reporting each pause to the client) for every
            breakpoint/step/signal stop along the way, since those leave
            the debuggee still alive and waiting."""
            assert session is not None
            while True:
                event = await session.events.get()
                if event.get("message") != "stopped":
                    continue
                payload = event.get("payload") or {}
                code = exit_code_from_stopped(payload)
                if code is not None:
                    return code
                frame = payload.get("frame") or {}
                try:
                    variables = await session.list_variables()
                except GdbError:
                    variables = []
                line = frame.get("line")
                await _safe_send_json(
                    websocket,
                    {
                        "type": "stopped",
                        "reason": payload.get("reason"),
                        "line": int(line) if line is not None else None,
                        "signal_name": payload.get("signal-name"),
                        "variables": variables,
                    },
                )

        async def pump_input() -> None:
            assert session is not None
            while True:
                message = await websocket.receive()
                if message.get("type") == "websocket.disconnect":
                    return
                data = message.get("bytes")
                if data:
                    session.write_stdin(data[:MAX_STDIN_CHUNK_BYTES])
                    continue
                text = message.get("text")
                if not text:
                    continue
                try:
                    control = json.loads(text)
                except ValueError:
                    continue
                ctype = control.get("type")
                try:
                    if ctype == "resize":
                        session.resize(int(control.get("rows", 24)), int(control.get("cols", 80)))
                    elif ctype == "continue":
                        await session.cont()
                    elif ctype == "step_over":
                        await session.step_over()
                    elif ctype == "step_into":
                        await session.step_into()
                    elif ctype == "stop":
                        return
                except GdbError:
                    # Most likely: the debuggee already exited and the
                    # client's button-disable state just hadn't caught up
                    # yet. Nothing to do -- the exit event is already on
                    # its way via watch_events.
                    pass

        output_task = asyncio.create_task(pump_output())
        input_task = asyncio.create_task(pump_input())
        events_task = asyncio.create_task(watch_events())

        await _safe_send_json(websocket, {"type": "started"})
        await session.run()

        done, _pending = await asyncio.wait(
            {events_task, input_task},
            timeout=SESSION_MAX_DURATION_SECONDS,
            return_when=asyncio.FIRST_COMPLETED,
        )

        if events_task in done:
            exit_code = events_task.result()
        else:
            # Either the session timed out, or the client disconnected /
            # asked to stop before the program finished -- either way,
            # nothing is going to drive it further, so kill it.
            session.kill_inferior()
            try:
                exit_code = await asyncio.wait_for(events_task, timeout=2)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                exit_code = None
                events_task.cancel()

        try:
            await asyncio.wait_for(output_task, timeout=1.0)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            output_task.cancel()

        if not input_task.done():
            input_task.cancel()

        await _safe_send_json(websocket, {"type": "exit", "exit_code": exit_code})
    except WebSocketDisconnect:
        if session is not None:
            session.kill_inferior()
    finally:
        release_slot(client_key)
        if session is not None:
            await session.close()
        shutil.rmtree(workspace, ignore_errors=True)
        try:
            await websocket.close()
        except RuntimeError:
            pass
