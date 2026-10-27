import { RotateCcw } from 'lucide-react'

import { Button } from './Button'
import { BottomSheet } from './ui/BottomSheet'

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
  return (
    <BottomSheet open={isOpen} onClose={() => { if (!isRestoring) onClose() }} dismissible={!isRestoring} size="auto" labelledBy="task-restore-dialog-title" bodyClassName="overflow-y-auto px-5 pb-5 pt-2">
      <div className="flex flex-col items-center text-center">
        <span className="animate-pop-in flex h-14 w-14 items-center justify-center rounded-full bg-chip-amber text-chip-amber-ink">
          <RotateCcw className="h-6 w-6" strokeWidth={2.1} aria-hidden="true" />
        </span>
        <p id="task-restore-dialog-title" className="mt-4 font-display text-xl font-bold text-on-surface">Restore task</p>
        <p className="mt-1.5 max-w-full truncate font-body text-sm font-semibold text-on-surface">{taskTitle}</p>
        <p className="mt-1.5 max-w-xs font-body text-sm leading-6 text-on-surface-variant">
          This moves the task back to To-do and removes it from completed history.
        </p>
      </div>
      <div className="mt-6 flex flex-col gap-2.5">
        <Button variant="primary" size="lg" fullWidth onClick={onRestore} disabled={isRestoring}>Restore to To-do</Button>
        <Button variant="ghost" size="lg" fullWidth onClick={onClose} disabled={isRestoring}>Cancel</Button>
      </div>
    </BottomSheet>
  )
}
