import { Bell, CalendarDays, Folder, Repeat2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { REMINDER_MODE_OPTIONS, useReminderMode } from '../hooks/useReminderMode'
import type { GroupSummary, TaskDetail, TaskRecurrence } from '../lib/api'
import { shiftReminderDateTimeLocal, shouldShiftReminderForDueDate } from '../lib/dateTime'
import { RECURRENCE_MONTHS, RECURRENCE_WEEKDAYS, recurrenceForDueDate, type TaskDetailDraft } from '../lib/taskFormModel'
import { DatePicker } from './DatePicker'
import { SelectDropdown } from './SelectDropdown'

type DraftUpdater = (updater: (draft: TaskDetailDraft) => TaskDetailDraft) => void

const FREQUENCY_OPTIONS = [
  { value: 'none', label: 'Never' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
]

/** Edit mode for the task preview sheet: the same notes block and property rows as read-only, with controls in place of values. */
export function TaskPreviewEditFields({ task, draft, groups, disabled, onChange }: { task: TaskDetail; draft: TaskDetailDraft; groups: GroupSummary[]; disabled: boolean; onChange: DraftUpdater }) {
  function changeDueDate(dueDate: string) {
    onChange((current) => {
      if (!dueDate) return { ...current, dueDate: '', reminderAt: '', reminderDate: '', recurrence: null }
      const shifted = shouldShiftReminderForDueDate(task.due_date, dueDate)
        ? { reminderAt: current.reminderAt ? shiftReminderDateTimeLocal(current.reminderAt, dueDate) : '', reminderDate: current.reminderDate ? dueDate : '' }
        : {}
      const frequency = current.recurrence?.frequency
      const recurrence = frequency && frequency !== 'daily' ? recurrenceForDueDate(frequency, dueDate) : current.recurrence
      return { ...current, ...shifted, dueDate, recurrence }
    })
  }

  return (
    <>
      <label className="block">
        <span className="text-xs font-medium text-on-surface-variant">Notes</span>
        <textarea
          value={draft.description}
          onChange={(event) => onChange((current) => ({ ...current, description: event.target.value }))}
          rows={3}
          disabled={disabled}
          aria-label="Task description"
          placeholder="Add notes"
          className="mt-1.5 block w-full resize-none border-l-2 border-outline/60 bg-transparent py-0 pl-3 text-base leading-6 text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/55 focus:border-primary"
        />
      </label>

      <div className="divide-y divide-outline/30">
        <EditRow label="Due date" icon={CalendarDays}>
          <DatePicker appearance="inline" value={draft.dueDate || null} onChange={changeDueDate} mode="date" disabled={disabled} placeholder="No due date" />
        </EditRow>
        <ReminderRow draft={draft} disabled={disabled} onChange={onChange} />
        <RepeatsRow draft={draft} disabled={disabled} onChange={onChange} />
        <EditRow label="Group" icon={Folder}>
          <SelectDropdown appearance="inline" label="" options={groups.map((group) => ({ value: group.id, label: group.name }))} value={draft.groupId} onChange={(value) => onChange((current) => ({ ...current, groupId: String(value) }))} placeholder="No group" disabled={disabled} />
        </EditRow>
      </div>
    </>
  )
}

function EditRow({ label, icon: Icon, children, details }: { label: string; icon: typeof CalendarDays; children: ReactNode; details?: ReactNode }) {
  return (
    <div className="py-1.5">
      <div className="flex min-h-[2.5rem] items-center gap-3">
        <Icon className="h-[1.1rem] w-[1.1rem] shrink-0 text-primary/75" strokeWidth={1.8} aria-hidden="true" />
        <span className="text-sm text-on-surface-variant">{label}</span>
        <div className="ml-auto min-w-0">{children}</div>
      </div>
      {details ? <div className="pb-1.5 pl-[1.85rem]">{details}</div> : null}
    </div>
  )
}

function DetailLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[2.25rem] items-center gap-3">
      <span className="text-xs text-on-surface-variant/80">{label}</span>
      <div className="ml-auto min-w-0">{children}</div>
    </div>
  )
}

