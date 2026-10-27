import type { TaskRecurrence } from '../lib/api'
import { RECURRENCE_MONTHS, RECURRENCE_WEEKDAYS, recurrenceForDueDate } from '../lib/taskFormModel'
import { SelectDropdown } from './SelectDropdown'

const FREQUENCIES = ['none', 'daily', 'weekly', 'monthly', 'yearly'] as const

function recurrenceForFrequency(frequency: typeof FREQUENCIES[number], dueDate: string): TaskRecurrence | null {
  if (frequency === 'none') return null
  return recurrenceForDueDate(frequency, dueDate)
}

type Props = {
  dueDate: string
  recurrence: TaskRecurrence | null
  disabled: boolean
  onChange: (recurrence: TaskRecurrence | null) => void
}

export function TaskRecurrenceFields({ dueDate, recurrence, disabled, onChange }: Props) {
  const frequency = recurrence?.frequency ?? 'none'
  return (
    <div className="rounded-[1.1rem] bg-surface-dim/70 p-4 ring-1 ring-inset ring-outline/30">
      <p className="font-display text-lg font-bold text-on-surface">Recurrence</p>
      <p className="mt-1 font-body text-xs text-on-surface-variant">Daily, weekly, monthly, and yearly only. Clearing the due date also clears reminder timing and recurrence.</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {FREQUENCIES.map((option) => <FrequencyButton key={option} value={option} selected={frequency === option} disabled={!dueDate || disabled} onSelect={() => onChange(recurrenceForFrequency(option, dueDate))} />)}
      </div>
      <RecurrenceDetails recurrence={recurrence} disabled={disabled} onChange={onChange} />
    </div>
  )
}

function FrequencyButton({ value, selected, disabled, onSelect }: { value: string; selected: boolean; disabled: boolean; onSelect: () => void }) {
  return <button type="button" disabled={disabled} onClick={onSelect} className={['rounded-pill px-3 py-2.5 text-sm font-semibold capitalize transition-all duration-200 active:scale-95', selected ? 'bg-primary text-on-primary shadow-card' : 'bg-surface-container-high text-on-surface-variant ring-1 ring-inset ring-outline/50 hover:text-on-surface', disabled ? 'opacity-50' : ''].join(' ')}>{value === 'none' ? 'None' : value}</button>
}

function RecurrenceDetails({ recurrence, disabled, onChange }: Omit<Props, 'dueDate'>) {
  if (recurrence?.frequency === 'weekly') return <WeeklyFields recurrence={recurrence} disabled={disabled} onChange={onChange} />
  if (recurrence?.frequency === 'monthly') return <DayField value={recurrence.day_of_month} disabled={disabled} onChange={(day) => onChange({ ...recurrence, day_of_month: day })} />
  if (recurrence?.frequency === 'yearly') return <YearlyFields recurrence={recurrence} disabled={disabled} onChange={onChange} />
  return null
}

function Field({ label, children, contained = true }: { label: string; children: React.ReactNode; contained?: boolean }) {
  return <div className={contained ? 'mt-3 overflow-visible rounded-card bg-surface-container-high/70 p-3 sm:p-4' : ''}><p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">{label}</p><div className="mt-3">{children}</div></div>
}

function WeeklyFields({ recurrence, disabled, onChange }: { recurrence: TaskRecurrence; disabled: boolean; onChange: (value: TaskRecurrence) => void }) {
  return <Field label="Day of Week"><SelectDropdown label="" options={RECURRENCE_WEEKDAYS} value={recurrence.weekday ?? ''} onChange={(value) => onChange({ frequency: 'weekly', weekday: value === '' ? null : Number(value), day_of_month: null, month: null })} placeholder="Select a day" disabled={disabled} /></Field>
}

function DayField({ value, disabled, onChange, contained = true }: { value: number | null; disabled: boolean; onChange: (value: number | null) => void; contained?: boolean }) {
  return <Field label="Day of Month" contained={contained}><input type="number" min={1} max={31} value={value ?? ''} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)} className="block w-full rounded-card bg-surface-container-high px-3 py-3 text-sm font-medium text-on-surface outline-none ring-1 ring-inset ring-outline/50 focus:ring-2 focus:ring-primary/60" style={{ fontSize: '16px' }} placeholder="1-31" disabled={disabled} /></Field>
}

function YearlyFields({ recurrence, disabled, onChange }: { recurrence: TaskRecurrence; disabled: boolean; onChange: (value: TaskRecurrence) => void }) {
  return <div className="mt-3 space-y-4 rounded-card bg-surface-container-high/70 p-3 sm:p-4"><Field label="Month" contained={false}><SelectDropdown label="" options={RECURRENCE_MONTHS} value={recurrence.month ?? ''} onChange={(value) => onChange({ ...recurrence, month: value === '' ? null : Number(value) })} placeholder="Select a month" disabled={disabled} /></Field><DayField value={recurrence.day_of_month} disabled={disabled} contained={false} onChange={(day) => onChange({ ...recurrence, day_of_month: day })} /></div>
}
