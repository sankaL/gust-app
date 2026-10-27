import { useCallback } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

export type ShellSheet = 'capture' | 'review' | 'account'
export type CaptureLaunchMode = 'record' | 'type'

type SheetHistoryState = { gustSheet?: ShellSheet } | null

const SHEETS: ShellSheet[] = ['capture', 'review', 'account']

function isShellSheet(value: string | null): value is ShellSheet {
  return SHEETS.includes(value as ShellSheet)
}

/**
 * Shell-level sheets live in the URL (`?sheet=capture`) so the hardware/browser back
 * gesture closes them, and deep links such as `/capture` can open them directly.
 */
export function useShellSheets() {
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const rawSheet = searchParams.get('sheet')
  const activeSheet = isShellSheet(rawSheet) ? rawSheet : null
  const rawMode = searchParams.get('mode')
  const captureMode: CaptureLaunchMode | null = rawMode === 'record' || rawMode === 'type' ? rawMode : null

  const openSheet = useCallback((sheet: ShellSheet, mode?: CaptureLaunchMode) => {
    const next = new URLSearchParams(location.search)
    next.set('sheet', sheet)
    if (mode) next.set('mode', mode)
    else next.delete('mode')
    const replace = isShellSheet(next.get('sheet')) && isShellSheet(new URLSearchParams(location.search).get('sheet'))
    void navigate({ pathname: location.pathname, search: `?${next.toString()}` }, { replace, state: { gustSheet: sheet } satisfies SheetHistoryState })
  }, [location.pathname, location.search, navigate])

  const closeSheet = useCallback(() => {
    const state = location.state as SheetHistoryState
    if (state?.gustSheet && window.history.length > 1) {
      void navigate(-1)
      return
    }
    const next = new URLSearchParams(location.search)
    next.delete('sheet')
    next.delete('mode')
    const search = next.toString()
    void navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true })
  }, [location.pathname, location.search, location.state, navigate])

  /** Drops the one-shot launch mode without closing the sheet or adding history. */
  const consumeCaptureMode = useCallback(() => {
    const next = new URLSearchParams(location.search)
    if (!next.has('mode')) return
    next.delete('mode')
    void navigate({ pathname: location.pathname, search: `?${next.toString()}` }, { replace: true, state: location.state as SheetHistoryState })
  }, [location.pathname, location.search, location.state, navigate])

  return { activeSheet, captureMode, openSheet, closeSheet, consumeCaptureMode }
}
