type AddSubtaskInputProps = {
  value: string
  disabled: boolean
  onChange: (value: string) => void
  onAdd: () => void
}

export function AddSubtaskInput({ value, disabled, onChange, onAdd }: AddSubtaskInputProps) {
  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || !value.trim()) return
    event.preventDefault()
    onAdd()
  }

  return (
    <div className="mt-3 flex gap-2">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add a subtask..."
        className="min-w-0 flex-1 rounded-card border border-dashed border-outline/30 bg-surface-dim px-3 py-3 text-sm text-on-surface outline-none focus:border-primary"
        disabled={disabled}
      />
      <button
        type="button"
        onClick={onAdd}
        disabled={!value.trim() || disabled}
        className="rounded-pill bg-primary px-4 py-2 text-sm font-semibold text-surface disabled:opacity-50"
      >
        Add
      </button>
    </div>
  )
}
