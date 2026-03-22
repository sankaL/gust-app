export function CaptureRoute() {
  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <p className="font-body text-sm uppercase tracking-[0.25em] text-on-surface-variant">
          Default launch route
        </p>
        <h2 className="font-display text-3xl text-on-surface">Capture</h2>
        <p className="max-w-sm font-body text-base leading-7 text-on-surface-variant">
          Phase 0 wires the mobile-first shell, providers, and PWA behavior. Real recording,
          transcript review, and submission flows land in later phases.
        </p>
      </div>

      <div className="rounded-soft bg-surface-container p-6 shadow-ambient">
        <div className="mx-auto flex h-40 w-40 items-center justify-center rounded-pill bg-[radial-gradient(circle_at_top,_rgba(186,158,255,0.48),_rgba(132,85,239,0.9))]">
          <div className="flex h-24 w-24 items-center justify-center rounded-pill bg-surface text-center font-display text-lg">
            Mic
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-card bg-surface-container p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-display text-xl text-on-surface">Text fallback</p>
            <p className="font-body text-sm text-on-surface-variant">
              Present but intentionally secondary.
            </p>
          </div>
          <span className="rounded-pill bg-surface-container-high px-3 py-1 text-xs uppercase tracking-[0.2em] text-on-surface-variant">
            Placeholder
          </span>
        </div>
        <div className="rounded-card bg-surface-dim px-4 py-5 text-sm text-on-surface-variant">
          Capture-state UI arrives in Phase 2. This shell only reserves the space and visual
          direction.
        </div>
      </div>
    </section>
  )
}
