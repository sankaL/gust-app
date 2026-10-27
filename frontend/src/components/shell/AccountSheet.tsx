import { useId } from 'react'
import { CheckCircle2, ChevronRight, Download, Laptop, LogOut, Monitor, Moon, Settings, Sun, type LucideIcon } from 'lucide-react'

import { useTheme } from '../../hooks/useTheme'
import { BottomSheet, SheetHeader } from '../ui/BottomSheet'
import { SegmentedControl } from '../ui/controls'
import type { ThemePreference } from '../../lib/theme'

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Auto', icon: Monitor },
]

function ListRow({ icon: Icon, label, description, onClick, tone = 'default', disabled, trailing, role }: {
  icon: LucideIcon
  role?: 'menuitem'
  label: string
  description?: string
  onClick: () => void
  tone?: 'default' | 'danger'
  disabled?: boolean
  trailing?: React.ReactNode
}) {
  const danger = tone === 'danger'
  const id = useId()
  return (
    <button
      type="button"
      role={role}
      aria-labelledby={`${id}-label`}
      aria-describedby={description ? `${id}-description` : undefined}
      onClick={onClick}
      disabled={disabled}
      className="group flex min-h-[3.5rem] w-full items-center gap-3.5 rounded-card px-3 py-2.5 text-left outline-none transition-colors duration-150 hover:bg-on-surface/[0.04] focus-visible:bg-on-surface/[0.06] active:bg-on-surface/[0.07] disabled:opacity-55"
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.85rem] transition-transform duration-200 group-active:scale-90 ${danger ? 'bg-chip-rose text-chip-rose-ink' : 'bg-chip-neutral text-on-surface'}`}>
        <Icon aria-hidden="true" className="h-[1.15rem] w-[1.15rem]" strokeWidth={2.1} />
      </span>
      <span className="min-w-0 flex-1">
        <span id={`${id}-label`} className={`block font-body text-[0.95rem] font-semibold ${danger ? 'text-tertiary' : 'text-on-surface'}`}>{label}</span>
        {description ? <span id={`${id}-description`} className="mt-0.5 block truncate font-body text-xs text-on-surface-variant">{description}</span> : null}
      </span>
      {trailing ?? (danger ? null : <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-on-surface-variant/60 transition-transform duration-200 group-hover:translate-x-0.5" />)}
    </button>
  )
}

export function ThemeSelector({ className = '' }: { className?: string }) {
  const { preference, setPreference } = useTheme()
  return <SegmentedControl label="Appearance" options={THEME_OPTIONS} value={preference} onChange={setPreference} className={className} />
}

export function AccountSheet({ open, onClose, email, displayName, initials, isLoggingOut, canInstall, installLabel, onInstall, onCompletedTasks, onSettings, onDesktopMode, onLogout }: {
  open: boolean
  onClose: () => void
  email?: string
  displayName?: string | null
  initials: string
  isLoggingOut: boolean
  canInstall: boolean
  installLabel: string
  onInstall: () => void
  onCompletedTasks: () => void
  onSettings: () => void
  onDesktopMode: () => void
  onLogout: () => void
}) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      labelledBy="account-sheet-title"
      header={<SheetHeader eyebrow="Account" title="You" titleId="account-sheet-title" onClose={onClose} closeLabel="Close account menu" />}
    >
      <div className="space-y-6">
        <div className="animate-rise-in flex items-center gap-4 rounded-soft bg-surface-container-high p-4 shadow-card ring-1 ring-inset ring-outline/40">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-dim font-body text-base font-bold uppercase text-on-primary">{initials}</span>
          <div className="min-w-0">
            <p className="font-body text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">Signed in</p>
            {displayName ? <p className="truncate font-display text-lg font-bold text-on-surface">{displayName}</p> : null}
            <p className="truncate font-body text-sm text-on-surface-variant">{email}</p>
          </div>
        </div>

        <section className="space-y-2.5" style={{ ['--stagger' as string]: 1 }}>
          <p className="px-1 font-body text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">Appearance</p>
          <ThemeSelector />
        </section>

        <section className="-mx-2 space-y-0.5" role="menu" aria-label="Account actions">
          <ListRow role="menuitem" icon={CheckCircle2} label="Completed Tasks" description="Review and restore finished tasks" onClick={onCompletedTasks} />
          <ListRow role="menuitem" icon={Settings} label="Settings" description="Notifications and reminders" onClick={onSettings} />
          <ListRow role="menuitem" icon={Laptop} label="Desktop Mode" description="Open the full workspace layout" onClick={onDesktopMode} />
          {canInstall ? <ListRow role="menuitem" icon={Download} label={installLabel} description="Add Gust to your home screen" onClick={onInstall} /> : null}
          <div className="mx-3 my-2 h-px bg-outline/60" />
          <ListRow role="menuitem" icon={LogOut} label={isLoggingOut ? 'Logging out...' : 'Logout'} tone="danger" disabled={isLoggingOut} onClick={onLogout} />
        </section>
      </div>
    </BottomSheet>
  )
}
