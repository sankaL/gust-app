import { CheckCircle2, ExternalLink, RotateCcw, Save, Trash2, X } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { GroupSummary, TaskDetail, TaskRecurrence } from '../lib/api'
import { RECURRENCE_MONTHS, RECURRENCE_OPTIONS, RECURRENCE_WEEKDAYS, recurrenceForDueDate, type TaskDetailDraft } from '../lib/taskFormModel'
import { DatePicker } from './DatePicker'
import { DesktopTaskGroupField } from './DesktopTaskGroupField'
import { SelectDropdown } from './SelectDropdown'

export type DraftUpdater = (updater: (draft: TaskDetailDraft) => TaskDetailDraft) => void

function recurrenceLabel(value: TaskRecurrence | null) {
  return value ? value.frequency.charAt(0).toUpperCase() + value.frequency.slice(1) : 'One-off'
}

export function TaskDetailHeader({ taskId, task, draft, modal, onClose }: { taskId: string; task?: TaskDetail; draft: TaskDetailDraft | null; modal: boolean; onClose?: () => void }) {
  return <header className="flex items-start justify-between gap-5 border-b border-white/10 px-6 py-5"><div className="min-w-0"><div className="flex items-center gap-2"><span className="text-[0.62rem] uppercase text-on-surface-variant">Desktop editor</span>{task ? <span className="rounded-pill bg-surface-container-high px-3 py-1 text-[0.62rem] uppercase">{task.status}</span> : null}{task?.needs_review ? <span className="rounded-pill bg-warning/20 px-3 py-1 text-[0.62rem] text-warning">Needs review</span> : null}</div><h2 id="desktop-task-editor-title" className="mt-3 truncate font-display text-3xl">{draft?.title || task?.title || 'Loading task'}</h2></div>{modal ? <div className="flex gap-2"><Link to={`/desktop/tasks/${taskId}`} className="inline-flex h-10 items-center gap-2 rounded-pill bg-surface-container-high px-4 text-sm"><ExternalLink className="h-4 w-4" />Open full page</Link><button type="button" onClick={onClose} aria-label="Close task editor" className="h-10 w-10 rounded-full bg-white/8"><X className="mx-auto h-4 w-4" /></button></div> : null}</header>
}

type RecurrenceDetailProps = { recurrence: TaskRecurrence; update: DraftUpdater; disabled: boolean }

function WeeklyRecurrence({ recurrence, update, disabled }: RecurrenceDetailProps) {
  return <SelectDropdown label="" options={RECURRENCE_WEEKDAYS} value={recurrence.weekday ?? ''} disabled={disabled} onChange={(value) => update((current) => ({ ...current, recurrence: { frequency: 'weekly', weekday: value === '' ? null : Number(value), day_of_month: null, month: null } }))} />
}

function MonthlyRecurrence({ recurrence, update, disabled }: RecurrenceDetailProps) {
  return <input type="number" min={1} max={31} value={recurrence.day_of_month ?? ''} disabled={disabled} aria-label="Recurrence day of month" className="w-full rounded-card bg-surface-dim px-3 py-3" onChange={(event) => update((current) => ({ ...current, recurrence: { frequency: 'monthly', weekday: null, day_of_month: event.target.value ? Number(event.target.value) : null, month: null } }))} />
}

function YearlyRecurrence({ recurrence, update, disabled }: RecurrenceDetailProps) {
  return <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem]"><SelectDropdown label="" options={RECURRENCE_MONTHS} value={recurrence.month ?? ''} disabled={disabled} onChange={(value) => update((current) => ({ ...current, recurrence: { frequency: 'yearly', weekday: null, day_of_month: current.recurrence?.day_of_month ?? null, month: value === '' ? null : Number(value) } }))} /><input type="number" min={1} max={31} value={recurrence.day_of_month ?? ''} disabled={disabled} aria-label="Recurrence day of year" className="w-full rounded-card bg-surface-dim px-3 py-3" onChange={(event) => update((current) => ({ ...current, recurrence: { frequency: 'yearly', weekday: null, day_of_month: event.target.value ? Number(event.target.value) : null, month: current.recurrence?.month ?? null } }))} /></div>
}

