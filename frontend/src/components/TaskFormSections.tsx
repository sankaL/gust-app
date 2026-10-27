import { Trash2 } from 'lucide-react'

import { AddSubtaskInput } from './AddSubtaskInput'
import { Button } from './Button'

type SubtaskDraftsProps = {
  titles: string[]
  newTitle: string
  disabled: boolean
  onTitlesChange: (titles: string[]) => void
  onNewTitleChange: (title: string) => void
  onAdd: () => void
}

export function SubtaskDrafts({
  titles,
  newTitle,
  disabled,
  onTitlesChange,
  onNewTitleChange,
  onAdd,
}: SubtaskDraftsProps) {
  return (
    <section className="rounded-[1.1rem] bg-surface-dim/70 p-4 ring-1 ring-inset ring-outline/30">
      <p className="font-display text-lg font-bold text-on-surface">Subtasks</p>
      <p className="mt-1 font-body text-xs text-on-surface-variant">
        {titles.length} {titles.length === 1 ? 'subtask' : 'subtasks'}
      </p>
      <AddSubtaskInput value={newTitle} disabled={disabled} onChange={onNewTitleChange} onAdd={onAdd} />
      <div className="mt-3 space-y-1">
        {titles.length === 0 ? (
          <EmptySubtasks />
        ) : (
          titles.map((title, index) => (
            <SubtaskDraftRow
              key={index}
              title={title}
              index={index}
              disabled={disabled}
              onChange={(nextTitle) =>
                onTitlesChange(titles.map((current, candidate) => (candidate === index ? nextTitle : current)))
              }
              onDelete={() => onTitlesChange(titles.filter((_current, candidate) => candidate !== index))}
            />
          ))
        )}
      </div>
    </section>
  )
}

function EmptySubtasks() {
  return <p className="px-0 py-2 text-sm text-on-surface-variant">No subtasks yet.</p>
}

function SubtaskDraftRow({
  title,
  index,
  disabled,
  onChange,
  onDelete,
}: {
  title: string
  index: number
  disabled: boolean
  onChange: (title: string) => void
  onDelete: () => void
}) {
  const label = title || `subtask ${index + 1}`
  return (
    <div className="flex items-center gap-3 py-1">
      <input
        value={title}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 border-b border-outline/70 bg-transparent px-0 py-2.5 text-sm text-on-surface outline-none transition-colors focus:border-primary"
        aria-label={`Subtask ${label}`}
        disabled={disabled}
      />
      <button
        type="button"
        onClick={onDelete}
        disabled={disabled}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition hover:bg-chip-rose hover:text-chip-rose-ink disabled:opacity-50"
        aria-label={`Delete ${label}`}
      >
        <Trash2 className="h-4 w-4" strokeWidth={2} />
      </button>
    </div>
  )
}

export function TaskFormActions({
  isSaving,
  isCreateMode,
  onCancel,
  onSave,
}: {
  isSaving: boolean
  isCreateMode: boolean
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <div className="grid grid-cols-2 gap-3 pt-4">
      <Button variant="secondary" size="lg" onClick={onCancel} disabled={isSaving}>Cancel</Button>
      <Button variant="primary" size="lg" onClick={onSave} disabled={isSaving}>
        {isSaving ? 'Saving...' : isCreateMode ? 'Add Task' : 'Save Changes'}
      </Button>
    </div>
  )
}
