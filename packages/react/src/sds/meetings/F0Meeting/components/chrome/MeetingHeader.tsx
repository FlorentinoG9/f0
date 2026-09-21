import { F0Avatar } from "@/components/avatars/F0Avatar"
import { F0Button } from "@/components/F0Button"
import { Minimize } from "@/icons/app"
import { OneEllipsis } from "@/lib/OneEllipsis"
import { useI18n } from "@/lib/providers/i18n"
import { cn } from "@/lib/utils"
import { useF0MeetingRoster } from "../../providers/F0MeetingProvider"
import { useMeetingDensity } from "../../providers/MeetingDensityProvider"
import { useMeetingSurface } from "../../providers/MeetingSurfaceProvider"
import { MeetingModeSwitch } from "./MeetingModeSwitch"
import { MeetingTimer } from "./MeetingTimer"

/**
 * Open delay for the tooltip that reveals a title too long for the bar. Short
 * on purpose: it is the only way to read a name the layout has cut off, so the
 * default 700ms reads as unresponsive.
 */
const CLIPPED_TITLE_TOOLTIP_DELAY_MS = 300

/**
 * The one control a picture-in-picture window's title bar has. The window is
 * the browser's — it moves, resizes and closes on its own — so the mode switch
 * would only offer places you reach by closing it. Same `md` as every other
 * control in the room.
 */
const BackToTabButton = () => {
  const i18n = useI18n()
  const { exitPictureInPicture } = useMeetingSurface()
  return (
    <F0Button
      variant="ghost"
      size="md"
      hideLabel
      icon={Minimize}
      label={i18n.meeting.exitPictureInPicture}
      onClick={() => {
        exitPictureInPicture()
        // Closing the window does not bring the tab forward by itself.
        window.focus()
      }}
    />
  )
}

/**
 * The window's title bar. It is also the drag surface, so anything interactive
 * inside carries `data-f0-no-drag` to opt out of starting a gesture.
 *
 * Two compositions rather than one that scales: full screen leads with the
 * elapsed time because that is the thing you glance at from across a room,
 * while a panel or a floating window leads with the room's identity because
 * there are several of them on screen and you need to know which is which.
 */
export const MeetingHeader = ({ extra }: { extra?: React.ReactNode }) => {
  const { room } = useF0MeetingRoster()
  const { effectiveMode } = useMeetingSurface()
  const density = useMeetingDensity()

  const isMinimized = effectiveMode === "minimized"
  const isFullscreen = effectiveMode === "fullscreen"
  const isPip = effectiveMode === "pip"
  // The avatar is the first thing to go. It is decoration next to the title,
  // and in a narrow window every pixel it takes comes off the room's name —
  // which is the one thing the bar exists to say.
  const hasRoomForAvatar = !isMinimized && density !== "tight"
  // A pill and a PiP window are both glanced at from another task, and the
  // time is what you glance for.
  const showsTimerInline = isMinimized || isPip

  return (
    <>
      {isFullscreen ? (
        <span className="flex min-w-0 items-center gap-3 text-f1-foreground">
          <span className="shrink-0 font-medium tabular-nums">
            <MeetingTimer startedAt={room.startedAt} />
          </span>
          <span
            aria-hidden
            className="h-5 w-px shrink-0 bg-f1-border-secondary"
          />
          <OneEllipsis
            tag="span"
            delay={CLIPPED_TITLE_TOOLTIP_DELAY_MS}
            className="text-lg font-semibold"
          >
            {room.title}
          </OneEllipsis>
        </span>
      ) : (
        <span className="flex min-w-0 items-center gap-2 text-f1-foreground">
          {room.avatar && hasRoomForAvatar ? (
            <span className="shrink-0" data-testid="meeting-room-avatar">
              <F0Avatar avatar={room.avatar} size="xs" />
            </span>
          ) : null}
          <OneEllipsis
            tag="span"
            delay={CLIPPED_TITLE_TOOLTIP_DELAY_MS}
            className="text-base font-medium"
          >
            {room.title}
          </OneEllipsis>
          {showsTimerInline ? (
            <span className="shrink-0 text-f1-foreground-secondary tabular-nums">
              <MeetingTimer startedAt={room.startedAt} />
            </span>
          ) : null}
        </span>
      )}

      <div
        className={cn(
          "ml-auto flex shrink-0 items-center",
          density === "tight" ? "gap-0.5" : "gap-1.5"
        )}
        data-f0-no-drag
      >
        {isPip ? (
          <BackToTabButton />
        ) : (
          <>
            {extra}
            <MeetingModeSwitch />
          </>
        )}
      </div>
    </>
  )
}
