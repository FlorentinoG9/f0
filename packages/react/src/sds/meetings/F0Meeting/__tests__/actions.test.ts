import { describe, expect, it, vi } from "vitest"
import { Microphone, Phone, VideoRecorder } from "@/icons/app"
import {
  ACTION_GAP,
  ACTION_SIZE,
  BAR_PADDING,
  LEAVE_SIZE,
  MEDIA_CONTROL_SIZE,
  MEDIA_TOGGLE_SIZE,
  OVERFLOW_SLOT,
  collapseActions,
} from "../components/controls/collapse-actions"
import { mergeActions } from "../components/controls/merge-actions"
import { type F0MeetingAction } from "../types"
import { WINDOW_MIN_WIDTH } from "../window/window-constants"

const action = (
  id: string,
  overrides: Partial<F0MeetingAction> = {}
): F0MeetingAction => ({
  id,
  label: id,
  icon: Microphone,
  ...overrides,
})

const ids = (actions: F0MeetingAction[]): string[] =>
  actions.map((item) => item.id)

const CORE: F0MeetingAction[] = [
  action("core:microphone", { pinned: true, priority: 90, group: "media" }),
  action("core:camera", {
    pinned: true,
    priority: 80,
    group: "media",
    icon: VideoRecorder,
  }),
  action("core:screenShare", { priority: 60, group: "media" }),
  action("core:leave", {
    pinned: true,
    priority: 100,
    group: "leave",
    icon: Phone,
  }),
]

/**
 * How much wider than an icon the core set is: the mic and camera draw as the
 * toggle half of a media control even without a picker, and "Leave" carries
 * its label. The bar's arithmetic has to know that, or it thinks 42 and 60 are
 * 32 and collapses what it had room for.
 */
const WIDER = 2 * (MEDIA_TOGGLE_SIZE - ACTION_SIZE) + (LEAVE_SIZE - ACTION_SIZE)

/**
 * Bar width with room for `slots` icon-sized controls plus the overflow
 * button. `extra` covers controls wider than an icon — see {@link WIDER}.
 */
const widthFor = (slots: number, extra = 0): number =>
  slots * (ACTION_SIZE + ACTION_GAP) -
  ACTION_GAP +
  extra +
  OVERFLOW_SLOT +
  ACTION_GAP

