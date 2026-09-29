export interface MenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  separatorBefore?: boolean;
}

export interface Menu {
  label: string;
  items: MenuItem[];
}

export type RunStatus = "idle" | "compiling" | "running" | "done" | "error";
