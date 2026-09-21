import { act, createElement, type ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { zeroRenderHook } from "@/testing/test-utils"
import { F0MeetingProvider } from "../providers/F0MeetingProvider"
import {
  createMeetingSignalStore,
  EMPTY_SIGNAL,
} from "../providers/MeetingSignalStore"
import { useMeetingSignal } from "../providers/useMeetingSignal"
import { type F0MeetingRuntime, type F0MeetingSignalStore } from "../types"

describe("createMeetingSignalStore", () => {
  it("returns a stable snapshot identity while nothing changes", () => {
    const store = createMeetingSignalStore()
    // Required by useSyncExternalStore: a fresh object every call is an
    // infinite render loop.
    expect(store.getSnapshot("a")).toBe(store.getSnapshot("a"))

    store.setAudioLevel("a", 0.5)
    const snapshot = store.getSnapshot("a")
    expect(store.getSnapshot("a")).toBe(snapshot)
  })

  it("quantizes audio levels so tiny fluctuations do not notify", () => {
    const store = createMeetingSignalStore()
    const listener = vi.fn()
    store.subscribe("a", listener)

    store.setAudioLevel("a", 0.5)
    expect(listener).toHaveBeenCalledTimes(1)

    // Same quantized bucket: no notification.
    store.setAudioLevel("a", 0.51)
    expect(listener).toHaveBeenCalledTimes(1)

    store.setAudioLevel("a", 0.8)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("only notifies speaker subscribers when the set changes", () => {
    const store = createMeetingSignalStore()
    const listener = vi.fn()
    store.subscribeSpeakers(listener)

    store.setSpeaking(["a", "b"])
    expect(listener).toHaveBeenCalledTimes(1)

    store.setSpeaking(["b", "a"])
    expect(listener).toHaveBeenCalledTimes(1)

    store.setSpeaking(["a"])
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("flips isSpeaking on the participants that entered or left the set", () => {
    const store = createMeetingSignalStore()
    store.setSpeaking(["a"])
    expect(store.getSnapshot("a").isSpeaking).toBe(true)
    expect(store.getSnapshot("b").isSpeaking).toBe(false)

    store.setSpeaking(["b"])
    expect(store.getSnapshot("a").isSpeaking).toBe(false)
    expect(store.getSnapshot("b").isSpeaking).toBe(true)
  })

  it("does not notify one participant's listener for another's signal", () => {
    const store = createMeetingSignalStore()
    const listenerA = vi.fn()
    const listenerB = vi.fn()
    store.subscribe("a", listenerA)
    store.subscribe("b", listenerB)

    store.setAudioLevel("a", 0.9)
    expect(listenerA).toHaveBeenCalledTimes(1)
    expect(listenerB).not.toHaveBeenCalled()
  })

  it("stops notifying after unsubscribe", () => {
    const store = createMeetingSignalStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe("a", listener)
    unsubscribe()
    store.setAudioLevel("a", 0.9)
    expect(listener).not.toHaveBeenCalled()
  })

  it("drops a participant that left the room", () => {
    const store = createMeetingSignalStore()
    store.setSpeaking(["a"])
    store.remove("a")
    expect(store.getSpeakers()).not.toContain("a")
    expect(store.getSnapshot("a").isSpeaking).toBe(false)
  })

  it("tells a still-mounted subscriber that its participant was removed", () => {
    const store = createMeetingSignalStore()
    const listener = vi.fn()
    store.setAudioLevel("a", 0.9)
    store.subscribe("a", listener)

    store.remove("a")

    // The tile outlives the roster by a commit; without this it would keep
    // drawing the last level it saw.
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot("a")).toBe(EMPTY_SIGNAL)
  })

  it("notifies every per-participant subscriber on reset", () => {
    const store = createMeetingSignalStore()
    const listenerA = vi.fn()
    const listenerB = vi.fn()
    const speakerListener = vi.fn()
    store.setAudioLevel("a", 0.9)
    store.setSpeaking(["b"])
    store.subscribe("a", listenerA)
    store.subscribe("b", listenerB)
    store.subscribeSpeakers(speakerListener)

    store.reset()

    expect(listenerA).toHaveBeenCalledTimes(1)
    expect(listenerB).toHaveBeenCalledTimes(1)
    expect(speakerListener).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot("a")).toBe(EMPTY_SIGNAL)
    expect(store.getSnapshot("b")).toBe(EMPTY_SIGNAL)
    expect(store.getSpeakers()).toEqual([])
  })
})

describe("useMeetingSignal", () => {
  const withStore = (signals: F0MeetingSignalStore) => {
    const runtime: F0MeetingRuntime = {
      room: { id: "room", title: "Room" },
      status: "connected",
      localParticipantId: "me",
      participants: [{ id: "a", name: "Ada", isLocal: false, tracks: [] }],
      signals,
      localMedia: { microphone: { enabled: true }, camera: { enabled: true } },
      leave: () => {},
      setMicrophoneEnabled: () => {},
      setCameraEnabled: () => {},
    }
    return function WithStore({ children }: { children: ReactNode }) {
      return createElement(F0MeetingProvider, { runtime }, children)
    }
  }

  it("returns the whole signal without a selector", () => {
    const store = createMeetingSignalStore()
    const { result } = zeroRenderHook(() => useMeetingSignal("a"), {
      wrapper: withStore(store),
    })
    expect(result.current).toBe(EMPTY_SIGNAL)

    act(() => store.setQuality("a", "poor"))
    expect(result.current.quality).toBe("poor")
  })

  it("re-renders a selecting subscriber only when its slice changes", () => {
    const store = createMeetingSignalStore()
    let renders = 0
    const { result } = zeroRenderHook(
      () => {
        renders++
        return useMeetingSignal("a", (signal) => signal.quality)
      },
      { wrapper: withStore(store) }
    )
    const afterMount = renders

    // Audio at 10 Hz is exactly what the quality bars must not pay for.
    act(() => {
      for (let step = 0; step < 20; step++) {
        store.setAudioLevel("a", step / 20)
      }
    })
    expect(renders).toBe(afterMount)
    expect(result.current).toBe("excellent")

    act(() => store.setQuality("a", "lost"))
    expect(result.current).toBe("lost")
    expect(renders).toBe(afterMount + 1)
  })

  it("keeps an object selection stable while it is equal", () => {
    const store = createMeetingSignalStore()
    const isEqual = (
      previous: { level: number },
      next: { level: number }
    ): boolean => previous.level === next.level
    const { result } = zeroRenderHook(
      () =>
        useMeetingSignal(
          "a",
          (signal) => ({ level: Math.round(signal.audioLevel) }),
          isEqual
        ),
      { wrapper: withStore(store) }
    )
    const first = result.current

    // Rounds to the same bucket: same object back, no churn downstream.
    act(() => store.setAudioLevel("a", 0.2))
    expect(result.current).toBe(first)

    act(() => store.setAudioLevel("a", 0.9))
    expect(result.current).toEqual({ level: 1 })
  })
})
