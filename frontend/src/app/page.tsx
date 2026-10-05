"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MenuBar from "@/components/menu/MenuBar";
import EditorPane, { EditorPaneHandle } from "@/components/editor/EditorPane";
import OutputPanel from "@/components/output/OutputPanel";
import StatusBar from "@/components/StatusBar";
import FileTabs from "@/components/tabs/FileTabs";
import UnsavedChangesDialog from "@/components/dialogs/UnsavedChangesDialog";
import TerminalScreen from "@/components/terminal/TerminalScreen";
import DebugScreen, { DebugScreenHandle } from "@/components/debug/DebugScreen";
import { MENUS } from "@/components/menu/menuData";
import { Menu, RunStatus } from "@/types/ide";
import { compileSource, CompileDiagnostic, CStandard } from "@/lib/api";
import { pickAndOpenFile, pickAndSaveFile, saveToHandle } from "@/lib/localFiles";

const DEFAULT_SOURCE = `#include <stdio.h>

int main()
{
    int a, b;

    printf("Enter two numbers: ");
    scanf("%d %d", &a, &b);

    printf("Sum = %d", a + b);

    return 0;
}
`;

const C_STANDARDS: CStandard[] = ["c90", "c99", "c11", "c17", "c23"];

interface Tab {
  id: string;
  fileHandle: FileSystemFileHandle | null;
  filename: string;
  content: string;
  savedContent: string;
}

interface RunSession {
  key: number;
  source: string;
  standard: CStandard;
  filename: string;
}

interface DebugSession {
  key: number;
  source: string;
  standard: CStandard;
  filename: string;
  breakpoints: number[];
}

type DebugPhase = "connecting" | "running" | "stopped" | "exited";

function makeTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: crypto.randomUUID(),
    fileHandle: null,
    filename: "main.c",
    content: "",
    savedContent: "",
    ...overrides,
  };
}

const NOT_YET_IMPLEMENTED: Record<string, string> = {
  Stop: "Close the black output screen (press any key) to stop the running program.",
  "Editor Settings": "Options are not implemented yet.",
  "Font Size": "Options are not implemented yet.",
  Theme: "Options are not implemented yet.",
  "C Standard": "Use the C Standard selector in the toolbar.",
  "Execution Settings": "Options are not implemented yet.",
  "C Help": "Help content is not implemented yet.",
  "Keyboard Shortcuts": "Help content is not implemented yet.",
  About: "Help content is not implemented yet.",
  Documentation: "Help content is not implemented yet.",
};

let runSessionCounter = 0;

