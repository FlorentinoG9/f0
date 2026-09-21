import { useCallback, useRef, useSyncExternalStore } from "react"
import { type F0MeetingSignal } from "../types"
import { useF0MeetingRoster } from "./F0MeetingProvider"
import { EMPTY_SIGNAL } from "./MeetingSignalStore"

const noopSubscribe = (): (() => void) => () => {}
const EMPTY_SPEAKERS: readonly string[] = []

const identity = (signal: F0MeetingSignal): F0MeetingSignal => signal

type SelectionCache<T> = {
  signal: F0MeetingSignal
  selector: (signal: F0MeetingSignal) => T
  selected: T
}

/**
 * Subscribes to one participant's volatile signals. Call it as deep in the tree
 * as possible — ideally in the leaf that draws the waveform — so an audio burst
 * repaints a handful of bars instead of the whole tile.
 *
 * With a `selector` the component re-renders only when the SELECTED value
 * changes: the quality bars can watch `quality` and sit out every audio level.
 * `isEqual` defaults to `Object.is`, which is all a primitive needs.
 *
 * When the host provides no signal store the hook returns a frozen default, so
 * the room degrades to muted flags with no waveform instead of breaking.
 */
export function useMeetingSignal(participantId: string): F0MeetingSignal
export function useMeetingSignal<T>(
  participantId: string,
  selector: (signal: F0MeetingSignal) => T,
  isEqual?: (previous: T, next: T) => boolean
): T
export function useMeetingSignal<T>(
  participantId: string,
  selector: (signal: F0MeetingSignal) => T = identity as (
    signal: F0MeetingSignal
  ) => T,
  isEqual: (previous: T, next: T) => boolean = Object.is
): T {
  const { signals } = useF0MeetingRoster()
  // `useSyncExternalStore` needs the SAME value back while nothing changed, and
  // a selector that builds an object would hand it a fresh one every call.
  const cacheRef = useRef<SelectionCache<T> | null>(null)

  const subscribe = useCallback(
    (listener: () => void) =>
      signals ? signals.subscribe(participantId, listener) : noopSubscribe(),
    [signals, participantId]
  )

  const getSnapshot = useCallback((): T => {
    const signal = signals ? signals.getSnapshot(participantId) : EMPTY_SIGNAL
    const cached = cacheRef.current
    if (cached && cached.signal === signal && cached.selector === selector) {
      return cached.selected
    }
    const selected = selector(signal)
    const kept =
      cached && isEqual(cached.selected, selected) ? cached.selected : selected
    cacheRef.current = { signal, selector, selected: kept }
    return kept
  }, [signals, participantId, selector, isEqual])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** The set of currently speaking participants, for the layout's ordering. */
export const useMeetingSpeakers = (): readonly string[] => {
  const { signals } = useF0MeetingRoster()

  const subscribe = useCallback(
    (listener: () => void) =>
      signals ? signals.subscribeSpeakers(listener) : noopSubscribe(),
    [signals]
  )

  const getSnapshot = useCallback(
    () => (signals ? signals.getSpeakers() : EMPTY_SPEAKERS),
    [signals]
  )

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
