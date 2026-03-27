type TaskDeleteDialogProps = {
  isOpen: boolean
  taskTitle: string
  isRecurring: boolean
  isDeleting: boolean
  onDeleteOccurrence: () => void
  onDeleteSeries: () => void
  onClose: () => void
}

export function TaskDeleteDialog({
  isOpen,
  taskTitle,
  isRecurring,
  isDeleting,
  onDeleteOccurrence,
  onDeleteSeries,
  onClose
}: TaskDeleteDialogProps) {
  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-card bg-surface-container p-4 shadow-ambient">
        {isRecurring ? (
          <>
            <p className="font-display text-xl text-on-surface">Delete recurring task</p>
            <p className="mt-2 font-body text-sm text-on-surface-variant">
              Choose whether to delete only this occurrence or this and future open occurrences.
            </p>
            <p className="mt-2 truncate font-body text-sm text-on-surface">{taskTitle}</p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={onDeleteOccurrence}
                disabled={isDeleting}
                className="w-full rounded-pill bg-surface-container-high px-4 py-2 text-sm font-medium text-on-surface transition hover:bg-surface-container-highest disabled:opacity-50"
              >
                Delete this occurrence
              </button>
              <button
                type="button"
                onClick={onDeleteSeries}
                disabled={isDeleting}
                className="w-full rounded-pill bg-tertiary px-4 py-2 text-sm font-medium text-surface transition hover:bg-tertiary/85 disabled:opacity-50"
              >
                Delete this and future
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={isDeleting}
                className="w-full rounded-pill bg-transparent px-4 py-2 text-sm font-medium text-on-surface-variant transition hover:bg-surface-container-high disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="font-display text-xl text-on-surface">Delete task</p>
            <p className="mt-2 truncate font-body text-sm text-on-surface">{taskTitle}</p>
            <p className="mt-2 font-body text-sm text-on-surface-variant">
              Are you sure you want to delete this task?
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={onDeleteOccurrence}
                disabled={isDeleting}
                className="w-full rounded-pill bg-tertiary px-4 py-2 text-sm font-medium text-surface transition hover:bg-tertiary/85 disabled:opacity-50"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={isDeleting}
                className="w-full rounded-pill bg-transparent px-4 py-2 text-sm font-medium text-on-surface-variant transition hover:bg-surface-container-high disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
