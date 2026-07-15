import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useFloatingDismiss } from '../hooks/useFloatingDismiss'

interface DatePickerProps {
  value: string | null
  onChange: (value: string) => void
  mode?: 'date' | 'datetime'
  disabled?: boolean
  placeholder?: string
  min?: string
  max?: string
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function parseDateValue(value: string): Date | null {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/
  )
  if (!match) {
    return null
  }

  const [, year, month, day, hours = '0', minutes = '0', seconds = '0'] = match
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds)
  )

  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day) ||
    date.getHours() !== Number(hours) ||
    date.getMinutes() !== Number(minutes) ||
    date.getSeconds() !== Number(seconds)
  ) {
    return null
  }

  return date
}

function isValidDate(date: Date): boolean {
  return !Number.isNaN(date.getTime())
}

function cloneDate(date: Date): Date {
  return new Date(date.getTime())
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function eachDayOfInterval({ start, end }: { start: Date; end: Date }): Date[] {
  const days: Date[] = []
  const current = startOfDay(start)

  while (current.getTime() <= end.getTime()) {
    days.push(cloneDate(current))
    current.setDate(current.getDate() + 1)
  }

  return days
}

function getDay(date: Date): number {
  return date.getDay()
}

function getYear(date: Date): number {
  return date.getFullYear()
}

function getMonth(date: Date): number {
  return date.getMonth()
}

function clampDayToMonth(date: Date, year: number, month: number): number {
  return Math.min(date.getDate(), new Date(year, month + 1, 0).getDate())
}

function shiftMonth(date: Date, amount: number): Date {
  const targetMonthIndex = date.getMonth() + amount
  const targetYear = date.getFullYear() + Math.floor(targetMonthIndex / 12)
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12
  const day = clampDayToMonth(date, targetYear, normalizedMonth)

  return new Date(
    targetYear,
    normalizedMonth,
    day,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds()
  )
}

function addMonths(date: Date, amount: number): Date {
  return shiftMonth(date, amount)
}

function subMonths(date: Date, amount: number): Date {
  return addMonths(date, -amount)
}

function setYear(date: Date, year: number): Date {
  const next = cloneDate(date)
  next.setFullYear(year)
  return next
}

function setMonth(date: Date, month: number): Date {
  const year = date.getFullYear()
  const day = clampDayToMonth(date, year, month)
  return new Date(
    year,
    month,
    day,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds()
  )
}

function setHours(date: Date, hours: number): Date {
  const next = cloneDate(date)
  next.setHours(hours)
  return next
}

function setMinutes(date: Date, minutes: number): Date {
  const next = cloneDate(date)
  next.setMinutes(minutes)
  return next
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function formatDateToken(
  date: Date,
  token: 'yyyy-MM-dd' | "yyyy-MM-dd'T'HH:mm" | 'HH:mm' | 'MMM d, yyyy' | 'MMM d, yyyy h:mm a' | 'd'
): string {
  if (token === 'yyyy-MM-dd') {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  }
  if (token === "yyyy-MM-dd'T'HH:mm") {
    return `${formatDateToken(date, 'yyyy-MM-dd')}T${formatDateToken(date, 'HH:mm')}`
  }
  if (token === 'HH:mm') {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  }
  if (token === 'd') {
    return String(date.getDate())
  }

  const month = MONTHS[date.getMonth()].slice(0, 3)
  const day = date.getDate()
  const year = date.getFullYear()

  if (token === 'MMM d, yyyy') {
    return `${month} ${day}, ${year}`
  }

  const hours24 = date.getHours()
  const minutes = pad2(date.getMinutes())
  const suffix = hours24 >= 12 ? 'PM' : 'AM'
  const hours12 = hours24 % 12 || 12
  return `${month} ${day}, ${year} ${hours12}:${minutes} ${suffix}`
}

function toDateValue(value: string | null): Date | null {
  if (!value) return null
  const date = parseDateValue(value)
  return date && isValidDate(date) ? date : null
}

function formatDateForInput(date: Date, mode: 'date' | 'datetime'): string {
  if (mode === 'datetime') {
    return formatDateToken(date, "yyyy-MM-dd'T'HH:mm")
  }
  return formatDateToken(date, 'yyyy-MM-dd')
}

function formatDateForDisplay(date: Date, mode: 'date' | 'datetime'): string {
  if (mode === 'datetime') {
    return formatDateToken(date, 'MMM d, yyyy h:mm a')
  }
  return formatDateToken(date, 'MMM d, yyyy')
}

function useDatePickerValue(value: string | null, setSelectedDate: (date: Date | null) => void, setViewDate: (date: Date) => void, setSelectedTime: (time: string) => void) {
  useEffect(() => {
    const date = toDateValue(value)
    setSelectedDate(date)
    if (!date) return
    setViewDate(date)
    setSelectedTime(formatDateToken(date, 'HH:mm'))
  }, [setSelectedDate, setSelectedTime, setViewDate, value])
}

function useDatePickerViewport(isOpen: boolean, updatePosition: () => void, close: () => void) {
  useEffect(() => {
    if (!isOpen) return undefined
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', close, true)
    return () => { window.removeEventListener('resize', updatePosition); window.removeEventListener('scroll', close, true) }
  }, [close, isOpen, updatePosition])
}

function calendarPosition(rect: DOMRect, mode: DatePickerProps['mode']) {
  const padding = 16
  const width = Math.min(Math.max(rect.width, 280), window.innerWidth - padding * 2)
  const height = mode === 'datetime' ? 420 : 380
  const left = Math.max(padding, Math.min(rect.left, window.innerWidth - width - padding))
  const below = rect.bottom + 8
  const above = rect.top - height - 8
  const overflows = below + height > window.innerHeight - padding
  const top = overflows ? (above >= padding ? above : Math.max(padding, window.innerHeight - height - padding)) : below
  return { top, left, width }
}

function useDatePickerState(value: string | null) {
  const date = toDateValue(value)
  const [isOpen, setIsOpen] = useState(false)
  const [viewDate, setViewDate] = useState(() => date || new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(() => date)
  const [selectedTime, setSelectedTime] = useState(() => date ? formatDateToken(date, 'HH:mm') : '12:00')
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const calendarRef = useRef<HTMLDivElement>(null)
  return { isOpen, setIsOpen, viewDate, setViewDate, selectedDate, setSelectedDate, selectedTime, setSelectedTime, position, setPosition, triggerRef, calendarRef }
}

export function DatePicker(props: DatePickerProps) {
  return <DatePickerView {...useDatePickerViewProps(props)} />
}

function useDatePickerViewProps({
  value,
  onChange,
  mode = 'date',
  disabled = false,
  placeholder = mode === 'datetime' ? 'Select date & time' : 'Select date',
  min,
  max,
}: DatePickerProps): DatePickerViewProps {
  const { isOpen, setIsOpen, viewDate, setViewDate, selectedDate, setSelectedDate, selectedTime, setSelectedTime, position, setPosition, triggerRef, calendarRef } = useDatePickerState(value)
  const closeCalendar = useCallback(() => setIsOpen(false), [setIsOpen])
  useDatePickerValue(value, setSelectedDate, setViewDate, setSelectedTime)

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPosition(calendarPosition(rect, mode))
  }, [mode, setPosition, triggerRef])

  useFloatingDismiss(isOpen, calendarRef, triggerRef, closeCalendar, updatePosition)
  useDatePickerViewport(isOpen, updatePosition, closeCalendar)

  const handleDateSelect = (date: Date) => {
    let finalDate = date

    if (mode === 'datetime' && selectedTime) {
      const [hours, minutes] = selectedTime.split(':').map(Number)
      finalDate = setHours(setMinutes(date, minutes), hours)
    }

    setSelectedDate(finalDate)
    onChange(formatDateForInput(finalDate, mode))

    if (mode === 'date') {
      setIsOpen(false)
    }
  }

  const handleTimeChange = (timeValue: string) => {
    setSelectedTime(timeValue)
    if (selectedDate) {
      const [hours, minutes] = timeValue.split(':').map(Number)
      const finalDate = setHours(setMinutes(selectedDate, minutes), hours)
      setSelectedDate(finalDate)
      onChange(formatDateForInput(finalDate, mode))
    }
  }

  const handlePrevMonth = () => {
    setViewDate(subMonths(viewDate, 1))
  }

  const handleNextMonth = () => {
    setViewDate(addMonths(viewDate, 1))
  }

  const handleYearChange = (year: number) => {
    setViewDate(setYear(viewDate, year))
  }

  const handleMonthChange = (monthIndex: number) => {
    setViewDate(setMonth(viewDate, monthIndex))
  }

  const monthStart = startOfMonth(viewDate)
  const monthEnd = endOfMonth(viewDate)
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd })
  const startDay = getDay(monthStart)

  const currentYear = getYear(new Date())
  const yearOptions = Array.from({ length: 21 }, (_, i) => currentYear - 10 + i)

  const displayValue = selectedDate
    ? formatDateForDisplay(selectedDate, mode)
    : placeholder

  const calendarDropdown = isOpen ? <DatePickerCalendar calendarRef={calendarRef} position={position} viewDate={viewDate} selectedDate={selectedDate} selectedTime={selectedTime} mode={mode} days={days} startDay={startDay} yearOptions={yearOptions} min={min} max={max} onPrevious={handlePrevMonth} onNext={handleNextMonth} onMonth={handleMonthChange} onYear={handleYearChange} onDate={handleDateSelect} onTime={handleTimeChange} onToday={() => { const today = new Date(); handleDateSelect(today); setViewDate(today) }} onClear={() => { setSelectedDate(null); onChange(''); setIsOpen(false) }} onDone={() => setIsOpen(false)} /> : null

  return { triggerRef, disabled, selected: Boolean(selectedDate), displayValue, isOpen, calendarDropdown, onToggle: () => { if (!disabled) { updatePosition(); setIsOpen((current) => !current) } } }
}

