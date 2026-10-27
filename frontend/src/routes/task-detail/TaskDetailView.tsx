import { ArrowLeft, Folder, Pencil, Trash2 } from 'lucide-react'
import { Button } from '../../components/Button'
import { CheckCircle, Chip } from '../../components/ui/controls'
import { chipClass, groupTone } from '../../components/ui/chipStyles'
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
  return <div className="animate-rise-in relative z-20 rounded-[1.6rem] bg-surface-container-high p-5 shadow-card ring-1 ring-inset ring-outline/40"><div className="flex flex-wrap gap-1.5"><Chip tone={props.isEditMode ? 'violet' : 'neutral'}>{props.isEditMode ? 'Editing task' : 'Task summary'}</Chip><Chip tone={groupTone(props.groupName)} icon={Folder}>{props.groupName}</Chip>{props.task.needs_review ? <Chip tone="amber">Needs review</Chip> : null}</div><div className="mt-4">{props.isEditMode ? <TaskEditor originalDueDate={props.task.due_date} draft={props.draft} groups={props.groups} isBusy={props.isBusy} isGroupDropdownOpen={props.isGroupDropdownOpen} onDraft={props.onDraft} onGroupDropdown={props.onGroupDropdown} /> : <ReadOnlySummary draft={props.draft} groupName={props.groupName} />}</div></div>
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
  return <div className="space-y-4"><h2 className="font-display text-[1.9rem] font-extrabold leading-tight tracking-[-0.02em] text-on-surface">{props.draft.title}</h2><p className="text-sm leading-6 text-on-surface-variant">{props.draft.description || 'No additional context yet. Edit this task to add the detail that helps you act faster later.'}</p><div className="grid grid-cols-2 gap-3"><Metadata label="Due date" value={formatDate(props.draft.dueDate, 'No due date')} /><Metadata label="Reminder" value={formatDate(props.draft.reminderAt || props.draft.reminderDate, 'No reminder')} /><Metadata label="Group" value={props.groupName} /><Metadata label="Recurrence" value={recurrenceLabel(props.draft.recurrence)} /></div><div className="rounded-[1.1rem] bg-surface-dim/60 p-4 text-sm leading-6 text-on-surface-variant">Open edit mode when you want to change details. Delete still asks for confirmation before it removes this task.</div></div>
}

function Metadata({ label, value }: { label: string; value: string }) {
  return <div className="rounded-[1.1rem] bg-surface-dim/70 p-3.5 ring-1 ring-inset ring-outline/30"><p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-on-surface-variant">{label}</p><p className="mt-2 truncate text-[0.95rem] font-semibold text-on-surface">{value}</p></div>
}

function RecurrenceCard({ recurrence, hidden }: { recurrence: TaskRecurrence | null; hidden: boolean }) {
  if (hidden) return null
  return <div className="animate-rise-in rounded-[1.4rem] bg-surface-container-high p-4 shadow-card ring-1 ring-inset ring-outline/40"><p className="font-display text-lg font-bold text-on-surface">Recurrence</p><div className="mt-3 rounded-card bg-surface-dim/70 px-4 py-3.5 font-semibold text-on-surface">{recurrenceLabel(recurrence)}</div></div>
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
  return <div className="animate-rise-in rounded-[1.4rem] bg-surface-container-high p-4 shadow-card ring-1 ring-inset ring-outline/40"><div className="flex items-center justify-between gap-3"><div><p className="font-display text-lg font-bold text-on-surface">Subtasks</p><p className="mt-1 text-xs text-on-surface-variant">{subtitle}</p></div><span className={chipClass('neutral')}>{props.task.subtasks.length} {props.task.subtasks.length === 1 ? 'subtask' : 'subtasks'}</span></div><div className="mt-3 space-y-2">{props.task.subtasks.length ? props.task.subtasks.map((subtask) => <SubtaskRow key={subtask.id} subtask={subtask} isEditMode={props.isEditMode} pending={props.pendingSubtaskIds.includes(subtask.id)} draftTitle={props.subtaskDrafts[subtask.id] ?? subtask.title} subtaskDrafts={props.subtaskDrafts} onSubtaskDrafts={props.onSubtaskDrafts} onUpdateSubtask={props.onUpdateSubtask} onDeleteSubtask={props.onDeleteSubtask} />) : <p className="px-1 py-2 text-sm text-on-surface-variant">No subtasks yet.</p>}</div>{props.isEditMode ? <AddSubtask title={props.newSubtaskTitle} onTitle={props.onNewSubtaskTitle} onCreate={props.onCreateSubtask} /> : null}</div>
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
  return <div className="rounded-xl px-1 py-2"><div className="flex items-start gap-3"><SubtaskToggle subtask={props.subtask} pending={props.pending} onUpdate={props.onUpdateSubtask} /><SubtaskContent subtask={props.subtask} isEditMode={props.isEditMode} pending={props.pending} draftTitle={props.draftTitle} subtaskDrafts={props.subtaskDrafts} onSubtaskDrafts={props.onSubtaskDrafts} onUpdate={props.onUpdateSubtask} onDelete={props.onDeleteSubtask} /></div></div>
}

