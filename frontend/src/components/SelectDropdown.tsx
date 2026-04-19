import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

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
}

export function SelectDropdown({
  label,
  options,
  value,
  onChange,
  onOpenChange,
  placeholder = 'Select an option',
  disabled = false,
}: SelectDropdownProps) {
  const hasLabel = label.trim().length > 0
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 240 })

  const selectedOption = options.find((opt) => opt.value === value)

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return

    const rect = triggerRef.current.getBoundingClientRect()
    const viewportPadding = 16
    const measuredWidth = rect.width || triggerRef.current.offsetWidth || 240
    const menuWidth = Math.min(measuredWidth, window.innerWidth - viewportPadding * 2)
    const estimatedHeight = Math.min(Math.max(options.length * 44 + 8, 120), 240)

    let left = rect.left
    if (left + menuWidth > window.innerWidth - viewportPadding) {
      left = window.innerWidth - menuWidth - viewportPadding
    }
    left = Math.max(viewportPadding, left)

    const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - viewportPadding)
    const spaceAbove = Math.max(0, rect.top - viewportPadding)
    const openAbove = spaceBelow < estimatedHeight && spaceAbove > spaceBelow
    const maxHeight = Math.max(
      120,
      Math.min(estimatedHeight, (openAbove ? spaceAbove : spaceBelow) - 8)
    )
    const top = openAbove
      ? Math.max(viewportPadding, rect.top - maxHeight - 8)
      : rect.bottom + 8

    setPosition({
      top,
      left,
      width: menuWidth,
      maxHeight,
    })
  }, [options.length])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        listRef.current &&
        !listRef.current.contains(target)
      ) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      updatePosition()
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, updatePosition])

  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const highlightedElement = listRef.current.children[highlightedIndex] as HTMLElement
      highlightedElement?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIndex])

  useEffect(() => {
    onOpenChange?.(isOpen)
  }, [isOpen, onOpenChange])

  useEffect(() => {
    if (!isOpen) return

    function handleResize() {
      updatePosition()
    }

    function handleScroll(event: Event) {
      const target = event.target
      if (
        target instanceof Node &&
        (listRef.current?.contains(target) || triggerRef.current?.contains(target))
      ) {
        return
      }
      setIsOpen(false)
    }

    window.addEventListener('resize', handleResize)
    window.addEventListener('scroll', handleScroll, true)

    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [isOpen, updatePosition])

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return

    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (isOpen && highlightedIndex >= 0) {
          const option = options[highlightedIndex]
          if (option) {
            onChange(option.value)
            setIsOpen(false)
          }
        } else {
          updatePosition()
          setIsOpen((current) => !current)
        }
        break
      case 'ArrowDown':
        event.preventDefault()
        if (!isOpen) {
          updatePosition()
          setIsOpen(true)
          setHighlightedIndex(options.length > 0 ? 0 : -1)
        } else if (options.length > 0) {
          setHighlightedIndex((prev) => Math.min(prev + 1, options.length - 1))
        }
        break
      case 'ArrowUp':
        event.preventDefault()
        if (isOpen && options.length > 0) {
          setHighlightedIndex((prev) => Math.max(prev - 1, 0))
        }
        break
      case 'Escape':
        event.preventDefault()
        setIsOpen(false)
        break
      case 'Tab':
        setIsOpen(false)
        break
    }
  }

  const handleOptionClick = (optionValue: string | number) => {
    onChange(optionValue)
    setIsOpen(false)
  }

  const listbox = isOpen ? (
    <ul
      ref={listRef}
      role="listbox"
      aria-label={hasLabel ? label : placeholder}
      className="
        fixed z-[140] overflow-y-auto rounded-card
        bg-[linear-gradient(180deg,_rgb(38,38,38)_0%,_rgb(26,26,26)_100%)]
        py-1 shadow-[0_18px_40px_rgba(0,0,0,0.58),_inset_0_1px_0_rgba(255,255,255,0.05)]
      "
      style={{
        top: position.top,
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight,
      }}
    >
      {options.map((option, index) => (
        <li
          key={option.value}
          role="option"
          aria-selected={option.value === value}
          onClick={() => handleOptionClick(option.value)}
          onMouseEnter={() => setHighlightedIndex(index)}
          className={`
            flex cursor-pointer items-center justify-between px-3 py-2 transition-colors
            ${index === highlightedIndex ? 'bg-surface-container-highest text-on-surface' : 'text-on-surface'}
            ${option.value === value ? 'text-primary' : ''}
          `}
        >
          <span>{option.label}</span>
          {option.value === value && (
            <span className="text-lg font-bold leading-none text-primary">•</span>
          )}
        </li>
      ))}
    </ul>
  ) : null

  return (
    <div className="space-y-1.5">
      {hasLabel ? (
        <label className="text-sm font-medium text-on-surface-variant">{label}</label>
      ) : null}
      <div ref={containerRef} className="relative">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => {
            if (disabled) return
            updatePosition()
            setIsOpen((current) => !current)
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          className={`
            w-full flex items-center justify-between px-3 py-3 rounded-card transition-all
            bg-surface-dim text-on-surface text-left outline-none text-sm
            ${disabled
              ? 'cursor-not-allowed opacity-50'
              : 'cursor-pointer hover:bg-surface-container-highest focus:ring-1 focus:ring-primary'
            }
          `}
        >
          <span className={selectedOption ? 'text-on-surface' : 'text-on-surface-variant/40'}>
            {selectedOption?.label || placeholder}
          </span>
          <span className={`text-[0.6rem] text-on-surface-variant transition-transform ${isOpen ? 'rotate-180' : ''}`}>▼</span>
        </button>
      </div>
      {listbox && typeof document !== 'undefined' ? createPortal(listbox, document.body) : null}
    </div>
  )
}
