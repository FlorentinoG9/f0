import { type F0Rect } from "../types"
import {
  COMPACT_TILE_WIDTH,
  CORNER_CHIP,
  COVERAGE_TOLERANCE,
  DEFAULT_ASPECT_RATIO,
  GRID_MAX_TILES,
  TILE_ASPECT_MAX,
  TILE_ASPECT_MIN,
  gapFor,
  gapForTile,
  minTileHeightFor,
  minTileWidthFor,
  radiusForTile,
} from "./constants"
import { type GridSolution, layoutGrid, solveGrid } from "./grid-solver"

export type PlanGridInput = {
  box: { width: number; height: number }
  /** Everyone who wants a cell. The plan caps and overflows on its own. */
  tileCount: number
  /** First-pass gap; the container's guess when omitted. */
  gapHint?: number
}

export type GridPlan = {
  /** One per visible tile, in tile order. */
  rects: F0Rect[]
  /** The overflow chip's cell, or null while everyone fits. */
  chipRect: F0Rect | null
  /** Tiles that get a rect. Everyone past this is in the chip. */
  visibleCount: number
  /** How many the solver could seat before the chip took its cell. */
  capacity: number
  /** The narrowest tile — what the gap, radius and density are derived from. */
  tileWidth: number
  gap: number
  radius: number
  compact: boolean
}

/** The chip sits in the corner when the layout has no cell to give it. */
export const cornerChipRect = (
  box: { width: number; height: number },
  gap: number
): F0Rect => ({
  x: Math.max(0, box.width - CORNER_CHIP.width - gap),
  y: Math.max(0, box.height - CORNER_CHIP.height - gap),
  ...CORNER_CHIP,
})

/**
 * The grid branch of the room, as a pure function of the box and the count, so
 * the component and the tests run the same pipeline.
 *
 * Everything the grid decides is here: the cap, the two-pass gap, the floors,
 * the chip's cell and the one case that drops the floor. `MeetingGrid` keeps
 * the spotlight, focus and speaker order, which are about WHO — this is about
 * how many, and where.
 */
export const planGrid = ({
  box,
  tileCount,
  gapHint,
}: PlanGridInput): GridPlan => {
  const count = Math.min(tileCount, GRID_MAX_TILES)

  // `floor: 0` drops both minimums — see the "never +1" case below, the one
  // place a tile under the comfort floor beats the alternative.
  const solveWith = (gap: number, floor = 1): GridSolution =>
    solveGrid({
      count,
      width: box.width,
      height: box.height,
      gap,
      minAspect: TILE_ASPECT_MIN,
      maxAspect: TILE_ASPECT_MAX,
      preferredAspect: DEFAULT_ASPECT_RATIO,
      minTileWidth: floor * minTileWidthFor(box.width),
      minTileHeight: floor * minTileHeightFor(box.height),
      coverageTolerance: COVERAGE_TOLERANCE,
    })

  // Two passes, and only two. The gap depends on the tile size, and the tile
  // size depends on the gap — so solve once with the container's guess, read
  // the tile that produces, and re-solve with the gap that tile actually wants.
  // `solveGrid` is pure and cheap, and stopping at two makes it deterministic
  // rather than a settling loop.
  const provisionalGap = gapHint ?? gapFor(box.width)
  const provisional = solveWith(provisionalGap)
  const gap = gapForTile(provisional.tileWidth)
  const solution = gap === provisionalGap ? provisional : solveWith(gap)

  const capacity = solution.visibleCount
  // The chip is a cell like any other, so it simply takes the last one —
  // except when that is the only cell there is. A room showing nobody and a
  // "+2" is worse than either half of it, so the last face keeps its place
  // and the chip goes in the corner instead.
  const seats = capacity < tileCount ? Math.max(1, capacity - 1) : capacity

  // Never "+1" (SPEC §Never "+1"): a chip standing for one person costs the
  // same cell as their tile and tells you less. The only way to get there is a
  // container that seats a single tile, and what the spec promises there is
  // the plain two-up grid — so the floor is dropped for that one case rather
  // than hiding a person behind a number.
  const twoUp = tileCount - seats === 1 ? solveWith(gap, 0) : null
  const grid = twoUp ?? solution
  const visibleCount = twoUp ? Math.min(tileCount, twoUp.visibleCount) : seats

  const rects = layoutGrid(grid, box, gap)
  const chipRect =
    visibleCount < tileCount
      ? (rects[visibleCount] ?? cornerChipRect(box, gap))
      : null

  return {
    rects: rects.slice(0, visibleCount),
    chipRect,
    visibleCount,
    capacity,
    tileWidth: grid.tileWidth,
    gap,
    radius: radiusForTile(grid.tileWidth),
    compact: grid.tileWidth < COMPACT_TILE_WIDTH,
  }
}
