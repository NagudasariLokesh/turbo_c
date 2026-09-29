import fcntl
import os
import pty
import resource
import struct
import termios
from pathlib import Path

from app.core.config import (
    RUN_CPU_SECONDS,
    RUN_MAX_FILE_SIZE_BYTES,
    RUN_MEMORY_BYTES,
)


def _apply_resource_limits() -> None:
    """Runs in the forked child, before exec. Same limits as before -- see
    sandbox/README.md for what this does and doesn't protect against."""
    resource.setrlimit(resource.RLIMIT_CPU, (RUN_CPU_SECONDS, RUN_CPU_SECONDS))
    resource.setrlimit(resource.RLIMIT_AS, (RUN_MEMORY_BYTES, RUN_MEMORY_BYTES))
    resource.setrlimit(
        resource.RLIMIT_FSIZE, (RUN_MAX_FILE_SIZE_BYTES, RUN_MAX_FILE_SIZE_BYTES)
    )
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


class PtySession:
    """One running program attached to a pseudo-terminal, so scanf/printf
    behave like a real interactive console instead of batch stdin/stdout.
    """

    def __init__(self, workspace: Path, binary_path: Path):
        self.workspace = workspace
        self.binary_path = binary_path
        self.pid: int | None = None
        self.master_fd: int | None = None

    def start(self) -> int:
        """Forks the child onto a fresh PTY and execs the compiled binary.
        Returns the master fd the parent reads/writes to drive the session.
        """
        pid, master_fd = pty.fork()
        if pid == 0:
            # Child: pty.fork() already made the slave side our controlling
            # terminal and wired it to fds 0/1/2.
            try:
                os.chdir(self.workspace)
                _apply_resource_limits()
                os.execv(str(self.binary_path), [str(self.binary_path)])
            except Exception:
                os._exit(127)
            os._exit(127)

        self.pid = pid
        self.master_fd = master_fd
        self.resize(24, 80)
        return master_fd

    def resize(self, rows: int, cols: int) -> None:
        if self.master_fd is None:
            return
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        try:
            fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, winsize)
        except OSError:
            pass

    def write(self, data: bytes) -> None:
        if self.master_fd is None:
            return
        try:
            os.write(self.master_fd, data)
        except OSError:
            pass

    def close(self) -> None:
        if self.master_fd is not None:
            try:
                os.close(self.master_fd)
            except OSError:
                pass
            self.master_fd = None
