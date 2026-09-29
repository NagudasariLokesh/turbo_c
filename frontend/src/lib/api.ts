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

