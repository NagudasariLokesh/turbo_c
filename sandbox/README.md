# Sandbox status

This documents exactly what isolates a student's compile/run request today,
and what a production deployment still needs to add. Read this before
trusting the execution service with untrusted internet traffic.

## Implemented (in `backend/app/services/execution_service.py`)

- **CPU time limit** (`RLIMIT_CPU`, default 4s) -- kills runaway loops.
- **Memory limit** (`RLIMIT_AS`, default 256MB) -- `malloc` fails cleanly
  instead of the process being OOM-killed.
- **Wall-clock timeout** (default 6s) via `subprocess.run(timeout=...)`.
- **Output size cap** (default 100KB) -- response is truncated, not the
  live stdout stream, so a flood is still bounded by the CPU/wall limits
  above, not by this cap alone.
- **File size limit** (`RLIMIT_FSIZE`, 10MB) and disabled core dumps.
- **No path traversal**: the compiler/execution services always write to a
  fixed `main.c` inside a freshly created `tempfile.mkdtemp()` workspace,
  which is deleted (`shutil.rmtree`) after every request regardless of
  outcome. The client-supplied `filename` field is never used to build a
  path.
- **Source/stdin size limits** enforced at the API layer (413 responses).

## NOT implemented -- this process is not safe to expose to the public
internet as-is

- **No filesystem isolation.** The compiled binary runs as the same OS
  user as the API server, with the same view of the host filesystem
  (bounded only by that user's normal file permissions). A program that
  finds a way to read files that user can read, is not stopped by
  anything here.
- **No network isolation.** A submitted program can open outbound
  sockets. There is no firewall/netns/seccomp rule in this repo blocking
  that.
- **No per-request user separation.** All requests run as one OS user, so
  `RLIMIT_NPROC` (process-count limiting) is deliberately **not** set in
  `execution_service.py` -- on a shared-user host it counts against every
  process that user owns, including the API server itself, so setting it
  low here would risk breaking the server, not just the sandboxed child.
  Real fork-bomb protection requires either a dedicated low-privilege user
  per request or a container/cgroup, not a bare rlimit.
- **No seccomp/syscall filtering.**

## What closes the gap: containers

`Dockerfile` in this directory builds an image that runs the FastAPI app
as an unprivileged `sandboxrunner` user with only `clang` and the app code
-- a real deployment should additionally run this container with:

```text
docker run \
  --network none \            # no outbound network from inside
  --read-only \                # root filesystem read-only
  --tmpfs /tmp:size=64m \       # writable scratch space only
  --pids-limit 64 \             # real per-container fork-bomb limit
  --memory 512m --cpus 1 \      # container-level resource cap
  --cap-drop ALL \               # drop all Linux capabilities
  --security-opt no-new-privileges \
  <image>
```

Note: the debugger (`debugger.py`/`gdb_session.py`) needs gdb to `ptrace` the
compiled binary it launches. Tracing a direct child is normally allowed
without any special capability (no `CAP_SYS_PTRACE` needed for that specific
case on a default Yama `ptrace_scope`), but this hasn't been verified inside
an actual hardened container running the flags above -- no Docker daemon was
available to test against in this dev environment. If debugging breaks under
a locked-down container, this is where to look first.

Per the spec's own architecture (section 29), each compile/run request
should ideally be dispatched to a short-lived container or a worker pool
of pre-warmed containers behind a queue, rather than executing directly
inside the API process as this repo currently does for local development.
That queue/worker split is Phase 10 (production deployment) work, not
implemented in this repo -- `docker-compose.yml` at the project root
starts the API and frontend as plain processes/containers, without the
per-request sandboxing container described above.
