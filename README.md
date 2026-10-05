# Turbo C-Style Online C IDE

A browser-based IDE dedicated to C, styled after the classic Turbo C
editor: Next.js/Monaco frontend, FastAPI backend compiling and running
code with a real C compiler (`gcc` by default, `clang` in local dev --
see `COMPILER_BINARY` in `backend/app/core/config.py`). No database --
the backend is stateless.

Full functional spec: `turbo_c_style_online_c_ide_spec.md`.

## What's implemented

- **Editor**: Monaco-based C editor, Turbo C-style menu bar, file tabs,
  unsaved-changes prompts, keyboard shortcuts (F2/F3/Alt+F9/Ctrl+F9/...).
- **Compile & Run**: `POST /api/compiler/compile` for compile-only (Alt+F9);
  `WS /api/compiler/run-ws` for Run (F9/Ctrl+F9) -- compiles, then streams a
  real interactive terminal session (PTY, not batch stdin) over the socket,
  so `scanf`/`getchar` etc. work character-by-character like a real console.
  See `frontend/src/components/terminal/TerminalScreen.tsx` and
  `backend/app/services/pty_session.py`. Both link against `-lm` (the C
  math library), so `<math.h>` functions like `sqrt`/`pow`/`sin` work.
  Resource limits (CPU/memory/output size/session duration) are enforced
  via POSIX rlimits -- see "Known gaps" below for what that doesn't cover.
- **Debugging**: `WS /api/compiler/debug-ws` for Debug > Start Debugging --
  compiles with `-g -O0`, then drives the binary under a real `gdb`
  (machine-interface mode) for actual breakpoints, Continue/Step
  Over/Step Into, and a live local-variables panel, with the debuggee's
  own stdin/stdout on the same interactive terminal as Run. Click the
  editor's left gutter to toggle a breakpoint (red dot); the current
  line highlights while paused. See
  `frontend/src/components/debug/DebugScreen.tsx` and
  `backend/app/services/gdb_session.py`. No real `gdb` exists on Render's
  native runtime (same constraint as `clang` -- see `COMPILER_BINARY`
  below), so the build command fetches one from conda-forge via
  `micromamba` -- see "Deploying (Render...)" below.
- **File management**: Save/Save As/Open write directly to **your own
  machine** via the browser's File System Access API (Chrome/Edge/Opera --
  a real OS "save to..." dialog, and a plain Save re-writes the same file
  without re-prompting). Firefox/Safari fall back to a normal file-picker
  for Open and a browser download (to your Downloads folder, no location
  choice) for Save, since they don't implement that API yet. See
  `frontend/src/lib/localFiles.ts`. The backend has no file storage at all.
- **Rate limiting**: `/api/compiler/compile` (20/min) is throttled per
  client IP via `slowapi`; other HTTP endpoints get a 120/min default. See
  `app/core/rate_limit.py`. This does **not** cover the `run-ws`/`debug-ws`
  WebSockets (slowapi only wraps HTTP routes) -- see "Known gaps" below.
- **Deployment artifacts**: `docker-compose.yml`, `frontend/Dockerfile`,
  `frontend/nginx.conf`, `sandbox/Dockerfile` -- written but **not run** in
  this dev environment (no Docker daemon available here). Review before
  using them for a real deployment. The actual live deployment is the
  single Render web service described below.

Auth, exercises/submissions, student/teacher dashboards, and server-side
file storage (a SQLite/Postgres `source_files` table) were all built in
earlier iterations and then deliberately removed at the user's request --
the code for that layer no longer exists in this repo, not just hidden.

## Local development

### Backend

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --port 8000 --reload --reload-dir app
```

Requires a C compiler on PATH (`clang` by default -- see
`app/core/config.py:COMPILER_BINARY`; change to `gcc` if that's what you
have). No database, no other setup.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Defaults to talking to the backend at `http://localhost:8000` (see
`src/lib/api.ts`); override with `NEXT_PUBLIC_API_BASE_URL` if needed.

## Deploying (docker-compose)

```bash
docker compose up --build
```

No env file needed for the defaults. This starts two containers:
`backend` (FastAPI, via `sandbox/Dockerfile`, which installs `clang` and
`gdb`) and `frontend` (an nginx image serving the Next.js static export
and proxying `/api/*` -- including the WebSocket run/debug endpoints --
to `backend`; same origin, port 80, no CORS needed, same design as the
live Render deployment above). To point the frontend at a backend hosted somewhere
else instead, set `NEXT_PUBLIC_API_BASE_URL` (no trailing `/api`) before
building: `NEXT_PUBLIC_API_BASE_URL=https://example.com docker compose up --build`.

