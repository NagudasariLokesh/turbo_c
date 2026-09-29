"use client";

import Editor, { OnMount } from "@monaco-editor/react";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type * as Monaco from "monaco-editor";
import { CompileDiagnostic } from "@/lib/api";

export interface EditorPaneHandle {
  undo: () => void;
  redo: () => void;
  cut: () => void;
  copy: () => void;
  paste: () => void;
  selectAll: () => void;
  deleteSelection: () => void;
  find: () => void;
  replace: () => void;
  findNext: () => void;
  goToLine: () => void;
}

interface EditorPaneProps {
  activeTabId: string;
  initialContent: string;
  onChange: (tabId: string, value: string) => void;
  onCursorChange: (line: number, column: number) => void;
  errors: CompileDiagnostic[];
  warnings: CompileDiagnostic[];
}

const EditorPane = forwardRef<EditorPaneHandle, EditorPaneProps>(
  function EditorPane(
    { activeTabId, initialContent, onChange, onCursorChange, errors, warnings },
    ref
  ) {
    const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<typeof Monaco | null>(null);
    // onMount only fires once per EditorPane instance, but `path` swaps the
    // underlying model on every tab switch without remounting -- routing
    // through a ref (kept fresh below) instead of closing over the prop
    // directly keeps the mount-time listeners correct even if the callback
    // identity changes.
    const onCursorChangeRef = useRef(onCursorChange);
    onCursorChangeRef.current = onCursorChange;

    useImperativeHandle(ref, () => {
      const run = (actionId: string) => {
        editorRef.current?.getAction(actionId)?.run();
        editorRef.current?.focus();
      };
      // undo/redo are core commands, not registered Actions, so they are
      // dispatched via trigger() rather than getAction().
      const trigger = (handlerId: string) => {
        editorRef.current?.trigger("menu", handlerId, null);
        editorRef.current?.focus();
      };

      return {
        undo: () => trigger("undo"),
        redo: () => trigger("redo"),
        cut: () => run("editor.action.clipboardCutAction"),
        copy: () => run("editor.action.clipboardCopyAction"),
        paste: () => run("editor.action.clipboardPasteAction"),
        selectAll: () => {
          const editorInstance = editorRef.current;
          const model = editorInstance?.getModel();
          if (editorInstance && model) {
            editorInstance.setSelection(model.getFullModelRange());
          }
          editorInstance?.focus();
        },
        deleteSelection: () => {
          const editorInstance = editorRef.current;
          const selection = editorInstance?.getSelection();
          if (editorInstance && selection && !selection.isEmpty()) {
            editorInstance.executeEdits("menu", [
              { range: selection, text: "" },
            ]);
          }
          editorInstance?.focus();
        },
        find: () => run("actions.find"),
        replace: () => run("editor.action.startFindReplaceAction"),
        findNext: () => run("editor.action.nextMatchFindAction"),
        goToLine: () => run("editor.action.gotoLine"),
      };
    });

    const handleMount: OnMount = (editorInstance, monaco) => {
      editorRef.current = editorInstance;
      monacoRef.current = monaco;

      editorInstance.onDidChangeCursorPosition((e) => {
        onCursorChangeRef.current(e.position.lineNumber, e.position.column);
      });
      // Switching tabs swaps the model (via the `path` prop) rather than
      // firing a normal cursor-move event, so without this the status bar's
      // Line/Column would keep showing the previous tab's position until
      // the user next clicks or types in the newly-active editor.
      editorInstance.onDidChangeModel(() => {
        const position = editorInstance.getPosition();
        onCursorChangeRef.current(position?.lineNumber ?? 1, position?.column ?? 1);
      });
    };

    useEffect(() => {
      const monaco = monacoRef.current;
      const editorInstance = editorRef.current;
      if (!monaco || !editorInstance) return;
      const model = editorInstance.getModel();
      if (!model) return;

      const toMarker = (
        d: CompileDiagnostic,
        severity: Monaco.MarkerSeverity
      ): Monaco.editor.IMarkerData => ({
        severity,
        startLineNumber: d.line || 1,
        startColumn: d.column || 1,
        endLineNumber: d.line || 1,
        endColumn: (d.column || 1) + 1,
        message: d.message,
      });

      monaco.editor.setModelMarkers(model, "compiler", [
        ...errors.map((d) => toMarker(d, monaco.MarkerSeverity.Error)),
        ...warnings.map((d) => toMarker(d, monaco.MarkerSeverity.Warning)),
      ]);
    }, [errors, warnings]);

    return (
      <div className="flex flex-1 overflow-hidden bg-[#0000aa]">
        <Editor
          // The `path` prop makes @monaco-editor/react keep one model per
          // tab (with its own undo history), swapping models on change
          // instead of overwriting one shared model's content.
          path={activeTabId}
          defaultValue={initialContent}
          // Monaco ships no dedicated C grammar; the C++ tokenizer covers C
          // syntax correctly and is the standard substitute for C highlighting.
          language="cpp"
          theme="turboC"
          onChange={(v) => onChange(activeTabId, v ?? "")}
          onMount={handleMount}
          beforeMount={(monaco) => {
            monaco.editor.defineTheme("turboC", {
              base: "vs-dark",
              inherit: true,
              rules: [
                { token: "comment", foreground: "6a9955" },
                { token: "keyword", foreground: "ffff55", fontStyle: "bold" },
                { token: "string", foreground: "d4d4d4" },
                { token: "number", foreground: "b5cea8" },
              ],
              colors: {
                "editor.background": "#0000aa",
                "editor.foreground": "#f0f0f0",
                "editorLineNumber.foreground": "#c0c0c0aa",
                "editorLineNumber.activeForeground": "#ffffff",
                "editor.lineHighlightBackground": "#0000cc",
                "editorCursor.foreground": "#ffffff",
                "editor.selectionBackground": "#5555ff88",
              },
            });
          }}
          options={{
            fontFamily:
              "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 15,
            minimap: { enabled: false },
            automaticLayout: true,
            tabSize: 4,
            insertSpaces: true,
            matchBrackets: "always",
            autoClosingBrackets: "always",
            autoIndent: "full",
            scrollBeyondLastLine: false,
            renderLineHighlight: "all",
            wordWrap: "off",
          }}
        />
      </div>
    );
  }
);

export default EditorPane;
