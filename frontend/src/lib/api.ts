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

