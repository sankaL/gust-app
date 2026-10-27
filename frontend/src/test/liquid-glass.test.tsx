import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useGlassRefraction } from '../components/ui/LiquidGlass'
import { createGlassDisplacementMap, supportsBackdropRefraction } from '../lib/liquidGlass'

const withBrands = (brands: string[]) => ({ userAgentData: { brands: brands.map((brand) => ({ brand, version: '1' })) } }) as unknown as Navigator

const LENS = { width: 44, height: 44, radius: 22, bezel: 14, scale: 28, aberration: 0.08 }

function LensProbe() {
  const lens = useGlassRefraction(LENS)
  return (
    <div>
      <span data-testid="warp" style={lens.warpStyle} />
      {lens.filter}
    </div>
  )
}

describe('liquid glass refraction', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('only reports backdrop refraction for Chromium browsers', () => {
    expect(supportsBackdropRefraction(withBrands(['Not?A_Brand', 'Chromium']))).toBe(true)
    expect(supportsBackdropRefraction(withBrands(['Google Chrome']))).toBe(true)
    // Safari and Firefox expose no client-hint brands, so they keep the plain glass.
    expect(supportsBackdropRefraction({} as Navigator)).toBe(false)
    expect(supportsBackdropRefraction(undefined)).toBe(false)
  })

  it('returns no displacement map when a 2D canvas is unavailable', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    expect(createGlassDisplacementMap(31, 31, 15, 9)).toBeNull()
  })

  it('renders no refraction filter outside Chromium', () => {
    const { container, getByTestId } = render(<LensProbe />)
    expect(container.querySelector('filter')).toBeNull()
    expect(getByTestId('warp').style.getPropertyValue('--glass-refraction')).toBe('')
  })
})
