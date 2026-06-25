import { AlertTriangle } from 'lucide-react'

type TaskRestoreDialogProps = {
  isOpen: boolean
  taskTitle: string
  isRestoring: boolean
  onRestore: () => void
  onClose: () => void
}

export function TaskRestoreDialog({
  isOpen,
  taskTitle,
  isRestoring,
  onRestore,
  onClose,
}: TaskRestoreDialogProps) {
  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-restore-dialog-title"
        className="w-full max-w-md rounded-card bg-surface-container p-4 shadow-ambient"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
            <AlertTriangle className="h-4 w-4" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <p id="task-restore-dialog-title" className="font-display text-xl text-on-surface">
              Restore task
            </p>
            <p className="mt-2 truncate font-body text-sm text-on-surface">{taskTitle}</p>
            <p className="mt-2 font-body text-sm leading-6 text-on-surface-variant">
              This moves the task back to To-do and removes it from completed history.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={onRestore}
            disabled={isRestoring}
            className="w-full rounded-pill bg-primary px-4 py-2 text-sm font-medium text-surface transition hover:bg-primary/90 disabled:opacity-50"
          >
            Restore to To-do
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isRestoring}
            className="w-full rounded-pill bg-transparent px-4 py-2 text-sm font-medium text-on-surface-variant transition hover:bg-surface-container-high disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
