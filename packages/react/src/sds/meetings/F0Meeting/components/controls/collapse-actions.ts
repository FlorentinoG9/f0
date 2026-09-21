import { type F0MeetingAction, type F0MeetingSurfaceMode } from "../../types"

/**
 * ONE set of widths, because the bar draws one size: every control is `md`
 * (32px) in every mode and density. There used to be a second, compact set the
 * bar switched to in a small window, and asking capacity with one set while
 * drawing the other is what made a narrow bar collapse controls it had room
 * for.
 */
export const ACTION_SIZE = 32
/**
 * What the bar draws between controls. `ACTION_GAP_CLASS` is the same number
 * as a utility, kept beside it so the estimate and the drawing cannot diverge.
 */
export const ACTION_GAP = 6
export const ACTION_GAP_CLASS = "gap-1.5"
/**
 * The row's own padding, which keeps the 44px touch targets inside its
 * overflow clip. The bar subtracts it from the measured width before asking.
 */
export const BAR_PADDING = 6
/**
 * The "more" button, drawn only when something actually collapsed into it.
 *
 * It used to be permanent — "the design gives the room a permanent 'more'
 * affordance" — but a menu that is always there and usually empty is a control
 * that teaches you to ignore it. Its slot is now reserved only once the bar has
 * established that it is needed.
 */
export const OVERFLOW_SLOT = 32
/** A mute toggle fused with its device chevron: 40 + 1 hairline + 28, in a 1px border = 71. */
export const MEDIA_CONTROL_SIZE = 71
/** The same control once a host removed its picker: the 40px toggle half alone, in its border. */
export const MEDIA_TOGGLE_SIZE = 42
/**
 * "Leave" carries its label, so it is wider than an icon button. An estimate,
 * because the label is localized; in a tight bar it drops to an icon and
 * `ACTION_SIZE` is exact.
 */
export const LEAVE_SIZE = 60

/**
 * Device pickers are not standalone buttons: they are the chevron half of the
 * control they configure, and the bar draws them there. They still travel in
 * the action array so a host can patch or remove them by id.
 */
export const PICKER_IDS: ReadonlySet<string> = new Set([
  "core:microphoneSettings",
  "core:cameraSettings",
])

const PAIRED_PICKER: Record<string, string> = {
  "core:microphone": "core:microphoneSettings",
  "core:camera": "core:cameraSettings",
}

export type CollapseResult = {
  visible: F0MeetingAction[]
  overflow: F0MeetingAction[]
}

export type CollapseOptions = {
  /** The bar is drawing "Leave" as an icon (tight density). */
  tightLeave?: boolean
  /**
   * Non-pinned actions to collapse beyond what the arithmetic asks for. The
   * bar's second look: it measured its own row after painting and found it
   * still clipping, so the estimate was short and one more has to go.
   */
  forceCollapse?: number
}

const DEFAULT_PRIORITY = 50

/**
 * How much horizontal room one action claims.
 *
 * Measuring this properly matters: with every control counted as an icon, a
 * bar holding a 71px media pair and a 60px "Leave" thought it had far more
 * room than it did, and a side panel collapsed controls that would have fitted.
 */
const widthOf = (
  action: F0MeetingAction,
  present: ReadonlySet<string>,
  tightLeave: boolean
): number => {
  if (PICKER_IDS.has(action.id)) {
    return 0
  }
  if (action.id === "core:leave") {
    return tightLeave ? ACTION_SIZE : LEAVE_SIZE
  }
  const picker = PAIRED_PICKER[action.id]
  if (picker) {
    return present.has(picker) ? MEDIA_CONTROL_SIZE : MEDIA_TOGGLE_SIZE
  }
  return ACTION_SIZE
}

/** Total width of a set of actions, gaps included. */
const measure = (
  actions: F0MeetingAction[],
  present: ReadonlySet<string>,
  tightLeave: boolean
): number => {
  const widths = actions
    .map((action) => widthOf(action, present, tightLeave))
    .filter((width) => width > 0)
  if (widths.length === 0) {
    return 0
  }
  return (
    widths.reduce((total, width) => total + width, 0) +
    ACTION_GAP * (widths.length - 1)
  )
}

const isCollapsible = (action: F0MeetingAction): boolean =>
  !action.pinned && !PICKER_IDS.has(action.id)

