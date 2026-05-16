function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function getZonedParts(date: Date, timezone: string | null | undefined) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = formatter.formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value)

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

function getTimeZoneOffsetMs(date: Date, timezone: string | null | undefined): number {
  const parts = getZonedParts(date, timezone)
  if (Object.values(parts).some((value) => Number.isNaN(value))) {
    return 0
  }

  const zonedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  )
  return zonedAsUtc - date.getTime()
}

export function toDateTimeLocalValue(
  value: string | null | undefined,
  timezone?: string | null
): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = getZonedParts(date, timezone)
  if (Object.values(parts).some((part) => Number.isNaN(part))) return ''
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}`
}

export function dateTimeLocalToIso(
  value: string | null | undefined,
  timezone?: string | null
): string | null {
  if (!value) return null
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (!match) return null

  const [, year, month, day, hour, minute] = match
  const localUtcMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute)
  )
  let utcMs = localUtcMs - getTimeZoneOffsetMs(new Date(localUtcMs), timezone)
  for (let index = 0; index < 3; index += 1) {
    const nextUtcMs = localUtcMs - getTimeZoneOffsetMs(new Date(utcMs), timezone)
    if (nextUtcMs === utcMs) break
    utcMs = nextUtcMs
  }

  const date = new Date(utcMs)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