function SubtaskToggle(props: { subtask: TaskDetail['subtasks'][number]; pending: boolean; onUpdate: (change: SubtaskChange) => void }) {
  return (
    <CheckCircle
      size="sm"
      className="mt-0.5"
      label={`Toggle ${props.subtask.title}`}
      checked={props.subtask.is_completed}
      pending={props.pending}
      disabled={props.pending}
      onClick={() => props.onUpdate({ subtaskId: props.subtask.id, is_completed: !props.subtask.is_completed })}
    />
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
  return <div className="flex-1"><p className={`text-sm transition-colors ${titleClass}`}>{subtask.title}</p></div>
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
  return <div className="flex-1"><input value={props.draftTitle} onChange={(event) => props.onSubtaskDrafts({ ...props.subtaskDrafts, [props.subtask.id]: event.target.value })} className="w-full rounded-card bg-surface-dim px-3 py-2 text-on-surface outline-none ring-1 ring-inset ring-outline/50 focus:ring-2 focus:ring-primary/60" aria-label={`Subtask ${props.subtask.title}`} /><div className="mt-2 flex gap-2"><Button variant="primary" size="sm" onClick={() => props.onUpdate({ subtaskId: props.subtask.id, title: props.draftTitle })} disabled={props.pending}>Save</Button><Button variant="ghost" size="sm" onClick={() => props.onDelete(props.subtask.id)} disabled={props.pending}>Delete</Button></div></div>
}

function AddSubtask(props: { title: string; onTitle: (title: string) => void; onCreate: () => void }) {
  return <div className="mt-3 flex gap-2"><input value={props.title} onChange={(event) => props.onTitle(event.target.value)} placeholder="Add a subtask..." className="min-w-0 flex-1 rounded-pill bg-surface-dim px-4 py-2.5 text-sm text-on-surface outline-none ring-1 ring-inset ring-outline/50 placeholder:text-on-surface-variant/60 focus:ring-2 focus:ring-primary/60" /><Button variant="primary" onClick={props.onCreate} disabled={!props.title.trim()}>Add</Button></div>
}

export function TaskActionDock({ isEditMode, isBusy, onBack, onSave, onEdit, onDelete }: { isEditMode: boolean; isBusy: boolean; onBack: () => void; onSave: () => void; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[55]">
      <div className="mx-auto w-full max-w-md px-3 pb-[calc(var(--safe-area-bottom)+0.75rem)]">
        <div className="pointer-events-auto rounded-[1.75rem] bg-surface-container-high/95 p-3 shadow-sheet ring-1 ring-outline/50 backdrop-blur-xl">
          <p className="px-1.5 pb-2.5 text-[0.7rem] font-medium text-on-surface-variant">{isEditMode ? 'Save writes your changes and closes this detail view.' : 'Edit unlocks every field. Delete asks before it removes this task.'}</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onBack} aria-label="Back to tasks" className="clay-obsidian flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-on-surface"><ArrowLeft className="h-5 w-5" strokeWidth={2.2} /></button>
            {isEditMode
              ? <Button variant="primary" size="lg" className="flex-1" onClick={onSave} disabled={isBusy}>Save and return</Button>
              : <Button variant="primary" size="lg" className="flex-1" onClick={onEdit}><Pencil className="h-4 w-4" />Edit task</Button>}
            <button type="button" onClick={onDelete} disabled={isBusy} aria-label="Delete task" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-chip-rose text-chip-rose-ink transition-transform active:scale-90 disabled:opacity-50"><Trash2 className="h-5 w-5" /></button>
          </div>
        </div>
      </div>
    </div>
  )
}
