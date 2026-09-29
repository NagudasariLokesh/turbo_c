"use client";

interface OutputPanelProps {
  lines: string[];
  onClear: () => void;
}

export default function OutputPanel({ lines, onClear }: OutputPanelProps) {
  return (
    <div className="flex h-44 shrink-0 flex-col border-t-2 border-[#c0c0c0] bg-black">
      <div className="flex h-6 shrink-0 items-center justify-between bg-[#c0c0c0] px-2 text-xs font-bold text-black">
        <span>OUTPUT</span>
        <button
          onClick={onClear}
          className="rounded-sm px-2 text-[11px] font-normal hover:bg-[#0000aa] hover:text-white"
        >
          Clear
        </button>
      </div>
      <div className="flex-1 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-sm text-[#f0f0f0]">
        {lines.join("\n")}
      </div>
    </div>
  );
}
