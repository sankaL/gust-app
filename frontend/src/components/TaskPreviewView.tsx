import { Bell, CalendarDays, CheckCircle2, ListTodo, PencilLine, Repeat2, RotateCcw, Save, TextQuote, Trash2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { GroupSummary, TaskDetail } from '../lib/api'
import type { TaskDetailDraft } from '../lib/taskFormModel'
import { formatDate, formatDateTime, formatRecurrence } from '../lib/taskFormatters'
import { TaskFormFields } from './TaskFormFields'
import { SaveConfirmationToast } from './SaveConfirmationToast'

type Props = {
  task?: TaskDetail
  draft: TaskDetailDraft | null
  groups: GroupSummary[]
  isLoading: boolean
  error: unknown
  isEditable: boolean
  isBusy: boolean
  isDirty?: boolean
  saveError: string | null
  saveNotice: string | null
  newSubtaskTitle: string
  onDraftChange: (updater: (draft: TaskDetailDraft) => TaskDetailDraft) => void
  onNewSubtaskTitleChange: (title: string) => void
  onDismissSaveNotice: () => void
  onClose: () => void
  onSave: () => void
  onCreateSubtask: () => void
  onToggleSubtask: (subtaskId: string, isCompleted: boolean) => void
  onDeleteSubtask: (id: string) => void
  onComplete?: () => void
  onRestore?: () => void
  onDelete?: () => void
  friendlyError: (error: unknown, fallback: string) => string
}

function MetadataTile({
  label,
  icon: Icon,
  value,
  onClick,
  onDoubleClick,
  onTouchStart,
  onTouchEnd,
}: {
  label: string
  icon: typeof CalendarDays
  value: string
  onClick?: () => void
  onDoubleClick?: () => void
  onTouchStart?: (e: React.TouchEvent) => void
  onTouchEnd?: (e: React.TouchEvent) => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="group min-w-0 cursor-pointer rounded-[1.2rem] bg-surface-container/55 p-3.5 text-left transition-[background-color,transform] hover:bg-surface-container-high/80 active:scale-[0.99]"
      title="Tap or double-click to edit"
    >
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-primary/75" strokeWidth={1.8} />
        <p className="text-[0.62rem] font-semibold uppercase tracking-[0.15em] text-on-surface-variant">
          {label}
        </p>
      </div>
      <p className="mt-2.5 truncate text-sm font-medium text-on-surface">{value}</p>
    </button>
  )
}

function PreviewHeader({
  task,
  draft,
  isEditable,
  isTitleEditing,
  isBusy,
  onStartTitleEdit,
  onTitleChange,
  onClose,
}: {
  task?: TaskDetail
  draft: TaskDetailDraft | null
  isEditable: boolean
  isTitleEditing: boolean
  isBusy: boolean
  onStartTitleEdit: () => void
  onTitleChange: (title: string) => void
  onClose: () => void
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 p-5 pb-3 pt-[max(1.25rem,calc(env(safe-area-inset-top)+0.75rem))] sm:p-6 sm:pb-4">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-pill bg-white/6 px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
            Task preview
          </span>
          {task ? (
            <>
              <span className="rounded-pill bg-surface-container-high px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                {task.status === 'completed' ? 'Completed' : 'Open'}
              </span>
              <span className="max-w-[12rem] truncate rounded-pill bg-surface-container-high px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                {task.group.name}
              </span>
              {task.needs_review ? (
                <span className="rounded-pill bg-warning/20 px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-warning">
                  Needs review
                </span>
              ) : null}
            </>
          ) : null}
        </div>
        {isEditable && isTitleEditing ? (
          <>
            <h2 id="task-preview-title" className="sr-only">{draft?.title || task?.title || 'Untitled task'}</h2>
            <input
              autoFocus
              value={draft?.title ?? task?.title ?? ''}
              onChange={(event) => onTitleChange(event.target.value)}
              className="w-full rounded-[1.25rem] bg-surface/60 px-4 py-3 font-display text-[1.5rem] leading-tight text-on-surface outline-none placeholder:text-on-surface-variant/40 focus:bg-surface/75 focus:text-white sm:text-[1.85rem]"
              style={{ fontSize: '16px' }}
              aria-label="Task title"
              placeholder="Task title"
              disabled={isBusy}
            />
          </>
        ) : (
          <h2 id="task-preview-title" className="pl-3.5 font-display text-2xl leading-tight text-on-surface sm:text-3xl">
            {isEditable ? (
              <button
                type="button"
                onClick={onStartTitleEdit}
                onDoubleClick={onStartTitleEdit}
                className="group flex w-full items-start gap-2 text-left outline-none"
                title="Tap or double-click to edit title"
              >
                <span className="text-balance">{draft?.title || task?.title || 'Loading task'}</span>
                <PencilLine className="mt-1 h-4 w-4 shrink-0 text-primary/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" strokeWidth={1.8} />
              </button>
            ) : (draft?.title || task?.title || 'Loading task')}
          </h2>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="clay-obsidian flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:text-on-surface"
        aria-label="Close task preview"
      >
        <X className="h-5 w-5" strokeWidth={2} />
      </button>
    </div>
  )
}

function EditableTask({
  draft,
  groups,
  disabled,
  onChange,
}: {
  draft: TaskDetailDraft
  groups: GroupSummary[]
  disabled: boolean
  onChange: Props['onDraftChange']
}) {
  const [isGroupDropdownOpen, setIsGroupDropdownOpen] = useState(false)
  return (
    <TaskFormFields
      {...draft}
      groups={groups}
      isGroupDropdownOpen={isGroupDropdownOpen}
      disabled={disabled}
      onTitleChange={(title) => onChange((current) => ({ ...current, title }))}
      onDescriptionChange={(description) => onChange((current) => ({ ...current, description }))}
      onGroupIdChange={(groupId) => onChange((current) => ({ ...current, groupId }))}
      onDueDateChange={(dueDate) => onChange((current) => ({ ...current, dueDate }))}
      onReminderAtChange={(reminderAt) => onChange((current) => ({ ...current, reminderAt }))}
      onReminderDateChange={(reminderDate) => onChange((current) => ({ ...current, reminderDate }))}
      onRecurrenceChange={(recurrence) => onChange((current) => ({ ...current, recurrence }))}
      onGroupDropdownOpenChange={setIsGroupDropdownOpen}
    />
  )
}

function ReadOnlyTask({
  task,
  draft,
  onStartEdit,
  onTouchStart,
  onTouchEnd,
}: {
  task: TaskDetail
  draft: TaskDetailDraft | null
  onStartEdit: () => void
  onTouchStart: (e: React.TouchEvent) => void
  onTouchEnd: (e: React.TouchEvent) => void
}) {
  const recurrence = formatRecurrence(draft?.recurrence ?? task.recurrence)
  const dueDate = formatDate(draft?.dueDate ?? task.due_date)
  const reminder = formatDateTime(draft?.reminderAt ?? task.reminder_at)
  const description = draft ? draft.description : task.description

  return (
    <>
      <button
        type="button"
        onClick={onStartEdit}
        onDoubleClick={onStartEdit}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="group w-full cursor-pointer rounded-[1.25rem] bg-surface-container/55 p-3.5 text-left transition-[background-color,transform] hover:bg-surface-container-high/80 active:scale-[0.99]"
        title="Tap or double-click to edit"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <TextQuote
              className="h-3.5 w-3.5 text-primary/80 transition-colors group-hover:text-primary"
              strokeWidth={1.8}
            />
            <p className="text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
              Context
            </p>
          </div>
          <span className="text-[0.62rem] text-primary/60 opacity-0 transition-opacity group-hover:opacity-100">
            Tap or double-click to edit
          </span>
        </div>
        <p className="mt-2 text-sm leading-6 text-on-surface-variant">
          {description || 'No description yet.'}
        </p>
      </button>

      <div className="grid gap-3 sm:grid-cols-2">
        <MetadataTile
          label="Due date"
          icon={CalendarDays}
          value={dueDate}
          onClick={onStartEdit}
          onDoubleClick={onStartEdit}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        />
        <MetadataTile
          label="Reminder"
          icon={Bell}
          value={reminder}
          onClick={onStartEdit}
          onDoubleClick={onStartEdit}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        />
        <MetadataTile
          label="Recurrence"
          icon={Repeat2}
          value={recurrence}
          onClick={onStartEdit}
          onDoubleClick={onStartEdit}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        />
        <MetadataTile
          label="Subtasks"
          icon={ListTodo}
          value={`${task.subtasks.length} subtasks`}
          onClick={onStartEdit}
          onDoubleClick={onStartEdit}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        />
      </div>
    </>
  )
}

function Checklist({
  task,
  editable,
  busy,
  title,
  onTitleChange,
  onCreate,
  onToggle,
  onDelete,
}: {
  task: TaskDetail
  editable: boolean
  busy: boolean
  title: string
  onTitleChange: (value: string) => void
  onCreate: () => void
  onToggle: (subtaskId: string, is_completed: boolean) => void
  onDelete: (id: string) => void
}) {
  return (
    <section className="rounded-[1.25rem] bg-surface-container/90 p-4 shadow-ambient">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-display text-lg text-on-surface">Checklist</p>
          <p className="mt-1 text-xs text-on-surface-variant">{task.subtasks.length} subtasks</p>
        </div>
        <span className="rounded-pill bg-surface-container-high px-3 py-1 text-[0.68rem] uppercase text-on-surface-variant">
          {task.subtasks.filter((item) => item.is_completed).length} done
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {task.subtasks.length ? (
          task.subtasks.map((subtask) => (
            <div key={subtask.id} className="flex items-center gap-3 rounded-card bg-surface-dim p-3">
              <button
                type="button"
                onClick={() => onToggle(subtask.id, !subtask.is_completed)}
                disabled={busy}
                aria-label={`Toggle ${subtask.title}`}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-all ${
                  subtask.is_completed
                    ? 'bg-primary text-surface shadow-[0_0_10px_rgba(196,181,253,0.35)]'
                    : 'border border-outline/40 bg-surface-container hover:border-primary/60'
                }`}
              >
                {subtask.is_completed ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
              </button>
              <p
                className={`min-w-0 flex-1 text-sm ${
                  subtask.is_completed ? 'text-on-surface-variant line-through' : 'text-on-surface'
                }`}
              >
                {subtask.title}
              </p>
              {editable ? (
                <button
                  type="button"
                  onClick={() => onDelete(subtask.id)}
                  disabled={busy}
                  aria-label={`Delete ${subtask.title}`}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-tertiary/15 hover:text-tertiary"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          ))
        ) : (
          <div className="rounded-card bg-surface-dim px-4 py-4 text-sm text-on-surface-variant">
            No subtasks yet.
          </div>
        )}
      </div>
      {editable ? (
        <div className="mt-3 flex gap-2">
          <input
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && title.trim() && !busy) onCreate()
            }}
            className="min-w-0 flex-1 rounded-card bg-surface-dim px-3 py-3 text-sm text-on-surface"
            placeholder="Add a subtask..."
            disabled={busy}
          />
          <button
            type="button"
            onClick={onCreate}
            disabled={!title.trim() || busy}
            className="rounded-pill bg-primary px-4 py-2 text-sm font-semibold text-surface disabled:opacity-50"
          >
            Add
          </button>
        </div>
      ) : null}
    </section>
  )
}

type PreviewBodyProps = {
  task?: TaskDetail
  draft: TaskDetailDraft | null
  groups: GroupSummary[]
  isLoading: boolean
  error: unknown
  isEditing: boolean
  isEditable: boolean
  isBusy: boolean
  saveError: string | null
  newSubtaskTitle: string
  onStartEdit: () => void
  onTouchStart: (e: React.TouchEvent) => void
  onTouchEnd: (e: React.TouchEvent) => void
  onDraftChange: Props['onDraftChange']
  onNewSubtaskTitleChange: (title: string) => void
  onCreateSubtask: () => void
  onToggleSubtask: (subtaskId: string, is_completed: boolean) => void
  onDeleteSubtask: (id: string) => void
  friendlyError: Props['friendlyError']
}

function PreviewBody(props: PreviewBodyProps) {
  if (props.isLoading)
    return <div className="h-40 animate-pulse rounded-card bg-surface-container-high" aria-busy="true" />
  if (props.error)
    return (
      <div className="rounded-card bg-[rgba(80,18,18,0.92)] p-4 text-sm text-red-100">
        {props.friendlyError(props.error, 'Task preview could not be loaded.')}
      </div>
    )
  if (!props.task) return null

  return (
    <div className="space-y-4">
      {props.isEditing && props.isEditable && props.draft ? (
        <EditableTask
          draft={props.draft}
          groups={props.groups}
          disabled={props.isBusy}
          onChange={props.onDraftChange}
        />
      ) : (
        <ReadOnlyTask
          task={props.task}
          draft={props.draft}
          onStartEdit={props.onStartEdit}
          onTouchStart={props.onTouchStart}
          onTouchEnd={props.onTouchEnd}
        />
      )}

      {props.saveError ? (
        <p className="rounded-xl bg-error/15 px-3 py-2 text-sm text-error">{props.saveError}</p>
      ) : null}

      <Checklist
        task={props.task}
        editable={props.isEditable}
        busy={props.isBusy}
        title={props.newSubtaskTitle}
        onTitleChange={props.onNewSubtaskTitleChange}
        onCreate={props.onCreateSubtask}
        onToggle={props.onToggleSubtask}
        onDelete={props.onDeleteSubtask}
      />

      {!props.isEditing && props.isEditable && (
        <p className="pt-1 text-center text-xs text-on-surface-variant/60">
          Tap or double-click any section to edit
        </p>
      )}
    </div>
  )
}

function PreviewFooter({
  task,
  isEditing,
  busy,
  isDirty,
  onSave,
  onComplete,
  onRestore,
  onDelete,
}: {
  task?: TaskDetail
  isEditing: boolean
  busy: boolean
  isDirty: boolean
  onSave: () => void
  onComplete?: () => void
  onRestore?: () => void
  onDelete?: () => void
}) {
  return (
    <div className="shrink-0 border-t border-white/10 bg-[rgba(20,20,20,0.86)] p-4 pb-[max(1rem,calc(env(safe-area-inset-bottom)+1rem))] sm:pb-4">
      <div className="flex items-center gap-3">
        {isEditing ? (
          <>
            <button
              type="button"
              onClick={onSave}
              disabled={busy || !isDirty}
              className="flex-1 rounded-pill bg-[radial-gradient(circle_at_top,_#c4b5fd_10%,_#7c3aed_90%)] px-4 py-3 text-center text-sm font-semibold text-white shadow-[0_8px_0_#4c1d95,_0_16px_22px_rgba(0,0,0,0.35),_inset_0_2px_3px_rgba(255,255,255,0.38)] transition-all hover:-translate-y-[1px] active:translate-y-[4px] disabled:cursor-not-allowed disabled:opacity-40 disabled:grayscale disabled:shadow-none"
              aria-label="Save changes"
            >
              <Save className="mr-2 inline h-4 w-4" />
              Save Changes
            </button>

            {task?.status === 'open' && onComplete ? (
              <button
                type="button"
                onClick={onComplete}
                disabled={busy}
                aria-label="Complete"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-success/20 text-success transition hover:bg-success/30 disabled:opacity-50"
              >
                <CheckCircle2 className="h-5 w-5" />
              </button>
            ) : null}

            {onDelete ? (
              <button
                type="button"
                onClick={onDelete}
                disabled={busy}
                aria-label="Delete task"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/5 text-tertiary transition hover:bg-tertiary/10 disabled:opacity-50"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            ) : null}
          </>
        ) : (
          <>
            {task?.status === 'open' && onComplete ? (
              <button
                type="button"
                onClick={onComplete}
                disabled={busy}
                aria-label="Complete"
                className="flex-1 rounded-pill bg-[radial-gradient(circle_at_top,_#6ee7b7_10%,_#059669_90%)] px-4 py-3 text-center text-sm font-semibold text-white shadow-[0_8px_0_#065f46,_0_16px_22px_rgba(0,0,0,0.35),_inset_0_2px_3px_rgba(255,255,255,0.38)] transition-all hover:-translate-y-[1px] active:translate-y-[4px] disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="h-5 w-5" />
                Mark as Complete
              </button>
            ) : null}

            {task?.status === 'completed' && onRestore ? (
              <button
                type="button"
                onClick={onRestore}
                disabled={busy}
                aria-label="Restore"
                className="flex-1 rounded-pill bg-surface-container-high px-4 py-3 text-center text-sm font-semibold text-on-surface transition hover:bg-surface-bright flex items-center justify-center gap-2"
              >
                <RotateCcw className="h-5 w-5" />
                Restore
              </button>
            ) : null}

            {onDelete ? (
              <button
                type="button"
                onClick={onDelete}
                disabled={busy}
                aria-label="Delete task"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/5 text-on-surface-variant transition hover:bg-tertiary/10 hover:text-tertiary disabled:opacity-50"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

export function TaskPreviewView(props: Props) {
  const [isEditing, setIsEditing] = useState(false)
  const [isTitleEditing, setIsTitleEditing] = useState(false)
  const lastTapRef = useRef<number>(0)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0]
    if (touch) {
      touchStartRef.current = { x: touch.clientX, y: touch.clientY }
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    const touch = e.changedTouches[0]
    if (touch && touchStartRef.current) {
      const dx = Math.abs(touch.clientX - touchStartRef.current.x)
      const dy = Math.abs(touch.clientY - touchStartRef.current.y)
      touchStartRef.current = null
      if (dx > 10 || dy > 10) {
        return // Ignore swipe/scroll gesture
      }
    }
    const now = Date.now()
    if (now - lastTapRef.current < 350) {
      setIsEditing(true)
    }
    lastTapRef.current = now
  }

  return (
    <>
      <div
        className="fixed inset-0 z-[120] flex items-center justify-center bg-surface p-0 sm:bg-black/65 sm:p-5 sm:backdrop-blur-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-preview-title"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) props.onClose()
        }}
      >
        <div className="flex h-full w-full max-w-2xl flex-col overflow-hidden rounded-none bg-[radial-gradient(circle_at_top_left,_rgba(186,158,255,0.18),_rgba(32,32,31,0.98)_42%,_rgba(14,14,14,1)_100%)] shadow-[0_28px_80px_rgba(0,0,0,0.62)] sm:h-auto sm:max-h-[92dvh] sm:rounded-[1.7rem]">
        <PreviewHeader
          task={props.task}
          draft={props.draft}
          isEditable={props.isEditable}
          isTitleEditing={isTitleEditing}
          isBusy={props.isBusy}
          onStartTitleEdit={() => setIsTitleEditing(true)}
          onTitleChange={(title) => props.onDraftChange((current) => ({ ...current, title }))}
          onClose={props.onClose}
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 sm:px-6">
          <PreviewBody
            task={props.task}
            draft={props.draft}
            groups={props.groups}
            isLoading={props.isLoading}
            error={props.error}
            isEditing={isEditing}
            isEditable={props.isEditable}
            isBusy={props.isBusy}
            saveError={props.saveError}
            newSubtaskTitle={props.newSubtaskTitle}
            onStartEdit={() => setIsEditing(true)}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onDraftChange={props.onDraftChange}
            onNewSubtaskTitleChange={props.onNewSubtaskTitleChange}
            onCreateSubtask={props.onCreateSubtask}
            onToggleSubtask={props.onToggleSubtask}
            onDeleteSubtask={props.onDeleteSubtask}
            friendlyError={props.friendlyError}
          />
        </div>
        <PreviewFooter
          task={props.task}
          isEditing={isEditing || isTitleEditing}
          busy={props.isBusy}
          isDirty={Boolean(props.isDirty)}
          onSave={() => { setIsTitleEditing(false); props.onSave() }}
          onComplete={props.onComplete}
          onRestore={props.onRestore}
          onDelete={props.onDelete}
        />
        </div>
      </div>
      <SaveConfirmationToast message={props.saveNotice} onDismiss={props.onDismissSaveNotice} />
    </>
  )
}
