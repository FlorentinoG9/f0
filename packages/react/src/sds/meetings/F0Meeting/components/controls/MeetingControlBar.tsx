import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react"
import { F0Button } from "@/components/F0Button"
import {
  Dropdown,
  type DropdownItemObject,
} from "@/experimental/Navigation/Dropdown"
import { Ellipsis } from "@/icons/app"
import { useI18n } from "@/lib/providers/i18n"
import { cn } from "@/lib/utils"
import { CONTROLS_HEIGHT } from "../../layout/density"
import { useMeasuredBox } from "../../layout/useMeasuredBox"
import { useF0MeetingRoster } from "../../providers/F0MeetingProvider"
import { useMeetingDensity } from "../../providers/MeetingDensityProvider"
import { useMeetingSurface } from "../../providers/MeetingSurfaceProvider"
import { type F0MeetingAction } from "../../types"
import {
  ACTION_GAP_CLASS,
  BAR_PADDING,
  collapseActions,
  PICKER_IDS,
} from "./collapse-actions"
import { MeetingActionButton } from "./MeetingActionButton"
import { MeetingMediaControl } from "./MeetingMediaControl"
import { touchTargetChildren } from "./touch-target"

export type MeetingControlBarProps = {
  actions: F0MeetingAction[]
}

/**
 * How many times the bar may take a second look at its own row before it
 * stops. Each look removes one action, so this bounds a bar that somehow
 * never stops clipping — a CSS override it cannot see, say — to a handful of
 * synchronous re-renders rather than a loop.
 */
const MAX_FORCE_COLLAPSE = 8

/**
 * A collapsed action, as a menu row.
 *
 * The hand-rolled menu this replaces dropped two things on the floor:
 * `disabledReason` was never shown, so a disabled row gave no reason; and
 * `variant: "critical"` was lost, so "Leave" turned into an ordinary item the
 * moment the bar was narrow enough to collapse it.
 */
const toDropdownItem = (action: F0MeetingAction): DropdownItemObject => ({
  label: action.label,
  icon: action.pressed && action.activeIcon ? action.activeIcon : action.icon,
  onClick: () => action.onClick?.(),
  disabled: action.disabled,
  ...(action.disabledReason ? { disabledTooltip: action.disabledReason } : {}),
  ...(action.variant === "critical" ? { critical: true } : {}),
})

/**
 * Whether the row is drawing more than it can show. `scrollWidth` alone is
 * not enough: some engines leave the end padding out of it, which hides an
 * overflow smaller than that padding — so the last control's own edge is
 * checked against the row too.
 */
const isClipped = (row: HTMLElement): boolean => {
  // No layout (jsdom, `display: none`) reads as all zeros, which the edge
  // check below would take for an overflow and collapse the whole bar.
  if (row.clientWidth <= 0) {
    return false
  }
  if (row.scrollWidth > row.clientWidth) {
    return true
  }
  const last = row.lastElementChild
  // 1px of slack: offsets are rounded, and a control sitting exactly on the
  // edge must not be dropped for a rounding error.
  return (
    last instanceof HTMLElement &&
    last.offsetLeft + last.offsetWidth > row.clientWidth - BAR_PADDING + 1
  )
}

/**
 * The action bar. Everything about it is host-extensible: F0 only guarantees
 * that the core controls exist and that the bar degrades sensibly as it narrows.
 *
 * Capacity comes from the bar's own measured width, not the viewport, so the
 * same component works in fullscreen and inside a 300px floating window.
 *
 * The bar has no surface of its own. It sits on the room's own background,
 * which is what the design shows and what keeps a translucent plate from
 * floating over the video for no reason.
 */
