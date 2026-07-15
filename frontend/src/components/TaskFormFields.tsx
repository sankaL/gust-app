import type { TaskRecurrence } from '../lib/api'
import { recurrenceForDueDate } from '../lib/taskFormModel'
import { DatePicker } from './DatePicker'
import { SelectDropdown } from './SelectDropdown'
import { TaskRecurrenceFields } from './TaskRecurrenceFields'

type Group = { id: string; name: string }

type Props = {
  title: string
  description: string
  groupId: string
  dueDate: string
  reminderAt: string
  recurrence: TaskRecurrence | null
  groups: Group[]
  isGroupDropdownOpen: boolean
  disabled?: boolean
  onTitleChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onGroupIdChange: (value: string) => void
  onDueDateChange: (value: string) => void
  onReminderAtChange: (value: string) => void
  onRecurrenceChange: (recurrence: TaskRecurrence | null) => void
  onGroupDropdownOpenChange: (isOpen: boolean) => void
}

export function TaskFormFields(props: Props) {
  const disabled = props.disabled ?? false
  function handleDueDateChange(dueDate: string) {
    props.onDueDateChange(dueDate)
    if (!dueDate) {
      props.onReminderAtChange('')
      props.onRecurrenceChange(null)
      return
    }
    const frequency = props.recurrence?.frequency
    if (frequency && frequency !== 'daily') props.onRecurrenceChange(recurrenceForDueDate(frequency, dueDate))
  }
  return (
    <div className="space-y-5">
      <TaskIdentityFields {...props} disabled={disabled} />
      <TaskScheduleFields {...props} disabled={disabled} onDueDateChange={handleDueDateChange} />
      <TaskRecurrenceFields dueDate={props.dueDate} recurrence={props.recurrence} disabled={disabled} onChange={props.onRecurrenceChange} />
    </div>
  )
}

function TaskIdentityFields({ title, description, disabled, onTitleChange, onDescriptionChange }: Props & { disabled: boolean }) {
  return (
    <div className="space-y-3">
      <input value={title} onChange={(event) => onTitleChange(event.target.value)} className="w-full rounded-[1.25rem] bg-surface/60 px-4 py-3 font-display text-[1.5rem] leading-tight text-on-surface outline-none placeholder:text-on-surface-variant/40 focus:bg-surface/75 focus:text-white sm:text-[1.85rem]" style={{ fontSize: '16px' }} aria-label="Task title" placeholder="Task title" disabled={disabled} />
      <textarea value={description} onChange={(event) => onDescriptionChange(event.target.value)} rows={3} className="w-full resize-none rounded-[1.25rem] bg-surface/55 px-4 py-3 text-sm leading-6 text-on-surface-variant outline-none placeholder:text-on-surface-variant/45 focus:bg-surface/70 focus:text-on-surface" style={{ fontSize: '16px' }} aria-label="Task description" placeholder="Add context that helps you act on this later" disabled={disabled} />
    </div>
  )
}

function TaskScheduleFields(props: Props & { disabled: boolean }) {
  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <ScheduleField label="Due date"><DatePicker value={props.dueDate || null} onChange={props.onDueDateChange} mode="date" disabled={props.disabled} placeholder="Select a date" /></ScheduleField>
      <ScheduleField label="Reminder">
        <DatePicker value={props.reminderAt || null} onChange={props.onReminderAtChange} mode="datetime" disabled={!props.dueDate || props.disabled} placeholder="Select date & time" />
        {!props.dueDate ? <p className="mt-2 text-xs text-on-surface-variant/60">Set a due date first</p> : null}
      </ScheduleField>
      <ScheduleField label="Group" isOpen={props.isGroupDropdownOpen}>
        <SelectDropdown label="" options={props.groups.map((group) => ({ value: group.id, label: group.name }))} value={props.groupId} onChange={(value) => props.onGroupIdChange(String(value))} onOpenChange={props.onGroupDropdownOpenChange} placeholder="No Group" disabled={props.disabled} />
      </ScheduleField>
      <ScheduleField label="Recurrence"><p className="text-base font-medium text-on-surface">{formatRecurrence(props.recurrence)}</p></ScheduleField>
    </div>
  )
}

function ScheduleField({ label, children, isOpen = false }: { label: string; children: React.ReactNode; isOpen?: boolean }) {
  return <div className={['min-w-0 overflow-visible rounded-[1.35rem] bg-black/20 p-3 backdrop-blur-sm sm:p-4', isOpen ? 'relative z-40' : ''].join(' ')}><p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">{label}</p><div className="mt-3">{children}</div></div>
}

function formatRecurrence(recurrence: TaskRecurrence | null): string {
  return recurrence ? recurrence.frequency.charAt(0).toUpperCase() + recurrence.frequency.slice(1) : 'One-off'
}