const RECURRENCE_DETAILS: Partial<Record<TaskRecurrence['frequency'], (props: RecurrenceDetailProps) => React.ReactNode>> = { weekly: WeeklyRecurrence, monthly: MonthlyRecurrence, yearly: YearlyRecurrence }

function RecurrenceDetails({ draft, update, disabled }: { draft: TaskDetailDraft; update: DraftUpdater; disabled: boolean }) {
  const recurrence = draft.recurrence
  const Details = recurrence ? RECURRENCE_DETAILS[recurrence.frequency] : undefined
  return recurrence && Details ? <Details recurrence={recurrence} update={update} disabled={disabled} /> : null
}

function ScheduleFields({ draft, groups, open, setOpen, update, disabled }: { draft: TaskDetailDraft; groups: GroupSummary[]; open: boolean; setOpen: (value: boolean) => void; update: DraftUpdater; disabled: boolean }) {
  const recurrenceFrequency = draft.recurrence?.frequency ?? 'none'
  return <div className="rounded-card bg-surface/35">
    <DesktopTaskGroupField groups={groups} value={draft.groupId} isOpen={open} disabled={disabled} labelWidthClass="sm:grid-cols-[10rem_minmax(0,1fr)]" onChange={(groupId) => update((current) => ({ ...current, groupId }))} onOpenChange={setOpen} />
    <div className="grid border-b border-white/10 px-4 py-3 sm:grid-cols-[10rem_minmax(0,1fr)]"><p className="text-xs uppercase">Due date</p><DatePicker value={draft.dueDate || null} mode="date" disabled={disabled} placeholder="Select a date" onChange={(value) => update((current) => value ? { ...current, dueDate: value } : { ...current, dueDate: '', reminderAt: '', recurrence: null })} /></div>
    <div className="grid border-b border-white/10 px-4 py-3 sm:grid-cols-[10rem_minmax(0,1fr)]"><p className="text-xs uppercase">Reminder</p><DatePicker value={draft.reminderAt || null} mode="datetime" disabled={!draft.dueDate || disabled} placeholder={draft.dueDate ? 'Select date & time' : 'Set a due date first'} onChange={(value) => update((current) => ({ ...current, reminderAt: value }))} /></div>
    <div className="grid px-4 py-3 sm:grid-cols-[10rem_minmax(0,1fr)]"><p className="text-xs uppercase">Recurrence</p><div className="space-y-3"><div className="grid gap-2 sm:grid-cols-5">{RECURRENCE_OPTIONS.map((option) => <button key={option.value} type="button" disabled={!draft.dueDate || disabled} onClick={() => update((current) => ({ ...current, recurrence: option.value === 'none' ? null : recurrenceForDueDate(option.value, current.dueDate) }))} className={recurrenceFrequency === option.value ? 'rounded-card bg-primary px-3 py-2 text-surface' : 'rounded-card bg-surface-dim px-3 py-2'}>{option.label}</button>)}</div><p className="text-xs text-on-surface-variant">{recurrenceLabel(draft.recurrence)}</p><RecurrenceDetails draft={draft} update={update} disabled={disabled} /></div></div>
  </div>
}

export function TaskDetailFields({ draft, groups, groupOpen, setGroupOpen, update, disabled }: { draft: TaskDetailDraft; groups: GroupSummary[]; groupOpen: boolean; setGroupOpen: (value: boolean) => void; update: DraftUpdater; disabled: boolean }) {
  return <section className="space-y-5"><label className="block text-[0.68rem] uppercase text-on-surface-variant">Title<input value={draft.title} onChange={(event) => update((current) => ({ ...current, title: event.target.value }))} className="mt-2 w-full rounded-card bg-surface/65 px-4 py-3 font-display text-2xl" disabled={disabled} aria-label="Task title" /></label><label className="block text-[0.68rem] uppercase text-on-surface-variant">Context<textarea value={draft.description} onChange={(event) => update((current) => ({ ...current, description: event.target.value }))} rows={7} className="mt-2 w-full resize-none rounded-card bg-surface/55 px-4 py-3 text-sm" disabled={disabled} aria-label="Task description" /></label><ScheduleFields draft={draft} groups={groups} open={groupOpen} setOpen={setGroupOpen} update={update} disabled={disabled} /></section>
}

