import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function SettingsCard({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <section className="animate-rise-in space-y-3 rounded-[1.4rem] bg-surface-container p-4 shadow-card ring-1 ring-inset ring-outline/40">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/[0.12] text-primary"><Icon className="h-[1.1rem] w-[1.1rem]" strokeWidth={2.1} /></span>
        <h2 className="font-display text-lg font-bold text-on-surface">{title}</h2>
      </div>
      {children}
    </section>
  )
}
