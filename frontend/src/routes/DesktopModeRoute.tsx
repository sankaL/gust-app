import { Link } from 'react-router-dom'

export function DesktopModeRoute() {
  return (
    <section className="space-y-4">
      <div className="space-y-2">
        <p className="font-body text-xs uppercase tracking-[0.15em] text-on-surface-variant">
          Preview
        </p>
        <h2 className="font-display text-2xl text-on-surface">Desktop Mode</h2>
        <p className="font-body text-sm leading-6 text-on-surface-variant">
          Desktop mode is a placeholder for now. Mobile-first behavior remains the primary
          workflow.
        </p>
      </div>
      <Link
        to="/tasks"
        className="inline-flex rounded-pill bg-primary px-4 py-2 font-body text-sm font-medium text-surface"
      >
        Back to Tasks
      </Link>
    </section>
  )
}
