import { AlarmClock, CalendarDays, CloudSun, Sun, type LucideIcon } from 'lucide-react'

/** Icons for agenda sections (client-side buckets) and server due buckets alike. */
export const SECTION_ICONS: Record<string, LucideIcon> = {
  today: Sun,
  overdue: AlarmClock,
  upcoming: CalendarDays,
  due_soon: CalendarDays,
  someday: CloudSun,
  no_date: CloudSun,
}
