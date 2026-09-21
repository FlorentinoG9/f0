import { act } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { screen, zeroRender } from "@/testing/test-utils"
import { MeetingGrid } from "../components/grid/MeetingGrid"
import { F0MeetingProvider } from "../providers/F0MeetingProvider"
import { createMeetingSignalStore } from "../providers/MeetingSignalStore"
import { MeetingSurfaceProvider } from "../providers/MeetingSurfaceProvider"
import { type F0MeetingParticipant, type F0MeetingRuntime } from "../types"
import { measure } from "./measure"

const counters = vi.hoisted(() => ({ tileRenders: 0 }))

// The real tile, counted. Wrapped in the same `memo` it ships with, so the
// count is "how often the tile would have rendered" rather than how often the
// grid re-rendered around it.
vi.mock("../components/grid/ParticipantTile", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../components/grid/ParticipantTile")>()
  const { memo, createElement } = await import("react")
  const Counted = memo(function CountedTile(
    props: Parameters<typeof actual.ParticipantTile>[0]
  ) {
    counters.tileRenders++
    return createElement(actual.ParticipantTile, props)
  })
  return { ...actual, ParticipantTile: Counted }
})

const store = createMeetingSignalStore()

const participants: F0MeetingParticipant[] = Array.from(
  { length: 50 },
  (_, index) => ({
    id: `p${index}`,
    name: `Person ${index}`,
    isLocal: index === 0,
    tracks: [
      {
        id: `p${index}:mic`,
        kind: "microphone" as const,
        bindingKey: `p${index}:mic:0`,
        muted: false,
        live: true,
      },
    ],
  })
)

const runtime: F0MeetingRuntime = {
  room: { id: "room", title: "Room" },
  status: "connected",
  localParticipantId: "p0",
  participants,
  signals: store,
  localMedia: {
    microphone: { enabled: true },
    camera: { enabled: false },
  },
  leave: () => {},
  setMicrophoneEnabled: () => {},
  setCameraEnabled: () => {},
}

const renderGrid = () =>
  zeroRender(
    <F0MeetingProvider runtime={runtime}>
      <MeetingSurfaceProvider defaultMode="inline" roomId="room">
        <MeetingGrid />
      </MeetingSurfaceProvider>
    </F0MeetingProvider>
  )

const visibleTiles = () =>
  screen.getAllByTestId("meeting-participant-tile").length

/**
 * The guard rail for the context partitioning. If someone moves the volatile
 * signals into a context, or makes the tile read them, this test fails — and it
 * has to, because that regression is invisible until a real call with a dozen
 * people brings the tab to its knees.
 */
describe("meeting render isolation", () => {
  beforeEach(() => {
    localStorage.clear()
    measure(1440, 780)
    store.reset()
    counters.tileRenders = 0
  })

  it("does not re-render a single tile across 200 audio-level ticks", () => {
    renderGrid()
    expect(visibleTiles()).toBeGreaterThan(1)
    counters.tileRenders = 0

    act(() => {
      for (let step = 0; step < 200; step++) {
        store.setAudioLevel(`p${step % 50}`, (step % 20) / 20)
      }
    })

    // Only the leaves that subscribed repaint: the waveform, never the tile.
    expect(counters.tileRenders).toBe(0)
  })

  it("re-renders at most the visible tiles when the speaker changes", () => {
    renderGrid()
    const visible = visibleTiles()
    counters.tileRenders = 0

    // A speaker change re-solves the grid (promotion, ordering), which is
    // allowed to touch the tiles on stage — but never the ones in the chip, and
    // never more than once each.
    act(() => {
      store.setSpeaking(["p7"])
    })

    expect(counters.tileRenders).toBeLessThanOrEqual(visible)
  })
})
