import { type CSSProperties, memo } from "react"
import { F0Avatar } from "@/components/avatars/F0Avatar"
import { F0Icon } from "@/components/F0Icon"
import { Desktop, MicrophoneNegative, PushPin, PushPinSolid } from "@/icons/app"
import { OneEllipsis } from "@/lib/OneEllipsis"
import { useI18n } from "@/lib/providers/i18n"
import { cn, focusRing } from "@/lib/utils"
import {
  COMPACT_TILE_WIDTH,
  LABEL_HIDE_WIDTH,
  LABEL_SHORT_WIDTH,
  PIN_RESERVE,
  SHARE_SUFFIX_MIN_WIDTH,
  avatarSizeFor,
  cellRadiusStyle,
  labelFontFor,
} from "../../layout/constants"
import { type F0MeetingTile } from "../../layout/tiles"
import { ConnectionQualityBars } from "./ConnectionQualityBars"
import { SpeakingIndicator } from "./SpeakingIndicator"
import { TileVideo } from "./TileVideo"

export type ParticipantTileProps = {
  tile: F0MeetingTile
  /**
   * The tile's laid-out width in px. Everything that scales — the label, the
   * avatar, the chip insets, the meter — is derived from it. Omitted, the tile
   * renders as a full-size one.
   */
  width?: number
  /**
   * Corner radius in px, scaled to the tile's width by the grid. Omitted, the
   * tile falls back to square corners — always pass it from a laid-out grid.
   */
  radius?: number
  isFocused?: boolean
  canFocus?: boolean
  onToggleFocus?: (key: string) => void
}

/** What a tile with no measured width behaves as: a full one. */
const DEFAULT_TILE_WIDTH = SHARE_SUFFIX_MIN_WIDTH

/** The chip's copy at three widths: everything, the first name, nothing. */
type LabelRegime = "full" | "short" | "icon"

const labelRegimeFor = (width: number): LabelRegime => {
  if (width < LABEL_HIDE_WIDTH) {
    return "icon"
  }
  return width < LABEL_SHORT_WIDTH ? "short" : "full"
}

const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name

const LABEL_TEXT = "text-[length:var(--tile-label)] font-medium leading-[1.35]"

/**
 * The name chip. Over video it has to fight arbitrary imagery, so it gets a
 * solid plate. Over the dark placeholder there is nothing to fight and the
 * same plate reads as a smudge, so the text stands on its own. Its children
 * inherit the colour from here.
 */
const TileLabel = ({
  tile,
  width,
  compact,
  hasVideo,
}: {
  tile: F0MeetingTile
  width: number
  compact: boolean
  hasVideo: boolean
}) => {
  const i18n = useI18n()
  const { participant, kind } = tile
  const isScreenShare = kind === "screenShare"
  const isMuted = !participant.tracks.some(
    (candidate) => candidate.kind === "microphone" && !candidate.muted
  )

  const regime = labelRegimeFor(width)
  const you = i18n.meeting.you
  const name =
    regime === "short"
      ? participant.isLocal
        ? you
        : firstName(participant.name)
      : participant.isLocal
        ? `${participant.name} (${you})`
        : participant.name
  const showShareSuffix = isScreenShare && width >= SHARE_SUFFIX_MIN_WIDTH

  return (
    <div
      className={cn(
        "absolute flex items-center overflow-hidden rounded-lg text-f1-foreground-inverse",
        // Insets, padding and gap all follow the tile's width, so the chip is
        // the same design on a 90px thumbnail and a 900px spotlight.
        compact ? "start-1.5 top-1.5" : "start-3 top-3",
        "px-[clamp(4px,calc(4px_+_var(--tile-w)_*_0.02),12px)]",
        "py-[clamp(2px,calc(2px_+_var(--tile-w)_*_0.012),8px)]",
        "gap-[clamp(3px,calc(var(--tile-w)_*_0.015),6px)]",
        // Room for the pin control in the opposite corner, so a long name
        // runs out of space before it runs under the button.
        "max-w-[calc(100%_-_0.75rem_-_var(--pin-reserve))]",
        hasVideo && "bg-f1-foreground dark:bg-f1-background"
      )}
    >
      {regime !== "icon" ? (
        // `min-w-0` is what lets the truncation actually happen: a flex child
        // will not shrink below its content width without it, so a long name
        // would spill out of the chip instead of ellipsing.
        <OneEllipsis
          tag="span"
          delay={300}
          className={cn("min-w-0", LABEL_TEXT)}
        >
          {name}
        </OneEllipsis>
      ) : null}
      {showShareSuffix ? (
        // Its own span, and it never shrinks: it is the name that gives way
        // when the chip is short of room, not what the tile is showing.
        <span className={cn("shrink-0 whitespace-nowrap", LABEL_TEXT)}>
          · {i18n.meeting.sharingScreen}
        </span>
      ) : null}
      <span className="flex shrink-0 items-center">
        {isScreenShare ? (
          <F0Icon icon={Desktop} size="sm" />
        ) : isMuted ? (
          <F0Icon icon={MicrophoneNegative} size="sm" />
        ) : (
          <SpeakingIndicator participantId={participant.id} compact={compact} />
        )}
      </span>
    </div>
  )
}

