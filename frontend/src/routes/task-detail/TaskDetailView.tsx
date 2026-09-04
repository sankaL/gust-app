import { CheckCircle2 } from 'lucide-react'
import { TaskDeleteDialog } from '../../components/TaskDeleteDialog'
import { TaskFormFields } from '../../components/TaskFormFields'
import { shiftReminderDateTimeLocal, shouldShiftReminderForDueDate } from '../../lib/dateTime'
import type { GroupSummary, TaskDeleteScope, TaskDetail, TaskRecurrence } from '../../lib/api'

export type TaskDetailDraft = {
  title: string
  description: string
  groupId: string
  dueDate: string
  reminderAt: string
  reminderDate: string
  recurrence: TaskRecurrence | null
}

export type SubtaskChange = { subtaskId: string; title?: string; is_completed?: boolean }

type TaskDetailLoadedProps = {
  task: TaskDetail
  draft: TaskDetailDraft
  groups: GroupSummary[]
  isEditMode: boolean
  isBusy: boolean
  isGroupDropdownOpen: boolean
  pendingSubtaskIds: string[]
  subtaskDrafts: Record<string, string>
  newSubtaskTitle: string
  pendingDelete: boolean
  isDeleting: boolean
  onDraft: (update: Partial<TaskDetailDraft>) => void
  onGroupDropdown: (open: boolean) => void
  onSubtaskDrafts: (drafts: Record<string, string>) => void
  onNewSubtaskTitle: (title: string) => void
  onCreateSubtask: () => void
  onUpdateSubtask: (change: SubtaskChange) => void
  onDeleteSubtask: (id: string) => void
  onDeleteScope: (scope: TaskDeleteScope) => void
  onCloseDelete: () => void
}

