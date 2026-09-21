import { describe, expect, it } from "vitest"
import {
  COVERAGE_TOLERANCE,
  DEFAULT_ASPECT_RATIO,
  TILE_ASPECT_MAX,
  TILE_ASPECT_MIN,
} from "../layout/constants"
import { layoutGrid, solveGrid } from "../layout/grid-solver"

const BOX = { width: 1200, height: 700 }

const solve = (count: number, box = BOX, minTileWidth = 128) =>
  solveGrid({
    count,
    width: box.width,
    height: box.height,
    gap: 16,
    minAspect: TILE_ASPECT_MIN,
    maxAspect: TILE_ASPECT_MAX,
    preferredAspect: DEFAULT_ASPECT_RATIO,
    minTileWidth,
  })

describe("solveGrid", () => {
  it("fills the container with a single tile", () => {
    const solution = solve(1)
    expect(solution.rows).toBe(1)
    expect(solution.cols).toBe(1)
    expect(solution.visibleCount).toBe(1)
  })

  it("splits two tiles side by side in a landscape container", () => {
    const solution = solve(2)
    expect(solution.rows).toBe(1)
    expect(solution.cols).toBe(2)
  })

  it("uses the conventional layout for common counts in a wide container", () => {
    // What every call product does, and what area alone would not always pick.
    expect(solve(4)).toMatchObject({ rows: 2, cols: 2 })
    expect(solve(6)).toMatchObject({ rows: 2, cols: 3 })
    expect(solve(9)).toMatchObject({ rows: 3, cols: 3 })
    expect(solve(12)).toMatchObject({ rows: 3, cols: 4 })
  })

  it("stacks instead of spreading in a portrait container", () => {
    const solution = solve(2, { width: 400, height: 900 })
    expect(solution.rows).toBe(2)
    expect(solution.cols).toBe(1)
  })

  it("handles counts the previous implementation could not render at all", () => {
    for (const count of [8, 9, 12, 16, 25, 49, 64]) {
      const solution = solve(count)
      expect(solution.rows * solution.cols).toBeGreaterThanOrEqual(
        solution.visibleCount
      )
      expect(solution.tileWidth).toBeGreaterThan(0)
      expect(solution.tileHeight).toBeGreaterThan(0)
    }
  })

  it("keeps every tile inside the container", () => {
    for (let count = 1; count <= 30; count++) {
      const solution = solve(count)
      const width =
        solution.cols * solution.tileWidth + 16 * (solution.cols - 1)
      const height =
        solution.rows * solution.tileHeight + 16 * (solution.rows - 1)
      expect(width).toBeLessThanOrEqual(BOX.width + 0.001)
      expect(height).toBeLessThanOrEqual(BOX.height + 0.001)
    }
  })

  it("gives the tile its cell's own shape, leaving no dead space", () => {
    // 2x3 of a 1200x700 box: cells are 389x342, which is inside the range, so
    // the tile IS the cell and the block covers the container completely.
    const solution = solve(6)
    const covered =
      solution.cols * solution.tileWidth + 16 * (solution.cols - 1)
    const coveredHeight =
      solution.rows * solution.tileHeight + 16 * (solution.rows - 1)
    expect(covered).toBeCloseTo(BOX.width, 5)
    expect(coveredHeight).toBeCloseTo(BOX.height, 5)
  })

  it("never strays outside the permitted aspect range", () => {
    // The clamp is what stops a very flat or very tall container from cropping
    // the top of someone's head, or their shoulders off entirely.
    const boxes = [
      { width: 1200, height: 700 },
      { width: 800, height: 800 },
      { width: 1600, height: 200 },
      { width: 320, height: 900 },
    ]
    for (const box of boxes) {
      for (let count = 1; count <= 12; count++) {
        const aspect = (() => {
          const solution = solve(count, box, 40)
          return solution.tileWidth / solution.tileHeight
        })()
        expect(aspect).toBeGreaterThanOrEqual(TILE_ASPECT_MIN - 0.001)
        expect(aspect).toBeLessThanOrEqual(TILE_ASPECT_MAX + 0.001)
      }
    }
  })

  it("fills a square container instead of letterboxing one person", () => {
    // The case the fixed 16:9 handled worst: 44% of the box was dead.
    const solution = solve(1, { width: 800, height: 800 })
    expect(solution.tileWidth).toBeCloseTo(800, 5)
    expect(solution.tileHeight).toBeCloseTo(800, 5)
  })

  it("goes portrait in a tall narrow container", () => {
    // What a docked side panel looks like. Meet does the same.
    const solution = solve(2, { width: 340, height: 900 }, 40)
    expect(solution.tileWidth / solution.tileHeight).toBeLessThan(1)
  })

  it("covers more of the container than a fixed 16:9 would", () => {
    const box = { width: 900, height: 700 }
    const coverage = (count: number) => {
      const solution = solve(count, box, 40)
      const area =
        solution.visibleCount * solution.tileWidth * solution.tileHeight
      return area / (box.width * box.height)
    }
    // Counts whose grid divides the box exactly leave nothing behind.
    expect(coverage(4)).toBeGreaterThan(0.94)
    expect(coverage(6)).toBeGreaterThan(0.94)
    expect(coverage(1)).toBeGreaterThan(0.94)
  })

  it("overflows instead of shrinking tiles below the minimum", () => {
    const solution = solve(30, { width: 320, height: 200 }, 96)
    expect(solution.visibleCount).toBeLessThan(30)
    expect(solution.tileWidth).toBeGreaterThanOrEqual(96)
  })

  it("never returns fewer than one visible tile", () => {
    const solution = solve(12, { width: 60, height: 40 }, 128)
    expect(solution.visibleCount).toBe(1)
  })

  it("reports the area the layout actually covers", () => {
    const solution = solve(5)
    const expected = solution.rowSpecs.reduce(
      (total, row) => total + row.count * row.tileWidth * row.tileHeight,
      0
    )
    expect(solution.totalArea).toBeCloseTo(expected, 5)
  })
})

