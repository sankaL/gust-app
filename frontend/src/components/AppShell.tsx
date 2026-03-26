import { NavLink, Outlet } from 'react-router-dom'

import { getAppConfig } from '../lib/config'

const navigation = [
  { to: '/', label: 'Capture', end: true },
  { to: '/tasks', label: 'Tasks', end: true },
  { to: '/tasks/groups', label: 'Groups', end: false }
]

export function AppShell() {
  const config = getAppConfig()

  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-3 pb-4 pt-3">
        <header className="sticky top-0 z-50 mb-4 space-y-5 bg-surface/95 pt-2 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <img src="/logos/gust-wind-electric.svg" alt="Gust" className="h-6 w-6" />
              <h1 className="font-display text-2xl leading-none text-on-surface">Gust</h1>
            </div>
            <div className="rounded-pill bg-surface-container-high px-2 py-1 text-right shadow-ambient">
              <p className="font-body text-xs font-medium">{config.environmentLabel}</p>
            </div>
          </div>
          <nav
            aria-label="Primary"
            className="grid grid-cols-3 gap-2 rounded-soft bg-surface-container p-1.5"
          >
            {navigation.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  [
                    'rounded-soft px-3 py-2 text-center font-body text-sm transition',
                    isActive
                      ? 'bg-surface-container-highest text-primary shadow-ambient'
                      : 'text-on-surface-variant hover:bg-surface-container-high'
                  ].join(' ')
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </header>

        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
