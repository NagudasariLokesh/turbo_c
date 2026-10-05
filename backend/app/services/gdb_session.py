import asyncio
import fcntl
import os
import pty
import signal
import struct
import termios
from pathlib import Path

from pygdbmi.gdbmiparser import parse_response

from app.core.config import (
    DEBUG_EXEC_WRAPPER,
    GDB_BINARY,
    RUN_CPU_SECONDS,
    RUN_MAX_FILE_SIZE_BYTES,
    RUN_MEMORY_BYTES,
)

# gdb MI's `exit-code` field is octal (e.g. "052" for 42) -- confirmed by
# actually running a `return 42;` program through MI and checking; a quirk
# inherited from GDB's CLI "Program exited with code 052" message.
_SIGNAL_NAME_TO_NUMBER = {sig.name: sig.value for sig in signal.Signals}


class GdbError(Exception):
    """A ^error result for a command that needs to succeed (e.g. an invalid
    breakpoint location)."""


class GdbSession:
    """Drives a compiled binary under gdb's machine interface (MI) for real
    breakpoint/step/continue debugging.

    The debuggee's own stdin/stdout (scanf/printf) run on a separate PTY
    from gdb's MI control channel (plain pipes via -inferior-tty-set), so
    the student's program is still a normal interactive terminal from the
    browser's point of view -- gdb and its structured command/event
    protocol are invisible to it. Resource limits are applied to the
    debuggee only (not gdb itself) via `set exec-wrapper`, since gdb -- not
    this process -- is what execs the debuggee.
    """

    def __init__(self, workspace: Path, binary_path: Path, filename: str = "main.c"):
        self.workspace = workspace
        self.binary_path = binary_path
        self.filename = filename
        self.process: asyncio.subprocess.Process | None = None
        self.inferior_master_fd: int | None = None
        self.inferior_pid: int | None = None
        self._inferior_slave_fd: int | None = None
        # Two queues because gdb MI is asynchronous: a command's own
        # ^done/^running/^error result can arrive well before (or
        # interleaved with) the *stopped notification for when the program
        # actually halts -- e.g. -exec-run's ^running just means "started",
        # not "stopped at your breakpoint yet". Confirmed by tracing real
        # MI output: *stopped for a breakpoint hit arrived AFTER the
        # ^running/(gdb) prompt for -exec-run had already completed.
        self._results: asyncio.Queue = asyncio.Queue()
        self.events: asyncio.Queue = asyncio.Queue()
        self._reader_task: asyncio.Task | None = None

    async def start(self) -> int:
        """Launches gdb in MI mode. Returns the inferior PTY master fd the
        caller reads/writes to drive the debuggee's own terminal I/O."""
        master_fd, slave_fd = pty.openpty()
        self.inferior_master_fd = master_fd
        self._inferior_slave_fd = slave_fd
        slave_path = os.ttyname(slave_fd)
        self.resize(24, 80)

        env = os.environ.copy()
        env["DEBUGGEE_CPU_SECONDS"] = str(RUN_CPU_SECONDS)
        env["DEBUGGEE_MEM_KB"] = str(RUN_MEMORY_BYTES // 1024)
        env["DEBUGGEE_FSIZE_KB"] = str(RUN_MAX_FILE_SIZE_BYTES // 1024)

        self.process = await asyncio.create_subprocess_exec(
            GDB_BINARY,
            "--interpreter=mi2",
            "--nx",
            "-q",
            str(self.binary_path),
            cwd=self.workspace,
            env=env,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        self._reader_task = asyncio.create_task(self._read_loop())

        await self._send(f"-inferior-tty-set {slave_path}")
        # Invoked via `sh` explicitly, not relied on being independently
        # executable -- this repo is checked out on a WSL drvfs mount with
        # git's fileMode tracking disabled (every file there reports as
        # executable locally regardless of what's actually committed), so
        # the executable bit alone isn't a reliable way to make sure this
        # script runs on Render's real Linux filesystem.
        await self._send(f"set exec-wrapper sh {DEBUG_EXEC_WRAPPER}")
        return master_fd

    async def _read_loop(self) -> None:
        assert self.process and self.process.stdout
        while True:
            line = await self.process.stdout.readline()
            if not line:
                break
            text = line.decode(errors="replace").rstrip("\n")
            if not text or text == "(gdb)":
                continue
            record = parse_response(text)
            if record is None:
                continue
            if record["type"] == "result":
                await self._results.put(record)
            elif record["type"] in ("notify", "exec"):
                if record.get("message") == "thread-group-started":
                    # Captured as a side effect, not consumed here -- still
                    # forwarded to self.events below like any other notify
                    # record. This is the debuggee's own OS pid (distinct
                    # from gdb's), needed to force-kill it directly (output
                    # limit exceeded, session timeout) without going
                    # through MI, which has no hard "kill -9" equivalent.
                    pid = (record.get("payload") or {}).get("pid")
                    if pid is not None:
                        try:
                            self.inferior_pid = int(pid)
                        except ValueError:
                            pass
                await self.events.put(record)
            # console/log/target stream records (human-readable text gdb
            # would print in its CLI) are discarded -- the structured
            # result/notify/exec records already carry everything the
            # frontend needs (line numbers, variable values, exit codes).

    async def _send(self, command: str) -> dict:
        assert self.process and self.process.stdin
        self.process.stdin.write((command + "\n").encode())
        await self.process.stdin.drain()
        record = await self._results.get()
        if record.get("message") == "error":
            payload = record.get("payload") or {}
            raise GdbError(payload.get("msg", f"gdb rejected: {command}"))
        return record

    async def set_breakpoints(self, lines: list[int]) -> None:
        for line in lines:
            try:
                await self._send(f"-break-insert {self.filename}:{line}")
            except GdbError:
                # Blank line, a line past the function, inside a comment,
                # etc. -- gdb just can't place a real breakpoint there.
                # Not fatal: skip it rather than failing the whole session.
                continue

    async def run(self) -> None:
        await self._send("-exec-run")

    async def cont(self) -> None:
        await self._send("-exec-continue")

    async def step_over(self) -> None:
        await self._send("-exec-next")

    async def step_into(self) -> None:
        await self._send("-exec-step")

    async def list_variables(self) -> list[dict]:
        record = await self._send("-stack-list-variables --simple-values")
        payload = record.get("payload") or {}
        return payload.get("variables", [])

    def resize(self, rows: int, cols: int) -> None:
        if self.inferior_master_fd is None:
            return
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        try:
            fcntl.ioctl(self.inferior_master_fd, termios.TIOCSWINSZ, winsize)
        except OSError:
            pass

    def write_stdin(self, data: bytes) -> None:
        if self.inferior_master_fd is None:
            return
        try:
            os.write(self.inferior_master_fd, data)
        except OSError:
            pass

    def kill_inferior(self) -> None:
        """Directly SIGKILLs the debuggee (not gdb itself) -- used for
        output-limit/timeout enforcement, where waiting on MI's own
        (cooperative) stop/kill commands isn't appropriate."""
        if self.inferior_pid is None:
            return
        try:
            os.kill(self.inferior_pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    async def close(self) -> None:
        if self._reader_task is not None:
            self._reader_task.cancel()
        if self.process is not None and self.process.returncode is None:
            try:
                if self.process.stdin:
                    self.process.stdin.write(b"-gdb-exit\n")
                    await self.process.stdin.drain()
                await asyncio.wait_for(self.process.wait(), timeout=2)
            except Exception:
                self.process.kill()
        for fd in (self.inferior_master_fd, self._inferior_slave_fd):
            if fd is not None:
                try:
                    os.close(fd)
                except OSError:
                    pass
        self.inferior_master_fd = None
        self._inferior_slave_fd = None


def exit_code_from_stopped(payload: dict) -> int | None:
    """Translates a *stopped notification's payload into an exit code using
    the same convention as the plain (non-debug) run path: 0+ for a normal
    exit, negative for death-by-signal (-signal number). Returns None if
    this *stopped event isn't a terminal one -- which includes
    "signal-received" (e.g. SIGSEGV): confirmed empirically that this is
    gdb *pausing* the still-alive process at the fault, same as a
    breakpoint, not the process actually dying yet. It only actually dies
    (reason "exited-signalled") if the student then Continues past it,
    letting the signal be redelivered -- same two-step real gdb gives you
    at a CLI, so the student gets a chance to inspect the crash site
    first instead of just being told "it crashed"."""
    reason = payload.get("reason")
    if reason == "exited-normally":
        return 0
    if reason == "exited":
        # Octal, not decimal -- confirmed empirically (`return 42;` reports
        # exit-code="052"), a quirk inherited from GDB's CLI message text.
        return int(payload.get("exit-code", "0"), 8)
    if reason == "exited-signalled":
        signal_name = payload.get("signal-name", "")
        return -_SIGNAL_NAME_TO_NUMBER.get(signal_name, 0)
    return None
