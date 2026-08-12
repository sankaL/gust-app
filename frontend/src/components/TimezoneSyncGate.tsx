type TimezoneSyncGateProps = {
  isError: boolean
  onRetry: () => void
  desktop?: boolean
}

export function TimezoneSyncGate({ isError, onRetry, desktop = false }: TimezoneSyncGateProps) {
  return (
    <main className="min-h-[100dvh] bg-surface text-on-surface">
      <div className={`mx-auto flex min-h-[100dvh] items-center px-6 ${desktop ? 'max-w-7xl' : 'max-w-md'}`}>
        <section className="w-full space-y-3" aria-busy={!isError}>
          <p className="font-body text-xs uppercase tracking-[0.18em] text-on-surface-variant">
            Date check
          </p>
          <h1 className="font-display text-3xl tracking-tight text-on-surface">
            {isError ? 'Could not confirm your timezone' : 'Aligning your task dates'}
          </h1>
          <p className="font-body text-sm leading-6 text-on-surface-variant">
            {isError
              ? 'Task dates are paused to prevent an incorrect Today or Overdue view.'
              : 'Confirming your local calendar day before loading tasks.'}
          </p>
          {isError ? (
            <button
              type="button"
              className="rounded-pill bg-primary px-4 py-2 font-body text-sm font-medium text-surface"
              onClick={onRetry}
            >
              Try again
            </button>
          ) : null}
        </section>
      </div>
    </main>
  )
}
