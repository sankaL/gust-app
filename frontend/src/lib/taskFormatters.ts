import type { TaskRecurrence } from './api'

export function formatDate(value: string | null | undefined): string {
  if (!value) return 'No due date'
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'No reminder'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'No reminder'
    : new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(date)
}

export function formatRecurrence(
  recurrence: TaskRecurrence | string | null | undefined
): string {
  if (!recurrence) return 'One-off'
  const frequency = typeof recurrence === 'string' ? recurrence : recurrence.frequency
  if (!frequency) return 'One-off'
  return frequency.charAt(0).toUpperCase() + frequency.slice(1)
}

function isoToNoonDate(isoDate: string) {
  return new Date(`${isoDate}T12:00:00`)
}

/** "Oct 28" */
export function formatShortDate(isoDate: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(isoToNoonDate(isoDate))
}

/** "Today", "Tomorrow", "Yesterday", or "Wed, Oct 28". */
export function formatRelativeDay(isoDate: string, todayIso: string): string {
  const dayMs = 86_400_000
  const difference = Math.round((isoToNoonDate(isoDate).getTime() - isoToNoonDate(todayIso).getTime()) / dayMs)
  if (difference === 0) return 'Today'
  if (difference === 1) return 'Tomorrow'
  if (difference === -1) return 'Yesterday'
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(isoToNoonDate(isoDate))
}

/** Header title in the reference style: "Oct 26, Mon". */
export function formatHeaderDate(isoDate: string): string {
  const date = isoToNoonDate(isoDate)
  const monthDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date)
  return `${monthDay}, ${weekday}`
}

/** Splits a reminder instant into the card's time column ("9:00" / "AM"). */
export function formatTimeParts(isoDateTime: string): { time: string; period: string } | null {
  const date = new Date(isoDateTime)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(date)
  const hour = parts.find((part) => part.type === 'hour')?.value ?? ''
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00'
  const period = parts.find((part) => part.type === 'dayPeriod')?.value ?? ''
  return { time: `${hour}:${minute}`, period: period.toUpperCase() }
}
