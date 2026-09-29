from fastapi import APIRouter, HTTPException, Request

from app.core.config import MAX_SOURCE_BYTES
from app.core.rate_limit import limiter
from app.schemas.compile import CompileRequest, CompileResponse
from app.services.compiler_service import compile_source

router = APIRouter(prefix="/api/compiler", tags=["compiler"])


@router.post("/compile", response_model=CompileResponse)
@limiter.limit("20/minute")
def compile_endpoint(request: Request, payload: CompileRequest) -> CompileResponse:
    if len(payload.source_code.encode("utf-8")) > MAX_SOURCE_BYTES:
        raise HTTPException(status_code=413, detail="Source code exceeds the maximum allowed size.")

    return compile_source(payload.source_code, payload.c_standard)
