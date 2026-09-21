import { describe, expect, it } from "vitest"
import {
  ACTION_GAP,
  ACTION_SIZE,
  collapseActions,
} from "../components/controls/collapse-actions"
import { type F0MeetingAction } from "../types"

const action = (
  id: string,
  overrides: Partial<F0MeetingAction> = {}
): F0MeetingAction => ({
  id,
  label: id,
  icon: (() => null) as unknown as F0MeetingAction["icon"],
  onClick: () => {},
  ...overrides,
})

const ids = (actions: F0MeetingAction[]): string[] =>
  actions.map((entry) => entry.id)

describe("collapseActions", () => {
  it("keeps the overflow empty when everything fits", () => {
    // It used to reserve the "more" slot unconditionally, which could be the
    // very thing that pushed an action out — a button whose only job was to
    // hold what its own reservation displaced.
    const actions = [action("a"), action("b"), action("c")]
    const { visible, overflow } = collapseActions(actions, 1000, "fullscreen")

    expect(visible).toHaveLength(3)
    expect(overflow).toHaveLength(0)
  })

  it("does not reserve room for a button it is not going to draw", () => {
    // Three 32px actions + two 6px gaps = 108. A bar of exactly that width
    // fits them, and only does so because the overflow slot is not deducted.
    const actions = [action("a"), action("b"), action("c")]
    const exact = 3 * ACTION_SIZE + 2 * ACTION_GAP
    expect(collapseActions(actions, exact, "fullscreen").overflow).toHaveLength(
      0
    )

    // One pixel less and something has to go — and now the slot is real.
    const { visible, overflow } = collapseActions(
      actions,
      exact - 1,
      "fullscreen"
    )
    expect(overflow.length).toBeGreaterThan(0)
    expect(visible.length + overflow.length).toBe(3)
  })

  it("shows pinned only while the bar is unmeasured", () => {
    // Width 0 is the first paint, before the ResizeObserver has reported. It
    // used to mean "everything fits", which painted a full bar into a window
    // that could not hold it — for one frame, clipped. Pinned only is the
    // frame that is never wrong; the rest waits in the menu.
    const actions = [
      action("core:microphone", { pinned: true }),
      action("core:microphoneSettings"),
      action("chat"),
      action("core:leave", { pinned: true }),
    ]
    const { visible, overflow } = collapseActions(actions, 0, "fullscreen")

    // The picker rides with its pinned toggle: the chevron must not pop in a
    // frame after the control it belongs to.
    expect(ids(visible)).toEqual([
      "core:microphone",
      "core:microphoneSettings",
      "core:leave",
    ])
    expect(ids(overflow)).toEqual(["chat"])
  })

  it("collapses once the bar genuinely runs out of room", () => {
    const actions = Array.from({ length: 10 }, (_, index) =>
      action(`a${index}`, { priority: 10 - index })
    )
    const { visible, overflow } = collapseActions(actions, 200, "fullscreen")

    expect(overflow.length).toBeGreaterThan(0)
    expect(visible.length + overflow.length).toBe(actions.length)
  })

  it("keeps pinned actions in the bar and pushes the rest out", () => {
    const actions = [
      action("core:microphone", { pinned: true }),
      action("core:leave", { pinned: true, variant: "critical" }),
      action("extra-1", { priority: 5 }),
      action("extra-2", { priority: 4 }),
      action("extra-3", { priority: 3 }),
    ]
    const { visible, overflow } = collapseActions(actions, 180, "fullscreen")

    expect(ids(visible)).toContain("core:leave")
    expect(overflow.length).toBeGreaterThan(0)
  })

  it("collapses one more on request, lowest priority first", () => {
    // The bar's second look: it measured its own row after painting and found
    // it still clipping, so the estimate was short and one more has to go.
    const actions = [
      action("core:leave", { pinned: true }),
      action("a", { priority: 30 }),
      action("b", { priority: 20 }),
      action("c", { priority: 10 }),
    ]
    expect(collapseActions(actions, 1000, "fullscreen").overflow).toHaveLength(
      0
    )

    const once = collapseActions(actions, 1000, "fullscreen", {
      forceCollapse: 1,
    })
    expect(ids(once.overflow)).toEqual(["c"])

    const twice = collapseActions(actions, 1000, "fullscreen", {
      forceCollapse: 2,
    })
    expect(ids(twice.overflow)).toEqual(["b", "c"])

    // Pinned never goes, however many are asked for.
    const all = collapseActions(actions, 1000, "fullscreen", {
      forceCollapse: 99,
    })
    expect(ids(all.visible)).toEqual(["core:leave"])
  })

  it("renders in the original order, never in rank order", () => {
    const actions = [
      action("first", { priority: 1 }),
      action("second", { priority: 99, pinned: true }),
      action("third", { priority: 50 }),
    ]
    const { visible } = collapseActions(actions, 1000, "fullscreen")
    expect(ids(visible)).toEqual(["first", "second", "third"])
  })

  it("gives a minimized pill no overflow at all", () => {
    const actions = [action("a", { pinned: true }), action("b")]
    const { visible, overflow } = collapseActions(actions, 200, "minimized")
    expect(ids(visible)).toEqual(["a"])
    expect(overflow).toHaveLength(0)
  })
})
