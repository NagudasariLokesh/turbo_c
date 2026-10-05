import { Menu } from "@/types/ide";

export const MENUS: Menu[] = [
  {
    label: "File",
    items: [
      { label: "New", shortcut: "" },
      { label: "Open", shortcut: "F3" },
      { label: "Save", shortcut: "F2" },
      { label: "Save As" },
      { label: "Recent Files" },
      { label: "Close", separatorBefore: true },
    ],
  },
  {
    label: "Edit",
    items: [
      { label: "Undo", shortcut: "Ctrl+Z" },
      { label: "Redo", shortcut: "Ctrl+Y" },
      { label: "Cut", shortcut: "Ctrl+X", separatorBefore: true },
      { label: "Copy", shortcut: "Ctrl+C" },
      { label: "Paste", shortcut: "Ctrl+V" },
      { label: "Select All", separatorBefore: true },
      { label: "Delete" },
    ],
  },
  {
    label: "Search",
    items: [
      { label: "Find", shortcut: "Ctrl+F" },
      { label: "Replace", shortcut: "Ctrl+H" },
      { label: "Find Next" },
      { label: "Go To Line", shortcut: "Ctrl+G" },
    ],
  },
  {
    label: "Run",
    items: [
      { label: "Run", shortcut: "Ctrl+F9" },
      { label: "Run With Input" },
      { label: "Stop", separatorBefore: true },
    ],
  },
  {
    label: "Compile",
    items: [
      { label: "Compile", shortcut: "Alt+F9" },
      { label: "Build" },
      { label: "Check Syntax" },
    ],
  },
  {
    label: "Debug",
    items: [
      { label: "Start Debugging" },
      { label: "Continue" },
      { label: "Step Over" },
      { label: "Step Into" },
      { label: "Stop Debugging" },
    ],
  },
  {
    label: "Project",
    items: [
      { label: "New Project", disabled: true },
      { label: "Open Project", disabled: true },
      { label: "Project Settings", disabled: true },
    ],
  },
  {
    label: "Options",
    items: [
      { label: "Editor Settings" },
      { label: "Font Size" },
      { label: "Theme" },
      { label: "C Standard" },
      { label: "Execution Settings" },
    ],
  },
  {
    label: "Help",
    items: [
      { label: "C Help" },
      { label: "Keyboard Shortcuts" },
      { label: "About" },
      { label: "Documentation" },
    ],
  },
];
