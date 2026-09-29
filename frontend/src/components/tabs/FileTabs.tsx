"use client";

export interface TabInfo {
  id: string;
  filename: string;
  isDirty: boolean;
}

interface FileTabsProps {
  tabs: TabInfo[];
  activeTabId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

export default function FileTabs({ tabs, activeTabId, onSelect, onClose }: FileTabsProps) {
  return (
    <div className="flex h-7 shrink-0 items-stretch overflow-x-auto bg-[#000088]">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          className={`flex shrink-0 cursor-pointer items-center gap-2 border-r border-black/40 px-3 text-xs ${
            tab.id === activeTabId
              ? "bg-[#0000aa] text-white"
              : "bg-[#000066] text-[#c0c0c0] hover:bg-[#000088]"
          }`}
        >
          <span>
            {tab.filename}
            {tab.isDirty ? " •" : ""}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab.id);
            }}
            className="rounded-sm px-1 hover:bg-white/20"
            aria-label={`Close ${tab.filename}`}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
