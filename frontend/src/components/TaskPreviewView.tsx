import { Bell, CalendarDays, CheckCircle2, Folder, PencilLine, Repeat2, RotateCcw, Save, Trash2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { GroupSummary, TaskDetail } from '../lib/api'
import type { TaskDetailDraft } from '../lib/taskFormModel'
import { formatDate, formatDateTime, formatRecurrence } from '../lib/taskFormatters'
import { TaskPreviewEditFields } from './TaskPreviewEditFields'
import { SaveConfirmationToast } from './SaveConfirmationToast'
import { Button } from './Button'
import { BottomSheet } from './ui/BottomSheet'
import { CheckCircle, Chip } from './ui/controls'
import { groupTone } from './ui/chipStyles'

type Props = {
  open: boolean
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

const PREVIEW_PRESSABLE_CLASS =
  'cursor-pointer text-left outline-none transition-[background-color,transform] duration-200 hover:bg-on-surface/[0.03] focus-visible:ring-2 focus-visible:ring-primary/60 active:scale-[0.99]'

type EditGestures = {
  onStartEdit: () => void
  onTouchStart: (e: React.TouchEvent) => void
  onTouchEnd: (e: React.TouchEvent) => void
}

function PropertyRow({
  label,
  icon: Icon,
  value,
  isEmpty,
  gestures,
}: {
  label: string
  icon: typeof CalendarDays
  value: string
  isEmpty: boolean
  gestures: EditGestures
}) {
  return (
    <button
      type="button"
      onClick={gestures.onStartEdit}
      onDoubleClick={gestures.onStartEdit}
      onTouchStart={gestures.onTouchStart}
      onTouchEnd={gestures.onTouchEnd}
      className={`${PREVIEW_PRESSABLE_CLASS} flex min-h-[3.25rem] w-full items-center gap-3`}
      title="Tap or double-click to edit"
    >
      <Icon className="h-[1.1rem] w-[1.1rem] shrink-0 text-primary/75" strokeWidth={1.8} aria-hidden="true" />
      <span className="text-sm text-on-surface-variant">{label}</span>
      <span className={`ml-auto min-w-0 truncate text-right text-sm font-medium ${isEmpty ? 'text-on-surface-variant/60' : 'text-on-surface'}`}>
        {value}
      </span>
    </button>
  )
}

function PreviewHeader({
  task,
  draft,
  isEditable,
  isTitleEditing,
  isEditing,
  isBusy,
  onStartTitleEdit,
  onTitleChange,
  onClose,
}: {
  task?: TaskDetail
  draft: TaskDetailDraft | null
  isEditable: boolean
  isTitleEditing: boolean
  isEditing: boolean
  isBusy: boolean
  onStartTitleEdit: () => void
  onTitleChange: (title: string) => void
  onClose: () => void
}) {
  const [isTitleExpanded, setIsTitleExpanded] = useState(false)
  return (
    <div className="px-5 pb-3 pt-1">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 pt-1.5">
          {task ? (
            <>
              <Chip tone={groupTone(task.group.name)} icon={Folder}>{task.group.name}</Chip>
              {task.status === 'completed' ? <Chip tone="green">Completed</Chip> : null}
              {task.needs_review ? <Chip tone="amber">Needs review</Chip> : null}
            </>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          onPointerDown={(event) => event.stopPropagation()}
          className="clay-obsidian flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:text-on-surface"
          aria-label="Close task preview"
        >
          <X className="h-[1.1rem] w-[1.1rem]" strokeWidth={2.2} />
        </button>
      </div>
      {isEditable && (isTitleEditing || isEditing) ? (
        <>
          <h2 id="task-preview-title" className="sr-only">{draft?.title || task?.title || 'Untitled task'}</h2>
          <input
            autoFocus={isTitleEditing}
            value={draft?.title ?? task?.title ?? ''}
            onChange={(event) => onTitleChange(event.target.value)}
            onPointerDown={(event) => event.stopPropagation()}
            className="mt-2.5 w-full border-b-2 border-outline/50 bg-transparent pb-1 font-display text-[1.5rem] font-bold leading-tight tracking-[-0.015em] text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/50 focus:border-primary"
            aria-label="Task title"
            placeholder="Task title"
            disabled={isBusy}
          />
        </>
      ) : (
        <div className="mt-2.5 flex items-start gap-2">
          {/* One line by default; tapping the title reveals the rest. */}
          <h2 id="task-preview-title" className="min-w-0 flex-1 font-display text-[1.5rem] font-bold leading-tight tracking-[-0.015em] text-on-surface">
            <button
              type="button"
              onClick={() => setIsTitleExpanded((expanded) => !expanded)}
              onPointerDown={(event) => event.stopPropagation()}
              aria-expanded={isTitleExpanded}
              className={`block w-full rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${isTitleExpanded ? 'text-balance break-words' : 'truncate'}`}
            >
              {draft?.title || task?.title || 'Loading task'}
            </button>
          </h2>
          {isEditable ? (
            <button
              type="button"
              onClick={onStartTitleEdit}
              onPointerDown={(event) => event.stopPropagation()}
              aria-label="Edit title"
              className="-mr-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-primary/70 transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/60 outline-none"
            >
              <PencilLine className="h-4 w-4" strokeWidth={2} />
            </button>
          ) : null}
        </div>
      )}
    </div>
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
  const gestures: EditGestures = { onStartEdit, onTouchStart, onTouchEnd }
  const rawRecurrence = draft ? draft.recurrence : task.recurrence
  const rawDueDate = draft ? draft.dueDate : task.due_date
  const rawReminder = draft ? draft.reminderAt : task.reminder_at
  const rawReminderDate = draft ? draft.reminderDate : task.reminder_date
  const reminder = rawReminder ? formatDateTime(rawReminder) : rawReminderDate ? formatDate(rawReminderDate) : formatDateTime(null)
  const description = draft ? draft.description : task.description

  return (
    <>
      <button
        type="button"
        onClick={onStartEdit}
        onDoubleClick={onStartEdit}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className={`${PREVIEW_PRESSABLE_CLASS} block w-full rounded-lg`}
        title="Tap or double-click to edit"
      >
        <p className="text-xs font-medium text-on-surface-variant">Notes</p>
        <p className={`mt-1.5 whitespace-pre-line border-l-2 border-outline/60 pl-3 text-base leading-6 ${description ? 'text-on-surface' : 'text-on-surface-variant/60'}`}>
          {description || 'No notes yet.'}
        </p>
      </button>

      <div className="divide-y divide-outline/30">
        <PropertyRow label="Due date" icon={CalendarDays} value={formatDate(rawDueDate)} isEmpty={!rawDueDate} gestures={gestures} />
        <PropertyRow label="Reminder" icon={Bell} value={reminder} isEmpty={!rawReminder && !rawReminderDate} gestures={gestures} />
        <PropertyRow label="Repeats" icon={Repeat2} value={formatRecurrence(rawRecurrence)} isEmpty={!rawRecurrence} gestures={gestures} />
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
  const doneCount = task.subtasks.filter((item) => item.is_completed).length
  const progress = task.subtasks.length ? Math.round((doneCount / task.subtasks.length) * 100) : 0
  return (
    <section className="rounded-[1.25rem] bg-surface-container-high p-4 shadow-card ring-1 ring-inset ring-outline/40">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-display text-lg font-bold text-on-surface">Checklist</p>
          <p className="mt-0.5 text-xs text-on-surface-variant">{task.subtasks.length} subtasks</p>
        </div>
        <Chip tone={doneCount && doneCount === task.subtasks.length ? 'green' : 'neutral'}>{doneCount} done</Chip>
      </div>
      {task.subtasks.length ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-pill bg-surface-dim" aria-hidden="true">
          <div className="h-full rounded-pill bg-primary transition-[width] duration-500 ease-out-expo" style={{ width: `${progress}%` }} />
        </div>
      ) : null}
      <div className="mt-3 space-y-1">
        {task.subtasks.length ? (
          task.subtasks.map((subtask) => (
            <div key={subtask.id} className="group/row flex min-h-[2.75rem] items-center gap-3 rounded-xl px-1 py-1.5">
              <CheckCircle
                size="sm"
                label={`Toggle ${subtask.title}`}
                checked={subtask.is_completed}
                disabled={busy}
                onClick={() => onToggle(subtask.id, !subtask.is_completed)}
              />
              <p className={`min-w-0 flex-1 text-sm transition-colors duration-300 ${subtask.is_completed ? 'text-on-surface-variant line-through' : 'text-on-surface'}`}>
                {subtask.title}
              </p>
              {editable ? (
                <button
                  type="button"
                  onClick={() => onDelete(subtask.id)}
                  disabled={busy}
                  aria-label={`Delete ${subtask.title}`}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-chip-rose hover:text-chip-rose-ink"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          ))
        ) : (
          <p className="px-1 py-2 text-sm text-on-surface-variant">No subtasks yet.</p>
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
            className="min-w-0 flex-1 rounded-pill bg-surface-dim px-4 py-2.5 text-sm text-on-surface outline-none ring-1 ring-inset ring-outline/40 placeholder:text-on-surface-variant/60 focus:ring-2 focus:ring-primary/60"
            placeholder="Add a subtask..."
            disabled={busy}
          />
          <Button variant="primary" size="md" onClick={onCreate} disabled={!title.trim() || busy}>Add</Button>
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
    return <div className="space-y-3" aria-busy="true"><div className="skeleton-shimmer h-16 rounded-[1.1rem]" /><div className="skeleton-shimmer h-10 rounded-xl" /><div className="skeleton-shimmer h-10 rounded-xl" /><div className="skeleton-shimmer h-10 rounded-xl" /></div>
  if (props.error)
    return (
      <div role="alert" className="rounded-card bg-chip-rose p-4 text-sm text-chip-rose-ink">
        {props.friendlyError(props.error, 'Task preview could not be loaded.')}
      </div>
    )
  if (!props.task) return null

  return (
    <div className="space-y-5">
      {props.isEditing && props.isEditable && props.draft ? (
        <TaskPreviewEditFields
          task={props.task}
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
        <p role="alert" className="rounded-card bg-chip-rose px-4 py-3 text-sm text-chip-rose-ink">{props.saveError}</p>
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
        <p className="pt-1 text-center text-xs text-on-surface-variant/70">
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
  const deleteButton = onDelete ? (
    <button
      type="button"
      onClick={onDelete}
      disabled={busy}
      aria-label="Delete task"
      className="flex h-[3.25rem] w-[3.25rem] shrink-0 items-center justify-center rounded-full bg-chip-rose text-chip-rose-ink transition-transform active:scale-90 disabled:opacity-50"
    >
      <Trash2 className="h-5 w-5" />
    </button>
  ) : null
  return (
    <div className="flex items-center gap-2.5">
      {isEditing ? (
        <>
          <Button variant="primary" size="lg" className="flex-1" onClick={onSave} disabled={busy || !isDirty} aria-label="Save changes">
            <Save className="h-4 w-4" />
            Save Changes
          </Button>
          {task?.status === 'open' && onComplete ? (
            <CheckCircle mode="action" size="lg" label="Complete" checked={false} disabled={busy} onClick={onComplete} className="!h-[3.25rem] !w-[3.25rem]" />
          ) : null}
        </>
      ) : (
        <>
          {task?.status === 'open' && onComplete ? (
            <Button variant="primary" size="lg" className="flex-1" onClick={onComplete} disabled={busy} aria-label="Complete">
              <CheckCircle2 className="h-5 w-5" />
              Mark as Complete
            </Button>
          ) : null}
          {task?.status === 'completed' && onRestore ? (
            <Button variant="secondary" size="lg" className="flex-1" onClick={onRestore} disabled={busy} aria-label="Restore">
              <RotateCcw className="h-5 w-5" />
              Restore
            </Button>
          ) : null}
        </>
      )}
      {deleteButton}
    </div>
  )
}

export function TaskPreviewView(props: Props) {
  const [isEditing, setIsEditing] = useState(false)
  const [isTitleEditing, setIsTitleEditing] = useState(false)
  const lastTapRef = useRef<number>(0)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  // Every opening starts read-only: closing the sheet, switching task, or a successful save ends edit mode.
  const editScope = props.open ? props.task?.id ?? 'loading' : 'closed'
  const [editScopeSeen, setEditScopeSeen] = useState(editScope)
  const [saveNoticeSeen, setSaveNoticeSeen] = useState(props.saveNotice)
  if (editScope !== editScopeSeen || props.saveNotice !== saveNoticeSeen) {
    setEditScopeSeen(editScope)
    setSaveNoticeSeen(props.saveNotice)
    if (editScope !== editScopeSeen || props.saveNotice) {
      setIsEditing(false)
      setIsTitleEditing(false)
    }
  }

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
      <BottomSheet
        open={props.open}
        onClose={props.onClose}
        labelledBy="task-preview-title"
        header={
          <PreviewHeader
            key={props.task?.id}
            task={props.task}
            draft={props.draft}
            isEditable={props.isEditable}
            isTitleEditing={isTitleEditing}
            isEditing={isEditing}
            isBusy={props.isBusy}
            onStartTitleEdit={() => setIsTitleEditing(true)}
            onTitleChange={(title) => props.onDraftChange((current) => ({ ...current, title }))}
            onClose={props.onClose}
          />
        }
        footer={
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
        }
      >
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
      </BottomSheet>
      <SaveConfirmationToast message={props.saveNotice} onDismiss={props.onDismissSaveNotice} />
    </>
  )
}