function formatDate(value: string, fallback: string) {
  if (!value) return fallback
  const date = new Date(value.includes('T') ? value : `${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return fallback
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', ...(value.includes('T') ? { hour: 'numeric', minute: '2-digit' } : {}) }).format(date)
}

function recurrenceLabel(recurrence: TaskRecurrence | null) {
  return recurrence ? recurrence.frequency.charAt(0).toUpperCase() + recurrence.frequency.slice(1) : 'One-off'
}

export function TaskDetailLoaded(props: TaskDetailLoadedProps) {
  const groupName = props.groups.find((group) => group.id === props.draft.groupId)?.name ?? props.task.group.name ?? 'Unknown group'
  return <><TaskOverview task={props.task} draft={props.draft} groups={props.groups} groupName={groupName} isEditMode={props.isEditMode} isBusy={props.isBusy} isGroupDropdownOpen={props.isGroupDropdownOpen} onDraft={props.onDraft} onGroupDropdown={props.onGroupDropdown} /><RecurrenceCard recurrence={props.draft.recurrence} hidden={props.isEditMode} /><SubtasksCard task={props.task} isEditMode={props.isEditMode} pendingSubtaskIds={props.pendingSubtaskIds} subtaskDrafts={props.subtaskDrafts} newSubtaskTitle={props.newSubtaskTitle} onSubtaskDrafts={props.onSubtaskDrafts} onNewSubtaskTitle={props.onNewSubtaskTitle} onCreateSubtask={props.onCreateSubtask} onUpdateSubtask={props.onUpdateSubtask} onDeleteSubtask={props.onDeleteSubtask} /><TaskDeleteDialog isOpen={props.pendingDelete} taskTitle={props.task.title} isRecurring={Boolean(props.task.series_id || props.task.recurrence_frequency)} isDeleting={props.isDeleting} followUpMessage="After delete, you'll return to the task list." onDeleteOccurrence={() => props.onDeleteScope('occurrence')} onDeleteSeries={() => props.onDeleteScope('series')} onClose={props.onCloseDelete} /></>
}

type TaskOverviewProps = {
  task: TaskDetail
  draft: TaskDetailDraft
  groups: GroupSummary[]
  groupName: string
  isEditMode: boolean
  isBusy: boolean
  isGroupDropdownOpen: boolean
  onDraft: (update: Partial<TaskDetailDraft>) => void
  onGroupDropdown: (open: boolean) => void
}

function TaskOverview(props: TaskOverviewProps) {
  return <div className="relative z-20 rounded-[1.7rem] bg-[radial-gradient(circle_at_top_left,_rgba(186,158,255,0.16),_rgba(32,32,31,0.98)_40%,_rgba(14,14,14,1)_100%)] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.48)]"><div className="flex flex-wrap gap-2"><span className="rounded-pill bg-white/6 px-3 py-1 text-xs uppercase text-on-surface-variant">{props.isEditMode ? 'Editing task' : 'Task summary'}</span><span className="rounded-pill bg-surface-container-high px-3 py-1 text-xs uppercase text-on-surface-variant">{props.groupName}</span>{props.task.needs_review ? <span className="rounded-pill bg-warning/20 px-3 py-1 text-xs uppercase text-warning">Needs review</span> : null}</div><div className="mt-4">{props.isEditMode ? <TaskEditor originalDueDate={props.task.due_date} draft={props.draft} groups={props.groups} isBusy={props.isBusy} isGroupDropdownOpen={props.isGroupDropdownOpen} onDraft={props.onDraft} onGroupDropdown={props.onGroupDropdown} /> : <ReadOnlySummary draft={props.draft} groupName={props.groupName} />}</div></div>
}

type TaskEditorProps = {
  originalDueDate: string | null
  draft: TaskDetailDraft
  groups: GroupSummary[]
  isBusy: boolean
  isGroupDropdownOpen: boolean
  onDraft: (update: Partial<TaskDetailDraft>) => void
  onGroupDropdown: (open: boolean) => void
}

function TaskEditor(props: TaskEditorProps) {
  const dueDateChange = (dueDate: string) =>
    props.onDraft(
      dueDate
        ? {
            dueDate,
            ...(shouldShiftReminderForDueDate(props.originalDueDate, dueDate) && props.draft.reminderAt ? { reminderAt: shiftReminderDateTimeLocal(props.draft.reminderAt, dueDate) } : {}),
            ...(shouldShiftReminderForDueDate(props.originalDueDate, dueDate) && props.draft.reminderDate ? { reminderDate: dueDate } : {}),
          }
        : { dueDate: '', reminderAt: '', reminderDate: '', recurrence: null }
    )
  return <TaskFormFields title={props.draft.title} description={props.draft.description} groupId={props.draft.groupId} dueDate={props.draft.dueDate} reminderAt={props.draft.reminderAt} reminderDate={props.draft.reminderDate} recurrence={props.draft.recurrence} groups={props.groups} isGroupDropdownOpen={props.isGroupDropdownOpen} disabled={props.isBusy} onTitleChange={(title) => props.onDraft({ title })} onDescriptionChange={(description) => props.onDraft({ description })} onGroupIdChange={(groupId) => props.onDraft({ groupId })} onDueDateChange={dueDateChange} onReminderAtChange={(reminderAt) => props.onDraft({ reminderAt })} onReminderDateChange={(reminderDate) => props.onDraft({ reminderDate })} onRecurrenceChange={(recurrence) => props.onDraft({ recurrence })} onGroupDropdownOpenChange={props.onGroupDropdown} />
}

function ReadOnlySummary(props: { draft: TaskDetailDraft; groupName: string }) {
  return <div className="space-y-4"><h2 className="font-display text-[2.15rem] leading-tight text-on-surface">{props.draft.title}</h2><p className="text-sm leading-6 text-on-surface-variant">{props.draft.description || 'No additional context yet. Edit this task to add the detail that helps you act faster later.'}</p><div className="grid gap-3 sm:grid-cols-2"><Metadata label="Due date" value={formatDate(props.draft.dueDate, 'No due date')} /><Metadata label="Reminder" value={formatDate(props.draft.reminderAt || props.draft.reminderDate, 'No reminder')} /><Metadata label="Group" value={props.groupName} /><Metadata label="Recurrence" value={recurrenceLabel(props.draft.recurrence)} /></div><div className="rounded-[1.35rem] bg-surface/45 p-4 text-sm text-on-surface-variant">Open edit mode when you want to change details. Delete still asks for confirmation before it removes this task.</div></div>
}

function Metadata({ label, value }: { label: string; value: string }) {
  return <div className="rounded-[1.35rem] bg-black/20 p-4"><p className="text-xs font-semibold uppercase text-on-surface-variant">{label}</p><p className="mt-3 text-base font-medium text-on-surface">{value}</p></div>
}

function RecurrenceCard({ recurrence, hidden }: { recurrence: TaskRecurrence | null; hidden: boolean }) {
  if (hidden) return null
  return <div className="rounded-soft bg-surface-container p-4 shadow-ambient"><p className="font-display text-xl text-on-surface">Recurrence</p><div className="mt-3 rounded-card bg-surface-dim px-4 py-4 text-on-surface">{recurrenceLabel(recurrence)}</div></div>
}

type SubtasksCardProps = {
  task: TaskDetail
  isEditMode: boolean
  pendingSubtaskIds: string[]
  subtaskDrafts: Record<string, string>
  newSubtaskTitle: string
  onSubtaskDrafts: (drafts: Record<string, string>) => void
  onNewSubtaskTitle: (title: string) => void
  onCreateSubtask: () => void
  onUpdateSubtask: (change: SubtaskChange) => void
  onDeleteSubtask: (id: string) => void
}

function SubtasksCard(props: SubtasksCardProps) {
  const subtitle = props.isEditMode ? 'Add, rename, complete, or remove checklist items.' : 'These are the smaller actions that drive this task forward.'
  return <div className="rounded-soft bg-surface-container p-4 shadow-ambient"><div className="flex items-center justify-between"><div><p className="font-display text-xl text-on-surface">Subtasks</p><p className="mt-1 text-xs text-on-surface-variant">{subtitle}</p></div><span className="rounded-pill bg-surface-container-high px-3 py-1 text-xs text-on-surface-variant">{props.task.subtasks.length} {props.task.subtasks.length === 1 ? 'subtask' : 'subtasks'}</span></div><div className="mt-3 space-y-2">{props.task.subtasks.length ? props.task.subtasks.map((subtask) => <SubtaskRow key={subtask.id} subtask={subtask} isEditMode={props.isEditMode} pending={props.pendingSubtaskIds.includes(subtask.id)} draftTitle={props.subtaskDrafts[subtask.id] ?? subtask.title} subtaskDrafts={props.subtaskDrafts} onSubtaskDrafts={props.onSubtaskDrafts} onUpdateSubtask={props.onUpdateSubtask} onDeleteSubtask={props.onDeleteSubtask} />) : <div className="rounded-card bg-surface-dim px-4 py-4 text-sm text-on-surface-variant">No subtasks yet.</div>}</div>{props.isEditMode ? <AddSubtask title={props.newSubtaskTitle} onTitle={props.onNewSubtaskTitle} onCreate={props.onCreateSubtask} /> : null}</div>
}

type SubtaskRowProps = {
  subtask: TaskDetail['subtasks'][number]
  isEditMode: boolean
  pending: boolean
  draftTitle: string
  subtaskDrafts: Record<string, string>
  onSubtaskDrafts: (drafts: Record<string, string>) => void
  onUpdateSubtask: (change: SubtaskChange) => void
  onDeleteSubtask: (id: string) => void
}

function SubtaskRow(props: SubtaskRowProps) {
  return <div className="rounded-card bg-surface-dim p-3"><div className="flex gap-2"><SubtaskToggle subtask={props.subtask} pending={props.pending} onUpdate={props.onUpdateSubtask} /><SubtaskContent subtask={props.subtask} isEditMode={props.isEditMode} pending={props.pending} draftTitle={props.draftTitle} subtaskDrafts={props.subtaskDrafts} onSubtaskDrafts={props.onSubtaskDrafts} onUpdate={props.onUpdateSubtask} onDelete={props.onDeleteSubtask} /></div></div>
}

function SubtaskToggle(props: { subtask: TaskDetail['subtasks'][number]; pending: boolean; onUpdate: (change: SubtaskChange) => void }) {
  return (
    <button
      type="button"
      onClick={() => props.onUpdate({ subtaskId: props.subtask.id, is_completed: !props.subtask.is_completed })}
      disabled={props.pending}
      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-all ${
        props.subtask.is_completed
          ? 'bg-primary text-surface shadow-[0_0_10px_rgba(196,181,253,0.35)]'
          : 'border border-outline/40 bg-surface-container hover:border-primary/60'
      }`}
      aria-label={`Toggle ${props.subtask.title}`}
    >
      {props.subtask.is_completed ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
    </button>
  )
}

