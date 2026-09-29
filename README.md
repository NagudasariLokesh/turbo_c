# Turbo C-Style Online C IDE

A browser-based IDE dedicated to C, styled after the classic Turbo C
editor: Next.js/Monaco frontend, FastAPI backend compiling and running
code with `clang`. No database -- the backend is stateless.

Full functional spec: `turbo_c_style_online_c_ide_spec.md`.

## What's implemented

- **Editor**: Monaco-based C editor, Turbo C-style menu bar, file tabs,
  unsaved-changes prompts, keyboard shortcuts (F2/F3/Alt+F9/Ctrl+F9/...).
- **Compile & Run**: `POST /api/compiler/compile` and `/run`, with
  stdin support, timeouts, and resource limits (see "Sandbox status" below).
  Links against `-lm` (the C math library), so `<math.h>` functions like
  `sqrt`/`pow`/`sin` work.
- **File management**: Save/Save As/Open write directly to **your own
  machine** via the browser's File System Access API (Chrome/Edge/Opera --
  a real OS "save to..." dialog, and a plain Save re-writes the same file
  without re-prompting). Firefox/Safari fall back to a normal file-picker
  for Open and a browser download (to your Downloads folder, no location
  choice) for Save, since they don't implement that API yet. See
  `frontend/src/lib/localFiles.ts`. The backend has no file storage at all.
- **Rate limiting**: `/api/compiler/compile` (20/min) and `/run` (12/min)
  are throttled per client IP via `slowapi`; other endpoints get a
  120/min default. See `app/core/rate_limit.py`.
- **Deployment artifacts**: `docker-compose.yml`, `frontend/Dockerfile`,
  `sandbox/Dockerfile`, `nginx/nginx.conf` -- written but **not run** in
  this dev environment (no Docker daemon available here). Review before
  using them for a real deployment.

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
cp backend/.env.example backend/.env   # fill in CORS_ORIGINS
cp frontend/.env.example frontend/.env.local
docker compose up --build
```

This starts the FastAPI backend, the Next.js frontend, and an Nginx
reverse proxy (port 80) in front of both. **Before pointing this at real
users**, read `sandbox/README.md` -- the `backend` service as defined runs
submitted code with process-level resource limits only, not the
container-level network/filesystem isolation a public-facing deployment
needs. Also add HTTPS (e.g. certbot) to `nginx/nginx.conf`; it ships
HTTP-only.

## Known gaps

- No real network/filesystem sandbox isolation (process rlimits only) --
  see `sandbox/README.md`.
- No live cloud deployment was performed from this session (no domain/cloud
  credentials available here); the docker-compose/nginx/Dockerfiles are
  reviewed and internally consistent but unverified end-to-end.
- "Run With Input" and "Run" behave identically (both use whatever is in
  the Input panel); there's no character-by-character interactive stdin
  (would need a PTY/WebSocket, not implemented).
- Debug menu, Options (theme/font size), and Project menu are UI stubs.
- Save/Open in Firefox/Safari can't ask for a location (no File System
  Access API support there) -- Save always drops into Downloads.
