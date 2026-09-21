import { useLayoutEffect } from "react"
import { cn } from "@/lib/utils"
import { tileKey } from "../../layout/tiles"
import { useMeetingSurfaceOptional } from "../../providers/MeetingSurfaceProvider"
import { useTrackBinding } from "../../providers/useTrackBinding"
import { type F0MeetingTrack } from "../../types"

export type TileVideoProps = {
  track: F0MeetingTrack
  /** Whose video this is; with the track's kind it names the tile. */
  participantId: string
  /** Screen shares are letterboxed; cameras fill the tile. */
  contain?: boolean
  /** Mirror the local camera, as every other call product does. */
  mirrored?: boolean
}

/**
 * The only place a `<video>` is created. It is never unmounted while the track
 * exists — remounting one shows a black frame and, with simulcast, forces a
 * layer renegotiation.
 */
export const TileVideo = ({
  track,
  participantId,
  contain = false,
  mirrored = false,
}: TileVideoProps) => {
  const ref = useTrackBinding<HTMLVideoElement>(track)
  const registerVideo = useMeetingSurfaceOptional()?.registerVideo
  const key = tileKey(participantId, track.kind)

  // Video picture-in-picture (the fallback where Document PiP is missing)
  // needs a real element to hand to the browser. Registered here because this
  // is the one place that has it; the surface picks which one to send.
  useLayoutEffect(() => {
    if (!registerVideo) {
      return
    }
    registerVideo(key, ref.current)
    return () => registerVideo(key, null)
  }, [registerVideo, key, ref])

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      // The room renders one <audio> per remote track instead, so a muted
      // participant tile can never double up the audio.
      muted
      className={cn(
        "h-full w-full",
        contain ? "object-contain" : "object-cover",
        mirrored && "-scale-x-100"
      )}
    />
  )
}
