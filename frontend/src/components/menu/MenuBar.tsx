"use client";

import { useEffect, useRef, useState } from "react";
import { MENUS } from "./menuData";

interface MenuBarProps {
  onAction: (menuLabel: string, itemLabel: string) => void;
}

export default function MenuBar({ onAction }: MenuBarProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenIndex(null);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenIndex(null);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div
      ref={barRef}
      className="relative flex h-7 shrink-0 select-none items-stretch bg-[#c0c0c0] text-sm text-black"
    >
      {MENUS.map((menu, i) => (
        <div key={menu.label} className="relative">
          <button
            className={`h-full px-3 outline-none ${
              openIndex === i
                ? "bg-[#0000aa] text-white"
                : "hover:bg-[#0000aa] hover:text-white"
            }`}
            onClick={() => setOpenIndex(openIndex === i ? null : i)}
            onMouseEnter={() => {
              if (openIndex !== null) setOpenIndex(i);
            }}
          >
            {menu.label}
          </button>

          {openIndex === i && (
            <div className="absolute left-0 top-full z-50 min-w-[190px] border border-black bg-[#c0c0c0] py-1 shadow-[3px_3px_0_rgba(0,0,0,0.6)]">
              {menu.items.map((item) => (
                <div key={item.label}>
                  {item.separatorBefore && (
                    <div className="my-1 h-px bg-black/30" />
                  )}
                  <button
                    disabled={item.disabled}
                    onClick={() => {
                      setOpenIndex(null);
                      onAction(menu.label, item.label);
                    }}
                    className={`flex w-full items-center justify-between px-3 py-0.5 text-left ${
                      item.disabled
                        ? "cursor-not-allowed text-black/40"
                        : "hover:bg-[#0000aa] hover:text-white"
                    }`}
                  >
                    <span>{item.label}</span>
                    {item.shortcut && (
                      <span className="ml-6 text-xs opacity-80">
                        {item.shortcut}
                      </span>
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
