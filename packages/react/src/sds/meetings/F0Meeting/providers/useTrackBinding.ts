import { useLayoutEffect, useRef } from "react"
import { type F0MeetingTrack } from "../types"
import { useF0MeetingBindings } from "./F0MeetingProvider"

/**
 * Attaches a track to a media element F0 owns.
 *
 * The effect depends on `bindingKey` and on WHETHER there is a binding — never
 * on the function's identity. Hosts rebuild the runtime, and with it every
 * `binding` closure, on each transport event, so depending on identity would
 * detach and re-attach the element around twenty times a second, black-flashing
 * the video continuously. The presence flag is what lets a binding that arrives
 * a commit after its key (a stream that opened late) still get attached.
 */
export const useTrackBinding = <T extends HTMLMediaElement>(
  track: F0MeetingTrack | undefined
): React.RefObject<T> => {
  const bindingsRef = useF0MeetingBindings()
  const ref = useRef<T>(null)
  const bindingKey = track?.bindingKey
  const binding = track?.binding
  const hasBinding = binding !== undefined

  // The latest closure, written in an effect so the attach effect below can
  // read it without listing it as a dependency. Declared first: effects of one
  // component run in order.
  const latestRef = useRef(binding)
  useLayoutEffect(() => {
    latestRef.current = binding
  })

  useLayoutEffect(() => {
    const element = ref.current
    if (!element || !bindingKey) {
      return
    }
    // The track is the source; the provider's map is the fallback for a track
    // handed over without its binding. It cannot be the other way round: the
    // map is synced in the provider's layout effect, and a child's effect runs
    // before its parent's, so on the commit that introduces a key the map is
    // one step behind.
    const attach = latestRef.current ?? bindingsRef.current.get(bindingKey)
    if (!attach) {
      return
    }
    return attach(element)
  }, [bindingKey, hasBinding, bindingsRef])

  return ref
}