**Before pointing this at real users**, read `sandbox/README.md` -- the
`backend` service as defined runs submitted code with process-level
resource limits only, not the container-level network/filesystem
isolation a public-facing deployment needs. Also add HTTPS (e.g. certbot)
to `frontend/nginx.conf`; it ships HTTP-only.

## Deploying (Render, single web service)

Live at **https://turboc-compiler.onrender.com**. Deployed as one Render
web service (native Python runtime, no Docker, no Blueprint) that builds
the frontend to a static export and serves it directly from FastAPI --
same origin for everything, so no CORS configuration is needed in
production.

Service settings:

- **Build Command**:
  `cd frontend && npm ci && npm run build && cd ../backend && pip install -r requirements.txt && rm -rf static && cp -r ../frontend/out static && mkdir -p vendor && curl -fsSL -o vendor/micromamba https://github.com/mamba-org/micromamba-releases/releases/download/2.9.0-0/micromamba-linux-64 && curl -fsSL -o vendor/micromamba.sha256 https://github.com/mamba-org/micromamba-releases/releases/download/2.9.0-0/micromamba-linux-64.sha256 && echo "$(awk '{print $1}' vendor/micromamba.sha256)  vendor/micromamba" | sha256sum -c - && chmod +x vendor/micromamba && ./vendor/micromamba create -y -p vendor/gdb-env -c conda-forge gdb`

  The `vendor/` steps fetch a real `gdb` (needed for Debug > Start
  Debugging): Render's native Python runtime has no package manager
  access (no root -- confirmed empirically: `apt-get install`/`apt-get
  update` both fail with permission errors), so there's no `apt install
  gdb` available the way `clang` would normally come from. `micromamba`
  (a small static binary, checksum-verified against its own published
  `.sha256`) installs `gdb` from **conda-forge** -- a long-established,
  CI-built, checksum-verified package channel, not an ad-hoc binary --
  into `backend/vendor/gdb-env/`, which `GDB_BINARY` in
  `app/core/config.py` points at by default. `vendor/` is gitignored like
  `static/`: a build artifact, not source, refetched on every build.
- **Start Command**: `cd backend && uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- **Environment variables**: `PYTHON_VERSION=3.12.3`, `NEXT_PUBLIC_API_BASE_URL=`
  (empty -- baked into the frontend bundle at build time so `fetch`/WebSocket
  calls resolve as same-origin instead of pointing at a separate service;
  see `frontend/src/lib/api.ts` and `frontend/src/components/terminal/TerminalScreen.tsx`).
- **Health check path**: `/api/health`

`backend/app/main.py` mounts the copied `frontend/out` build at `backend/static/`
(gitignored -- it's a build artifact, regenerated by the build command above,
not committed) via Starlette's `StaticFiles`, registered *after* the `/api/*`
routers so API routes aren't shadowed by the static catch-all.

## Known gaps

- No real network/filesystem sandbox isolation (process rlimits only) --
  see `sandbox/README.md`.
- The docker-compose/nginx/Dockerfiles describe an alternative
  multi-container deployment and are reviewed but unverified end-to-end --
  the actual live deployment is the single Render web service above.
- `run-ws`/`debug-ws` have no per-client rate limiting (slowapi only
  covers HTTP routes, not WebSockets) and no Origin validation on the
  WebSocket upgrade, so a session-exhaustion or cross-origin-connection
  abuse path exists in principle. `MAX_CONCURRENT_SESSIONS_PER_CLIENT`
  (shared across both, see `app/services/session_limits.py`) and the
  process rlimits bound the damage any one connection can do, but neither
  is a substitute for actually closing this gap.
- "Run With Input" and "Run" are intentionally the same action (both open
  the same interactive terminal) -- the menu item is a holdover from the
  original Turbo C menu, not a bug.
- The debugger shows local variables of basic types (int/char/float/
  double/pointers/simple structs -- whatever `gdb -stack-list-variables`
  formats for a `-O0` build) in the current stack frame only; there's no
  watch-expression box, call-stack panel, or breakpoint conditions/multi-
  file support. Stepping into a function without debug info (e.g. a libc
  call like `printf`) steps over it instead, same as plain gdb.
- Options (theme/font size) and Project menu are UI stubs.
- Save/Open in Firefox/Safari can't ask for a location (no File System
  Access API support there) -- Save always drops into Downloads.