type SubtaskContentProps = {
  subtask: TaskDetail['subtasks'][number]
  isEditMode: boolean
  pending: boolean
  draftTitle: string
  subtaskDrafts: Record<string, string>
  onSubtaskDrafts: (drafts: Record<string, string>) => void
  onUpdate: (change: SubtaskChange) => void
  onDelete: (id: string) => void
}

function SubtaskContent(props: SubtaskContentProps) {
  if (!props.isEditMode) return <SubtaskReadOnly subtask={props.subtask} />
  return <SubtaskEditor subtask={props.subtask} pending={props.pending} draftTitle={props.draftTitle} subtaskDrafts={props.subtaskDrafts} onSubtaskDrafts={props.onSubtaskDrafts} onUpdate={props.onUpdate} onDelete={props.onDelete} />
}

function SubtaskReadOnly({ subtask }: { subtask: TaskDetail['subtasks'][number] }) {
  const titleClass = subtask.is_completed ? 'line-through text-on-surface-variant' : 'text-on-surface'
  return <div className="flex-1"><p className={titleClass}>{subtask.title}</p></div>
}

type SubtaskEditorProps = {
  subtask: TaskDetail['subtasks'][number]
  pending: boolean
  draftTitle: string
  subtaskDrafts: Record<string, string>
  onSubtaskDrafts: (drafts: Record<string, string>) => void
  onUpdate: (change: SubtaskChange) => void
  onDelete: (id: string) => void
}

