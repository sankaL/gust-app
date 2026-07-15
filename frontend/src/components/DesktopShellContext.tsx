import { useEffect, type ReactNode } from 'react'
import { useOutletContext } from 'react-router-dom'

import type { GroupSummary, SessionStatus } from '../lib/api'

export type DesktopHeaderContent = {
  eyebrow: string
  title: string
  subtitle?: string
  action?: ReactNode
}

export type DesktopOutletContext = {
  session: SessionStatus
  groups: GroupSummary[]
  isGroupsLoading: boolean
  setDesktopHeader: (header: DesktopHeaderContent) => void
}

export const DEFAULT_DESKTOP_HEADER: DesktopHeaderContent = {
  eyebrow: 'Mission Control',
  title: 'Weekly overview',
}

export function useDesktopHeader(header: DesktopHeaderContent) {
  const { setDesktopHeader } = useOutletContext<DesktopOutletContext>()

  useEffect(() => {
    setDesktopHeader(header)
    return () => setDesktopHeader(DEFAULT_DESKTOP_HEADER)
  }, [header, setDesktopHeader])
}