function ReminderRow({ draft, disabled, onChange }: { draft: TaskDetailDraft; disabled: boolean; onChange: DraftUpdater }) {
  const { reminderMode, setReminderMode } = useReminderMode({
    reminderAt: draft.reminderAt,
    reminderDate: draft.reminderDate,
    onReminderAtChange: (reminderAt) => onChange((current) => ({ ...current, reminderAt })),
    onReminderDateChange: (reminderDate) => onChange((current) => ({ ...current, reminderDate })),
  })
  const details =
    reminderMode === 'date' ? (
      <>
        <DetailLine label="On">
          <DatePicker appearance="inline" value={draft.reminderDate || null} onChange={(value) => { onChange((current) => ({ ...current, reminderDate: value })); if (!value) setReminderMode('none') }} mode="date" disabled={disabled} placeholder="Pick a date" />
        </DetailLine>
        <p className="pb-1 text-xs text-on-surface-variant/60">Notification time is set in Settings.</p>
      </>
    ) : reminderMode === 'datetime' ? (
      <DetailLine label="At">
        <DatePicker appearance="inline" value={draft.reminderAt || null} onChange={(value) => { onChange((current) => ({ ...current, reminderAt: value })); if (!value) setReminderMode('none') }} mode="datetime" disabled={disabled} placeholder="Pick a date and time" />
      </DetailLine>
    ) : null

  return (
    <EditRow label="Reminder" icon={Bell} details={details}>
      <SelectDropdown appearance="inline" label="" options={REMINDER_MODE_OPTIONS} value={reminderMode} onChange={(value) => setReminderMode(String(value))} disabled={disabled} />
    </EditRow>
  )
}

function RepeatsRow({ draft, disabled, onChange }: { draft: TaskDetailDraft; disabled: boolean; onChange: DraftUpdater }) {
  const recurrence = draft.recurrence
  const setRecurrence = (next: TaskRecurrence | null) => onChange((current) => ({ ...current, recurrence: next }))
  const control = draft.dueDate ? (
    <SelectDropdown
      appearance="inline"
      label=""
      options={FREQUENCY_OPTIONS}
      value={recurrence?.frequency ?? 'none'}
      onChange={(value) => setRecurrence(value === 'none' ? null : recurrenceForDueDate(value as TaskRecurrence['frequency'], draft.dueDate))}
      disabled={disabled}
    />
  ) : (
    <span className="text-sm text-on-surface-variant/60">Needs a due date</span>
  )
  return (
    <EditRow label="Repeats" icon={Repeat2} details={recurrence ? <RecurrenceDetails recurrence={recurrence} disabled={disabled} onChange={setRecurrence} /> : null}>
      {control}
    </EditRow>
  )
}

function RecurrenceDetails({ recurrence, disabled, onChange }: { recurrence: TaskRecurrence; disabled: boolean; onChange: (recurrence: TaskRecurrence) => void }) {
  const dayInput = (
    <input
      type="number"
      min={1}
      max={31}
      value={recurrence.day_of_month ?? ''}
      onChange={(event) => onChange({ ...recurrence, day_of_month: event.target.value ? Number(event.target.value) : null })}
      disabled={disabled}
      aria-label="Day of month"
      placeholder="1-31"
      className="w-16 rounded-lg bg-transparent px-2 py-1.5 text-right text-base font-medium text-on-surface outline-none placeholder:text-on-surface-variant/55 focus-visible:ring-2 focus-visible:ring-primary/60"
    />
  )
  if (recurrence.frequency === 'weekly')
    return (
      <DetailLine label="On">
        <SelectDropdown appearance="inline" label="" options={RECURRENCE_WEEKDAYS.filter((option) => option.value !== '')} value={recurrence.weekday ?? ''} onChange={(value) => onChange({ frequency: 'weekly', weekday: Number(value), day_of_month: null, month: null })} placeholder="Pick a day" disabled={disabled} />
      </DetailLine>
    )
  if (recurrence.frequency === 'monthly') return <DetailLine label="Day of month">{dayInput}</DetailLine>
  if (recurrence.frequency === 'yearly')
    return (
      <>
        <DetailLine label="Month">
          <SelectDropdown appearance="inline" label="" options={RECURRENCE_MONTHS.filter((option) => option.value !== '')} value={recurrence.month ?? ''} onChange={(value) => onChange({ ...recurrence, month: Number(value) })} placeholder="Pick a month" disabled={disabled} />
        </DetailLine>
        <DetailLine label="Day">{dayInput}</DetailLine>
      </>
    )
  return null
}
