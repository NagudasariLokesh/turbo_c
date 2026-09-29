"use client";

import { RunStatus } from "@/types/ide";

interface StatusBarProps {
  status: RunStatus;
  filename: string;
  line: number;
  column: number;
  cStandard: string;
}

const STATUS_TEXT: Record<RunStatus, string> = {
  idle: "Ready",
  compiling: "Compiling...",
  running: "Running...",
  done: "Program finished successfully.",
  error: "Compilation error.",
};

export default function StatusBar({
  status,
  filename,
  line,
  column,
  cStandard,
}: StatusBarProps) {
  return (
    <div className="flex h-6 shrink-0 items-center justify-between bg-[#c0c0c0] px-2 text-xs text-black">
      <span>
        {STATUS_TEXT[status]} — {filename}
      </span>
      <div className="flex gap-4">
        <span>
          Line {line}, Column {column}
        </span>
        <span>Spaces: 4</span>
        <span>{cStandard}</span>
      </div>
    </div>
  );
}
