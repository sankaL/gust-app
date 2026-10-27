import { createContext, type ReactNode, useContext } from 'react'

import type { CaptureLaunchMode, ShellSheet } from '../hooks/useShellSheets'

type AppShellActionsContextValue = {
  setTopBarAction: (action: ReactNode | null) => void
}

export const AppShellActionsContext = createContext<AppShellActionsContextValue | null>(null)

export function useAppShellActions() {
  return useContext(AppShellActionsContext)
}

type MobileShellContextValue = {
  topBarAction: ReactNode | null
  pendingReviewCount: number
  openSheet: (sheet: ShellSheet, mode?: CaptureLaunchMode) => void
}

export const MobileShellContext = createContext<MobileShellContextValue | null>(null)

export function useMobileShell() {
  return useContext(MobileShellContext)
}
