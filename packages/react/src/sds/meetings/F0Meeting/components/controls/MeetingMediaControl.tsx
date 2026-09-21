import { F0Icon } from "@/components/F0Icon"
import { Check, ChevronDown } from "@/icons/app"
import { useI18n } from "@/lib/providers/i18n"
import { cn, focusRing } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu"
import { type F0MeetingAction, type F0MeetingLocalSource } from "../../types"
import { touchTarget } from "./touch-target"

export type MeetingMediaControlProps = {
  /** The mute toggle. Its `pressed` means "the source is OFF". */
  action: F0MeetingAction
  source: F0MeetingLocalSource
  /** Localized name of the picker, e.g. "Select microphone". */
  pickerLabel: string
}

/**
 * Mute toggle and device picker as one control, split by a hairline.
 *
 * This reverses an earlier decision — the picker used to be a separate sibling
 * button, on the grounds that a menu glued to a toggle turns one target into
 * two and the small one wins the misclick. The design asks for the fused pair
 * that every other call product uses, so the mitigation moves into the shape:
 * the toggle half is 40px against the chevron's 28, and they are separated by
 * a real gap in the hit areas rather than only a painted line.
 *
 * Its width is what `MEDIA_CONTROL_SIZE` says: 40 + 1 + 28 inside a 1px
 * border = 71. Same `md` height as every other control, in every density.
 */
export const MeetingMediaControl = ({
  action,
  source,
  pickerLabel,
}: MeetingMediaControlProps) => {
  const i18n = useI18n()
  const isOff = Boolean(action.pressed)
  const devices = source.devices ?? []
  const canPick = devices.length > 0 && Boolean(source.selectDevice)
  const icon = isOff && action.activeIcon ? action.activeIcon : action.icon
  const disabled = action.disabled || action.pending

  return (
    <div
      className={cn(
        // No `overflow-hidden`: it would clip the halves' coarse-pointer hit
        // areas. The halves round their own outer corners instead.
        "flex h-8 items-stretch rounded border border-solid border-f1-border-secondary",
        // Muted is a state you must be able to spot without reading an icon,
        // so it takes the critical surface rather than a generic "on" look.
        isOff ? "bg-f1-background-secondary" : "bg-f1-background"
      )}
    >
      <button
        type="button"
        onClick={action.onClick}
        aria-pressed={isOff}
        aria-label={action.label}
        title={action.disabled ? action.disabledReason : action.label}
        disabled={disabled}
        className={cn(
          "flex w-10 items-center justify-center transition-colors duration-150 ease-out motion-reduce:transition-none",
          canPick ? "rounded-l-[inherit]" : "rounded-[inherit]",
          "hover:bg-f1-background-secondary-hover",
          disabled && "cursor-not-allowed opacity-50",
          focusRing(),
          touchTarget(canPick ? "left" : "all")
        )}
      >
        <F0Icon icon={icon} size="md" color="bold" />
      </button>

      {canPick ? (
        <>
          <span aria-hidden className="w-px shrink-0 bg-f1-border-secondary" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={pickerLabel}
                disabled={action.disabled}
                className={cn(
                  "flex w-7 items-center justify-center rounded-r-[inherit] transition-colors duration-150 ease-out motion-reduce:transition-none",
                  "hover:bg-f1-background-secondary-hover",
                  action.disabled && "cursor-not-allowed opacity-50",
                  focusRing(),
                  touchTarget("right")
                )}
              >
                <F0Icon icon={ChevronDown} size="sm" color="bold" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" side="top">
              {devices.map((device) => (
                <DropdownMenuItem
                  key={device.id}
                  onSelect={() => source.selectDevice?.(device.id)}
                >
                  {/* The check keeps its slot on every row, so the labels stay
                      in one column instead of shifting as the choice moves. */}
                  <span className="flex w-4 shrink-0 justify-center">
                    {device.id === source.selectedDeviceId ? (
                      <F0Icon icon={Check} size="sm" />
                    ) : null}
                  </span>
                  {device.isDefault
                    ? `${device.label} · ${i18n.meeting.systemDefault}`
                    : device.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}
    </div>
  )
}