type DatePickerViewProps = { triggerRef: React.RefObject<HTMLButtonElement | null>; disabled: boolean; selected: boolean; displayValue: string; isOpen: boolean; calendarDropdown: React.ReactNode; onToggle: () => void }

function DatePickerView({ triggerRef, disabled, selected, displayValue, isOpen, calendarDropdown, onToggle }: DatePickerViewProps) {
  const stateClass = disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-surface-container-highest focus:ring-1 focus:ring-primary'
  return <div className="relative"><button ref={triggerRef} type="button" onClick={onToggle} disabled={disabled} className={`flex w-full items-center justify-between rounded-card bg-surface-dim px-3 py-3 text-left text-sm font-medium outline-none transition-all ${stateClass}`}><span className={selected ? 'text-on-surface' : 'text-on-surface-variant/40'}>{displayValue}</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`text-on-surface-variant transition-transform ${isOpen ? 'rotate-180' : ''}`}><path d="M8 9l4 4 4-4" /></svg></button>{calendarDropdown && typeof document !== 'undefined' ? createPortal(calendarDropdown, document.body) : null}</div>
}

type CalendarProps = { calendarRef: React.RefObject<HTMLDivElement | null>; position: { top: number; left: number; width: number }; viewDate: Date; selectedDate: Date | null; selectedTime: string; mode: 'date' | 'datetime'; days: Date[]; startDay: number; yearOptions: number[]; min?: string; max?: string; onPrevious: () => void; onNext: () => void; onMonth: (month: number) => void; onYear: (year: number) => void; onDate: (date: Date) => void; onTime: (time: string) => void; onToday: () => void; onClear: () => void; onDone: () => void }

