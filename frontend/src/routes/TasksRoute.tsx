const taskGroups = [
  {
    name: 'Inbox',
    items: [
      { title: 'Review extraction contract', meta: 'Needs review', emphasized: true },
      { title: 'Verify reminder uniqueness', meta: 'Due soon', emphasized: false }
    ]
  },
  {
    name: 'Personal',
    items: [{ title: 'Refine mobile shell spacing', meta: 'No due date', emphasized: false }]
  }
]

export function TasksRoute() {
  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <p className="font-body text-sm uppercase tracking-[0.25em] text-on-surface-variant">
          Placeholder task surface
        </p>
        <h2 className="font-display text-3xl text-on-surface">Tasks</h2>
        <p className="max-w-sm font-body text-base leading-7 text-on-surface-variant">
          Phase 0 only establishes the grouped task view shell and design tokens. Real task data,
          edits, and swipe actions are implemented later.
        </p>
      </div>

      <div className="space-y-6">
        {taskGroups.map((group) => (
          <section key={group.name} className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-2xl text-on-surface">{group.name}</h3>
              <span className="font-body text-xs uppercase tracking-[0.2em] text-on-surface-variant">
                {group.items.length} items
              </span>
            </div>
            <div className="space-y-4">
              {group.items.map((item) => (
                <article
                  key={item.title}
                  className="rounded-card bg-surface-container p-5 shadow-ambient"
                >
                  <div className="flex items-start gap-4">
                    <div
                      className={[
                        'mt-1 h-6 w-6 rounded-pill border',
                        item.emphasized
                          ? 'border-primary bg-primary/25'
                          : 'border-outline/20 bg-surface-container-high'
                      ].join(' ')}
                    />
                    <div className="space-y-2">
                      <p className="font-body text-base text-on-surface">{item.title}</p>
                      <span className="inline-flex rounded-pill bg-surface-container-high px-3 py-1 text-xs uppercase tracking-[0.18em] text-on-surface-variant">
                        {item.meta}
                      </span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  )
}