describe("coverage within a tolerance of maximin", () => {
  const PANEL = { width: 600, height: 800 }

  const solveWith = (count: number, coverageTolerance?: number) =>
    solveGrid({
      count,
      width: PANEL.width,
      height: PANEL.height,
      gap: 16,
      minAspect: TILE_ASPECT_MIN,
      maxAspect: TILE_ASPECT_MAX,
      preferredAspect: DEFAULT_ASPECT_RATIO,
      minTileWidth: 80,
      coverageTolerance,
    })

  it("is plain maximin by default", () => {
    // Three stacked 2:1 tiles have the biggest worst tile, and pure maximin
    // takes them — with a fifth of the panel empty.
    const solution = solveWith(3)
    expect(solution.rowSpecs.map((row) => row.count)).toEqual([1, 1, 1])
  })

  it("trades a little of the worst tile for a lot of coverage", () => {
    // Two on top of one makes the smallest tile ~13% smaller and covers 97%
    // of the panel instead of 82%. That is the room's setting.
    const maximin = solveWith(3)
    const covered = solveWith(3, COVERAGE_TOLERANCE)
    expect(covered.rowSpecs.map((row) => row.count)).toEqual([2, 1])
    expect(covered.totalArea).toBeGreaterThan(maximin.totalArea * 1.1)
  })

  it("never picks a layout whose worst tile is below the tolerance", () => {
    const maximin = solveWith(3)
    const covered = solveWith(3, COVERAGE_TOLERANCE)
    const worst = (rows: typeof covered.rowSpecs) =>
      Math.min(...rows.map((row) => row.tileWidth * row.tileHeight))
    expect(worst(covered.rowSpecs)).toBeGreaterThanOrEqual(
      worst(maximin.rowSpecs) * COVERAGE_TOLERANCE
    )
  })

  it("does not move a layout the box already fills", () => {
    // Where the maximin answer covers the container, coverage agrees with it.
    for (const count of [1, 2, 4, 6]) {
      expect(solveWith(count, COVERAGE_TOLERANCE).rowSpecs).toEqual(
        solveWith(count).rowSpecs
      )
    }
  })
})

describe("layoutGrid", () => {
  it("produces one rect per visible tile", () => {
    const solution = solve(7)
    expect(layoutGrid(solution, BOX, 16)).toHaveLength(solution.visibleCount)
  })

  it("centres an incomplete last row", () => {
    // 5 tiles solve to 3x2 here, leaving a row of two to centre.
    const solution = solveGrid({
      count: 5,
      width: 900,
      height: 600,
      gap: 16,
      minAspect: TILE_ASPECT_MIN,
      maxAspect: TILE_ASPECT_MAX,
      preferredAspect: DEFAULT_ASPECT_RATIO,
      minTileWidth: 100,
    })
    const rects = layoutGrid(solution, { width: 900, height: 600 }, 16)
    const rows = new Map<number, typeof rects>()
    for (const rect of rects) {
      const row = rows.get(rect.y) ?? []
      row.push(rect)
      rows.set(rect.y, row)
    }

    for (const row of rows.values()) {
      const first = row[0]
      const last = row[row.length - 1]
      if (!first || !last) {
        continue
      }
      const leftGap = first.x
      const rightGap = 900 - (last.x + last.width)
      expect(leftGap).toBeCloseTo(rightGap, 5)
    }
  })

  it("centres the block vertically", () => {
    const solution = solve(2)
    const rects = layoutGrid(solution, BOX, 16)
    const first = rects[0]
    expect(first).toBeDefined()
    if (!first) {
      return
    }
    expect(first.y).toBeCloseTo(BOX.height - (first.y + first.height), 5)
  })
})
