import { useEffect, useRef, useState } from 'react'

export const REMINDER_MODE_OPTIONS = [{ value: 'none', label: 'No reminder' }, { value: 'date', label: 'Date only' }, { value: 'datetime', label: 'Date and time' }]

type ReminderFields = {
  reminderAt: string
  reminderDate?: string
  onReminderAtChange: (value: string) => void
  onReminderDateChange?: (value: string) => void
}

/** Tracks the reminder kind (none, date only, date and time), keeping a just-picked kind while its date is still empty. */
export function useReminderMode({ reminderAt, reminderDate, onReminderAtChange, onReminderDateChange }: ReminderFields) {
  const inferredReminderMode = reminderAt ? 'datetime' : reminderDate ? 'date' : 'none'
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
    if (mode === 'none') { onReminderAtChange(''); onReminderDateChange?.('') }
    if (mode === 'date') onReminderAtChange('')
    if (mode === 'datetime') onReminderDateChange?.('')
  }
  return { reminderMode, setReminderMode }
}