describe("mergeActions", () => {
  it("keeps the core actions when the host adds nothing", () => {
    expect(ids(mergeActions(CORE))).toEqual(ids(CORE))
  })

  it("patches a core action instead of duplicating it", () => {
    const merged = mergeActions(CORE, [
      action("core:microphone", { label: "Silenciar" }),
    ])
    expect(merged.filter((item) => item.id === "core:microphone")).toHaveLength(
      1
    )
    expect(merged.find((item) => item.id === "core:microphone")?.label).toBe(
      "Silenciar"
    )
    // The untouched fields survive the patch.
    expect(merged.find((item) => item.id === "core:microphone")?.pinned).toBe(
      true
    )
  })

  it("accepts a patch that only names the id", () => {
    const merged = mergeActions(CORE, [
      { id: "core:microphone", label: "Mute" },
    ])
    const patched = merged.find((item) => item.id === "core:microphone")
    expect(patched?.label).toBe("Mute")
    expect(patched?.icon).toBe(Microphone)
    expect(patched?.priority).toBe(90)
  })

  it("warns instead of rendering a patch for an id that does not exist", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const merged = mergeActions(CORE, [
      { id: "core:raiseHand", label: "Raise" },
    ])
    expect(ids(merged)).not.toContain("core:raiseHand")
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("appends unknown host actions", () => {
    const merged = mergeActions(CORE, [action("chat"), action("people")])
    expect(ids(merged)).toContain("chat")
    expect(ids(merged)).toContain("people")
  })

  it("lets the host hide a synthesized action", () => {
    const merged = mergeActions(CORE, [
      action("core:screenShare", { hidden: true }),
    ])
    expect(ids(merged)).not.toContain("core:screenShare")
  })

  it("respects an explicit order and leaves unlisted ids after it", () => {
    const merged = mergeActions(
      CORE,
      [action("chat")],
      ["core:leave", "chat", "core:microphone"]
    )
    expect(ids(merged.slice(0, 3))).toEqual([
      "core:leave",
      "chat",
      "core:microphone",
    ])
  })
})

describe("collapseActions", () => {
  const many = [
    ...CORE,
    action("chat", { priority: 50, group: "collab" }),
    action("people", { priority: 45, group: "collab" }),
    action("notes", { priority: 20, group: "collab" }),
    action("settings", { priority: 10, group: "system" }),
  ]

  it("shows everything when there is room", () => {
    const { visible, overflow } = collapseActions(
      many,
      widthFor(many.length, WIDER),
      "fullscreen"
    )
    expect(visible).toHaveLength(many.length)
    expect(overflow).toHaveLength(0)
  })

  it("keeps pinned actions no matter how narrow the bar gets", () => {
    const { visible } = collapseActions(many, widthFor(3), "floating")
    expect(ids(visible)).toContain("core:microphone")
    expect(ids(visible)).toContain("core:camera")
    expect(ids(visible)).toContain("core:leave")
  })

  it("drops the lowest priority first", () => {
    const { overflow } = collapseActions(many, widthFor(6, WIDER), "floating")
    expect(ids(overflow)).toContain("settings")
    expect(ids(overflow)).not.toContain("chat")
  })

  it("renders survivors in the original order, not by priority", () => {
    const { visible } = collapseActions(many, widthFor(5, WIDER), "floating")
    const original = ids(many).filter((id) => ids(visible).includes(id))
    expect(ids(visible)).toEqual(original)
  })

  it("reduces a minimized pill to the pinned actions with no overflow menu", () => {
    const { visible, overflow } = collapseActions(many, 280, "minimized")
    expect(visible.every((item) => item.pinned)).toBe(true)
    expect(overflow).toHaveLength(0)
  })

  it("still keeps the pinned ones when nothing else fits", () => {
    const { visible } = collapseActions(many, widthFor(2), "floating")
    expect(visible.every((item) => item.pinned)).toBe(true)
  })

  it("honours per-action mode restrictions", () => {
    const restricted = [
      ...CORE,
      action("onlyFullscreen", { modes: ["fullscreen"] }),
    ]
    const { visible } = collapseActions(
      restricted,
      widthFor(restricted.length, WIDER),
      "floating"
    )
    expect(ids(visible)).not.toContain("onlyFullscreen")
  })
})

/**
 * The smallest window the user can reach, with the full core set: both media
 * controls with their pickers, screen share, raise hand and Leave.
 */
describe("the bar at the minimum window width", () => {
  const core = [
    action("core:microphone", { pinned: true, priority: 90 }),
    action("core:microphoneSettings", { priority: 70 }),
    action("core:camera", { pinned: true, priority: 80, icon: VideoRecorder }),
    action("core:cameraSettings", { priority: 65 }),
    action("core:screenShare", { priority: 60 }),
    action("core:raiseHand", { priority: 40 }),
    action("core:leave", {
      pinned: true,
      priority: 100,
      icon: Phone,
      variant: "critical",
    }),
  ]

  it("keeps mic, camera and Leave, and puts the rest in the menu", () => {
    const { visible, overflow } = collapseActions(
      core,
      WINDOW_MIN_WIDTH,
      "floating"
    )

    expect(ids(visible)).toEqual([
      "core:microphone",
      "core:microphoneSettings",
      "core:camera",
      "core:cameraSettings",
      "core:leave",
    ])
    expect(ids(overflow)).toEqual(["core:screenShare", "core:raiseHand"])

    // What is actually drawn — two fused media controls, the labelled Leave,
    // the menu button and the gaps between them — fits the bar.
    const drawn =
      2 * MEDIA_CONTROL_SIZE + LEAVE_SIZE + OVERFLOW_SLOT + 3 * ACTION_GAP
    expect(drawn).toBeLessThanOrEqual(WINDOW_MIN_WIDTH)
  })

  it("seats them all once Leave is an icon, as a tight bar draws it", () => {
    // The row keeps `BAR_PADDING` on each side for the touch targets, so the
    // bar asks with that taken off.
    const { overflow } = collapseActions(
      core,
      WINDOW_MIN_WIDTH - 2 * BAR_PADDING,
      "floating",
      { tightLeave: true }
    )
    expect(overflow).toHaveLength(0)
  })
})