function DatePickerCalendar(props: CalendarProps) {
  return <div ref={props.calendarRef} className="fixed z-[140] overflow-hidden rounded-card shadow-[0_24px_60px_rgba(0,0,0,0.6)]" style={{ ...props.position, maxHeight: 'calc(100vh - 2rem)' }}><div className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-[linear-gradient(180deg,_rgb(38,38,38)_0%,_rgb(26,26,26)_100%)] p-4"><CalendarHeader viewDate={props.viewDate} yearOptions={props.yearOptions} onPrevious={props.onPrevious} onNext={props.onNext} onMonth={props.onMonth} onYear={props.onYear} /><CalendarGrid days={props.days} startDay={props.startDay} selectedDate={props.selectedDate} min={props.min} max={props.max} onDate={props.onDate} />{props.mode === 'datetime' ? <TimeField value={props.selectedTime} onChange={props.onTime} /> : null}<CalendarActions mode={props.mode} onToday={props.onToday} onClear={props.onClear} onDone={props.onDone} /></div></div>
}

type CalendarHeaderProps = { viewDate: Date; yearOptions: number[]; onPrevious: () => void; onNext: () => void; onMonth: (month: number) => void; onYear: (year: number) => void }
function CalendarHeader(props: CalendarHeaderProps) {
  return <div className="mb-4 flex items-center justify-between"><NavButton direction="previous" onClick={props.onPrevious} /><div className="flex min-w-0 flex-1 items-center gap-2 px-2"><select value={getMonth(props.viewDate)} onChange={(event) => props.onMonth(Number(event.target.value))} className="min-w-0 flex-1 rounded-lg bg-surface-container-high px-2 py-1 text-sm text-on-surface">{MONTHS.map((month, index) => <option key={month} value={index}>{month}</option>)}</select><select value={getYear(props.viewDate)} onChange={(event) => props.onYear(Number(event.target.value))} className="min-w-0 flex-1 rounded-lg bg-surface-container-high px-2 py-1 text-sm text-on-surface">{props.yearOptions.map((year) => <option key={year}>{year}</option>)}</select></div><NavButton direction="next" onClick={props.onNext} /></div>
}

