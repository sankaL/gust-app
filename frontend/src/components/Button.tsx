import { ButtonHTMLAttributes, forwardRef } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft' | 'tertiary' | 'solid' | 'mic'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
}

const BASE_CLASS =
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-pill font-body font-semibold tracking-[-0.005em] outline-none transition-[transform,background-color,box-shadow,color,opacity] duration-200 ease-out-expo focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45'

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-[0.8rem]',
  md: 'h-11 px-5 text-sm',
  lg: 'h-[3.25rem] px-6 text-[0.95rem]',
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary shadow-[0_8px_20px_-10px_rgb(var(--color-primary-dim))] hover:bg-primary-dim',
  secondary: 'bg-surface-container-high text-on-surface ring-1 ring-inset ring-outline/70 hover:bg-surface-container-highest',
  ghost: 'bg-transparent text-on-surface-variant hover:bg-on-surface/[0.06] hover:text-on-surface',
  danger: 'bg-chip-rose text-chip-rose-ink hover:bg-tertiary hover:text-white',
  soft: 'bg-primary/[0.12] text-primary hover:bg-primary/20',
  // Legacy aliases kept so older call sites inherit the unified styling.
  tertiary: 'bg-chip-rose text-chip-rose-ink hover:bg-tertiary hover:text-white',
  solid: 'bg-primary text-on-primary hover:bg-primary-dim',
  mic: 'bg-primary text-on-primary hover:bg-primary-dim',
}

function buttonClass({ variant = 'secondary', size = 'md', fullWidth = false, className = '' }: { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean; className?: string } = {}) {
  return [BASE_CLASS, SIZE_CLASSES[size], VARIANT_CLASSES[variant], fullWidth ? 'w-full' : '', className].filter(Boolean).join(' ')
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'secondary', size = 'md', fullWidth = false, children, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} className={buttonClass({ variant, size, fullWidth, className })} {...props}>
      {children}
    </button>
  )
)

Button.displayName = 'Button'