type SubtaskActions = { pending: (id: string) => boolean; mark: (id: string, value: boolean) => void; update: (payload: { subtaskId: string; title?: string; is_completed?: boolean }) => void; remove: (id: string) => void }

function SubtaskRow({ task, value, setValue, actions }: { task: TaskDetail['subtasks'][number]; value: string; setValue: (value: string) => void; actions: SubtaskActions }) {
  const pending = actions.pending(task.id)
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <button
        type="button"
        disabled={pending}
        aria-label={`Toggle ${task.title}`}
        onClick={() => {
          actions.mark(task.id, true)
          actions.update({ subtaskId: task.id, is_completed: !task.is_completed })
        }}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-all ${
          task.is_completed
            ? 'bg-primary text-surface shadow-[0_0_10px_rgba(196,181,253,0.35)]'
            : 'border border-outline/40 bg-surface-container hover:border-primary/60'
        }`}
      >
        {task.is_completed ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
      </button>
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          const title = value.trim()
          if (title && title !== task.title && !pending) {
            actions.mark(task.id, true)
            actions.update({ subtaskId: task.id, title })
          }
        }}
        disabled={pending}
        className={`min-w-0 flex-1 bg-transparent text-sm outline-none ${
          task.is_completed ? 'text-on-surface-variant line-through' : 'text-on-surface'
        }`}
        aria-label={`Subtask ${task.title}`}
      />
      <button
        type="button"
        disabled={pending}
        aria-label={`Delete ${task.title}`}
        onClick={() => {
          actions.mark(task.id, true)
          actions.remove(task.id)
        }}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-tertiary/15 hover:text-tertiary disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}

export function TaskDetailSubtasks({ task, drafts, setDraft, newTitle, setNewTitle, create, disabled, actions }: { task: TaskDetail; drafts: Record<string, string>; setDraft: (id: string, value: string) => void; newTitle: string; setNewTitle: (value: string) => void; create: () => void; disabled: boolean; actions: SubtaskActions }) {
  const completed = task.subtasks.filter((item) => item.is_completed).length
  return <section className="min-w-0 space-y-4"><div className="border-b border-white/10 pb-3"><h3 className="text-[0.68rem] uppercase text-on-surface-variant">Subtasks</h3><p className="text-xs text-on-surface-variant">{completed} of {task.subtasks.length} done</p></div><div className="divide-y divide-white/10 rounded-card bg-surface/35">{task.subtasks.length ? task.subtasks.map((item) => <SubtaskRow key={item.id} task={item} value={drafts[item.id] ?? item.title} setValue={(value) => setDraft(item.id, value)} actions={actions} />) : <p className="px-4 py-5 text-sm text-on-surface-variant">No subtasks yet.</p>}</div><div className="flex gap-2"><input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && newTitle.trim()) create() }} disabled={disabled} placeholder="Add a subtask..." className="min-w-0 flex-1 rounded-card bg-surface-dim px-3 py-3" /><button type="button" onClick={create} disabled={!newTitle.trim() || disabled} className="rounded-pill bg-primary px-4 py-2 text-surface">Add</button></div></section>
}

export function TaskDetailFooter({ task, title, busy, actionBusy, onComplete, onRestore, onSave }: { task: TaskDetail; title: string; busy: boolean; actionBusy: boolean; onComplete?: (task: TaskDetail) => void; onRestore?: (task: TaskDetail) => void; onSave: () => void }) {
  return <footer className="flex justify-end gap-3 border-t border-white/10 px-6 py-4">{task.status === 'open' && onComplete ? <button type="button" onClick={() => onComplete(task)} disabled={actionBusy} className="rounded-pill bg-success/20 px-4 py-2.5 text-success"><CheckCircle2 className="mr-2 inline h-4 w-4" />Complete</button> : null}{task.status === 'completed' && onRestore ? <button type="button" onClick={() => onRestore(task)} disabled={actionBusy} className="rounded-pill bg-surface-container-high px-4 py-2.5"><RotateCcw className="mr-2 inline h-4 w-4" />Restore</button> : null}<button type="button" onClick={onSave} disabled={busy || !title.trim()} className="rounded-pill bg-primary px-5 py-2.5 text-surface"><Save className="mr-2 inline h-4 w-4" />Save changes</button></footer>
}