function NavButton({ direction, onClick }: { direction: 'previous' | 'next'; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="rounded-lg p-1 text-on-surface-variant hover:bg-surface-container-high" aria-label={`${direction} month`}><span aria-hidden="true">{direction === 'previous' ? '‹' : '›'}</span></button>
}

type CalendarGridProps = { days: Date[]; startDay: number; selectedDate: Date | null; min?: string; max?: string; onDate: (date: Date) => void }
function CalendarGrid(props: CalendarGridProps) {
  return <><div className="mb-2 grid grid-cols-7 gap-1">{WEEKDAYS.map((day) => <div key={day} className="py-1 text-center text-xs font-medium text-on-surface-variant">{day}</div>)}</div><div className="grid grid-cols-7 gap-1">{Array.from({ length: props.startDay }).map((_, index) => <div key={`empty-${index}`} className="h-9" />)}{props.days.map((day) => <DayButton key={day.toISOString()} day={day} selectedDate={props.selectedDate} min={props.min} max={props.max} onSelect={props.onDate} />)}</div></>
}

function DayButton({ day, selectedDate, min, max, onSelect }: { day: Date; selectedDate: Date | null; min?: string; max?: string; onSelect: (date: Date) => void }) {
  const token = formatDateToken(day, 'yyyy-MM-dd')
  const selected = selectedDate ? token === formatDateToken(selectedDate, 'yyyy-MM-dd') : false
  const today = token === formatDateToken(new Date(), 'yyyy-MM-dd')
  const disabled = Boolean((min && token < min) || (max && token > max))
  const color = selected ? 'bg-primary text-surface' : today ? 'border border-primary/30 bg-surface-container-high text-primary' : 'text-on-surface hover:bg-surface-container-high'
  return <button type="button" onClick={() => onSelect(day)} disabled={disabled} className={`flex h-9 w-full items-center justify-center rounded-lg text-sm font-medium transition-all ${color} ${disabled ? 'cursor-not-allowed opacity-30' : 'cursor-pointer'}`}>{formatDateToken(day, 'd')}</button>
}

function TimeField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div className="mt-4 border-t border-outline/20 pt-4"><label className="mb-2 block text-xs font-medium text-on-surface-variant">Time</label><input type="time" value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-card bg-surface-dim px-3 py-2 text-sm text-on-surface" style={{ fontSize: '16px' }} /></div>
}

type CalendarActionsProps = { mode: 'date' | 'datetime'; onToday: () => void; onClear: () => void; onDone: () => void }
function CalendarActions(props: CalendarActionsProps) {
  return <div className="mt-4 flex gap-2 border-t border-outline/20 pt-4"><CalendarAction onClick={props.onToday}>Today</CalendarAction><CalendarAction onClick={props.onClear}>Clear</CalendarAction>{props.mode === 'datetime' ? <CalendarAction onClick={props.onDone} primary>Done</CalendarAction> : null}</div>
}

function CalendarAction({ children, onClick, primary = false }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return <button type="button" onClick={onClick} className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${primary ? 'bg-primary text-surface' : 'bg-surface-container-high text-on-surface-variant'}`}>{children}</button>
}
