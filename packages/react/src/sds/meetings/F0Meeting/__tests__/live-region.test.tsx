import { fireEvent } from "@testing-library/react"
import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, zeroRender } from "@/testing/test-utils"
import { F0Meeting } from "../F0Meeting"
import { type F0MeetingParticipant, type F0MeetingRuntime } from "../types"

const person = (
  id: string,
  overrides: Partial<F0MeetingParticipant> = {}
): F0MeetingParticipant => ({
  id,
  name: `Person ${id}`,
  isLocal: false,
  tracks: [],
  ...overrides,
})

const buildRuntime = (
  participants: F0MeetingParticipant[]
): F0MeetingRuntime => ({
  room: { id: "room", title: "Huddle" },
  status: "connected",
  localParticipantId: "me",
  participants,
  localMedia: { microphone: { enabled: true }, camera: { enabled: false } },
  leave: () => {},
  setMicrophoneEnabled: () => {},
  setCameraEnabled: () => {},
})

const roster = (...ids: string[]) => [
  person("me", { isLocal: true }),
  ...ids.map((id) => person(id)),
]

const region = () =>
  document.querySelector('[aria-live="polite"]') as HTMLElement

const renderCall = (participants: F0MeetingParticipant[]) => {
  const view = zeroRender(
    <F0Meeting runtime={buildRuntime(participants)} defaultMode="floating">
      <p>app</p>
    </F0Meeting>
  )
  const update = (next: F0MeetingParticipant[]) =>
    view.rerender(
      <F0Meeting runtime={buildRuntime(next)} defaultMode="floating">
        <p>app</p>
      </F0Meeting>
    )
  return { ...view, update }
}

const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms))

describe("the live region", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("says nothing about the room you walked into", () => {
    renderCall(roster("a", "b"))
    expect(region()).toHaveTextContent("")
  })

  it("announces who joined", () => {
    const { update } = renderCall(roster("a"))
    update(roster("a", "b"))
    expect(region()).toHaveTextContent("Person b joined")
  })

  it("announces who left", () => {
    const { update } = renderCall(roster("a", "b"))
    update(roster("a"))
    expect(region()).toHaveTextContent("Person b left")
  })

  it("coalesces a burst to the last message", () => {
    const { update } = renderCall(roster("a"))
    update(roster("a", "b"))
    expect(region()).toHaveTextContent("Person b joined")

    // Two more within the throttle window: neither interrupts, and only the
    // later one is read once the window closes.
    tick(500)
    update(roster("a", "b", "c"))
    tick(500)
    update(roster("b", "c"))
    expect(region()).toHaveTextContent("Person b joined")

    tick(2000)
    expect(region()).toHaveTextContent("Person a left")
    expect(region()).not.toHaveTextContent("Person c joined")
  })

  it("does not count someone still invited as having joined or left", () => {
    const { update } = renderCall(roster("a"))
    update([...roster("a"), person("b", { presence: "invited" })])
    expect(region()).toHaveTextContent("")

    // Arriving is the join.
    update([...roster("a"), person("b", { presence: "joined" })])
    expect(region()).toHaveTextContent("Person b joined")
  })

  it("announces where the call went", () => {
    renderCall(roster("a"))

    // `fireEvent`, not `userEvent`: the latter awaits timers this test owns.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /fill the screen/i }))
    })
    tick(2000)

    expect(region()).toHaveTextContent("Meeting fills the screen")
  })
})
