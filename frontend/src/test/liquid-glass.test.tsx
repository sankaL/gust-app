import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useGlassRefraction } from '../components/ui/LiquidGlass'
import { createGlassDisplacementMap, fillGlassDisplacement, glassPixel, supportsBackdropRefraction } from '../lib/liquidGlass'

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

  it('matches a full per-pixel map while only computing the edge bands', () => {
    for (const [width, height, radius, bezel] of [[120, 90, 20, 12], [64, 200, 36, 22], [30, 30, 15, 9], [400, 40, 36, 22]]) {
      const fast = new Uint8ClampedArray(width * height * 4)
      fillGlassDisplacement(fast, width, height, radius, bezel)
      const full = new Uint8ClampedArray(width * height * 4)
      const cornerRadius = Math.min(radius, width / 2, height / 2)
      for (let index = 0; index < width * height; index += 1) {
        const [red, blue] = glassPixel((index % width) + 0.5 - width / 2, Math.floor(index / width) + 0.5 - height / 2, width / 2, height / 2, cornerRadius, bezel)
        full.set([red, 128, blue, 255], index * 4)
      }
      expect(Array.from(fast)).toEqual(Array.from(full))
    }
  })

  it('renders no refraction filter outside Chromium', () => {
    const { container, getByTestId } = render(<LensProbe />)
    expect(container.querySelector('filter')).toBeNull()
    expect(getByTestId('warp').style.getPropertyValue('--glass-refraction')).toBe('')
  })
})