function SubtaskEditor(props: SubtaskEditorProps) {
  return <div className="flex-1"><input value={props.draftTitle} onChange={(event) => props.onSubtaskDrafts({ ...props.subtaskDrafts, [props.subtask.id]: event.target.value })} className="w-full rounded-card bg-surface-container px-3 py-2 text-on-surface" aria-label={`Subtask ${props.subtask.title}`} /><div className="mt-2 flex gap-2"><button type="button" onClick={() => props.onUpdate({ subtaskId: props.subtask.id, title: props.draftTitle })} disabled={props.pending} className="rounded-pill bg-primary px-3 py-1.5 text-sm text-surface">Save</button><button type="button" onClick={() => props.onDelete(props.subtask.id)} disabled={props.pending} className="rounded-pill border border-outline/30 px-3 py-1.5 text-sm text-on-surface-variant">Delete</button></div></div>
}

function AddSubtask(props: { title: string; onTitle: (title: string) => void; onCreate: () => void }) {
  return <div className="mt-3 flex gap-2"><input value={props.title} onChange={(event) => props.onTitle(event.target.value)} placeholder="Add a subtask..." className="flex-1 rounded-card border border-dashed border-outline/30 bg-surface-dim px-3 py-3 text-on-surface" /><button type="button" onClick={props.onCreate} disabled={!props.title.trim()} className="rounded-pill bg-primary px-4 py-2 text-sm text-surface disabled:opacity-50">Add</button></div>
}

export function TaskActionDock({ isEditMode, isBusy, onBack, onSave, onEdit, onDelete }: { isEditMode: boolean; isBusy: boolean; onBack: () => void; onSave: () => void; onEdit: () => void; onDelete: () => void }) {
  return <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40"><div className="mx-auto w-full max-w-md px-3 pb-3"><div className="pointer-events-auto rounded-[1.8rem] bg-[rgba(20,20,20,0.9)] p-3"><p className="px-1 pb-3 text-xs uppercase text-on-surface-variant">{isEditMode ? 'Save writes your changes and closes this detail view.' : 'Edit unlocks every field. Delete asks before it removes this task.'}</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-3"><button type="button" onClick={onBack} className="rounded-pill border border-white/10 bg-white/5 px-3 py-3 text-left text-sm text-on-surface">Back to tasks</button>{isEditMode ? <button type="button" onClick={onSave} disabled={isBusy} className="rounded-pill bg-primary px-4 py-3 text-sm font-semibold text-surface disabled:opacity-50">Save and return</button> : <button type="button" onClick={onEdit} className="rounded-pill bg-primary px-4 py-3 text-sm font-semibold text-surface">Edit task</button>}<button type="button" onClick={onDelete} disabled={isBusy} className="col-span-2 rounded-pill border border-tertiary/35 bg-tertiary/10 px-4 py-3 text-sm text-tertiary disabled:opacity-50 sm:col-span-1">Delete task</button></div></div></div></div>
}
