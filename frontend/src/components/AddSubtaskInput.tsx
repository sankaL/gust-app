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
        className="min-w-0 flex-1 rounded-pill bg-surface-container-high px-4 py-2.5 text-sm text-on-surface outline-none ring-1 ring-inset ring-outline/50 placeholder:text-on-surface-variant/60 focus:ring-2 focus:ring-primary/60"
        disabled={disabled}
      />
      <button
        type="button"
        onClick={onAdd}
        disabled={!value.trim() || disabled}
        className="h-11 rounded-pill bg-primary px-5 text-sm font-semibold text-on-primary transition-transform active:scale-95 disabled:opacity-45"
      >
        Add
      </button>
    </div>
  )
}
