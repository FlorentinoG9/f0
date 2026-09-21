import { beforeEach, describe, expect, it } from "vitest"
import { act, screen, zeroRender } from "@/testing/test-utils"
import { F0MeetingRoom } from "../F0MeetingRoom"
import { F0MeetingProvider } from "../providers/F0MeetingProvider"
import { MeetingSurfaceProvider } from "../providers/MeetingSurfaceProvider"
import {
  type F0MeetingParticipant,
  type F0MeetingRuntime,
  type F0MeetingTrack,
} from "../types"
import { measure } from "./measure"

const camera = (id: string): F0MeetingTrack => ({
  id: `${id}:cam`,
  kind: "camera",
  bindingKey: `${id}:cam:0`,
  muted: false,
  live: true,
})

const crowd = (size: number): F0MeetingParticipant[] =>
  Array.from({ length: size }, (_, index) => {
    const id = index === 0 ? "me" : `p${index}`
    return {
      id,
      name: `Person ${index}`,
      isLocal: index === 0,
      tracks: [camera(id)],
    }
  })

const renderRoom = (participants: F0MeetingParticipant[]) => {
  const runtime: F0MeetingRuntime = {
    room: { id: "room", title: "All hands" },
    status: "connected",
    localParticipantId: "me",
    participants,
    localMedia: { microphone: { enabled: true }, camera: { enabled: true } },
    leave: () => {},
    setMicrophoneEnabled: () => {},
    setCameraEnabled: () => {},
  }

  return zeroRender(
    <F0MeetingProvider runtime={runtime}>
      <MeetingSurfaceProvider defaultMode="inline" roomId="room">
        <F0MeetingRoom />
      </MeetingSurfaceProvider>
    </F0MeetingProvider>
  )
}

const tiles = () => screen.queryAllByTestId("meeting-participant-tile")
const tileCount = () => tiles().length
const tileIds = () =>
  tiles()
    .map((tile) => tile.dataset.participantId)
    .sort()
const tileWidths = () =>
  new Set(tiles().map((tile) => tile.style.getPropertyValue("--tile-w")))

describe("a room with more people than it can seat", () => {
  beforeEach(() => {
    localStorage.clear()
    measure(1440, 780)
  })

  it("stays a grid and puts the rest in the chip", () => {
    // The reported bug: a spotlight was forced the moment the grid could not
    // seat everyone, so thirty people threw away a perfectly good 16-up grid
    // for one big tile beside a column of 42px slivers.
    renderRoom(crowd(30))

    expect(tileCount()).toBe(15)
    expect(screen.getByTestId("meeting-overflow-tile")).toHaveTextContent("+15")
  })

  it("accounts for everybody, however many turn up", () => {
    renderRoom(crowd(200))

    const shown = tileCount()
    expect(shown).toBeGreaterThan(1)
    expect(screen.getByTestId("meeting-overflow-tile")).toHaveTextContent(
      `+${200 - shown}`
    )
  })

  it("shows no chip while everyone fits", () => {
    renderRoom(crowd(8))

    expect(tileCount()).toBe(8)
    expect(screen.queryByTestId("meeting-overflow-tile")).toBeNull()
  })

  it("rounds the chip exactly like the tiles beside it", () => {
    // The chip carried its own `rounded-lg` while the tiles scaled 6→16px with
    // their width, so the odd cell out was visible as soon as the room was
    // small or large enough for the two numbers to diverge.
    renderRoom(crowd(30))

    const tile = screen.getAllByTestId("meeting-participant-tile")[0]
    const chip = screen.getByTestId("meeting-overflow-tile")

    expect(tile?.style.borderRadius).toBeTruthy()
    expect(chip.style.borderRadius).toBe(tile?.style.borderRadius)
    // The plate behind the button follows too, or the corners show a sliver of
    // the wrong colour.
    expect((chip.parentElement as HTMLElement).style.borderRadius).toBe(
      tile?.style.borderRadius
    )
  })

  it("still spotlights a screen share, with a strip of a handful", () => {
    // The spotlight did not go away — it went back to meaning "the room is
    // focused on something", which is a share or a pin, never a head count.
    const participants = crowd(30)
    participants[3] = {
      ...(participants[3] as F0MeetingParticipant),
      tracks: [
        camera("p3"),
        {
          id: "p3:screen",
          kind: "screenShare",
          bindingKey: "p3:screen:0",
          muted: false,
          live: true,
        },
      ],
    }

    renderRoom(participants)

    // One spotlight plus a capped strip, not sixteen thumbnails.
    expect(tileCount()).toBeLessThanOrEqual(7)
    expect(tileCount()).toBeGreaterThan(1)
    expect(screen.getByTestId("meeting-overflow-tile")).toBeInTheDocument()
  })

  it("re-solves on a resize without losing anyone or remounting a tile", () => {
    renderRoom(crowd(30))
    const before = tileIds()
    const widthsBefore = tileWidths()
    const videoBefore = document.querySelectorAll("video")[0]

    // Fullscreen to a phone-shaped panel: a different split, the same people.
    act(() => {
      measure(420, 640)
    })

    expect(tileWidths()).not.toEqual(widthsBefore)
    expect(tileIds()).toEqual(before)
    expect(screen.getByTestId("meeting-overflow-tile")).toHaveTextContent(
      `+${30 - tileCount()}`
    )
    // The tile moved; its <video> is the same node — SPEC §3, invariant 1.
    expect(document.querySelectorAll("video")[0]).toBe(videoBefore)
  })
})
