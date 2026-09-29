import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.config import COMPILE_TIMEOUT_SECONDS, COMPILER_BINARY
from app.schemas.compile import CompileDiagnostic, CompileResponse

# GCC only recognizes "-std=c23" starting at GCC 14; Debian 12 "bookworm"
# (Render's native Python runtime, and most current Debian-based images)
# ships GCC 12, which only understands the pre-finalization alias "c2x" for
# the same standard. c2x is accepted by both older and newer GCC/clang, so
# it's the safer flag to actually pass regardless of what the API/UI calls
# it. Every other standard name here is a stable, universally-recognized
# flag on both compilers.
_STD_FLAG_OVERRIDES = {"c23": "c2x"}


DIAGNOSTIC_PATTERN = re.compile(
    r"^(?P<file>[^:\n]+):(?P<line>\d+):(?P<column>\d+):\s*"
    r"(?P<severity>error|warning):\s*(?P<message>.*)$",
    re.MULTILINE,
)


def _parse_diagnostics(compiler_output: str) -> tuple[list[CompileDiagnostic], list[CompileDiagnostic]]:
    errors: list[CompileDiagnostic] = []
    warnings: list[CompileDiagnostic] = []

    for match in DIAGNOSTIC_PATTERN.finditer(compiler_output):
        # Skip diagnostics that originate in a different file (e.g. a
        # system header pulled in by #include) -- their line/column refer
        # to that file, not main.c, so surfacing them as an editor marker
        # would point at the wrong place in the student's own code. The
        # message still reaches the student via the raw compiler_output.
        if match.group("file") != "main.c":
            continue

        diagnostic = CompileDiagnostic(
            line=int(match.group("line")),
            column=int(match.group("column")),
            message=match.group("message").strip(),
        )
        if match.group("severity") == "error":
            errors.append(diagnostic)
        else:
            warnings.append(diagnostic)

    return errors, warnings


def compile_in_workspace(workspace: Path, source_code: str, c_standard: str) -> tuple[CompileResponse, Path]:
    """Compile main.c inside an already-created workspace.

    Leaves the workspace and any produced binary on disk -- the caller owns
    cleanup. Used directly by compile-only requests, and by the run flow
    which needs the binary to still exist afterwards.
    """
    source_path = workspace / "main.c"
    source_path.write_text(source_code)
    binary_path = workspace / "program"

    std_flag = _STD_FLAG_OVERRIDES.get(c_standard, c_standard)

    try:
        # Relative filenames (with cwd=workspace) keep the server's
        # temp-directory path out of diagnostics shown to the client.
        result = subprocess.run(
            [
                COMPILER_BINARY,
                f"-std={std_flag}",
                "-Wall",
                "-Wextra",
                "main.c",
                "-o",
                "program",
                # Linked after main.c (linker order matters -- a library
                # only resolves symbols referenced by inputs already seen).
                # -lm is the standard C math library: sqrt/pow/sin/cos/...
                # from <math.h> live there, not in libc, on Linux.
                "-lm",
            ],
            cwd=workspace,
            capture_output=True,
            text=True,
            timeout=COMPILE_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        return (
            CompileResponse(
                success=False,
                compiler_output="Compilation timed out.",
                errors=[CompileDiagnostic(line=0, column=0, message="Compilation timed out.")],
                warnings=[],
            ),
            binary_path,
        )

    compiler_output = result.stderr
    errors, warnings = _parse_diagnostics(compiler_output)
    success = result.returncode == 0 and binary_path.exists()

    return (
        CompileResponse(
            success=success,
            compiler_output=compiler_output,
            errors=errors,
            warnings=warnings,
        ),
        binary_path,
    )


def compile_source(source_code: str, c_standard: str) -> CompileResponse:
    """Compile a single C source file inside an isolated temp workspace that
    is destroyed before returning (compile-only; no binary is kept)."""
    workspace = Path(tempfile.mkdtemp(prefix="c-compile-"))
    try:
        response, _ = compile_in_workspace(workspace, source_code, c_standard)
        return response
    finally:
        shutil.rmtree(workspace, ignore_errors=True)
