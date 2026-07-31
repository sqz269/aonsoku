import { contours } from 'd3-contour'

// Density estimation for the map overlay. A KDE over 163k points per keystroke
// would be silly; a histogram on a fixed grid plus a separable gaussian blur is
// the same estimator, milliseconds fast, and plays perfectly with d3-contour.

export const GRID = 192

export interface ContourSet {
  /** MultiPolygon rings in data space ([-1, 1] map coordinates). */
  polygons: Array<Array<Array<[number, number]>>>
  /** 0..1 rank of each polygon's threshold — drives the overlay alpha ramp. */
  strengths: number[]
}

function histogram(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  indices: number[] | null,
): Float32Array {
  const field = new Float32Array(GRID * GRID)
  const put = (i: number) => {
    const gx = Math.min(GRID - 1, Math.max(0, ((x[i] + 1) / 2) * (GRID - 1)))
    const gy = Math.min(GRID - 1, Math.max(0, ((y[i] + 1) / 2) * (GRID - 1)))
    field[Math.round(gy) * GRID + Math.round(gx)] += 1
  }
  if (indices) {
    for (const i of indices) put(i)
  } else {
    for (let i = 0; i < x.length; i++) put(i)
  }
  return field
}

function blur(field: Float32Array, sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * 3))
  const kernel = new Float32Array(radius * 2 + 1)
  let kernelSum = 0
  for (let k = -radius; k <= radius; k++) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma))
    kernel[k + radius] = w
    kernelSum += w
  }
  for (let k = 0; k < kernel.length; k++) kernel[k] /= kernelSum

  const pass = (src: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(GRID * GRID)
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        let acc = 0
        for (let k = -radius; k <= radius; k++) {
          const p = col + k
          if (p < 0 || p >= GRID) continue
          acc +=
            kernel[k + radius] *
            (horizontal ? src[row * GRID + p] : src[p * GRID + row])
        }
        if (horizontal) out[row * GRID + col] = acc
        else out[col * GRID + row] = acc
      }
    }
    return out
  }
  return pass(pass(field, true), false)
}

const globalFieldCache = new Map<number, Float32Array>()

/**
 * Contours of one circle's density over the map.
 *
 * With `relative` the field becomes circle density over library density —
 * "where does this circle live, given where music exists at all" — instead of
 * every contour hugging the library's own dense middle. Cells with almost no
 * library mass are zeroed so the ratio can't explode on empty space.
 */
export function buildCircleContours(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  circleIndices: number[],
  sigma: number,
  relative: boolean,
): ContourSet {
  let field = blur(histogram(x, y, circleIndices), sigma)

  if (relative) {
    let global = globalFieldCache.get(sigma)
    if (!global) {
      global = blur(histogram(x, y, null), sigma)
      globalFieldCache.set(sigma, global)
    }
    const floor = 0.02 * Math.max(...global)
    const ratio = new Float32Array(GRID * GRID)
    for (let i = 0; i < ratio.length; i++) {
      ratio[i] = global[i] > floor ? field[i] / global[i] : 0
    }
    field = ratio
  }

  // Two tail problems meet here: the blur smears a whisper of density
  // everywhere (quantiles over that dust ring the whole continent), and in
  // relative mode a few low-mass cells spike the ratio (making anything
  // "% of max" exclude everything else). Winsorize at p99, then rank
  // thresholds only over cells that carry real mass on that capped scale.
  const sorted = Array.from(field)
    .filter((v) => v > 0)
    .sort((a, b) => a - b)
  if (sorted.length === 0) return { polygons: [], strengths: [] }
  const cap = sorted[Math.min(sorted.length - 1, Math.floor(0.99 * sorted.length))]
  if (cap <= 0) return { polygons: [], strengths: [] }
  for (let i = 0; i < field.length; i++) {
    if (field[i] > cap) field[i] = cap
  }
  const meaningful = sorted.filter((v) => v > 0.05 * cap).map((v) => Math.min(v, cap))
  if (meaningful.length === 0) return { polygons: [], strengths: [] }
  const quantile = (q: number) =>
    meaningful[Math.min(meaningful.length - 1, Math.floor(q * meaningful.length))]
  const thresholds = [0.35, 0.55, 0.72, 0.86, 0.96]
    .map(quantile)
    .filter((v, i, arr) => v > 0 && arr.indexOf(v) === i)

  const generator = contours().size([GRID, GRID]).thresholds(thresholds)
  const result = generator(Array.from(field))

  const toData = ([gx, gy]: number[]): [number, number] => [
    (gx / (GRID - 1)) * 2 - 1,
    (gy / (GRID - 1)) * 2 - 1,
  ]
  return {
    polygons: result.map((multi) =>
      multi.coordinates.flatMap((polygon) =>
        polygon.map((ring) => ring.map(toData)),
      ),
    ),
    strengths: result.map((_, i) =>
      result.length > 1 ? i / (result.length - 1) : 1,
    ),
  }
}

export function clearContourCache() {
  globalFieldCache.clear()
}
