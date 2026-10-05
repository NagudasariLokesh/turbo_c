export interface CompileDiagnostic {
  line: number;
  column: number;
  message: string;
}

export interface CompileResponse {
  success: boolean;
  compiler_output: string;
  errors: CompileDiagnostic[];
  warnings: CompileDiagnostic[];
}

export type CStandard = "c90" | "c99" | "c11" | "c17" | "c23";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

// In the single-service deployment, NEXT_PUBLIC_API_BASE_URL is baked in
// as "" at build time so fetch() calls resolve as same-origin relative
// paths -- but the WebSocket constructor does NOT auto-convert a relative
// http(s) URL to ws(s); it resolves relative to the page's http(s) scheme
// and then rejects it for not being ws/wss. So an empty base falls back
// to the current page's origin, built explicitly with the ws(s) scheme.
export function wsUrlFor(path: string): string {
  const base =
    API_BASE_URL || (typeof window !== "undefined" ? window.location.origin : "");
  return base.replace(/^http/, "ws") + path;
}

// Turbo C's compiler printed one line per diagnostic -- "Error FILE LINE:
// message" / "Warning FILE LINE: message", no column number, no source
// snippet/caret -- not GCC/clang's own "file:line:col: severity: message"
// format (which is what compiler_output contains raw). The structured
// errors/warnings arrays (already line/message-parsed by the backend) are
// reformatted into that classic pattern here instead of ever showing GCC's
// own diagnostic text directly.
export function formatCompileResult(filename: string, result: CompileResponse): string[] {
  const diagnosticLines = [
    ...result.errors.map((d) => ({ ...d, label: "Error" as const })),
    ...result.warnings.map((d) => ({ ...d, label: "Warning" as const })),
  ]
    .sort((a, b) => a.line - b.line)
    .map((d) => `${d.label} ${filename} ${d.line}: ${d.message}`);

  if (result.success) {
    const lines = ["COMPILATION SUCCESSFUL", "", `${filename} compiled successfully.`];
    if (diagnosticLines.length > 0) {
      lines.push("", ...diagnosticLines, "", `${result.warnings.length} warning(s).`);
    }
    return lines;
  }

  const lines = ["COMPILATION ERROR", ""];
  if (diagnosticLines.length > 0) {
    lines.push(
      ...diagnosticLines,
      "",
      `${result.errors.length} error(s), ${result.warnings.length} warning(s).`
    );
  } else if (result.compiler_output.trim()) {
    // Structured parsing didn't catch anything -- e.g. a linker error
    // ("undefined reference to ..."), which doesn't match the
    // file:line:col: pattern the backend parses. Fall back to the
    // compiler's own raw text so nothing is silently hidden.
    lines.push(result.compiler_output.trim());
  } else {
    lines.push("Compilation failed.");
  }
  return lines;
}

export async function compileSource(
  sourceCode: string,
  cStandard: CStandard,
  filename = "main.c"
): Promise<CompileResponse> {
  const response = await fetch(`${API_BASE_URL}/api/compiler/compile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename,
      source_code: sourceCode,
      c_standard: cStandard,
    }),
  });

  if (!response.ok) {
    throw new Error(`Compiler service error: HTTP ${response.status}`);
  }

  return response.json();
}

