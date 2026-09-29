import os

# Render's native (non-Docker) Python runtime ships gcc/g++ pre-installed
# (Debian 12 "bookworm") but has no way to install additional packages like
# clang -- see sandbox/README.md for the Docker-based alternative, which
# does install clang, if you switch back to that deployment path. Override
# via env var for any environment that has a different compiler on PATH
# (e.g. this dev machine only has clang, not gcc).
COMPILER_BINARY = os.environ.get("COMPILER_BINARY", "gcc")
COMPILE_TIMEOUT_SECONDS = 10
MAX_SOURCE_BYTES = 200_000
CORS_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]

# Execution limits. These are enforced via POSIX rlimits on the child
# process -- the best isolation available without Docker/root in this
# environment. They are NOT a substitute for real container/namespace
# isolation (no filesystem, network, or per-process user separation) -- see
# sandbox/README.md for what a production deployment still needs.
RUN_CPU_SECONDS = 4
RUN_MEMORY_BYTES = 256 * 1024 * 1024
RUN_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
MAX_OUTPUT_BYTES = 200_000

# Interactive run sessions (WebSocket + PTY, see pty_session.py). Unlike the
# old one-shot /run, a session can legitimately sit idle waiting for the
# student to type -- like real Turbo C, there's no per-input timeout. There
# is still a hard cap on total session lifetime so an abandoned/forgotten
# tab doesn't hold a process open forever, and a cap on how many sessions
# one client can have open at once.
SESSION_MAX_DURATION_SECONDS = 300
MAX_CONCURRENT_SESSIONS_PER_CLIENT = 2
MAX_STDIN_CHUNK_BYTES = 4096
