import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

import { chipClass, type ChipTone } from './chipStyles'

/* ----------------------------------------------------------------------------
 * CheckCircle: the single completion / approval control used everywhere.
 * ------------------------------------------------------------------------- */

type CheckSize = 'sm' | 'md' | 'lg'

const CHECK_SIZES: Record<CheckSize, { box: string; icon: string }> = {
  sm: { box: 'h-5 w-5', icon: 'h-3 w-3' },
  md: { box: 'h-7 w-7', icon: 'h-3.5 w-3.5' },
  lg: { box: 'h-9 w-9', icon: 'h-[1.1rem] w-[1.1rem]' },
}

export function CheckCircle({ checked, pending = false, size = 'md', label, mode = 'toggle', className = '', ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  checked: boolean
  /** `toggle` exposes checkbox semantics; `action` is a one-shot button (complete, approve). */
  mode?: 'toggle' | 'action'
  pending?: boolean
  size?: CheckSize
  label: string
}) {
  const sizes = CHECK_SIZES[size]
  return (
    <button
      type="button"
      role={mode === 'toggle' ? 'checkbox' : undefined}
      aria-checked={mode === 'toggle' ? checked : undefined}
      aria-label={label}
      title={mode === 'action' ? label : undefined}
      aria-busy={pending || undefined}
      className={`group/check relative inline-flex shrink-0 items-center justify-center rounded-full outline-none transition-transform duration-200 ease-out-expo focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-90 disabled:cursor-not-allowed ${sizes.box} ${className}`}
      {...props}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-0 rounded-full border-2 transition-all duration-300 ease-out-expo ${checked
          ? 'scale-100 border-primary bg-primary'
          : 'border-on-surface-variant/35 bg-transparent group-hover/check:border-primary group-hover/check:bg-primary/[0.08] group-disabled/check:opacity-50'}`}
      />
      {checked ? <span aria-hidden="true" className="animate-check-burst absolute inset-0 rounded-full bg-primary/40" /> : null}
      {pending ? (
        <span aria-hidden="true" className="absolute inset-[3px] animate-spin rounded-full border-2 border-primary border-r-transparent" />
      ) : (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={`relative ${sizes.icon} ${checked ? 'text-on-primary' : 'text-primary opacity-0 group-hover/check:opacity-60'}`}>
          <path
            d="M5 12.5l4.5 4.5L19 7.5"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={24}
            style={{ strokeDashoffset: checked ? 0 : undefined, animation: checked ? 'check-draw 320ms var(--ease-out-expo) both' : undefined }}
          />
        </svg>
      )}
    </button>
  )
}

/* ----------------------------------------------------------------------------
 * Chip: compact metadata pill (group, recurrence, review state, ...).
 * ------------------------------------------------------------------------- */

export function Chip({ tone = 'neutral', icon: Icon, children, className = '', title }: { tone?: ChipTone; icon?: LucideIcon; children: ReactNode; className?: string; title?: string }) {
  return (
    <span className={chipClass(tone, className)} title={title}>
      {Icon ? <Icon aria-hidden="true" className="h-3 w-3 shrink-0" strokeWidth={2.4} /> : null}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  )
}

/* ----------------------------------------------------------------------------
 * Switch
 * ------------------------------------------------------------------------- */

export function Switch({ label, checked, disabled, onChange, description }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void; description?: string }) {
  return (
    <label className="flex min-h-[3.25rem] cursor-pointer items-center justify-between gap-4 rounded-card bg-surface-container-high px-4 py-2.5 font-body text-sm font-medium text-on-surface ring-1 ring-inset ring-outline/50 transition-colors duration-150 hover:bg-surface-container-highest focus-within:ring-2 focus-within:ring-primary/60 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-55">
      <span className="min-w-0">
        <span className="block">{label}</span>
        {description ? <span className="mt-0.5 block text-xs font-normal text-on-surface-variant">{description}</span> : null}
      </span>
      <span className="relative inline-flex h-7 w-12 shrink-0">
        <input aria-label={label} role="switch" type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
        <span aria-hidden="true" className="absolute inset-0 rounded-full bg-on-surface-variant/25 transition-colors duration-200 peer-checked:bg-primary" />
        <span aria-hidden="true" className="absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform duration-300 ease-spring peer-checked:translate-x-5" />
      </span>
    </label>
  )
}

/* ----------------------------------------------------------------------------
 * SegmentedControl: sliding thumb selector (theme, speak/type, ...).
 * ------------------------------------------------------------------------- */

export function SegmentedControl<T extends string>({ label, options, value, onChange, className = '' }: {
  label: string
  options: { value: T; label: string; icon?: LucideIcon }[]
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  const index = Math.max(0, options.findIndex((option) => option.value === value))
  return (
    <div role="radiogroup" aria-label={label} className={`relative grid rounded-pill bg-surface-dim p-1 ring-1 ring-inset ring-outline/40 ${className}`} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      <span
        aria-hidden="true"
        className="absolute bottom-1 left-1 top-1 rounded-pill bg-surface-container-high shadow-card ring-1 ring-outline/50 transition-transform duration-300 ease-out-expo"
        style={{ width: `calc((100% - 0.5rem) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((option) => {
        const Icon = option.icon
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`relative z-10 flex h-9 items-center justify-center gap-1.5 rounded-pill font-body text-[0.8rem] font-semibold outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-primary/60 ${selected ? 'text-on-surface' : 'text-on-surface-variant hover:text-on-surface'}`}
          >
            {Icon ? <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={2} /> : null}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/* ----------------------------------------------------------------------------
 * SectionLabel: "☀ Morning" style list section heading.
 * ------------------------------------------------------------------------- */

export function SectionLabel({ icon: Icon, children, count, tone = 'default', as: Heading = 'h3' }: { icon?: LucideIcon; children: ReactNode; count?: number; tone?: 'default' | 'alert'; as?: 'h2' | 'h3' }) {
  return (
    <div className="flex items-center justify-between gap-3 px-1">
      <Heading className={`flex items-center gap-2 font-display text-[1.05rem] font-bold tracking-[-0.01em] dark:font-body dark:text-[0.78rem] dark:font-semibold dark:uppercase dark:tracking-[0.14em] ${tone === 'alert' ? 'text-tertiary' : 'text-on-surface dark:text-on-surface-variant'}`}>
        {Icon ? <Icon aria-hidden="true" className="h-[1.1rem] w-[1.1rem] dark:h-4 dark:w-4" strokeWidth={2.2} /> : null}
        {children}
      </Heading>
      {count !== undefined ? <span className="font-body text-xs font-medium text-on-surface-variant">{count} {count === 1 ? 'task' : 'tasks'}</span> : null}
    </div>
  )
}

/* ----------------------------------------------------------------------------
 * Panel: inline status surface (errors, notices, empty states).
 * ------------------------------------------------------------------------- */

export function InlineNotice({ tone = 'neutral', title, children, action, role }: { tone?: 'neutral' | 'error' | 'warning' | 'success'; title?: ReactNode; children?: ReactNode; action?: ReactNode; role?: 'alert' | 'status' }) {
  const toneClass = {
    neutral: 'bg-surface-container-high text-on-surface ring-outline/50',
    error: 'bg-chip-rose text-chip-rose-ink ring-tertiary/25',
    warning: 'bg-chip-amber text-chip-amber-ink ring-warning/25',
    success: 'bg-chip-green text-chip-green-ink ring-success/25',
  }[tone]
  return (
    <div role={role} className={`rounded-card px-4 py-3 text-left ring-1 ring-inset ${toneClass}`}>
      {title ? <p className="font-body text-sm font-semibold">{title}</p> : null}
      {children ? <div className={`font-body text-sm leading-6 ${title ? 'mt-0.5 opacity-90' : ''}`}>{children}</div> : null}
      {action ? <div className="mt-3 flex flex-wrap gap-2">{action}</div> : null}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, children, action }: { icon?: LucideIcon; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="animate-rise-in flex flex-col items-center rounded-soft bg-surface-container-high px-6 py-9 text-center shadow-card ring-1 ring-inset ring-outline/40">
      {Icon ? (
        <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/[0.12] text-primary">
          <Icon aria-hidden="true" className="h-6 w-6" strokeWidth={2} />
        </span>
      ) : null}
      <p className="font-display text-xl font-bold tracking-[-0.01em] text-on-surface">{title}</p>
      {children ? <p className="mt-2 max-w-xs font-body text-sm leading-6 text-on-surface-variant">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}
