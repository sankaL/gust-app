import { Trash2 } from 'lucide-react'

import { AddSubtaskInput } from './AddSubtaskInput'

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
    <section className="rounded-card bg-surface-container/75 p-4">
      <p className="font-display text-lg text-on-surface">Subtasks</p>
      <p className="mt-1 font-body text-xs text-on-surface-variant">
        {titles.length} {titles.length === 1 ? 'subtask' : 'subtasks'}
      </p>
      <AddSubtaskInput value={newTitle} disabled={disabled} onChange={onNewTitleChange} onAdd={onAdd} />
      <div className="mt-3 space-y-1">
        {titles.length === 0 ? <EmptySubtasks /> : titles.map((title, index) => ({ title, index })).reverse().map(({ title, index }) => (
          <SubtaskDraftRow
            key={`${title}-${index}`}
            title={title}
            index={index}
            disabled={disabled}
            onChange={(nextTitle) => onTitlesChange(titles.map((current, candidate) => candidate === index ? nextTitle : current))}
            onDelete={() => onTitlesChange(titles.filter((_current, candidate) => candidate !== index))}
          />
        ))}
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
        className="min-w-0 flex-1 border-b border-white/10 bg-transparent px-0 py-2.5 text-sm text-on-surface outline-none transition-colors focus:border-primary"
        aria-label={`Subtask ${label}`}
        disabled={disabled}
      />
      <button
        type="button"
        onClick={onDelete}
        disabled={disabled}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition hover:bg-tertiary/10 hover:text-tertiary disabled:opacity-50"
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
      <button type="button" onClick={onCancel} disabled={isSaving} className="w-full rounded-pill border border-white/10 bg-white/5 px-4 py-3 text-center text-sm font-medium text-on-surface transition-colors hover:bg-white/10 disabled:opacity-50 disabled:hover:bg-white/5">Cancel</button>
      <button type="button" onClick={onSave} disabled={isSaving} className="w-full rounded-pill bg-[radial-gradient(circle_at_top,_#c4b5fd_10%,_#7c3aed_90%)] px-4 py-3 text-center text-sm font-semibold text-white shadow-[0_8px_0_#4c1d95,_0_16px_22px_rgba(0,0,0,0.35),_inset_0_2px_3px_rgba(255,255,255,0.38)] transition-all hover:-translate-y-[1px] active:translate-y-[4px] active:shadow-[0_0px_0_#4c1d95,_0_4px_10px_rgba(0,0,0,0.35),_inset_0_2px_4px_rgba(255,255,255,0.18)] disabled:opacity-50 disabled:shadow-none disabled:hover:translate-y-0 disabled:active:translate-y-0">
        {isSaving ? 'Saving...' : isCreateMode ? 'Add Task' : 'Save Changes'}
      </button>
    </div>
  )
}
