import { type F0Rect } from "../types"
import { clamp } from "../utils/aspect"

export type GridSolverInput = {
  count: number
  width: number
  height: number
  gap: number
  /**
   * How far a tile may stray from `preferredAspect` to fill its cell. Inside
   * this range the tile simply IS the cell, so the grid leaves no dead space.
   */
  minAspect: number
  maxAspect: number
  /** Only breaks ties between layouts of equal quality. */
  preferredAspect: number
  /** Below this a tile stops being useful; the solver overflows instead. */
  minTileWidth: number
  /**
   * The same floor for height. Optional, and 0 means "no floor" — a caller with
   * only a width in mind gets exactly the old behaviour.
   */
  minTileHeight?: number
  /**
   * How much smaller than the best possible worst tile a layout may make its
   * smallest tile to compete on total coverage. `1` (the default) is pure
   * maximin; `COVERAGE_TOLERANCE` is what the room uses.
   */
  coverageTolerance?: number
}

/** One row of the grid. Rows may hold different counts, so also different widths. */
export type GridRow = {
  count: number
  tileWidth: number
  tileHeight: number
}

export type GridSolution = {
  rows: number
  /** Widest row's tile count. */
  cols: number
  /** The NARROWEST row's tile — the worst case, which is what limits are about. */
  tileWidth: number
  tileHeight: number
  /** Tiles that fit. `count - visibleCount` go to the overflow chip. */
  visibleCount: number
  rowSpecs: GridRow[]
  /** Σ tile areas: how much of the container the layout actually covers. */
  totalArea: number
}

/** Layouts within this much of each other's total area count as a tie. */
const AREA_EPSILON = 0.99

/** A viable split, with the numbers selection is made on. */
type Candidate = {
  rows: number
  counts: number[]
  specs: GridRow[]
  worst: GridRow
  worstArea: number
  totalArea: number
  /** Mean log-distance of the rows' aspects to the preferred one. */
  shape: number
}

/**
 * Spreads `count` over `rows` as evenly as possible, fuller rows first.
 *
 * `Math.ceil(count / rows)` for every row is what used to leave a hole: five
 * people over two rows became 3 + 3 with one cell empty, instead of 3 + 2 with
 * none.
 */
const distribute = (count: number, rows: number): number[] => {
  const base = Math.floor(count / rows)
  const extra = count % rows
  return Array.from({ length: rows }, (_, row) => base + (row < extra ? 1 : 0))
}

/** Fits a tile into its cell, taking the cell's shape within the range. */
const fitCell = (
  cellWidth: number,
  cellHeight: number,
  minAspect: number,
  maxAspect: number
): { width: number; height: number; aspect: number } => {
  const aspect = clamp(cellWidth / cellHeight, minAspect, maxAspect)
  let width = cellWidth
  let height = width / aspect
  if (height > cellHeight) {
    height = cellHeight
    width = height * aspect
  }
  return { width, height, aspect }
}

/**
 * Sizes one split's rows. Null when the split cannot be drawn or its smallest
 * tile misses a floor.
 *
 * The minimum belongs INSIDE the search, not after it. Choosing the best split
 * first and rejecting it afterwards for being too small is what pushed people
 * into the chip who fit perfectly well: at 1912x852, sixteen people have a
 * clean 4x4 at 358px wide, but 6+5+5 wins on area at 305px, fails the 320px
 * floor, and takes the whole count down with it — so the room showed 14 and a
 * "+2". It also made capacity non-monotonic, where twenty people all fitted
 * and sixteen did not.
 */
const evaluateSplit = (
  count: number,
  rows: number,
  input: GridSolverInput
): Candidate | null => {
  const { width, height, gap, minAspect, maxAspect, preferredAspect } = input
  const minTileHeight = input.minTileHeight ?? 0
  const rowHeight = (height - gap * (rows - 1)) / rows
  if (rowHeight <= 0) {
    return null
  }

  const counts = distribute(count, rows)
  const specs: GridRow[] = []
  // The smallest tile stands for the layout, so it must stay a REAL tile:
  // taking its width from one row and its height from another describes a
  // rectangle that the grid never draws.
  let worst: GridRow | null = null
  let worstArea = Number.POSITIVE_INFINITY
  let totalArea = 0
  let shape = 0

  for (const inRow of counts) {
    const cellWidth = (width - gap * (inRow - 1)) / inRow
    if (cellWidth <= 0) {
      return null
    }
    const tile = fitCell(cellWidth, rowHeight, minAspect, maxAspect)
    const spec = {
      count: inRow,
      tileWidth: tile.width,
      tileHeight: tile.height,
    }
    specs.push(spec)
    const area = tile.width * tile.height
    totalArea += area * inRow
    if (area < worstArea) {
      worstArea = area
      worst = spec
    }
    // Log distance, so twice and half the target are equally far off.
    shape += Math.abs(Math.log(tile.aspect / preferredAspect))
  }

  if (
    !worst ||
    worst.tileWidth < input.minTileWidth ||
    worst.tileHeight < minTileHeight
  ) {
    return null
  }

  return {
    rows,
    counts,
    specs,
    worst,
    worstArea,
    totalArea,
    shape: shape / specs.length,
  }
}

