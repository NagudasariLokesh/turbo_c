"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { CompileDiagnostic, CStandard, wsUrlFor } from "@/lib/api";

interface Variable {
  name: string;
  type: string;
  value: string;
}

export interface DebugScreenHandle {
  continue: () => void;
  stepOver: () => void;
  stepInto: () => void;
  stop: () => void;
}

type Phase = "connecting" | "running" | "stopped" | "exited";

interface DebugScreenProps {
  sourceCode: string;
  cStandard: CStandard;
  filename: string;
  breakpoints: number[];
  onClose: () => void;
  onCompileError: (
    errors: CompileDiagnostic[],
    warnings: CompileDiagnostic[],
    compilerOutput: string,
    filename: string
  ) => void;
  onStopped: (line: number | null) => void;
  onPhaseChange: (phase: Phase) => void;
  onExit?: (exitCode: number | null) => void;
}

const DebugScreen = forwardRef<DebugScreenHandle, DebugScreenProps>(function DebugScreen(
  { sourceCode, cStandard, filename, breakpoints, onClose, onCompileError, onStopped, onPhaseChange, onExit },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // Mirrors TerminalScreen's pattern: the socket-owning effect below reads
  // *current* phase via a ref (not state) so its closures stay correct
  // without re-running on every phase change.
  const phaseRef = useRef<Phase>("connecting");
  const [variables, setVariables] = useState<Variable[]>([]);
  const [phase, setPhase] = useState<Phase>("connecting");

  const onCloseRef = useRef(onClose);
  const onCompileErrorRef = useRef(onCompileError);
  const onStoppedRef = useRef(onStopped);
  const onExitRef = useRef(onExit);

  useEffect(() => {
    onCloseRef.current = onClose;
    onCompileErrorRef.current = onCompileError;
    onStoppedRef.current = onStopped;
    onExitRef.current = onExit;
  }, [onClose, onCompileError, onStopped, onExit]);

  useEffect(() => {
    onPhaseChange(phase);
  }, [phase, onPhaseChange]);

  const setPhaseBoth = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  useImperativeHandle(ref, () => ({
    continue: () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "continue" }));
        setPhaseBoth("running");
      }
    },
    stepOver: () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "step_over" }));
        setPhaseBoth("running");
      }
    },
    stepInto: () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "step_into" }));
        setPhaseBoth("running");
      }
    },
    stop: () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "stop" }));
      }
    },
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
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
    requestAnimationFrame(() => {
      requestAnimationFrame(() => fitAddon.fit());
    });
    term.writeln("Connecting...");

    const setStatus = (text: string) => {
      if (statusRef.current) statusRef.current.textContent = text;
    };
    setStatus("Connecting...");

    const ws = new WebSocket(wsUrlFor("/api/compiler/debug-ws"));
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({ source_code: sourceCode, c_standard: cStandard, filename, breakpoints })
      );
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        const data = JSON.parse(event.data);
        if (data.type === "started") {
          setPhaseBoth("running");
          term.clear();
          fitAddon.fit();
          setStatus("Running -- output below is live.");
        } else if (data.type === "compile_error") {
          setStatus("Compilation error.");
          onCompileErrorRef.current(data.errors, data.warnings, data.compiler_output, filename);
          onCloseRef.current();
        } else if (data.type === "stopped") {
          setPhaseBoth("stopped");
          setVariables(data.variables ?? []);
          onStoppedRef.current(data.line ?? null);
          const where =
            data.reason === "signal-received"
              ? `crashed (${data.signal_name ?? "signal"}) at line ${data.line}`
              : `paused at line ${data.line}`;
          setStatus(`${where} -- Continue, Step Over, Step Into, or Stop Debugging.`);
        } else if (data.type === "exit") {
          setPhaseBoth("exited");
          onStoppedRef.current(null);
          const code = data.exit_code;
          const summary =
            code === 0
              ? "Program finished successfully."
              : code === null
                ? "Debugging stopped."
                : code < 0
                  ? `Program was killed by signal ${-code}.`
                  : `Program exited with code ${code}.`;
          term.write(`\r\n\x1b[90m--- ${summary} ---\r\nPress any key to continue...\x1b[0m`);
          setStatus(`${summary} Press any key to return to the editor.`);
          onExitRef.current?.(code);
        } else if (data.type === "error") {
          setStatus(data.message);
          term.write(`\r\n\x1b[31m${data.message}\x1b[0m\r\n`);
          setPhaseBoth("exited");
          onStoppedRef.current(null);
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
    // fresh for a new debug session (see the `key` prop where it's rendered).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopped = phase === "stopped";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex h-6 shrink-0 items-center justify-between bg-[#c0c0c0] px-2 text-xs text-black">
        <span>DEBUG -- {filename}</span>
        <div ref={statusRef} className="text-black/70" />
      </div>
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-black/40 bg-[#000088] px-2">
        {([
          ["Continue", "continue"],
          ["Step Over", "step_over"],
          ["Step Into", "step_into"],
        ] as const).map(([label, action]) => (
          <button
            key={action}
            disabled={!stopped}
            onClick={() => {
              const ws = wsRef.current;
              if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: action }));
                setPhaseBoth("running");
              }
            }}
            className="rounded-sm bg-[#c0c0c0] px-2 py-0.5 text-xs font-bold text-black hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => {
            const ws = wsRef.current;
            if (ws?.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "stop" }));
            }
          }}
          className="ml-auto rounded-sm bg-[#c0c0c0] px-2 py-0.5 text-xs font-bold text-black hover:bg-white"
        >
          Stop Debugging
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden p-2" />
        <div className="w-56 shrink-0 overflow-y-auto border-l border-black/40 bg-[#0000aa] p-2 text-xs text-white">
          <div className="mb-1 font-bold">Variables</div>
          {variables.length === 0 ? (
            <div className="text-white/50">
              {stopped ? "No local variables in scope." : "Pause at a breakpoint to inspect variables."}
            </div>
          ) : (
            <table className="w-full">
              <tbody>
                {variables.map((v) => (
                  <tr key={v.name}>
                    <td className="pr-2 align-top font-bold">{v.name}</td>
                    <td className="pr-2 align-top text-white/70">{v.type}</td>
                    <td className="break-all align-top">{v.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
});

export default DebugScreen;
