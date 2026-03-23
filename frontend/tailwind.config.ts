import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: 'var(--color-surface)',
        'surface-dim': 'var(--color-surface-dim)',
        'surface-container': 'var(--color-surface-container)',
        'surface-container-high': 'var(--color-surface-container-high)',
        'surface-container-highest': 'var(--color-surface-container-highest)',
        'surface-variant': 'var(--color-surface-variant)',
        primary: 'var(--color-primary)',
        'primary-dim': 'var(--color-primary-dim)',
        secondary: 'var(--color-secondary)',
        'secondary-dim': 'var(--color-secondary-dim)',
        tertiary: 'var(--color-tertiary)',
        success: 'var(--color-success)',
        'success-dim': 'var(--color-success-dim)',
        warning: 'var(--color-warning)',
        'warning-dim': 'var(--color-warning-dim)',
        error: 'var(--color-error)',
        'error-dim': 'var(--color-error-dim)',
        info: 'var(--color-info)',
        'info-dim': 'var(--color-info-dim)',
        'on-surface': 'var(--color-on-surface)',
        'on-surface-variant': 'var(--color-on-surface-variant)',
        outline: 'var(--color-outline)'
      },
      fontFamily: {
        display: ['Manrope', 'sans-serif'],
        body: ['Inter', 'sans-serif']
      },
      borderRadius: {
        card: '1rem',
        soft: '1.5rem',
        pill: '9999px'
      },
      boxShadow: {
        ambient: '0 0 40px rgba(132, 85, 239, 0.12)'
      },
      spacing: {
        4: '1.4rem',
        8: '2.75rem',
        16: '5.5rem'
      }
    }
  },
  plugins: []
}

export default config