export default function Home() {
  const [tabs, setTabs] = useState<Tab[]>([
    makeTab({ content: DEFAULT_SOURCE, savedContent: DEFAULT_SOURCE }),
  ]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const [line, setLine] = useState(1);
  const [column, setColumn] = useState(1);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [cStandard, setCStandard] = useState<CStandard>("c11");
  const [errors, setErrors] = useState<CompileDiagnostic[]>([]);
  const [warnings, setWarnings] = useState<CompileDiagnostic[]>([]);
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null);
  const [runSession, setRunSession] = useState<RunSession | null>(null);
  const [breakpointsByTab, setBreakpointsByTab] = useState<Record<string, number[]>>({});
  const [debugSession, setDebugSession] = useState<DebugSession | null>(null);
  const [debugPhase, setDebugPhase] = useState<DebugPhase | null>(null);
  const [currentDebugLine, setCurrentDebugLine] = useState<number | null>(null);

  const editorRef = useRef<EditorPaneHandle>(null);
  const debugScreenRef = useRef<DebugScreenHandle>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  const updateTabContent = useCallback((tabId: string, value: string) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, content: value } : t)));
  }, []);

  const handleCompile = useCallback(async () => {
    setStatus("compiling");
    setOutputLines([`Compiling ${activeTab.filename} (${cStandard.toUpperCase()})...`]);
    try {
      const result = await compileSource(activeTab.content, cStandard, activeTab.filename);
      setErrors(result.errors);
      setWarnings(result.warnings);

      const lines: string[] = [];
      if (result.success) {
        lines.push("COMPILATION SUCCESSFUL", "", `${activeTab.filename} compiled successfully.`);
        setStatus("done");
      } else {
        lines.push("COMPILATION ERROR", "");
        setStatus("error");
      }
      if (result.compiler_output.trim()) {
        lines.push("", result.compiler_output.trim());
      }
      if (result.warnings.length > 0 && result.success) {
        lines.push("", `${result.warnings.length} warning(s).`);
      }
      setOutputLines(lines);
    } catch (err) {
      setStatus("error");
      setOutputLines([
        "SERVER ERROR",
        "",
        "Could not reach the compiler service.",
        err instanceof Error ? err.message : String(err),
      ]);
    }
  }, [activeTab.content, activeTab.filename, cStandard]);

  const handleRun = useCallback(() => {
    runSessionCounter += 1;
    setStatus("running");
    setErrors([]);
    setWarnings([]);
    setRunSession({
      key: runSessionCounter,
      source: activeTab.content,
      standard: cStandard,
      filename: activeTab.filename,
    });
  }, [activeTab.content, activeTab.filename, cStandard]);

  const handleToggleBreakpoint = useCallback(
    (line: number) => {
      setBreakpointsByTab((prev) => {
        const current = prev[activeTabId] ?? [];
        const next = current.includes(line)
          ? current.filter((l) => l !== line)
          : [...current, line].sort((a, b) => a - b);
        return { ...prev, [activeTabId]: next };
      });
    },
    [activeTabId]
  );

  const handleStartDebugging = useCallback(() => {
    runSessionCounter += 1;
    setStatus("running");
    setErrors([]);
    setWarnings([]);
    setCurrentDebugLine(null);
    setDebugSession({
      key: runSessionCounter,
      source: activeTab.content,
      standard: cStandard,
      filename: activeTab.filename,
      breakpoints: breakpointsByTab[activeTabId] ?? [],
    });
  }, [activeTab.content, activeTab.filename, activeTabId, breakpointsByTab, cStandard]);

  const handleDebugStopped = useCallback((line: number | null) => {
    setCurrentDebugLine(line);
  }, []);

  const handleDebugExit = useCallback((exitCode: number | null) => {
    setStatus(exitCode === 0 ? "done" : "error");
  }, []);

  const handleTerminalCompileError = useCallback(
    (errs: CompileDiagnostic[], warns: CompileDiagnostic[], compilerOutput: string) => {
      setErrors(errs);
      setWarnings(warns);
      setStatus("error");
      setOutputLines([
        "COMPILATION ERROR",
        "",
        "Program cannot run because it did not compile.",
        "",
        compilerOutput.trim(),
      ]);
    },
    []
  );

  const handleTerminalExit = useCallback((exitCode: number | null) => {
    setStatus(exitCode === 0 ? "done" : "error");
  }, []);

  const handleNew = useCallback(() => {
    let filename = window.prompt("New file name:", "untitled.c");
    if (!filename) return;
    if (!filename.endsWith(".c")) filename += ".c";
    const tab = makeTab({ filename });
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  const handleSaveAs = useCallback(
    async (tabId: string): Promise<boolean> => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return false;
      try {
        const result = await pickAndSaveFile(tab.filename, tab.content);
        if (!result) return false; // user cancelled the save dialog
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tabId
              ? { ...t, fileHandle: result.handle, filename: result.filename, savedContent: t.content }
              : t
          )
        );
        setOutputLines((prev) => [...prev, `Saved as ${result.filename}.`]);
        return true;
      } catch (err) {
        setOutputLines((prev) => [
          ...prev,
          `Could not save file: ${err instanceof Error ? err.message : String(err)}`,
        ]);
        return false;
      }
    },
    [tabs]
  );

  const handleSave = useCallback(
    async (tabId: string): Promise<boolean> => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return false;

      // No handle yet (new file, or a browser without File System Access
      // support) -- there's nowhere to write to silently, so this behaves
      // like Save As.
      if (!tab.fileHandle) {
        return handleSaveAs(tabId);
      }

      try {
        await saveToHandle(tab.fileHandle, tab.content);
        setTabs((prev) =>
          prev.map((t) => (t.id === tabId ? { ...t, savedContent: t.content } : t))
        );
        setOutputLines((prev) => [...prev, `Saved ${tab.filename}.`]);
        return true;
      } catch (err) {
        setOutputLines((prev) => [
          ...prev,
          `Could not save file: ${err instanceof Error ? err.message : String(err)}`,
        ]);
        return false;
      }
    },
    [tabs, handleSaveAs]
  );

  const closeTabImmediately = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === tabId);
        if (idx === -1) return prev;
        const next = prev.filter((t) => t.id !== tabId);
        if (next.length === 0) {
          next.push(makeTab());
        }
        if (activeTabId === tabId) {
          const fallback = next[Math.max(0, idx - 1)] ?? next[0];
          setActiveTabId(fallback.id);
        }
        return next;
      });
    },
    [activeTabId]
  );

  const handleCloseRequest = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return;
      if (tab.content !== tab.savedContent) {
        setPendingCloseTabId(tabId);
      } else {
        closeTabImmediately(tabId);
      }
    },
    [tabs, closeTabImmediately]
  );

  const handleOpen = useCallback(async () => {
    try {
      const opened = await pickAndOpenFile();
      if (!opened) return; // user cancelled the open dialog
      const tab = makeTab({
        fileHandle: opened.handle,
        filename: opened.filename,
        content: opened.content,
        savedContent: opened.content,
      });
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
    } catch (err) {
      setOutputLines((prev) => [
        ...prev,
        `Could not open file: ${err instanceof Error ? err.message : String(err)}`,
      ]);
    }
  }, []);

  const handleMenuAction = useCallback(
    (menuLabel: string, itemLabel: string) => {
      const editorHandle = editorRef.current;

      if (menuLabel === "File") {
        switch (itemLabel) {
          case "New":
            return handleNew();
          case "Open":
          case "Recent Files":
            return void handleOpen();
          case "Save":
            return void handleSave(activeTabId);
          case "Save As":
            return void handleSaveAs(activeTabId);
          case "Close":
            return handleCloseRequest(activeTabId);
        }
      }

      if (menuLabel === "Edit" && editorHandle) {
        switch (itemLabel) {
          case "Undo":
            return editorHandle.undo();
          case "Redo":
            return editorHandle.redo();
          case "Cut":
            return editorHandle.cut();
          case "Copy":
            return editorHandle.copy();
          case "Paste":
            return editorHandle.paste();
          case "Select All":
            return editorHandle.selectAll();
          case "Delete":
            return editorHandle.deleteSelection();
        }
      }

      if (menuLabel === "Search" && editorHandle) {
        switch (itemLabel) {
          case "Find":
            return editorHandle.find();
          case "Replace":
            return editorHandle.replace();
          case "Find Next":
            return editorHandle.findNext();
          case "Go To Line":
            return editorHandle.goToLine();
        }
      }

      if (menuLabel === "Compile") {
        // Build and Check Syntax reuse the same compile pipeline for now;
        // they diverge once linking/execution artifacts matter further.
        if (["Compile", "Build", "Check Syntax"].includes(itemLabel)) {
          void handleCompile();
          return;
        }
      }

      if (menuLabel === "Run" && (itemLabel === "Run" || itemLabel === "Run With Input")) {
        handleRun();
        return;
      }

      if (menuLabel === "Debug") {
        switch (itemLabel) {
          case "Start Debugging":
            return handleStartDebugging();
          case "Continue":
            return debugScreenRef.current?.continue();
          case "Step Over":
            return debugScreenRef.current?.stepOver();
          case "Step Into":
            return debugScreenRef.current?.stepInto();
          case "Stop Debugging":
            return debugScreenRef.current?.stop();
        }
      }

      const message = NOT_YET_IMPLEMENTED[itemLabel];
      setOutputLines((prev) => [...prev, message ?? `${itemLabel} is not implemented yet.`]);
    },
    [
      activeTabId,
      handleNew,
      handleOpen,
      handleSave,
      handleSaveAs,
      handleCloseRequest,
      handleCompile,
      handleRun,
      handleStartDebugging,
    ]
  );

  const menus: Menu[] = MENUS.map((menu) => {
    if (menu.label !== "Debug") return menu;
    return {
      ...menu,
      items: menu.items.map((item) => {
        if (item.label === "Start Debugging") {
          return { ...item, disabled: debugSession !== null };
        }
        if (item.label === "Stop Debugging") {
          return { ...item, disabled: debugSession === null };
        }
        // Continue / Step Over / Step Into
        return { ...item, disabled: debugPhase !== "stopped" };
      }),
    };
  });

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.altKey && e.key === "F9") {
        e.preventDefault();
        void handleCompile();
      } else if (e.ctrlKey && e.key === "F9") {
        e.preventDefault();
        handleRun();
      } else if (e.key === "F2" || (e.ctrlKey && e.key.toLowerCase() === "s")) {
        e.preventDefault();
        void handleSave(activeTabId);
      } else if (e.key === "F3") {
        e.preventDefault();
        void handleOpen();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleCompile, handleRun, handleSave, handleOpen, activeTabId]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0000aa]">
      <MenuBar onAction={handleMenuAction} menus={menus} />

      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-black/40 bg-[#000088] px-2">
        <button
          onClick={() => void handleCompile()}
          className="rounded-sm bg-[#c0c0c0] px-3 py-0.5 text-xs font-bold text-black hover:bg-white"
        >
          Compile (Alt+F9)
        </button>
        <button
          onClick={handleRun}
          className="rounded-sm bg-[#c0c0c0] px-3 py-0.5 text-xs font-bold text-black hover:bg-white"
        >
          Run (Ctrl+F9)
        </button>
        <div className="ml-auto flex items-center gap-1 text-xs text-white">
          <label htmlFor="c-standard">Standard:</label>
          <select
            id="c-standard"
            value={cStandard}
            onChange={(e) => setCStandard(e.target.value as CStandard)}
            className="rounded-sm bg-[#c0c0c0] px-1 py-0.5 text-black"
          >
            {C_STANDARDS.map((std) => (
              <option key={std} value={std}>
                {std.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
      </div>

      <FileTabs
        tabs={tabs.map((t) => ({
          id: t.id,
          filename: t.filename,
          isDirty: t.content !== t.savedContent,
        }))}
        activeTabId={activeTabId}
        onSelect={setActiveTabId}
        onClose={handleCloseRequest}
      />

      <EditorPane
        ref={editorRef}
        activeTabId={activeTab.id}
        initialContent={activeTab.content}
        onChange={updateTabContent}
        onCursorChange={(l, c) => {
          setLine(l);
          setColumn(c);
        }}
        errors={errors}
        warnings={warnings}
        breakpoints={breakpointsByTab[activeTabId] ?? []}
        onToggleBreakpoint={handleToggleBreakpoint}
        currentDebugLine={currentDebugLine}
      />

      <OutputPanel lines={outputLines} onClear={() => setOutputLines([])} />

      <StatusBar
        status={status}
        filename={activeTab.filename}
        line={line}
        column={column}
        cStandard={cStandard.toUpperCase()}
      />

      {runSession && (
        <TerminalScreen
          key={runSession.key}
          sourceCode={runSession.source}
          cStandard={runSession.standard}
          filename={runSession.filename}
          onCompileError={handleTerminalCompileError}
          onExit={handleTerminalExit}
          onClose={() => setRunSession(null)}
        />
      )}

      {debugSession && (
        <DebugScreen
          ref={debugScreenRef}
          key={debugSession.key}
          sourceCode={debugSession.source}
          cStandard={debugSession.standard}
          filename={debugSession.filename}
          breakpoints={debugSession.breakpoints}
          onCompileError={handleTerminalCompileError}
          onStopped={handleDebugStopped}
          onPhaseChange={setDebugPhase}
          onExit={handleDebugExit}
          onClose={() => {
            setDebugSession(null);
            setDebugPhase(null);
            setCurrentDebugLine(null);
          }}
        />
      )}

      {pendingCloseTabId && (
        <UnsavedChangesDialog
          filename={tabs.find((t) => t.id === pendingCloseTabId)?.filename ?? ""}
          onSave={async () => {
            const tabId = pendingCloseTabId;
            setPendingCloseTabId(null);
            const saved = await handleSave(tabId);
            if (saved) closeTabImmediately(tabId);
          }}
          onDontSave={() => {
            closeTabImmediately(pendingCloseTabId);
            setPendingCloseTabId(null);
          }}
          onCancel={() => setPendingCloseTabId(null)}
        />
      )}
    </div>
  );
}
