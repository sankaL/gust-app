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
  placeholder?: string
  disabled?: boolean
}

export function SelectDropdown({
  label,
  options,
  value,
  onChange,
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
      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          className={`
            w-full flex items-center justify-between px-3 py-2 rounded-lg border transition-colors
            bg-surface-container-low text-on-surface text-left
            ${disabled 
              ? 'opacity-50 cursor-not-allowed border-outline' 
              : 'cursor-pointer border-outline hover:border-on-surface-variant focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary'
            }
          `}
        >
          <span className={selectedOption ? 'text-on-surface' : 'text-on-surface-variant/60'}>
            {selectedOption?.label || placeholder}
          </span>
          <svg
            className={`w-4 h-4 text-on-surface-variant transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isOpen && (
          <ul
            ref={listRef}
            role="listbox"
            aria-label={hasLabel ? label : placeholder}
            className="
              absolute z-50 mt-1 w-full rounded-lg border border-outline/30
              bg-surface-container-high/95 backdrop-blur-md shadow-lg
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
                  <svg className="w-4 h-4 text-primary" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
