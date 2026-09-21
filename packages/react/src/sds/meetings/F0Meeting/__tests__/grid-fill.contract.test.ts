import { describe, expect, it } from "vitest"
import { GRID_MAX_TILES } from "../layout/constants"
import { type GridPlan, planGrid } from "../layout/plan-grid"

type Box = { width: number; height: number }

/**
 * The contract the grid makes with every room shape we ship: the tiles plus
 * the chip cover at least 85% of the container. Below that the layout has
 * left a hole, which is the complaint every previous round of this work was
 * answering.
 */
const CONTAINERS: Box[] = [
  { width: 1280, height: 720 },
  { width: 960, height: 540 },
  { width: 600, height: 800 },
  { width: 420, height: 640 },
  { width: 360, height: 236 },
  { width: 280, height: 158 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1080 },
]

const COUNTS = [1, 2, 3, 4, 5, 6, 7, 9, 12, 16, 25]

const MIN_COVERAGE = 0.85

/**
 * The exemptions, each one a floor or the clamp rather than the selection.
 *
 * - Ultrawide with one person: a 2:1 tile in a 2.37:1 box.
 * - Seven in the two smallest windows: the 88px width floor rules out a 4+3
 *   split (its tiles would be 86–87px), so the only viable split is 3+2+2 and
 *   the short rows hit the 2:1 cap in a 2.4–2.8:1 cell. Eight is 3+3+2 and
 *   nine is 3+3+3, both back above the line.
 */
const EXEMPT: Record<string, number> = {
  "2560x1080:1": 0.8,
  "360x236:7": 0.84,
  "280x158:7": 0.75,
}

const floorFor = (box: Box, count: number): number =>
  EXEMPT[`${box.width}x${box.height}:${count}`] ?? MIN_COVERAGE

const area = (rect: Box): number => rect.width * rect.height

/** Σ rect areas including the chip, over the container. */
const coverage = (plan: GridPlan, box: Box): number => {
  const tiles = plan.rects.reduce((total, rect) => total + area(rect), 0)
  const chip = plan.chipRect ? area(plan.chipRect) : 0
  return (tiles + chip) / area(box)
}

/** Rows of the plan, by the y each rect sits at. */
const rowCounts = (plan: GridPlan): number[] => {
  const rows = new Map<number, number>()
  const cells = [...plan.rects, ...(plan.chipRect ? [plan.chipRect] : [])]
  for (const rect of cells) {
    const key = Math.round(rect.y)
    rows.set(key, (rows.get(key) ?? 0) + 1)
  }
  return [...rows.values()]
}

const label = (box: Box) =>
  `${String(box.width).padStart(4)}×${String(box.height).padEnd(4)}`

describe("the grid covers the room", () => {
  const results = CONTAINERS.map((box) => ({
    box,
    cells: COUNTS.map((count) => {
      const plan = planGrid({ box, tileCount: count })
      return { count, plan, covered: coverage(plan, box) }
    }),
  }))

  // The table the report quotes: one line per container, coverage per count.
  console.info(
    [
      `coverage (n:%)  ${COUNTS.map((count) => String(count).padStart(4)).join(" ")}`,
      ...results.map(
        ({ box, cells }) =>
          `${label(box)}      ${cells
            .map(({ covered }) => `${(covered * 100).toFixed(0)}%`.padStart(4))
            .join(" ")}`
      ),
    ].join("\n")
  )

  it.each(results)("$box.width×$box.height", ({ box, cells }) => {
    for (const { count, plan, covered } of cells) {
      expect(covered, `n=${count}`).toBeGreaterThanOrEqual(floorFor(box, count))
      expect(plan.visibleCount).toBeLessThanOrEqual(GRID_MAX_TILES)
      expect(plan.rects).toHaveLength(plan.visibleCount)
    }
  })

  it("splits three people in a portrait panel as two and one, not a column", () => {
    // 600×800 is 0.75. Three stacked 2:1 tiles cover 82%; two on top of one
    // covers 96% and every tile is still inside the crop range.
    const box = { width: 600, height: 800 }
    const plan = planGrid({ box, tileCount: 3 })
    expect(rowCounts(plan)).toContain(2)
    expect(coverage(plan, box)).toBeGreaterThanOrEqual(0.95)
  })

  it("fills a phone-shaped panel with seven", () => {
    const box = { width: 420, height: 640 }
    expect(
      coverage(planGrid({ box, tileCount: 7 }), box)
    ).toBeGreaterThanOrEqual(0.95)
  })

  it("fills a small floating window with three", () => {
    const box = { width: 360, height: 236 }
    expect(
      coverage(planGrid({ box, tileCount: 3 }), box)
    ).toBeGreaterThanOrEqual(0.95)
  })

  it("never lays out more than the cap, however big the display", () => {
    const plan = planGrid({ box: { width: 3840, height: 2160 }, tileCount: 40 })
    expect(plan.chipRect).not.toBeNull()
    // The chip took one of the cap's cells: nobody is drawn past it.
    expect(plan.visibleCount + 1).toBeLessThanOrEqual(GRID_MAX_TILES)
  })
})
