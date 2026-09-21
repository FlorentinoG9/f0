import { describe, expect, it } from "vitest"
import { screen, zeroRender } from "@/testing/test-utils"
import { ParticipantTile } from "../components/grid/ParticipantTile"
import {
  LABEL_FONT_MAX,
  LABEL_FONT_MIN,
  labelFontFor,
} from "../layout/constants"
import { buildTiles } from "../layout/tiles"
import { F0MeetingProvider } from "../providers/F0MeetingProvider"
import { MeetingSurfaceProvider } from "../providers/MeetingSurfaceProvider"
import {
  type F0MeetingParticipant,
  type F0MeetingRuntime,
  type F0MeetingTrack,
} from "../types"

const camera = (id: string): F0MeetingTrack => ({
  id: `${id}:cam`,
  kind: "camera",
  bindingKey: `${id}:cam:0`,
  muted: false,
  live: true,
})

const share = (id: string): F0MeetingTrack => ({
  id: `${id}:share`,
  kind: "screenShare",
  bindingKey: `${id}:share:0`,
  muted: false,
  live: true,
  width: 2560,
  height: 1440,
})

/** An open mic, so the chip carries the meter rather than the muted glyph. */
const microphone = (id: string): F0MeetingTrack => ({
  id: `${id}:mic`,
  kind: "microphone",
  bindingKey: `${id}:mic:0`,
  muted: false,
  live: true,
})

const person = (
  overrides: Partial<F0MeetingParticipant> = {}
): F0MeetingParticipant => ({
  id: "a",
  name: "Ada Lovelace",
  isLocal: false,
  tracks: [camera("a"), microphone("a")],
  ...overrides,
})

const renderTile = (
  participant: F0MeetingParticipant,
  props: { width?: number; radius?: number; canFocus?: boolean } = {}
) => {
  const runtime: F0MeetingRuntime = {
    room: { id: "room", title: "Huddle" },
    status: "connected",
    localParticipantId: "me",
    participants: [participant],
    localMedia: { microphone: { enabled: true }, camera: { enabled: true } },
    leave: () => {},
    setMicrophoneEnabled: () => {},
    setCameraEnabled: () => {},
  }
  const tile = buildTiles([participant])[0]
  if (!tile) {
    throw new Error("no tile")
  }

  const ui = (next: typeof props) => (
    <F0MeetingProvider runtime={runtime}>
      <MeetingSurfaceProvider defaultMode="inline" roomId="room">
        <ParticipantTile tile={tile} {...next} />
      </MeetingSurfaceProvider>
    </F0MeetingProvider>
  )
  const { rerender } = zeroRender(ui(props))

  return {
    root: () => screen.getByTestId("meeting-participant-tile"),
    rerender: (next: typeof props) => rerender(ui(next)),
  }
}

/** The name chip: the element carrying the indicator slot. */
const chip = () =>
  screen.getByTestId("meeting-speaking-indicator").parentElement
    ?.parentElement as HTMLElement

describe("the label follows the tile's width", () => {
  it("scales the font with the tile, clamped at both ends", () => {
    // 110px is a thumbnail: the floor. 333px lands mid-range. 700px is a
    // spotlight, where an ever-growing label would be a banner: the cap.
    expect(labelFontFor(110)).toBe(LABEL_FONT_MIN)
    expect(labelFontFor(333)).toBe(14)
    expect(labelFontFor(700)).toBe(LABEL_FONT_MAX)
  })

  it.each([
    [110, "11px"],
    [333, "14px"],
    [700, "18px"],
  ])("hands a %ipx tile a %s label", (width, size) => {
    const { root } = renderTile(person(), { width })
    expect(root().style.getPropertyValue("--tile-label")).toBe(size)
    expect(root().style.getPropertyValue("--tile-w")).toBe(`${width}px`)
  })

  it("shows the full name on a full tile", () => {
    renderTile(person(), { width: 400 })
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument()
  })

  it("keeps the first name only on a narrow tile", () => {
    renderTile(person(), { width: 120 })
    expect(screen.getByText("Ada")).toBeInTheDocument()
    expect(screen.queryByText("Ada Lovelace")).toBeNull()
  })

  it("calls the local person 'you' and nothing else when short of room", () => {
    // "Ada (You)" is longer than the tile; "You" says as much.
    renderTile(person({ isLocal: true }), { width: 120 })
    expect(screen.getByText("You")).toBeInTheDocument()
    expect(screen.queryByText(/Ada/)).toBeNull()
  })

  it("keeps only the icon on a thumbnail", () => {
    renderTile(person(), { width: 80 })
    expect(screen.queryByText(/Ada/)).toBeNull()
    expect(screen.getByTestId("meeting-speaking-indicator")).toBeInTheDocument()
  })

  it("drops the share suffix before it drops the name", () => {
    const wide = renderTile(person({ tracks: [share("a"), microphone("a")] }), {
      width: 400,
    })
    expect(wide.root()).toHaveTextContent(/Sharing screen/)

    wide.rerender({ width: 240 })
    expect(wide.root()).not.toHaveTextContent(/Sharing screen/)
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument()
  })

  it("never lets a long name push the indicator out of the chip", () => {
    renderTile(
      person({ name: "Maximiliane Anastasia von Habsburg-Lothringen" }),
      {
        width: 200,
      }
    )
    const indicator = screen.getByTestId("meeting-speaking-indicator")
    expect(indicator.className).toContain("shrink-0")
    expect(indicator.parentElement?.className).toContain("shrink-0")
    // And the name is what gives way.
    expect(screen.getByText(/Maximiliane/).className).toContain("min-w-0")
  })

  it("re-renders when the grid hands it a new radius", () => {
    // The regression: `radius` was missing from the memo comparator, so a tile
    // kept its old corners after the room resized around it.
    const { root, rerender } = renderTile(person(), { width: 300, radius: 8 })
    expect(root().style.borderRadius).toBe("8px")

    rerender({ width: 300, radius: 14 })
    expect(root().style.borderRadius).toBe("14px")
  })

  it("uses logical insets, so a right-to-left room mirrors", () => {
    const { root } = renderTile(person(), { width: 300, canFocus: true })
    const classNames = [root(), ...root().querySelectorAll("*")]
      .map((element) => element.className)
      .filter((value): value is string => typeof value === "string")
      .join(" ")
    expect(classNames).not.toMatch(/(^|\s)(left|right)-/)
    expect(classNames).toMatch(/(^|\s)start-/)
    expect(classNames).toMatch(/(^|\s)end-/)
  })

  it("reserves the pin's corner only when there is a pin", () => {
    const pinned = renderTile(person(), { width: 300, canFocus: true })
    expect(pinned.root().style.getPropertyValue("--pin-reserve")).not.toBe(
      "0px"
    )
    pinned.rerender({ width: 300, canFocus: false })
    expect(pinned.root().style.getPropertyValue("--pin-reserve")).toBe("0px")
    expect(chip()).toBeInTheDocument()
  })
})
