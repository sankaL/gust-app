import { useCallback, useRef } from 'react'
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

  // Sheet content keeps rendering (with its old callbacks) while it animates out, so close
  // requests read the live location instead of the render-time closure.
  const locationRef = useRef(location)
  locationRef.current = location
  const closingKeyRef = useRef<string | null>(null)
  if (closingKeyRef.current !== location.key) closingKeyRef.current = null

  const openSheet = useCallback((sheet: ShellSheet, mode?: CaptureLaunchMode) => {
    const current = locationRef.current
    const next = new URLSearchParams(current.search)
    next.set('sheet', sheet)
    if (mode) next.set('mode', mode)
    else next.delete('mode')
    const replace = isShellSheet(new URLSearchParams(current.search).get('sheet'))
    // Swapping sheets reuses the current entry, so keep its state: only an entry the app pushed may be popped on close.
    const state: SheetHistoryState = replace ? (current.state as SheetHistoryState) : { gustSheet: sheet }
    void navigate({ pathname: current.pathname, search: `?${next.toString()}` }, { replace, state })
  }, [navigate])

  const closeSheet = useCallback(() => {
    const current = locationRef.current
    if (!isShellSheet(new URLSearchParams(current.search).get('sheet'))) return
    // A second close before the first navigation lands would pop an extra history entry.
    if (closingKeyRef.current === current.key) return
    closingKeyRef.current = current.key
    const state = current.state as SheetHistoryState
    if (state?.gustSheet && window.history.length > 1) {
      void navigate(-1)
      return
    }
    const next = new URLSearchParams(current.search)
    next.delete('sheet')
    next.delete('mode')
    const search = next.toString()
    void navigate({ pathname: current.pathname, search: search ? `?${search}` : '' }, { replace: true })
  }, [navigate])

  /** Drops the one-shot launch mode without closing the sheet or adding history. */
  const consumeCaptureMode = useCallback(() => {
    const next = new URLSearchParams(location.search)
    if (!next.has('mode')) return
    next.delete('mode')
    void navigate({ pathname: location.pathname, search: `?${next.toString()}` }, { replace: true, state: location.state as SheetHistoryState })
  }, [location.pathname, location.search, location.state, navigate])

  return { activeSheet, captureMode, openSheet, closeSheet, consumeCaptureMode }
}
