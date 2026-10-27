type NavigatorWithBrands = Navigator & { userAgentData?: { brands?: { brand: string }[] } }

const CHROMIUM_BRAND = /Chromium|Google Chrome|Microsoft Edge/
// Sheets get a new map per viewport size; keep only the most recent few.
const MAP_CACHE_LIMIT = 8

/**
 * Only Chromium applies SVG filters to an element's backdrop. WebKit (every iOS browser and
 * home-screen PWA) and Gecko ignore them, so callers fall back to the plain glass there.
 */
export function supportsBackdropRefraction(nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator) {
  const brands = (nav as NavigatorWithBrands | undefined)?.userAgentData?.brands ?? []
  return brands.some(({ brand }) => CHROMIUM_BRAND.test(brand))
}

const mapCache = new Map<string, string>()

/** Outward edge normal for a point inside a rounded rectangle; `qx`/`qy` are its distances past the straight edges. */
function edgeNormal(px: number, py: number, qx: number, qy: number): [number, number] {
  if (qx > 0 && qy > 0) {
    const length = Math.hypot(qx, qy)
    return [(qx / length) * Math.sign(px), (qy / length) * Math.sign(py)]
  }
  return qx > qy ? [Math.sign(px), 0] : [0, Math.sign(py)]
}

/** Red/blue channel values for a pixel at `px`, `py` from the center of a `halfWidth` x `halfHeight` rounded rectangle. */
export function glassPixel(px: number, py: number, halfWidth: number, halfHeight: number, radius: number, bezel: number): [number, number] {
  const qx = Math.abs(px) - (halfWidth - radius)
  const qy = Math.abs(py) - (halfHeight - radius)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
  const depth = -outside
  if (depth < 0 || depth >= bezel) return [128, 128]
  const [nx, ny] = edgeNormal(px, py, qx, qy)
  const strength = Math.pow(1 - depth / bezel, 1.6) * 127
  return [128 + nx * strength, 128 + ny * strength]
}

function writePixel(data: Uint8ClampedArray, x: number, y: number, width: number, halfWidth: number, halfHeight: number, radius: number, bezel: number) {
  const [red, blue] = glassPixel(x + 0.5 - halfWidth, y + 0.5 - halfHeight, halfWidth, halfHeight, radius, bezel)
  const offset = (y * width + x) * 4
  data[offset] = red
  data[offset + 2] = blue
}

/**
 * Fills RGBA `data` with the displacement for a rounded rectangle. Everything deeper than `bezel`
 * from the edge is neutral, so only the edge bands are computed: a full-sheet map is ~280k pixels,
 * but only a few percent of them carry any offset.
 */
export function fillGlassDisplacement(data: Uint8ClampedArray, width: number, height: number, radius: number, bezel: number) {
  data.fill(128)
  for (let offset = 3; offset < data.length; offset += 4) data[offset] = 255
  const halfWidth = width / 2
  const halfHeight = height / 2
  const cornerRadius = Math.min(radius, halfWidth, halfHeight)
  // Rows this close to the top or bottom can be in a corner, so every column is computed there;
  // other rows only have non-neutral pixels within `bezel` of the left and right edges.
  const band = Math.ceil(cornerRadius + bezel) + 1
  const sideBand = Math.ceil(bezel) + 1
  for (let y = 0; y < height; y += 1) {
    if (y < band || y >= height - band || sideBand * 2 >= width) {
      for (let x = 0; x < width; x += 1) writePixel(data, x, y, width, halfWidth, halfHeight, cornerRadius, bezel)
      continue
    }
    for (let x = 0; x < sideBand; x += 1) writePixel(data, x, y, width, halfWidth, halfHeight, cornerRadius, bezel)
    for (let x = width - sideBand; x < width; x += 1) writePixel(data, x, y, width, halfWidth, halfHeight, cornerRadius, bezel)
  }
}

/**
 * Displacement map for a rounded rectangle. Red carries the x offset and blue the y offset
 * (128 means none), growing toward the edge across `bezel` px. Returns null without a 2D canvas.
 */
export function createGlassDisplacementMap(width: number, height: number, radius: number, bezel: number): string | null {
  const key = `${width}x${height}:${radius}:${bezel}`
  const cached = mapCache.get(key)
  if (cached) return cached
  if (typeof document === 'undefined' || width <= 0 || height <= 0) return null

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return null

  const image = context.createImageData(width, height)
  fillGlassDisplacement(image.data, width, height, radius, bezel)
  context.putImageData(image, 0, 0)
  const url = canvas.toDataURL()
  if (mapCache.size >= MAP_CACHE_LIMIT) mapCache.delete(mapCache.keys().next().value as string)
  mapCache.set(key, url)
  return url
}
