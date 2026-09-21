import { cn } from "@/lib/utils"
import { useMeetingSignal } from "../../providers/useMeetingSignal"
import { type F0MeetingConnectionQuality } from "../../types"

const LEVELS: Record<F0MeetingConnectionQuality, number> = {
  excellent: 3,
  good: 2,
  poor: 1,
  lost: 0,
}

const HEIGHTS = ["h-1", "h-2", "h-3"]
/** On a thumbnail the full meter is a quarter of the tile's height. */
const COMPACT_HEIGHTS = ["h-[3px]", "h-1.5", "h-2"]

/** Another leaf reader of the signal store — see {@link SpeakingIndicator}. */
export const ConnectionQualityBars = ({
  participantId,
  label,
  compact = false,
}: {
  participantId: string
  label: string
  /** Thumbnails get shorter, thinner bars, the same way the meter shrinks. */
  compact?: boolean
}) => {
  const { quality } = useMeetingSignal(participantId)
  const level = LEVELS[quality]

  if (quality === "excellent") {
    return null
  }

  const heights = compact ? COMPACT_HEIGHTS : HEIGHTS

  return (
    <div
      className={cn("flex items-end", compact ? "gap-px" : "gap-[2px]")}
      role="img"
      aria-label={label}
    >
      {heights.map((height, index) => (
        <div
          key={height}
          className={cn(
            // Inherits the tile's colour: white over video, dark over the
            // avatar placeholder, where white bars would vanish.
            "rounded-full bg-current",
            compact ? "w-[3px]" : "w-1",
            height,
            index < level ? "opacity-100" : "opacity-30"
          )}
        />
      ))}
    </div>
  )
}
