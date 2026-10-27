import { useEffect, useRef, useState } from 'react'

import type { TaskRecurrence } from '../lib/api'
import { recurrenceForDueDate } from '../lib/taskFormModel'
import { DatePicker } from './DatePicker'
import { SelectDropdown } from './SelectDropdown'
import { TaskRecurrenceFields } from './TaskRecurrenceFields'

type Group = { id: string; name: string }

const REMINDER_MODE_OPTIONS = [{ value: 'none', label: 'No reminder' }, { value: 'date', label: 'Date only' }, { value: 'datetime', label: 'Date and time' }]

type Props = {
  title: string
  description: string
  groupId: string
  dueDate: string
  reminderAt: string
  reminderDate?: string
  recurrence: TaskRecurrence | null
  groups: Group[]
  isGroupDropdownOpen: boolean
  disabled?: boolean
  onTitleChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onGroupIdChange: (value: string) => void
  onDueDateChange: (value: string) => void
  onReminderAtChange: (value: string) => void
  onReminderDateChange?: (value: string) => void
  onRecurrenceChange: (recurrence: TaskRecurrence | null) => void
  onGroupDropdownOpenChange: (isOpen: boolean) => void
}

export function TaskFormFields(props: Props) {
  const disabled = props.disabled ?? false
  function handleDueDateChange(dueDate: string) {
    props.onDueDateChange(dueDate)
    if (!dueDate) {
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
      <input value={title} onChange={(event) => onTitleChange(event.target.value)} className="w-full rounded-card bg-surface-container-high px-4 py-3 font-display text-[1.35rem] font-bold leading-tight text-on-surface outline-none ring-1 ring-inset ring-outline/50 placeholder:text-on-surface-variant/50 focus:ring-2 focus:ring-primary/60 sm:text-[1.6rem]" style={{ fontSize: '16px' }} aria-label="Task title" placeholder="Task title" disabled={disabled} />
      <textarea value={description} onChange={(event) => onDescriptionChange(event.target.value)} rows={3} className="w-full resize-none rounded-card bg-surface-container-high px-4 py-3 text-sm leading-6 text-on-surface outline-none ring-1 ring-inset ring-outline/50 placeholder:text-on-surface-variant/55 focus:ring-2 focus:ring-primary/60" style={{ fontSize: '16px' }} aria-label="Task description" placeholder="Add context that helps you act on this later" disabled={disabled} />
    </div>
  )
}

function TaskScheduleFields(props: Props & { disabled: boolean }) {
  const inferredReminderMode = props.reminderAt ? 'datetime' : props.reminderDate ? 'date' : 'none'
  const [reminderMode, setReminderModeState] = useState(inferredReminderMode)
  const isSelectingReminderMode = useRef(false)

  useEffect(() => {
    if (inferredReminderMode !== 'none') {
      isSelectingReminderMode.current = false
      setReminderModeState(inferredReminderMode)
    } else if (!isSelectingReminderMode.current) {
      setReminderModeState('none')
    }
  }, [inferredReminderMode])

  const setReminderMode = (mode: string) => {
    isSelectingReminderMode.current = mode !== 'none'
    setReminderModeState(mode)
    if (mode === 'none') { props.onReminderAtChange(''); props.onReminderDateChange?.('') }
    if (mode === 'date') props.onReminderAtChange('')
    if (mode === 'datetime') props.onReminderDateChange?.('')
  }
  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <ScheduleField label="Due date"><DatePicker value={props.dueDate || null} onChange={props.onDueDateChange} mode="date" disabled={props.disabled} placeholder="Select a date" /></ScheduleField>
      <ScheduleField label="Reminder">
        <SelectDropdown label="" options={REMINDER_MODE_OPTIONS} value={reminderMode} disabled={props.disabled} onChange={(value) => setReminderMode(String(value))} />
        {reminderMode === 'date' ? <div className="mt-2"><DatePicker value={props.reminderDate || null} onChange={(value) => { props.onReminderDateChange?.(value); if (!value) setReminderMode('none') }} mode="date" disabled={props.disabled} placeholder="Select a date" /></div> : null}
        {reminderMode === 'datetime' ? <div className="mt-2"><DatePicker value={props.reminderAt || null} onChange={(value) => { props.onReminderAtChange(value); if (!value) setReminderMode('none') }} mode="datetime" disabled={props.disabled} placeholder="Select date & time" /></div> : null}
        {reminderMode === 'date' ? <p className="mt-2 text-xs text-on-surface-variant/60">Notification time is set in Settings.</p> : null}
      </ScheduleField>
      <ScheduleField label="Group" isOpen={props.isGroupDropdownOpen}>
        <SelectDropdown label="" options={props.groups.map((group) => ({ value: group.id, label: group.name }))} value={props.groupId} onChange={(value) => props.onGroupIdChange(String(value))} onOpenChange={props.onGroupDropdownOpenChange} placeholder="No Group" disabled={props.disabled} />
      </ScheduleField>
      <ScheduleField label="Recurrence"><p className="py-1 text-base font-semibold text-on-surface">{formatRecurrence(props.recurrence)}</p></ScheduleField>
    </div>
  )
}

function ScheduleField({ label, children, isOpen = false }: { label: string; children: React.ReactNode; isOpen?: boolean }) {
  return <div className={['min-w-0 overflow-visible rounded-[1.1rem] bg-surface-dim/70 p-3 ring-1 ring-inset ring-outline/30 sm:p-4', isOpen ? 'relative z-40' : ''].join(' ')}><p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">{label}</p><div className="mt-3">{children}</div></div>
}

function formatRecurrence(recurrence: TaskRecurrence | null): string {
  return recurrence ? recurrence.frequency.charAt(0).toUpperCase() + recurrence.frequency.slice(1) : 'One-off'
}
