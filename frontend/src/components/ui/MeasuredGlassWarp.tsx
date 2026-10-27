import { useEffect, useState, type RefObject } from 'react'

import { supportsBackdropRefraction } from '../../lib/liquidGlass'
import { useGlassRefraction, type GlassOptions } from './LiquidGlass'

/** Whole-pixel size of `ref`'s element while `active`; only observed where refraction can render. */
function useGlassSize(ref: RefObject<HTMLElement | null>, active: boolean) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const element = ref.current
    if (!active || !element || typeof ResizeObserver === 'undefined' || !supportsBackdropRefraction()) return undefined
    const observer = new ResizeObserver(() => {
      const next = { width: element.offsetWidth, height: element.offsetHeight }
      setSize((current) => (current.width === next.width && current.height === next.height ? current : next))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [active, ref])
  return size
}

/** The `.liquid-warp` layer for a surface whose size can change, such as a bottom sheet. */
export function MeasuredGlassWarp({ targetRef, active, ...glass }: { targetRef: RefObject<HTMLElement | null>; active: boolean } & Omit<GlassOptions, 'width' | 'height'>) {
  const size = useGlassSize(targetRef, active)
  const { filter, warpStyle } = useGlassRefraction({ ...size, ...glass })
  return (
    <>
      <span aria-hidden="true" className="liquid-warp" style={warpStyle} />
      {filter}
    </>
  )
}