const ParticipantTileBase = ({
  tile,
  width = DEFAULT_TILE_WIDTH,
  radius,
  isFocused = false,
  canFocus = false,
  onToggleFocus,
}: ParticipantTileProps) => {
  const i18n = useI18n()
  const { participant, track, kind } = tile
  const isScreenShare = kind === "screenShare"
  // Someone the call is still waiting for. They publish nothing, so there is
  // no video, no level to meter and no connection to rate — the tile says so
  // and shows none of the instrumentation that would all read as zero.
  const isInvited = participant.presence === "invited"
  const hasVideo = Boolean(track && track.live && !track.muted) && !isInvited
  /** Letterboxed rather than filled — so the bands need a backdrop. */
  const isContained = isScreenShare || Boolean(participant.preventCrop)
  // One rule for what "small" means, shared with the overflow chip beside it.
  const compact = width < COMPACT_TILE_WIDTH

  return (
    <div
      className={cn(
        "group relative h-full w-full overflow-hidden",
        // In dark mode every cell is the same secondary surface. In light mode
        // a tile with no video keeps a dark plate — an avatar on the light
        // surface reads as a hole in the grid — while one carrying video sits
        // on the surface itself, with the border doing the work instead.
        "dark:bg-f1-background-secondary",
        hasVideo ? "bg-f1-background" : "bg-f1-foreground",
        "border border-solid border-f1-border-secondary"
      )}
      // The radius is scaled to the tile rather than a fixed `rounded-xl`: at
      // 90px wide a 12px radius eats the corners. The width goes in as a custom
      // property so the chip's insets scale in CSS; the label size is resolved
      // here because it is clamped, and clamping in JS is what the tests can
      // read. The pin reserve is a property too, so the chip's max-width and
      // the button's corner come from the one constant.
      style={
        {
          ...cellRadiusStyle(radius),
          "--tile-w": `${width}px`,
          "--tile-label": `${labelFontFor(width)}px`,
          "--pin-reserve": `${canFocus ? PIN_RESERVE : 0}px`,
        } as CSSProperties
      }
      data-testid="meeting-participant-tile"
      data-participant-id={participant.id}
    >
      {hasVideo && track ? (
        <TileVideo
          track={track}
          participantId={participant.id}
          // Tiles take their cell's shape and crop the sides to fill it, so
          // anyone who opted out is letterboxed like a screen share.
          contain={isContained}
          mirrored={participant.isLocal && !isScreenShare}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2.5 px-2">
          {participant.avatar ? (
            // Steps with the tile: the placeholder is an identity, and a 40px
            // one is most of a thumbnail and a dot on a spotlight.
            <F0Avatar avatar={participant.avatar} size={avatarSizeFor(width)} />
          ) : null}
          {isInvited && !compact ? (
            <span className="max-w-full truncate text-base text-f1-foreground-inverse-secondary">
              {i18n.meeting.waitingToJoin}
            </span>
          ) : null}
        </div>
      )}

      {!isInvited ? (
        <TileLabel
          tile={tile}
          width={width}
          compact={compact}
          hasVideo={hasVideo}
        />
      ) : null}

      {!isInvited ? (
        <div
          className={cn(
            "absolute text-f1-foreground-inverse",
            compact ? "bottom-1.5 end-1.5" : "bottom-3 end-3"
          )}
        >
          <ConnectionQualityBars
            participantId={participant.id}
            label={i18n.meeting.weakConnection}
            compact={compact}
          />
        </div>
      ) : null}

      {canFocus && !isInvited ? (
        <button
          type="button"
          onClick={() => onToggleFocus?.(tile.key)}
          aria-pressed={isFocused}
          className={cn(
            "absolute flex items-center justify-center rounded-md bg-f1-background/90 text-f1-foreground transition-opacity duration-150 ease-out",
            // Inside `PIN_RESERVE` at either size: inset plus button plus a
            // breath is what the chip's max-width leaves free.
            compact ? "end-1.5 top-1.5 h-6 w-6" : "end-3 top-3 h-8 w-8",
            // Always visible while pinned: the affordance that undoes a state
            // cannot itself be hidden behind a hover.
            isFocused
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
            focusRing()
          )}
        >
          {/* Solid glyph while pinned, outline when not — the same pair the
              chat uses for its pin action. */}
          <F0Icon icon={isFocused ? PushPinSolid : PushPin} size="sm" />
          <span className="sr-only">
            {isFocused
              ? i18n.meeting.unpinParticipant
              : i18n.meeting.pinParticipant}
          </span>
        </button>
      ) : null}
    </div>
  )
}

/**
 * Memoized on scalar props derived by the grid. It must never read the full
 * runtime: the volatile signals are subscribed to by the leaves inside it, so
 * an audio burst cannot re-render the tile or the `<video>` it owns.
 *
 * `radius` and `width` are in the comparison because they are what the grid
 * changes on a re-solve: leaving `radius` out is what kept a tile's corners at
 * the old size after the room resized around it.
 */
export const ParticipantTile = memo(
  ParticipantTileBase,
  (previous, next) =>
    previous.tile.key === next.tile.key &&
    previous.tile.track?.bindingKey === next.tile.track?.bindingKey &&
    previous.tile.track?.live === next.tile.track?.live &&
    previous.tile.track?.muted === next.tile.track?.muted &&
    previous.tile.participant.name === next.tile.participant.name &&
    previous.tile.participant.avatar === next.tile.participant.avatar &&
    previous.tile.participant.tracks === next.tile.participant.tracks &&
    previous.tile.participant.presence === next.tile.participant.presence &&
    previous.tile.participant.preventCrop ===
      next.tile.participant.preventCrop &&
    previous.width === next.width &&
    previous.radius === next.radius &&
    previous.isFocused === next.isFocused &&
    previous.canFocus === next.canFocus &&
    previous.onToggleFocus === next.onToggleFocus
)
