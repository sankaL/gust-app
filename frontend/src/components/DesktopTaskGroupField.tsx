import type { GroupSummary } from '../lib/api'
import { SelectDropdown } from './SelectDropdown'

type DesktopTaskGroupFieldProps = {
  groups: GroupSummary[]
  value: string
  isOpen: boolean
  disabled: boolean
  labelWidthClass: string
  onChange: (groupId: string) => void
  onOpenChange: (isOpen: boolean) => void
}

export function DesktopTaskGroupField({
  groups,
  value,
  isOpen,
  disabled,
  labelWidthClass,
  onChange,
  onOpenChange,
}: DesktopTaskGroupFieldProps) {
  return (
    <div className={`grid border-b border-white/10 px-4 py-3 ${labelWidthClass} sm:items-center`}>
      <p className="font-body text-xs font-semibold uppercase tracking-[0.13em] text-on-surface-variant">Group</p>
      <div className={isOpen ? 'relative z-40' : ''}>
        <SelectDropdown
          label=""
          options={groups.map((group) => ({ value: group.id, label: group.name }))}
          value={value}
          onChange={(nextValue) => onChange(nextValue as string)}
          onOpenChange={onOpenChange}
          disabled={disabled}
        />
      </div>
    </div>
  )
}
