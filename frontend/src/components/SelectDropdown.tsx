import { useState, useRef, useEffect } from 'react'

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
  const listRef = useRef<HTMLUListElement>(null)

  const selectedOption = options.find((opt) => opt.value === value)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const highlightedElement = listRef.current.children[highlightedIndex] as HTMLElement
      highlightedElement?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIndex])

  useEffect(() => {
    onOpenChange?.(isOpen)
  }, [isOpen, onOpenChange])

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
          setIsOpen(!isOpen)
        }
        break
      case 'ArrowDown':
        event.preventDefault()
        if (!isOpen) {
          setIsOpen(true)
          setHighlightedIndex(options.length > 0 ? 0 : -1)
        } else {
          if (options.length > 0) {
            setHighlightedIndex((prev) => Math.min(prev + 1, options.length - 1))
          }
        }
        break
      case 'ArrowUp':
        event.preventDefault()
        if (isOpen) {
          if (options.length > 0) {
            setHighlightedIndex((prev) => Math.max(prev - 1, 0))
          }
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

  return (
    <div className="space-y-1.5">
      {hasLabel ? (
        <label className="text-sm font-medium text-on-surface-variant">{label}</label>
      ) : null}
      <div ref={containerRef} className={`relative ${isOpen ? 'z-[70]' : 'z-0'}`}>
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          className={`
            w-full flex items-center justify-between px-3 py-3 rounded-card transition-all
            bg-surface-dim text-on-surface text-left outline-none text-sm
            ${disabled 
              ? 'opacity-50 cursor-not-allowed' 
              : 'cursor-pointer hover:bg-surface-container-highest focus:ring-1 focus:ring-primary'
            }
          `}
        >
          <span className={selectedOption ? 'text-on-surface' : 'text-on-surface-variant/40'}>
            {selectedOption?.label || placeholder}
          </span>
          <span className={`text-on-surface-variant transition-transform text-[0.6rem] ${isOpen ? 'rotate-180' : ''}`}>▼</span>
        </button>

        {isOpen && (
          <ul
            ref={listRef}
            role="listbox"
            aria-label={hasLabel ? label : placeholder}
            className="
              absolute z-[80] mt-2 w-full overflow-hidden rounded-card
              bg-[linear-gradient(180deg,_rgb(38,38,38)_0%,_rgb(26,26,26)_100%)]
              shadow-[0_18px_40px_rgba(0,0,0,0.58),_inset_0_1px_0_rgba(255,255,255,0.05)]
              max-h-60 overflow-y-auto py-1
            "
          >
            {options.map((option, index) => (
              <li
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                onClick={() => handleOptionClick(option.value)}
                onMouseEnter={() => setHighlightedIndex(index)}
                className={`
                  flex items-center justify-between px-3 py-2 cursor-pointer transition-colors
                  ${index === highlightedIndex ? 'bg-surface-container-highest text-on-surface' : 'text-on-surface'}
                  ${option.value === value ? 'text-primary' : ''}
                `}
              >
                <span>{option.label}</span>
                {option.value === value && (
                  <span className="text-primary font-bold text-lg leading-none">•</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
