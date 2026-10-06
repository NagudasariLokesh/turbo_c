import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.api.routes.compiler import router as compiler_router
from app.api.routes.debugger import router as debugger_router
from app.api.routes.interactive import router as interactive_router
from app.core.config import CORS_ORIGINS
from app.core.rate_limit import limiter

app = FastAPI(title="Turbo C-Style Online C IDE API")

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# The production deployment is same-origin, so this middleware has nothing
# to actually do there (confirmed: a same-origin fetch() never triggers a
# browser's CORS check, so an unused allow-list is inert, not wrong). Local
# dev genuinely needs it -- `next dev` (:3000) calling this API (:8000) is
# cross-origin for fetch()-based requests (compile), confirmed broken via
# an actual browser before this was added back. See CORS_ORIGINS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(compiler_router)
app.include_router(interactive_router)
app.include_router(debugger_router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# The Next.js static export (frontend/out/, built via `npm run build`) is
# mounted LAST and AFTER all /api/* routes above, since FastAPI/Starlette
# matches routes in registration order -- if this were registered first, it
# would swallow every request (including /api/*) before the API routers
# ever saw them. This app is a single page (src/app/page.tsx is the only
# route, no client-side routing to other paths), so plain html=True --
# which serves index.html for "/" and lets everything else 404 normally --
# is all that's needed; no SPA catch-all fallback required.
_FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "static")

if os.path.isdir(_FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=_FRONTEND_DIR, html=True), name="frontend")
