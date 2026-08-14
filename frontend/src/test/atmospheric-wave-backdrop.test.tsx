import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AtmosphericWaveBackdrop } from '../components/AtmosphericWaveBackdrop'
import { ExtractingLoader } from '../components/ExtractingLoader'

describe('AtmosphericWaveBackdrop', () => {
  it('renders idle mode with purple wave gradients and animateTransform elements', () => {
    const { container } = render(<AtmosphericWaveBackdrop mode="idle" />)
    const defs = container.querySelector('defs')
    expect(defs).toBeInTheDocument()
    expect(container.querySelector('#wave-grad-1-idle')).toBeInTheDocument()
    expect(container.querySelector('#wave-grad-2-idle')).toBeInTheDocument()
    const animates = container.querySelectorAll('animateTransform')
    expect(animates.length).toBe(3)
  })

  it('renders recording mode with reddish/rose wave gradients', () => {
    const { container } = render(<AtmosphericWaveBackdrop mode="recording" />)
    expect(container.querySelector('#wave-grad-1-recording')).toBeInTheDocument()
    expect(container.querySelector('#wave-grad-2-recording')).toBeInTheDocument()
    const animates = container.querySelectorAll('animateTransform')
    expect(animates.length).toBe(3)
  })

  it('renders extracting mode with emerald/green wave gradients', () => {
    const { container } = render(<AtmosphericWaveBackdrop mode="extracting" />)
    expect(container.querySelector('#wave-grad-1-extracting')).toBeInTheDocument()
    expect(container.querySelector('#wave-grad-2-extracting')).toBeInTheDocument()
    const animates = container.querySelectorAll('animateTransform')
    expect(animates.length).toBe(3)
  })
})

describe('ExtractingLoader', () => {
  it('renders the voice variant in greenish extracting mode with rotating word indicator', () => {
    render(<ExtractingLoader variant="voice" />)
    expect(screen.getByRole('status', { name: 'Transcribing voice' })).toBeInTheDocument()
    expect(screen.getByText('Analyzing your voice...')).toBeInTheDocument()
  })

  it('renders the tasks variant in greenish extracting mode', () => {
    render(<ExtractingLoader variant="tasks" />)
    expect(screen.getByText('Analyzing your voice...')).toBeInTheDocument()
  })
})
