from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.api.routes.compiler import router as compiler_router
from app.api.routes.interactive import router as interactive_router
from app.core.config import CORS_ORIGINS
from app.core.rate_limit import limiter

app = FastAPI(title="Turbo C-Style Online C IDE API")

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(compiler_router)
app.include_router(interactive_router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
