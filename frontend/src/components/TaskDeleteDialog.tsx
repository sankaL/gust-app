import { Trash2 } from 'lucide-react'

import { Button } from './Button'
import { BottomSheet } from './ui/BottomSheet'

type TaskDeleteDialogProps = {
  isOpen: boolean
  taskTitle: string
  isRecurring: boolean
  isDeleting: boolean
  followUpMessage?: string
  onDeleteOccurrence: () => void
  onDeleteSeries: () => void
  onClose: () => void
}

export function TaskDeleteDialog({
  isOpen,
  taskTitle,
  isRecurring,
  isDeleting,
  followUpMessage,
  onDeleteOccurrence,
  onDeleteSeries,
  onClose
}: TaskDeleteDialogProps) {
  return (
    <BottomSheet open={isOpen} onClose={() => { if (!isDeleting) onClose() }} dismissible={!isDeleting} size="auto" labelledBy="task-delete-dialog-title" bodyClassName="overflow-y-auto px-5 pb-5 pt-2">
      <div className="flex flex-col items-center text-center">
        <span className="animate-pop-in flex h-14 w-14 items-center justify-center rounded-full bg-chip-rose text-chip-rose-ink">
          <Trash2 className="h-6 w-6" strokeWidth={2.1} aria-hidden="true" />
        </span>
        <p id="task-delete-dialog-title" className="mt-4 font-display text-xl font-bold text-on-surface">{isRecurring ? 'Delete recurring task' : 'Delete task'}</p>
        <p className="mt-1.5 max-w-full truncate font-body text-sm font-semibold text-on-surface">{taskTitle}</p>
        <p className="mt-1.5 max-w-xs font-body text-sm leading-6 text-on-surface-variant">
          {isRecurring
            ? 'Choose whether to delete only this occurrence or this and future open occurrences.'
            : 'Are you sure you want to delete this task?'}
        </p>
        {followUpMessage ? (
          <p className="mt-2 font-body text-xs font-semibold uppercase tracking-[0.12em] text-on-surface-variant">{followUpMessage}</p>
        ) : null}
      </div>
      <div className="mt-6 flex flex-col gap-2.5">
        {isRecurring ? (
          <>
            <Button variant="secondary" size="lg" fullWidth onClick={onDeleteOccurrence} disabled={isDeleting}>Delete this occurrence</Button>
            <Button variant="danger" size="lg" fullWidth onClick={onDeleteSeries} disabled={isDeleting}>Delete this and future</Button>
          </>
        ) : (
          <Button variant="danger" size="lg" fullWidth onClick={onDeleteOccurrence} disabled={isDeleting}>Delete</Button>
        )}
        <Button variant="ghost" size="lg" fullWidth onClick={onClose} disabled={isDeleting}>Cancel</Button>
      </div>
    </BottomSheet>
  )
}
