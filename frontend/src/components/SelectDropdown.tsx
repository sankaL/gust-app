import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useFloatingDismiss } from '../hooks/useFloatingDismiss'

interface SelectOption {
  value: string | number
  label: string
}

interface SelectDropdownProps {
  label: string
  options: SelectOption[]
  value: string | number
  onChange: (value: string | number) => void
  onOpenChange?: (isOpen: boolean) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  triggerClassName?: string
  labelClassName?: string
}

function useHighlightedOption(listRef: React.RefObject<HTMLUListElement | null>, highlightedIndex: number) {
  useEffect(() => { if (highlightedIndex >= 0) (listRef.current?.children[highlightedIndex] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' }) }, [highlightedIndex, listRef])
}

function useOpenNotification(isOpen: boolean, onOpenChange?: (isOpen: boolean) => void) {
  useEffect(() => { onOpenChange?.(isOpen) }, [isOpen, onOpenChange])
}

function useSelectEffects(listRef: React.RefObject<HTMLUListElement | null>, highlightedIndex: number, isOpen: boolean, onOpenChange?: (isOpen: boolean) => void) {
  useHighlightedOption(listRef, highlightedIndex)
  useOpenNotification(isOpen, onOpenChange)
}

function useDropdownViewport(isOpen: boolean, listRef: React.RefObject<HTMLUListElement | null>, triggerRef: React.RefObject<HTMLButtonElement | null>, updatePosition: () => void, close: () => void) {
  useEffect(() => {
    if (!isOpen) return undefined
    function handleScroll(event: Event) {
      const target = event.target
      if (target instanceof Node && (listRef.current?.contains(target) || triggerRef.current?.contains(target))) return
      close()
    }
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', handleScroll, true)
    return () => { window.removeEventListener('resize', updatePosition); window.removeEventListener('scroll', handleScroll, true) }
  }, [close, isOpen, listRef, triggerRef, updatePosition])
}

function dropdownPosition(rect: DOMRect, measuredWidth: number, optionCount: number) {
  const padding = 16
  const width = Math.min(measuredWidth || 240, window.innerWidth - padding * 2)
  const height = Math.min(Math.max(optionCount * 44 + 8, 120), 240)
  const left = Math.max(padding, Math.min(rect.left, window.innerWidth - width - padding))
  const below = Math.max(0, window.innerHeight - rect.bottom - padding)
  const above = Math.max(0, rect.top - padding)
  const openAbove = below < height && above > below
  const maxHeight = Math.max(120, Math.min(height, (openAbove ? above : below) - 8))
  return { top: openAbove ? Math.max(padding, rect.top - maxHeight - 8) : rect.bottom + 8, left, width, maxHeight }
}

function useSelectControls({ isOpen, disabled, highlightedIndex, options, onChange, updatePosition, setIsOpen, setHighlightedIndex }: { isOpen: boolean; disabled: boolean; highlightedIndex: number; options: SelectOption[]; onChange: (value: string | number) => void; updatePosition: () => void; setIsOpen: React.Dispatch<React.SetStateAction<boolean>>; setHighlightedIndex: React.Dispatch<React.SetStateAction<number>> }) {
  function select() { const option = isOpen && highlightedIndex >= 0 ? options[highlightedIndex] : undefined; if (option) { onChange(option.value); setIsOpen(false) } else { updatePosition(); setIsOpen((current) => !current) } }
  function down() { if (!isOpen) { updatePosition(); setIsOpen(true); setHighlightedIndex(options.length ? 0 : -1) } else if (options.length) setHighlightedIndex((previous) => Math.min(previous + 1, options.length - 1)) }
  const handlers: Record<string, () => void> = { Enter: select, ' ': select, ArrowDown: down, ArrowUp: () => setHighlightedIndex((previous) => isOpen && options.length ? Math.max(previous - 1, 0) : previous), Escape: () => setIsOpen(false), Tab: () => setIsOpen(false) }
  return { keyDown: (event: React.KeyboardEvent) => { const handler = handlers[event.key]; if (disabled || !handler) return; if (event.key !== 'Tab') event.preventDefault(); handler() }, selectOption: (optionValue: string | number) => { onChange(optionValue); setIsOpen(false) }, toggle: () => { if (!disabled) { updatePosition(); setIsOpen((current) => !current) } } }
}

function useSelectState() {
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 240 })
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  return { isOpen, setIsOpen, highlightedIndex, setHighlightedIndex, position, setPosition, containerRef, triggerRef, listRef }
}

function useDropdownPlacement(triggerRef: React.RefObject<HTMLButtonElement | null>, optionCount: number, setPosition: React.Dispatch<React.SetStateAction<{ top: number; left: number; width: number; maxHeight: number }>>, setIsOpen: React.Dispatch<React.SetStateAction<boolean>>) {
  const close = useCallback(() => setIsOpen(false), [setIsOpen])
  const update = useCallback(() => { if (triggerRef.current) { const rect = triggerRef.current.getBoundingClientRect(); setPosition(dropdownPosition(rect, rect.width || triggerRef.current.offsetWidth, optionCount)) } }, [optionCount, setPosition, triggerRef])
  return { close, update }
}

export function SelectDropdown(props: SelectDropdownProps) {
  return <SelectDropdownView {...useSelectDropdownViewProps(props)} />
}

function useSelectDropdownViewProps({
  label,
  options,
  value,
  onChange,
  onOpenChange,
  placeholder = 'Select an option',
  disabled = false,
  className = 'space-y-1.5',
  triggerClassName = 'px-3 py-3',
  labelClassName = 'text-sm font-medium text-on-surface-variant',
}: SelectDropdownProps): Parameters<typeof SelectDropdownView>[0] {
  const hasLabel = label.trim().length > 0
  const { isOpen, setIsOpen, highlightedIndex, setHighlightedIndex, position, setPosition, containerRef, triggerRef, listRef } = useSelectState()

  const selectedOption = options.find((opt) => opt.value === value)
  const placement = useDropdownPlacement(triggerRef, options.length, setPosition, setIsOpen)

  useFloatingDismiss(isOpen, containerRef, listRef, placement.close, placement.update)

  useSelectEffects(listRef, highlightedIndex, isOpen, onOpenChange)
  useDropdownViewport(isOpen, listRef, triggerRef, placement.update, placement.close)

  const controls = useSelectControls({ isOpen, disabled, highlightedIndex, options, onChange, updatePosition: placement.update, setIsOpen, setHighlightedIndex })

  const listbox = isOpen ? <DropdownList listRef={listRef} label={hasLabel ? label : placeholder} options={options} value={value} highlightedIndex={highlightedIndex} position={position} onHighlight={setHighlightedIndex} onSelect={controls.selectOption} /> : null

  return { label, hasLabel, placeholder, selectedLabel: selectedOption?.label, disabled, isOpen, className, triggerClassName, labelClassName, containerRef, triggerRef, listbox, onKeyDown: controls.keyDown, onToggle: controls.toggle }
}

function SelectDropdownView({ label, hasLabel, placeholder, selectedLabel, disabled, isOpen, className, triggerClassName, labelClassName, containerRef, triggerRef, listbox, onKeyDown, onToggle }: { label: string; hasLabel: boolean; placeholder: string; selectedLabel?: string; disabled: boolean; isOpen: boolean; className: string; triggerClassName: string; labelClassName: string; containerRef: React.RefObject<HTMLDivElement | null>; triggerRef: React.RefObject<HTMLButtonElement | null>; listbox: React.ReactNode; onKeyDown: (event: React.KeyboardEvent) => void; onToggle: () => void }) {
  return <div className={className}><DropdownLabel visible={hasLabel} className={labelClassName}>{label}</DropdownLabel><DropdownTrigger containerRef={containerRef} triggerRef={triggerRef} selectedLabel={selectedLabel} placeholder={placeholder} disabled={disabled} isOpen={isOpen} triggerClassName={triggerClassName} onKeyDown={onKeyDown} onToggle={onToggle} /><DropdownPortal>{listbox}</DropdownPortal></div>
}

function DropdownLabel({ visible, className, children }: { visible: boolean; className: string; children: string }) {
  return visible ? <label className={className}>{children}</label> : null
}

function DropdownTrigger({ containerRef, triggerRef, selectedLabel, placeholder, disabled, isOpen, triggerClassName, onKeyDown, onToggle }: Omit<Parameters<typeof SelectDropdownView>[0], 'label' | 'hasLabel' | 'className' | 'labelClassName' | 'listbox'>) {
  const stateClass = disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-surface-container-highest focus:ring-1 focus:ring-primary'
  return <div ref={containerRef} className="relative"><button ref={triggerRef} type="button" onClick={onToggle} onKeyDown={onKeyDown} disabled={disabled} aria-haspopup="listbox" aria-expanded={isOpen} className={`flex w-full items-center justify-between rounded-card bg-surface-dim text-left text-sm text-on-surface outline-none transition-all ${triggerClassName} ${stateClass}`}><DropdownTriggerLabel label={selectedLabel} placeholder={placeholder} /><span className={`text-[0.6rem] text-on-surface-variant transition-transform ${isOpen ? 'rotate-180' : ''}`}>▼</span></button></div>
}

function DropdownTriggerLabel({ label, placeholder }: { label?: string; placeholder: string }) { return <span className={label ? 'text-on-surface' : 'text-on-surface-variant/40'}>{label || placeholder}</span> }

function DropdownPortal({ children }: { children: React.ReactNode }) {
  return children && typeof document !== 'undefined' ? createPortal(children, document.body) : null
}

function DropdownList({ listRef, label, options, value, highlightedIndex, position, onHighlight, onSelect }: { listRef: React.RefObject<HTMLUListElement | null>; label: string; options: SelectOption[]; value: string | number; highlightedIndex: number; position: { top: number; left: number; width: number; maxHeight: number }; onHighlight: (index: number) => void; onSelect: (value: string | number) => void }) {
  return <ul ref={listRef} role="listbox" aria-label={label} className="fixed z-[140] overflow-y-auto rounded-card bg-[linear-gradient(180deg,_rgb(38,38,38)_0%,_rgb(26,26,26)_100%)] py-1 shadow-[0_18px_40px_rgba(0,0,0,0.58),_inset_0_1px_0_rgba(255,255,255,0.05)]" style={position}>{options.map((option, index) => <DropdownOption key={option.value} option={option} selected={option.value === value} highlighted={index === highlightedIndex} onHighlight={() => onHighlight(index)} onSelect={() => onSelect(option.value)} />)}</ul>
}

function DropdownOption({ option, selected, highlighted, onHighlight, onSelect }: { option: SelectOption; selected: boolean; highlighted: boolean; onHighlight: () => void; onSelect: () => void }) {
  return <li role="option" aria-selected={selected} onClick={onSelect} onMouseEnter={onHighlight} className={`flex cursor-pointer items-center justify-between px-3 py-2 transition-colors ${highlighted ? 'bg-surface-container-highest text-on-surface' : 'text-on-surface'} ${selected ? 'text-primary' : ''}`}><span>{option.label}</span>{selected ? <span className="text-lg font-bold leading-none text-primary">•</span> : null}</li>
}