/** The ids of `chosen`, each with its picker when the picker is present. */
const withPickers = (
  chosen: F0MeetingAction[],
  present: ReadonlySet<string>
): Set<string> => {
  const kept = new Set<string>()
  for (const action of chosen) {
    kept.add(action.id)
    const picker = PAIRED_PICKER[action.id]
    if (picker && present.has(picker)) {
      kept.add(picker)
    }
  }
  return kept
}

/** Splits `applicable` by a set of ids to keep; pickers never reach the menu. */
const split = (
  applicable: F0MeetingAction[],
  kept: ReadonlySet<string>
): CollapseResult => ({
  visible: applicable.filter((action) => kept.has(action.id)),
  overflow: applicable.filter(
    (action) => !kept.has(action.id) && isCollapsible(action)
  ),
})

/** Pinned first, then by priority. */
const rank = (applicable: F0MeetingAction[]): F0MeetingAction[] =>
  [...applicable].sort((a, b) => {
    const pinned = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
    if (pinned !== 0) {
      return pinned
    }
    return (b.priority ?? DEFAULT_PRIORITY) - (a.priority ?? DEFAULT_PRIORITY)
  })

/**
 * Takes actions in rank order while they fit. A picker rides along with its
 * toggle rather than competing with it, so the pair is never split in half.
 */
const takeWhileFitting = (
  ranked: F0MeetingAction[],
  present: ReadonlySet<string>,
  tightLeave: boolean,
  budget: number
): F0MeetingAction[] => {
  const chosen: F0MeetingAction[] = []
  for (const action of ranked) {
    if (PICKER_IDS.has(action.id)) {
      continue
    }
    const candidate = [...chosen, action]
    if (measure(candidate, present, tightLeave) > budget && !action.pinned) {
      continue
    }
    chosen.push(action)
  }
  return chosen
}

/**
 * The second look: drops the lowest-ranked survivors that may go. `chosen` is
 * in rank order, so walking it backwards is walking priority upwards.
 */
const dropLowest = (
  chosen: F0MeetingAction[],
  count: number
): F0MeetingAction[] => {
  const kept = [...chosen]
  let remaining = count
  for (let index = kept.length - 1; index >= 0 && remaining > 0; index--) {
    const action = kept[index]
    if (action && isCollapsible(action)) {
      kept.splice(index, 1)
      remaining--
    }
  }
  return kept
}

/**
 * Decides which actions stay in the bar. Capacity is derived from the measured
 * bar width rather than from each button's box: measuring per-button forces a
 * layout on every render and makes the bar visibly jump as it settles.
 *
 * Ranking picks what survives; rendering keeps the ORIGINAL order, so controls
 * never swap places as the window is resized.
 */
export const collapseActions = (
  actions: F0MeetingAction[],
  barWidth: number,
  mode: F0MeetingSurfaceMode,
  { tightLeave = false, forceCollapse = 0 }: CollapseOptions = {}
): CollapseResult => {
  const applicable = actions.filter(
    (action) => !action.modes || action.modes.includes(mode)
  )

  // A minimized pill has room for the essentials only, and no overflow menu:
  // opening a menu from a 56px bar is worse than not offering the action.
  if (mode === "minimized") {
    return {
      visible: applicable.filter((action) => action.pinned),
      overflow: [],
    }
  }

  const present = new Set(applicable.map((action) => action.id))

  // Unmeasured — the first paint, before the ResizeObserver has reported. It
  // used to mean "everything fits", which painted a full bar into a window
  // that could not hold it for one frame, clipped. Pinned only (with their
  // pickers) is the frame that is never wrong; the rest waits in the menu.
  if (barWidth <= 0) {
    const pinned = applicable.filter((action) => action.pinned)
    return split(applicable, withPickers(pinned, present))
  }

  // Ask first whether everything fits with NO overflow button at all. This has
  // to come first because the question is circular: reserving the slot can be
  // what forces something out, and then the button exists only to hold the
  // thing its own reservation displaced.
  if (
    forceCollapse <= 0 &&
    measure(applicable, present, tightLeave) <= barWidth
  ) {
    return { visible: applicable, overflow: [] }
  }

  // Something genuinely has to go, so the button will be drawn and its slot is
  // no longer available.
  const budget = barWidth - OVERFLOW_SLOT - ACTION_GAP
  const chosen = dropLowest(
    takeWhileFitting(rank(applicable), present, tightLeave, budget),
    forceCollapse
  )
  return split(applicable, withPickers(chosen, present))
}
