import { addDaysIso } from '../../lib/desktopData'

const DAYS_BEFORE_TODAY = 1
const DAYS_SHOWN = 7

function dayParts(isoDate: string) {
  const date = new Date(`${isoDate}T12:00:00`)
  return {
    weekday: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date).toUpperCase(),
    day: date.getDate(),
    fullLabel: new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(date),
  }
}

/**
 * Seven-day agenda strip in the reference style. Today is the resting selection and shows the
 * full agenda; picking another day narrows the list to tasks due that day.
 */
export function WeekStrip({ todayIso, selectedIso, dueCounts, onSelect }: {
  todayIso: string
  selectedIso: string
  dueCounts: Record<string, number>
  onSelect: (isoDate: string) => void
}) {
  const days = Array.from({ length: DAYS_SHOWN }, (_, index) => addDaysIso(todayIso, index - DAYS_BEFORE_TODAY))
  return (
    <div role="tablist" aria-label="Pick a day" className="-mx-1 grid grid-cols-7 gap-0.5 py-2">
      {days.map((iso, index) => {
        const { weekday, day, fullLabel } = dayParts(iso)
        const selected = iso === selectedIso
        const isToday = iso === todayIso
        const count = dueCounts[iso] ?? 0
        return (
          <button
            key={iso}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={`${isToday ? 'Today, ' : ''}${fullLabel}${count ? `, ${count} ${count === 1 ? 'task' : 'tasks'} due` : ''}`}
            onClick={() => onSelect(iso)}
            className="animate-rise-in group flex flex-col items-center gap-2 rounded-2xl py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            style={{ ['--stagger' as string]: index }}
          >
            <span className={`font-body text-[0.68rem] font-semibold tracking-[0.06em] transition-colors duration-300 ${selected ? 'text-on-surface dark:text-primary' : isToday ? 'text-primary' : 'text-on-surface-variant'}`}>
              {weekday}
            </span>
            <span
              className={`relative flex h-11 w-11 items-center justify-center rounded-full font-display text-[1.05rem] font-bold tabular-nums transition-all duration-300 ease-out-expo group-active:scale-90 ${selected
                ? 'scale-105 text-on-surface ring-2 ring-on-surface dark:bg-primary dark:text-on-primary dark:shadow-[0_8px_22px_-6px_rgb(var(--color-primary))] dark:ring-0'
                : 'text-on-surface/85 group-hover:bg-on-surface/[0.05]'}`}
            >
              {day}
            </span>
            <span aria-hidden="true" className={`h-1 w-1 rounded-full transition-all duration-300 ${count ? (selected ? 'scale-125 bg-primary' : 'bg-on-surface-variant/50') : 'bg-transparent'}`} />
          </button>
        )
      })}
    </div>
  )
}
