import { describe, expect, it } from "vitest"
import {
  COVERAGE_TOLERANCE,
  DEFAULT_ASPECT_RATIO,
  TILE_ASPECT_MAX,
  TILE_ASPECT_MIN,
} from "../layout/constants"
import { layoutGrid, solveGrid } from "../layout/grid-solver"

const GAP = 16

const solve = (
  count: number,
  box: { width: number; height: number },
  minTileWidth = 80
) =>
  solveGrid({
    count,
    width: box.width,
    height: box.height,
    gap: GAP,
    minAspect: TILE_ASPECT_MIN,
    maxAspect: TILE_ASPECT_MAX,
    preferredAspect: DEFAULT_ASPECT_RATIO,
    minTileWidth,
    coverageTolerance: COVERAGE_TOLERANCE,
  })

/** How much of the container the tiles actually cover, gaps included. */
const coverage = (count: number, box: { width: number; height: number }) => {
  const area = layoutGrid(solve(count, box), box, GAP).reduce(
    (total, rect) => total + rect.width * rect.height,
    0
  )
  return area / (box.width * box.height)
}

describe("the grid leaves no hole", () => {
  const WIDE = { width: 960, height: 720 }

  // The counts whose last row is short — where the old solver centred the
  // orphans at the full tile size and left an empty cell beside them. Against
  // the real container, gaps and all: a 16px gutter is the design, and it is
  // what keeps these off 100%.
  it.each([5, 7, 11])("covers the container with %i people", (count) => {
    expect(coverage(count, WIDE)).toBeGreaterThan(0.9)
  })

  it("widens the short row instead of leaving a gap beside it", () => {
    // Three in a portrait panel: two on top of one, and the one takes the
    // width the pair could not.
    const solution = solve(3, { width: 600, height: 800 })
    expect(solution.rowSpecs.map((row) => row.count)).toEqual([2, 1])
    const [pair, single] = solution.rowSpecs
    expect(single?.tileWidth).toBeGreaterThan(pair?.tileWidth ?? 0)
  })

  it("stops widening at the aspect limit rather than cropping a face", () => {
    // One person in an ultrawide box: filling it would need a 2.4:1 tile. The
    // tile widens as far as the clamp allows and the remainder is centred —
    // the one place the grid deliberately leaves space, because the
    // alternative is `object-cover` taking the top of someone's head.
    const box = { width: 2560, height: 1080 }
    const [single] = solve(1, box).rowSpecs
    expect(single).toBeDefined()
    if (!single) {
      return
    }
    expect(single.tileWidth / single.tileHeight).toBeCloseTo(TILE_ASPECT_MAX, 5)
    expect(single.tileWidth).toBeLessThan(box.width)
  })

  it("spreads people evenly rather than filling early rows first", () => {
    // 5 over two rows is 3 + 2, never 3 + 3 with a hole.
    expect(solve(5, WIDE).rowSpecs.map((row) => row.count)).toEqual([3, 2])
  })

  it("keeps every row inside the container", () => {
    for (let count = 1; count <= 24; count++) {
      const solution = solve(count, WIDE)
      for (const rect of layoutGrid(solution, WIDE, GAP)) {
        expect(rect.x).toBeGreaterThanOrEqual(-0.001)
        expect(rect.y).toBeGreaterThanOrEqual(-0.001)
        expect(rect.x + rect.width).toBeLessThanOrEqual(WIDE.width + 0.001)
        expect(rect.y + rect.height).toBeLessThanOrEqual(WIDE.height + 0.001)
      }
    }
  })

  it("never lets a tile leave the permitted aspect range", () => {
    // The clamp is the one thing allowed to leave space: without it a lone tile
    // on a wide row becomes a slit and `object-cover` takes the face with it.
    for (const box of [WIDE, { width: 420, height: 900 }]) {
      for (let count = 1; count <= 12; count++) {
        for (const row of solve(count, box).rowSpecs) {
          const aspect = row.tileWidth / row.tileHeight
          expect(aspect).toBeGreaterThanOrEqual(TILE_ASPECT_MIN - 0.001)
          expect(aspect).toBeLessThanOrEqual(TILE_ASPECT_MAX + 0.001)
        }
      }
    }
  })
})

describe("two people", () => {
  it("sits them side by side in a wide room, each filling its half", () => {
    const solution = solve(2, { width: 960, height: 720 })
    expect(solution.rows).toBe(1)
    expect(solution.cols).toBe(2)
    expect(solution.tileHeight).toBeCloseTo(720, 5)
  })

  it("stacks them in a side panel instead of shrinking them", () => {
    // The case the old `SPOTLIGHT_ASPECT` constant forced into a spotlight: a
    // 450px panel stacks two people perfectly well.
    const panel = { width: 426, height: 686 }
    const solution = solve(2, panel)
    expect(solution.rows).toBe(2)
    expect(solution.cols).toBe(1)
    expect(coverage(2, panel)).toBeGreaterThan(0.95)
  })
})
