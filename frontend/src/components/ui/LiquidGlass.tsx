import { Fragment, useId, useMemo, type CSSProperties, type ReactNode } from 'react'

import { createGlassDisplacementMap, supportsBackdropRefraction } from '../../lib/liquidGlass'

export type GlassOptions = {
  /** Size in px of the element the `.liquid-warp` fills; 0 renders no filter. */
  width: number
  height: number
  /** Corner radius in px. */
  radius: number
  /** Width of the refracting edge in px. */
  bezel: number
  /** Displacement strength in px at the very edge. */
  scale: number
  /** Extra displacement per color channel, for the edge's color fringing. */
  aberration: number
}

const CHANNELS = [
  '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
  '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
  '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0',
]

/**
 * Edge refraction for a liquid-glass surface. In Chromium it returns an SVG filter to render next to
 * the surface and a style that points its `.liquid-warp` at it; elsewhere both are empty and the
 * surface stays clear glass with its rim.
 */
export function useGlassRefraction({ width, height, radius, bezel, scale, aberration }: GlassOptions): { filter: ReactNode; warpStyle: CSSProperties | undefined } {
  const id = `glass-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const map = useMemo(
    () => (width > 0 && height > 0 && supportsBackdropRefraction() ? createGlassDisplacementMap(width, height, radius, bezel) : null),
    [width, height, radius, bezel],
  )
  if (!map) return { filter: null, warpStyle: undefined }

  const filter = (
    <svg aria-hidden="true" focusable="false" width="0" height="0" className="pointer-events-none absolute">
      <filter id={id} x="0" y="0" width={width} height={height} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
        <feImage href={map} x="0" y="0" width={width} height={height} preserveAspectRatio="none" result="map" />
        {CHANNELS.map((values, channel) => (
          <Fragment key={values}>
            <feDisplacementMap in="SourceGraphic" in2="map" scale={-scale * (1 + aberration * channel)} xChannelSelector="R" yChannelSelector="B" result={`shifted-${channel}`} />
            <feColorMatrix in={`shifted-${channel}`} type="matrix" values={values} result={`channel-${channel}`} />
          </Fragment>
        ))}
        <feBlend in="channel-0" in2="channel-1" mode="screen" result="red-green" />
        <feBlend in="red-green" in2="channel-2" mode="screen" />
      </filter>
    </svg>
  )
  return { filter, warpStyle: { '--glass-refraction': `url(#${id})` } as CSSProperties }
}