export const MeetingControlBar = ({ actions }: MeetingControlBarProps) => {
  const i18n = useI18n()
  const { effectiveMode } = useMeetingSurface()
  const { localMedia } = useF0MeetingRoster()
  const density = useMeetingDensity()
  const [containerRef, box] = useMeasuredBox<HTMLDivElement>()
  const rowRef = useRef<HTMLDivElement>(null)

  const isMinimized = effectiveMode === "minimized"
  // Only "Leave" changes shape with the room: everything else is 32px always.
  const tightLeave = density === "tight"
  const barWidth = Math.max(0, box.width - BAR_PADDING * 2)

  // The second look (see `isClipped`), keyed to the layout it was taken of so
  // a resize or a new set of actions starts again from the arithmetic.
  const layoutKey = [
    barWidth,
    effectiveMode,
    tightLeave,
    actions.map((action) => action.id).join(","),
  ].join("|")
  const [forced, setForced] = useState({ key: layoutKey, count: 0 })
  const forceCollapse = forced.key === layoutKey ? forced.count : 0

  const { visible, overflow } = useMemo(
    () =>
      collapseActions(actions, barWidth, effectiveMode, {
        tightLeave,
        forceCollapse,
      }),
    [actions, barWidth, effectiveMode, tightLeave, forceCollapse]
  )

  // Before paint, so a correction never shows: the estimate is an estimate
  // (a localized "Leave", a host control the arithmetic never met), and the
  // bar must not clip silently when it is short.
  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row || barWidth <= 0 || isMinimized || !isClipped(row)) {
      return
    }
    if (forceCollapse >= MAX_FORCE_COLLAPSE) {
      return
    }
    const collapsible = visible.some(
      (action) => !action.pinned && !PICKER_IDS.has(action.id)
    )
    if (!collapsible) {
      return
    }
    setForced({ key: layoutKey, count: forceCollapse + 1 })
  })

  const byId = useMemo(
    () => new Map(visible.map((action) => [action.id, action])),
    [visible]
  )

  return (
    <div
      ref={containerRef}
      className="flex w-full shrink-0 items-center justify-center"
      style={isMinimized ? undefined : { height: CONTROLS_HEIGHT[density] }}
      data-testid="meeting-control-bar"
    >
      {/* `p-1.5` is `BAR_PADDING`: the room the 44px touch targets need inside
          the overflow clip. `relative` so the clip check can read the last
          control's offset against the row. */}
      <div
        ref={rowRef}
        className={cn(
          "relative flex min-w-0 items-center overflow-hidden p-1.5",
          ACTION_GAP_CLASS,
          touchTargetChildren()
        )}
        role="toolbar"
        aria-label={i18n.meeting.controls}
      >
        {visible.map((action) => {
          // A picker never renders on its own: it is the chevron half of the
          // control it configures, drawn by that control below.
          if (PICKER_IDS.has(action.id)) {
            return null
          }

          if (action.id === "core:microphone" || action.id === "core:camera") {
            const isMicrophone = action.id === "core:microphone"
            const pickerId = isMicrophone
              ? "core:microphoneSettings"
              : "core:cameraSettings"
            const source = isMicrophone
              ? localMedia.microphone
              : localMedia.camera

            return (
              <Fragment key={action.id}>
                <MeetingMediaControl
                  action={action}
                  // Without its picker action the chevron must not appear —
                  // that is how a host removes the device menu.
                  source={
                    byId.has(pickerId) ? source : { ...source, devices: [] }
                  }
                  pickerLabel={
                    isMicrophone
                      ? i18n.meeting.selectMicrophone
                      : i18n.meeting.selectCamera
                  }
                />
              </Fragment>
            )
          }

          return (
            <MeetingActionButton
              key={action.id}
              action={action}
              tightLeave={tightLeave}
            />
          )
        })}

        {/* Only when something actually collapsed into it. A menu that is
            always there and usually empty is a control that teaches you to
            ignore it — and the empty state it used to need ("No more actions")
            is gone with it. */}
        {!isMinimized && overflow.length > 0 ? (
          <Dropdown items={overflow.map(toDropdownItem)} align="end">
            <F0Button
              variant="ghost"
              size="md"
              hideLabel
              icon={Ellipsis}
              label={i18n.meeting.moreActions}
            />
          </Dropdown>
        ) : null}
      </div>
    </div>
  )
}
