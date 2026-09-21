import { F0Button } from "@/components/F0Button"
import { F0ButtonToggle } from "@/components/F0ButtonToggle"
import { useI18n } from "@/lib/providers/i18n"
import { cn } from "@/lib/utils"
import { type F0MeetingAction } from "../../types"
import { touchTarget } from "./touch-target"

export type MeetingActionButtonProps = {
  action: F0MeetingAction
  /** Draw "Leave" as an icon: a tight bar has no room for its label. */
  tightLeave?: boolean
}

/**
 * Every control is `md` — 32px — in every mode and density. The bar used to
 * step between `lg` and `md` with the window, and two sizes meant two sets of
 * width estimates that had to be kept in step with what was drawn.
 */
const SIZE = "md"

type Tooltip = string | { label: string; description: string } | undefined

/**
 * A disabled control explains itself: without the reason it is a dead end for
 * anyone who cannot see the state that caused it. Otherwise the shortcut, if
 * the host declared one.
 */
const tooltipFor = (action: F0MeetingAction): Tooltip => {
  if (action.disabled && action.disabledReason) {
    return action.disabledReason
  }
  if (action.shortcut) {
    return { label: action.label, description: action.shortcut }
  }
  return undefined
}

/** The unread pill on a toggle, or a dot when there is activity but no count. */
const ActionBadge = ({ count }: { count: number | undefined }) => (
  <span
    aria-hidden
    data-testid="meeting-action-badge"
    className={cn(
      "pointer-events-none absolute -right-1 -top-1 flex items-center justify-center rounded-full bg-f1-background-accent-bold text-f1-foreground-inverse",
      count === undefined
        ? "h-2 w-2"
        : "h-4 min-w-4 px-1 text-xs font-medium tabular-nums"
    )}
  >
    {count === undefined ? null : count > 99 ? "99+" : count}
  </span>
)

/**
 * Anything with an on/off state is a toggle, so it gets the real toggle
 * control and its `aria-pressed`, not a button styled to look active.
 */
const MeetingToggleButton = ({ action }: { action: F0MeetingAction }) => {
  const i18n = useI18n()
  const count = typeof action.badge === "number" ? action.badge : undefined
  const hasBadge = action.badge !== undefined && count !== 0
  // The count is part of the name, not a sibling: a screen reader walking the
  // toolbar hears "Open chat · 3 unread" on the button itself.
  const label =
    count !== undefined && count > 0
      ? `${action.label} · ${i18n.t("meeting.unreadCount", { count })}`
      : action.label

  const toggle = (
    <F0ButtonToggle
      // For mic and camera `pressed` means "the source is off", so the
      // selected half of the pair is the negative glyph.
      selected={Boolean(action.pressed)}
      onSelectedChange={() => action.onClick?.()}
      icon={action.activeIcon ? [action.icon, action.activeIcon] : action.icon}
      label={label}
      tooltip={tooltipFor(action)}
      disabled={action.disabled || action.pending}
      size={SIZE}
      variant="compact"
      className={touchTarget()}
    />
  )

  if (!hasBadge) {
    return toggle
  }
  return (
    <span className="relative inline-flex">
      {toggle}
      <ActionBadge count={count} />
    </span>
  )
}

/**
 * Renders one action with the design system's own controls rather than a
 * bespoke button: toggles get {@link F0ButtonToggle}'s dual icon, everything
 * else is an {@link F0Button}. Both already derive a tooltip from `label` when
 * it is visually hidden, so the bar needs no tooltip plumbing of its own.
 */
export const MeetingActionButton = ({
  action,
  tightLeave = false,
}: MeetingActionButtonProps) => {
  if (action.pressed !== undefined) {
    return <MeetingToggleButton action={action} />
  }

  // Hanging up is the one action that carries its label. It is irreversible and
  // it is the only red control in the bar, so it should not depend on reading a
  // glyph — the design gives it a wider, labelled button for exactly that. A
  // tight bar is the exception: there the label is what pushes the mic out.
  if (action.variant === "critical") {
    return (
      <F0Button
        variant="critical"
        size={SIZE}
        label={action.label}
        hideLabel={tightLeave}
        icon={tightLeave ? action.icon : undefined}
        tooltip={tooltipFor(action)}
        disabled={action.disabled}
        loading={action.pending}
        onClick={action.onClick}
      />
    )
  }

  return (
    <F0Button
      variant="outline"
      size={SIZE}
      hideLabel
      icon={action.icon}
      label={action.label}
      tooltip={tooltipFor(action)}
      disabled={action.disabled}
      loading={action.pending}
      onClick={action.onClick}
    />
  )
}
