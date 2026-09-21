import { useEffect, useRef } from "react"
import { useI18n } from "@/lib/providers/i18n"
import { type F0MeetingSurfaceMode } from "../types"
import { useF0MeetingRoster } from "./F0MeetingProvider"
import { useMeetingSurface } from "./MeetingSurfaceProvider"

const MODE_MESSAGE_KEY = {
  fullscreen: "movedToFullscreen",
  floating: "movedToFloating",
  panel: "movedToSidePanel",
  minimized: "movedToMinimized",
  inline: "movedInline",
  pip: "movedToPictureInPicture",
} as const satisfies Record<F0MeetingSurfaceMode, string>

/**
 * Feeds the live region with what changed in the room: who arrived, who left,
 * and where the call went. Only the differences — nobody is read the roster of
 * the room they just walked into — and never the local participant.
 *
 * Several changes in one commit collapse to the last one. The region throttles
 * and coalesces anyway (see `MeetingLiveRegion`), so listing them all would
 * only be announced as the last one too.
 */
export const useRosterAnnouncements = (): void => {
  const i18n = useI18n()
  const { participants } = useF0MeetingRoster()
  const { announce, effectiveMode } = useMeetingSurface()

  /** id → name of everyone actually in the room, as of the previous commit. */
  const previousRef = useRef<Map<string, string> | null>(null)

  useEffect(() => {
    const current = new Map<string, string>()
    for (const participant of participants) {
      // Someone still `invited` has not arrived, so they are neither a join
      // now nor a leave when the host drops them from the list.
      if (!participant.isLocal && participant.presence !== "invited") {
        current.set(participant.id, participant.name)
      }
    }

    const previous = previousRef.current
    previousRef.current = current
    if (!previous) {
      return
    }

    let message: string | null = null
    for (const [id, name] of current) {
      if (!previous.has(id)) {
        message = i18n.t("meeting.participantJoined", { name })
      }
    }
    for (const [id, name] of previous) {
      if (!current.has(id)) {
        message = i18n.t("meeting.participantLeft", { name })
      }
    }
    if (message !== null) {
      announce(message)
    }
  }, [participants, announce, i18n])

  const previousModeRef = useRef(effectiveMode)

  useEffect(() => {
    if (previousModeRef.current === effectiveMode) {
      return
    }
    previousModeRef.current = effectiveMode
    announce(i18n.meeting[MODE_MESSAGE_KEY[effectiveMode]])
  }, [effectiveMode, announce, i18n])
}