/**
 * Coverage within a tolerance of maximin.
 *
 * Maximin alone picked three portrait columns over a 2+1 split because the
 * columns' worst tile was a few percent bigger, and left a quarter of the room
 * empty. So: every split whose worst tile is within `tolerance` of the best
 * worst tile is in the pool, and the pool is decided on total area. Ties go to
 * the shape nearest the preferred aspect, so the result is deterministic across
 * a pixel of resize. With `tolerance` 1 the pool is the maximin winners alone.
 */
const pick = (candidates: Candidate[], tolerance: number): Candidate | null => {
  let bestWorst = 0
  for (const candidate of candidates) {
    bestWorst = Math.max(bestWorst, candidate.worstArea)
  }

  let best: Candidate | null = null
  for (const candidate of candidates) {
    if (candidate.worstArea < bestWorst * tolerance) {
      continue
    }
    if (!best) {
      best = candidate
      continue
    }
    const bigger = candidate.totalArea > best.totalArea
    const tied =
      Math.min(candidate.totalArea, best.totalArea) >=
      Math.max(candidate.totalArea, best.totalArea) * AREA_EPSILON
    if (tied ? candidate.shape < best.shape : bigger) {
      best = candidate
    }
  }
  return best
}

/**
 * Most tiles the floors could possibly admit, so the search starts there
 * instead of at a count it will reject anyway. With a 320px floor in a 1440px
 * room that is the difference between solving for 200 people and for 16.
 */
const admissible = (input: GridSolverInput): number => {
  const { width, height, gap, minTileWidth } = input
  const minTileHeight = Math.max(1, input.minTileHeight ?? 0)
  const maxCols = Math.floor((width + gap) / (minTileWidth + gap))
  const maxRows = Math.floor((height + gap) / (minTileHeight + gap))
  return maxCols > 0 && maxRows > 0
    ? Math.max(1, maxCols * maxRows)
    : Number.POSITIVE_INFINITY
}

/**
 * Picks the row split for the most people the floors admit, each row filling
 * the container's width on its own.
 *
 * Two ideas do the work. A tile takes the shape of its own cell within
 * `[minAspect, maxAspect]`, so inside that range the tile IS the cell and the
 * block covers the container instead of letterboxing a fixed 16:9 box in every
 * cell. And rows are sized independently, so an incomplete last row spreads its
 * tiles over the full width rather than leaving the missing cells as a hole —
 * three people fill the room, they do not sit next to an empty square.
 *
 * Selection is coverage within a tolerance of maximin — see `pick`.
 *
 * Pure, so it is tested without rendering.
 */
export const solveGrid = (input: GridSolverInput): GridSolution => {
  const { count, width, height, minAspect, maxAspect } = input
  const tolerance = input.coverageTolerance ?? 1
  let remaining = Math.min(Math.max(1, Math.floor(count)), admissible(input))

  while (remaining >= 1) {
    const candidates: Candidate[] = []
    for (let rows = 1; rows <= remaining; rows++) {
      const candidate = evaluateSplit(remaining, rows, input)
      if (candidate) {
        candidates.push(candidate)
      }
    }

    const best = pick(candidates, tolerance)
    if (best) {
      return {
        rows: best.rows,
        cols: Math.max(...best.counts),
        tileWidth: best.worst.tileWidth,
        tileHeight: best.worst.tileHeight,
        visibleCount: remaining,
        rowSpecs: best.specs,
        totalArea: best.totalArea,
      }
    }
    // No split of this many clears the floor: one more participant moves to the
    // overflow chip, re-solve.
    remaining--
  }

  // Not even one tile clears the minimum. Something still has to render, so the
  // last resort ignores it rather than showing an empty room.
  const tile = fitCell(
    Math.max(0, width),
    Math.max(0, height),
    minAspect,
    maxAspect
  )

  return {
    rows: 1,
    cols: 1,
    tileWidth: tile.width,
    tileHeight: tile.height,
    visibleCount: 1,
    rowSpecs: [{ count: 1, tileWidth: tile.width, tileHeight: tile.height }],
    totalArea: tile.width * tile.height,
  }
}

/**
 * Places the solved tiles. Rows sit in equal-height slots that span the
 * container, and each row centres its own tiles inside its slot — so a row
 * that the aspect clamp shrank is centred rather than pinned to a corner.
 *
 * Returns absolute rects so the caller can animate x/y/width/height directly —
 * no `scale`, which is what would warp the video mid-flight.
 */
export const layoutGrid = (
  solution: GridSolution,
  box: { width: number; height: number },
  gap: number
): F0Rect[] => {
  const rects: F0Rect[] = []
  const slotHeight = (box.height - gap * (solution.rows - 1)) / solution.rows

  solution.rowSpecs.forEach((row, index) => {
    const rowWidth = row.count * row.tileWidth + gap * (row.count - 1)
    const offsetX = (box.width - rowWidth) / 2
    const slotY = index * (slotHeight + gap)
    const offsetY = slotY + (slotHeight - row.tileHeight) / 2

    for (let column = 0; column < row.count; column++) {
      rects.push({
        x: offsetX + column * (row.tileWidth + gap),
        y: offsetY,
        width: row.tileWidth,
        height: row.tileHeight,
      })
    }
  })

  return rects
}
