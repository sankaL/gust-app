import { NavLink, Outlet } from 'react-router-dom'

import { getAppConfig } from '../lib/config'

const navigation = [
  { to: '/', label: 'Capture', end: true },
  { to: '/tasks', label: 'Tasks', end: false }
]

export function AppShell() {
  const config = getAppConfig()

  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-8 pt-6">
        <header className="mb-8 space-y-4 pt-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-body text-sm uppercase tracking-[0.3em] text-on-surface-variant">
                Voice-first foundation
              </p>
              <h1 className="font-display text-5xl leading-none text-on-surface">Gust</h1>
            </div>
            <div className="rounded-pill bg-surface-container-high px-3 py-2 text-right shadow-ambient">
              <p className="font-body text-xs text-on-surface-variant">Environment</p>
              <p className="font-body text-sm font-medium">{config.environmentLabel}</p>
            </div>
          </div>
          <nav
            aria-label="Primary"
            className="grid grid-cols-2 gap-3 rounded-soft bg-surface-container p-2"
          >
            {navigation.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  [
                    'rounded-soft px-4 py-3 text-center font-body text-sm transition',
                    isActive
                      ? 'bg-surface-container-highest text-on-surface shadow-ambient'
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
