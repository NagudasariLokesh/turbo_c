from typing import Literal

from pydantic import BaseModel, Field

CStandard = Literal["c90", "c99", "c11", "c17", "c23"]


class CompileRequest(BaseModel):
    filename: str = Field(default="main.c")
    source_code: str
    c_standard: CStandard = "c11"


class CompileDiagnostic(BaseModel):
    line: int
    column: int
    message: str


class CompileResponse(BaseModel):
    success: bool
    compiler_output: str
    errors: list[CompileDiagnostic]
    warnings: list[CompileDiagnostic]
