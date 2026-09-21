import { F0Button } from "@/components/F0Button"
import { Floating, Kanban, Maximize, Minimize } from "@/icons/app"
import { useI18n } from "@/lib/providers/i18n"
import { cn } from "@/lib/utils"
import { useMeetingSurface } from "../../providers/MeetingSurfaceProvider"
import { type F0MeetingSurfaceDestination } from "../../types"
import { touchTargetChildren } from "../controls/touch-target"

/**
 * Where the call can go from here.
 *
 * Deliberately NOT a toggle group. A toggle group says "pick one of three" and
 * draws all three, including the one you are already looking at — a button that
 * does nothing. This offers only the destinations: the mode you are in is
 * omitted, and which one that is, is obvious from the window itself.
 *
 * `minimized` is never offered on desktop: it is derived automatically on small
 * viewports, not a place you choose. Picture-in-picture is never offered at
 * all: like Meet, it is where the browser puts the call when you leave the
 * tab, from any of these modes, not a place you send it (see
 * `useMediaSessionPip`).
 *
 * Every button is `md`, like every control in the room. The switch used to
 * drop to `sm` in a tight window, which made the title bar the one place with
 * 24px targets — and the tight bar is 44px, which holds a 32px control fine.
 */
export const MeetingModeSwitch = () => {
  const i18n = useI18n()
  const { effectiveMode, setMode, isCompactViewport, hasPanelSlot } =
    useMeetingSurface()

  // On a small viewport there is no window to place and no room for a panel:
  // the only meaningful choice is pill or full screen. Same rule as below —
  // show the place you are not — which is why it is no longer a special case.
  if (isCompactViewport) {
    const isFullscreen = effectiveMode === "fullscreen"
    return (
      <span className={cn("inline-flex", touchTargetChildren())}>
        <F0Button
          variant="ghost"
          size="md"
          hideLabel
          icon={isFullscreen ? Minimize : Maximize}
          label={
            isFullscreen
              ? i18n.meeting.exitFullscreen
              : i18n.meeting.enterFullscreen
          }
          onClick={() => setMode(isFullscreen ? "minimized" : "fullscreen")}
        />
      </span>
    )
  }

  const destinations: {
    mode: F0MeetingSurfaceDestination
    icon: typeof Kanban
    label: string
  }[] = [
    // TODO: `Kanban` is the closest glyph the generated icon set has to a left
    // side panel. Ask design for a real `PanelLeft` in f0-core.
    { mode: "panel", icon: Kanban, label: i18n.meeting.modeSidePanel },
    { mode: "floating", icon: Floating, label: i18n.meeting.modeFloating },
    { mode: "fullscreen", icon: Maximize, label: i18n.meeting.modeFullscreen },
  ]

  return (
    <div
      role="group"
      aria-label={i18n.meeting.modeSwitch}
      className={cn("flex gap-1", touchTargetChildren())}
    >
      {destinations
        .filter((destination) => destination.mode !== effectiveMode)
        // The panel is only a destination where one exists. A call rendered
        // outside an application frame has nowhere to dock, and offering it
        // would be a button that lands you somewhere else.
        .filter((destination) => destination.mode !== "panel" || hasPanelSlot)
        .map((destination) => (
          <F0Button
            key={destination.mode}
            variant="ghost"
            size="md"
            hideLabel
            icon={destination.icon}
            label={destination.label}
            onClick={() => setMode(destination.mode)}
          />
        ))}
    </div>
  )
}
