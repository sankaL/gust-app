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
