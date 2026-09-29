"use client";

interface UnsavedChangesDialogProps {
  filename: string;
  onSave: () => void;
  onDontSave: () => void;
  onCancel: () => void;
}

export default function UnsavedChangesDialog({
  filename,
  onSave,
  onDontSave,
  onCancel,
}: UnsavedChangesDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-80 border-2 border-black bg-[#c0c0c0] p-4 text-sm text-black shadow-[4px_4px_0_rgba(0,0,0,0.6)]">
        <div className="mb-3 font-bold">Unsaved Changes</div>
        <p className="mb-4">{filename} has unsaved changes.</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onSave}
            className="border border-black bg-white px-3 py-1 hover:bg-[#0000aa] hover:text-white"
          >
            Save
          </button>
          <button
            onClick={onDontSave}
            className="border border-black bg-white px-3 py-1 hover:bg-[#0000aa] hover:text-white"
          >
            Don&apos;t Save
          </button>
          <button
            onClick={onCancel}
            className="border border-black bg-white px-3 py-1 hover:bg-[#0000aa] hover:text-white"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
