"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { API_BASE_URL, CompileDiagnostic, CStandard } from "@/lib/api";

interface TerminalScreenProps {
  sourceCode: string;
  cStandard: CStandard;
  filename: string;
  onClose: () => void;
  onCompileError: (
    errors: CompileDiagnostic[],
    warnings: CompileDiagnostic[],
    compilerOutput: string
  ) => void;
  onExit?: (exitCode: number | null) => void;
}

function wsUrlFor(path: string): string {
  // In the single-service deployment, NEXT_PUBLIC_API_BASE_URL is baked in
  // as "" at build time so fetch() calls resolve as same-origin relative
  // paths -- but the WebSocket constructor does NOT auto-convert a relative
  // http(s) URL to ws(s); it resolves relative to the page's http(s) scheme
  // and then rejects it for not being ws/wss. So an empty base falls back
  // to the current page's origin, built explicitly with the ws(s) scheme.
  const base =
    API_BASE_URL || (typeof window !== "undefined" ? window.location.origin : "");
  return base.replace(/^http/, "ws") + path;
}

export default function TerminalScreen({
  sourceCode,
  cStandard,
  filename,
  onClose,
  onCompileError,
  onExit,
}: TerminalScreenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  // Event handlers below are set up once (in the effect that owns the
  // socket/terminal lifecycle) and must read the *current* phase without
  // re-running that effect on every phase change -- hence a ref instead of
  // plain state for phase tracking.
  const phaseRef = useRef<"connecting" | "running" | "exited">("connecting");
  const onCloseRef = useRef(onClose);
  const onCompileErrorRef = useRef(onCompileError);
  const onExitRef = useRef(onExit);

  useEffect(() => {
    onCloseRef.current = onClose;
    onCompileErrorRef.current = onCompileError;
    onExitRef.current = onExit;
  }, [onClose, onCompileError, onExit]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      // A classic terminal typeface (not the app's modern code-editor
      // font) to match the Turbo C/DOS console feel of this screen.
      fontFamily: '"Courier New", Consolas, "Lucida Console", monospace',
      fontSize: 16,
      lineHeight: 1.3,
      letterSpacing: 1,
      cols: 80,
      rows: 24,
      theme: { background: "#000000", foreground: "#f0f0f0", cursor: "#f0f0f0" },
      convertEol: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    // fit() needs the container to already have a real, laid-out size --
    // calling it synchronously right after open() (especially under React
    // Strict Mode's mount/cleanup/remount-in-dev cycle) can run before the
    // browser has painted this newly-inserted subtree, measuring 0 and
    // leaving the terminal effectively invisible even though writes to it
    // "succeed". Two rAFs reliably land after that first layout/paint.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => fitAddon.fit());
    });
    term.writeln("Connecting...");

    const setStatus = (text: string) => {
      if (statusRef.current) statusRef.current.textContent = text;
    };
    setStatus("Connecting...");

    const ws = new WebSocket(wsUrlFor("/api/compiler/run-ws"));
    // WebSocket.binaryType defaults to "blob", not "arraybuffer" -- without
    // this, every binary frame (all PTY output) arrives as a Blob and the
    // `instanceof ArrayBuffer` check below silently never matches, so
    // nothing ever gets written to the terminal.
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      ws.send(JSON.stringify({ source_code: sourceCode, c_standard: cStandard, filename }));
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        const data = JSON.parse(event.data);
        if (data.type === "started") {
          phaseRef.current = "running";
          term.clear();
          fitAddon.fit();
          setStatus("Running -- output below is live.");
        } else if (data.type === "compile_error") {
          setStatus("Compilation error.");
          onCompileErrorRef.current(data.errors, data.warnings, data.compiler_output);
          onCloseRef.current();
        } else if (data.type === "exit") {
          phaseRef.current = "exited";
          const code = data.exit_code;
          const summary =
            code === 0
              ? "Program finished successfully."
              : code === null
                ? "Program was terminated (timeout, signal, or resource limit)."
                : code < 0
                  ? `Program was killed by signal ${-code}.`
                  : `Program exited with code ${code}.`;
          term.write(`\r\n\x1b[90m--- ${summary} ---\r\nPress any key to continue...\x1b[0m`);
          setStatus(`${summary} Press any key to return to the editor.`);
          onExitRef.current?.(code);
        } else if (data.type === "error") {
          setStatus(data.message);
          term.write(`\r\n\x1b[31m${data.message}\x1b[0m\r\n`);
          phaseRef.current = "exited";
        }
      } else if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data));
      }
    };

    ws.onerror = () => setStatus("Connection error.");

    const dataDisposable = term.onData((data) => {
      if (phaseRef.current === "exited") {
        onCloseRef.current();
        return;
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(data));
      }
    });

    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    function handleWindowKeydown(e: KeyboardEvent) {
      if (phaseRef.current === "exited") {
        e.preventDefault();
        onCloseRef.current();
      }
    }
    window.addEventListener("keydown", handleWindowKeydown);

    function handleWindowResize() {
      fitAddon.fit();
    }
    window.addEventListener("resize", handleWindowResize);

    term.focus();

    return () => {
      window.removeEventListener("keydown", handleWindowKeydown);
      window.removeEventListener("resize", handleWindowResize);
      dataDisposable.dispose();
      resizeDisposable.dispose();
      ws.close();
      term.dispose();
    };
    // Intentionally runs once per mount -- this overlay is always remounted
    // fresh for a new Run (see the `key` prop where it's rendered).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex h-6 shrink-0 items-center justify-between bg-[#c0c0c0] px-2 text-xs text-black">
        <span>OUTPUT -- {filename}</span>
        <div ref={statusRef} className="text-black/70" />
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden p-2" />
    </div>
  );
}
