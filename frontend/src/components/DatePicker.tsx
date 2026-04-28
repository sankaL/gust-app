import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

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

export function DatePicker({
  value,
  onChange,
  mode = 'date',
  disabled = false,
  placeholder = mode === 'datetime' ? 'Select date & time' : 'Select date',
  min,
  max,
}: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [viewDate, setViewDate] = useState(() => toDateValue(value) || new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(() => toDateValue(value))
  const [selectedTime, setSelectedTime] = useState(() => {
    const date = toDateValue(value)
    return date ? formatDateToken(date, 'HH:mm') : '12:00'
  })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const calendarRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 })

  useEffect(() => {
    const date = toDateValue(value)
    setSelectedDate(date)
    if (date) {
      setViewDate(date)
      setSelectedTime(formatDateToken(date, 'HH:mm'))
    }
  }, [value])

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return

    const rect = triggerRef.current.getBoundingClientRect()
    const viewportPadding = 16
    const availableWidth = window.innerWidth - viewportPadding * 2
    const calendarWidth = Math.min(Math.max(rect.width, 280), availableWidth)
    const calendarHeight = mode === 'datetime' ? 420 : 380

    let left = rect.left
    if (left + calendarWidth > window.innerWidth - viewportPadding) {
      left = window.innerWidth - calendarWidth - viewportPadding
    }
    left = Math.max(viewportPadding, left)

    let top = rect.bottom + 8
    const topAboveTrigger = rect.top - calendarHeight - 8
    const canOpenAbove = topAboveTrigger >= viewportPadding
    const overflowsBelow = top + calendarHeight > window.innerHeight - viewportPadding
    if (overflowsBelow && canOpenAbove) {
      top = topAboveTrigger
    } else if (overflowsBelow) {
      top = Math.max(viewportPadding, window.innerHeight - calendarHeight - viewportPadding)
    }

    setPosition({
      top,
      left,
      width: calendarWidth,
    })
  }, [mode])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node
      if (
        calendarRef.current &&
        !calendarRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      updatePosition()
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, updatePosition])

  useEffect(() => {
    function handleResize() {
      if (isOpen) {
        updatePosition()
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [isOpen, updatePosition])

  useEffect(() => {
    function handleScroll() {
      if (isOpen) {
        setIsOpen(false)
      }
    }

    window.addEventListener('scroll', handleScroll, true)
    return () => window.removeEventListener('scroll', handleScroll, true)
  }, [isOpen])

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

  const calendarDropdown = isOpen ? (
    <div
      ref={calendarRef}
      className="fixed z-[140] overflow-hidden rounded-card shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
      style={{
        top: position.top,
        left: position.left,
        width: position.width,
        maxHeight: 'calc(100vh - 2rem)',
      }}
    >
      <div className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-[linear-gradient(180deg,_rgb(38,38,38)_0%,_rgb(26,26,26)_100%)] p-4">
        <div className="mb-4 flex items-center justify-between">
          <button
            type="button"
            onClick={handlePrevMonth}
            className="rounded-lg p-1 text-on-surface-variant transition-colors hover:bg-surface-container-high"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>

          <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
            <select
              value={getMonth(viewDate)}
              onChange={(e) => handleMonthChange(Number(e.target.value))}
              className="min-w-0 flex-1 cursor-pointer rounded-lg bg-surface-container-high px-2 py-1 text-sm text-on-surface outline-none focus:ring-1 focus:ring-primary"
            >
              {MONTHS.map((month, index) => (
                <option key={month} value={index}>{month}</option>
              ))}
            </select>

            <select
              value={getYear(viewDate)}
              onChange={(e) => handleYearChange(Number(e.target.value))}
              className="min-w-0 flex-1 cursor-pointer rounded-lg bg-surface-container-high px-2 py-1 text-sm text-on-surface outline-none focus:ring-1 focus:ring-primary"
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handleNextMonth}
            className="rounded-lg p-1 text-on-surface-variant transition-colors hover:bg-surface-container-high"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>

        <div className="mb-2 grid grid-cols-7 gap-1">
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="py-1 text-center text-xs font-medium text-on-surface-variant"
            >
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: startDay }).map((_, index) => (
            <div key={`empty-${index}`} className="h-9" />
          ))}

          {days.map((day) => {
            const isSelected =
              selectedDate &&
              formatDateToken(day, 'yyyy-MM-dd') === formatDateToken(selectedDate, 'yyyy-MM-dd')
            const isToday =
              formatDateToken(day, 'yyyy-MM-dd') === formatDateToken(new Date(), 'yyyy-MM-dd')
            const dayString = formatDateToken(day, 'yyyy-MM-dd')
            const isDisabled = Boolean((min && dayString < min) || (max && dayString > max))

            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => !isDisabled && handleDateSelect(day)}
                disabled={isDisabled}
                className={`
                  flex h-9 w-full items-center justify-center rounded-lg text-sm font-medium transition-all
                  ${isSelected
                    ? 'bg-primary text-surface'
                    : isToday
                      ? 'border border-primary/30 bg-surface-container-high text-primary'
                      : 'text-on-surface hover:bg-surface-container-high'
                  }
                  ${isDisabled ? 'cursor-not-allowed opacity-30' : 'cursor-pointer'}
                `}
              >
                {formatDateToken(day, 'd')}
              </button>
            )
          })}
        </div>

        {mode === 'datetime' && (
          <div className="mt-4 border-t border-outline/20 pt-4">
            <label className="mb-2 block text-xs font-medium text-on-surface-variant">
              Time
            </label>
            <input
              type="time"
              value={selectedTime}
              onChange={(e) => handleTimeChange(e.target.value)}
              className="w-full rounded-card bg-surface-dim px-3 py-2 text-sm text-on-surface outline-none focus:bg-surface-container-high"
              style={{ fontSize: '16px' }}
            />
          </div>
        )}

        <div className="mt-4 flex gap-2 border-t border-outline/20 pt-4">
          <button
            type="button"
            onClick={() => {
              const today = new Date()
              handleDateSelect(today)
              setViewDate(today)
            }}
            className="flex-1 rounded-lg bg-surface-container-high px-3 py-2 text-sm font-medium text-on-surface transition-colors hover:bg-surface-container-highest"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedDate(null)
              onChange('')
              setIsOpen(false)
            }}
            className="flex-1 rounded-lg bg-surface-container-high px-3 py-2 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-highest"
          >
            Clear
          </button>
          {mode === 'datetime' && (
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-surface transition-colors hover:bg-primary-dim"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  ) : null

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (!disabled) {
            updatePosition()
            setIsOpen((current) => !current)
          }
        }}
        disabled={disabled}
        className={`
          w-full flex items-center justify-between px-3 py-3 rounded-card transition-all
          bg-surface-dim text-left outline-none text-sm font-medium
          ${disabled
            ? 'cursor-not-allowed opacity-50'
            : 'cursor-pointer hover:bg-surface-container-highest focus:ring-1 focus:ring-primary'
          }
        `}
      >
        <span className={selectedDate ? 'text-on-surface' : 'text-on-surface-variant/40'}>
          {displayValue}
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`text-on-surface-variant transition-transform ${isOpen ? 'rotate-180' : ''}`}
        >
          <path d="M8 9l4 4 4-4" />
        </svg>
      </button>

      {calendarDropdown && typeof document !== 'undefined'
        ? createPortal(calendarDropdown, document.body)
        : null}
    </div>
  )
}
