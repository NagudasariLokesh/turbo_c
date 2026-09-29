// Saves/opens files on the user's own machine via the File System Access
// API (Chrome/Edge/Opera -- lets the user pick a real location, and
// remembers the handle so a plain "Save" doesn't re-prompt). Firefox/Safari
// don't implement that API yet, so they fall back to a classic
// <input type=file> picker for Open and a blob <a download> for Save --
// the latter always lands in the browser's default Downloads folder since
// there is no cross-browser way to ask those browsers for a location.

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}

const C_FILE_TYPES: FilePickerAcceptType[] = [
  { description: "C source file", accept: { "text/x-c": [".c"] } },
];

export interface OpenedFile {
  handle: FileSystemFileHandle | null;
  filename: string;
  content: string;
}

export async function pickAndOpenFile(): Promise<OpenedFile | null> {
  if (isFileSystemAccessSupported()) {
    let handle: FileSystemFileHandle;
    try {
      [handle] = await window.showOpenFilePicker({ types: C_FILE_TYPES });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return null;
      throw err;
    }
    const file = await handle.getFile();
    return { handle, filename: file.name, content: await file.text() };
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".c";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then((content) => resolve({ handle: null, filename: file.name, content }));
    };
    // If the user cancels, no change event fires -- resolve(null) never
    // happens in that case, which just leaves the caller's promise
    // pending. Acceptable here since "Open" has no other in-flight state
    // waiting on it, but worth knowing if this helper is reused elsewhere.
    input.click();
  });
}

export async function saveToHandle(handle: FileSystemFileHandle, content: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

export interface SavedFile {
  handle: FileSystemFileHandle | null;
  filename: string;
}

export async function pickAndSaveFile(
  suggestedName: string,
  content: string
): Promise<SavedFile | null> {
  if (isFileSystemAccessSupported()) {
    let handle: FileSystemFileHandle;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName,
        types: C_FILE_TYPES,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return null;
      throw err;
    }
    await saveToHandle(handle, content);
    return { handle, filename: handle.name };
  }

  const blob = new Blob([content], { type: "text/x-c" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
  return { handle: null, filename: suggestedName };
}
