import { createContext, type ReactNode, useContext } from 'react'

type AppShellActionsContextValue = {
  setTopBarAction: (action: ReactNode | null) => void
}

export const AppShellActionsContext = createContext<AppShellActionsContextValue | null>(null)

export function useAppShellActions() {
  return useContext(AppShellActionsContext)
}
