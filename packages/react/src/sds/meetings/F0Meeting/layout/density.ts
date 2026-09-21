/**
 * How much room the room has, as one answer the whole surface agrees on.
 *
 * The grid and the action bar already size themselves from their own measured
 * box. What did not was the CHROME around them: a 60px title bar and an 80px
 * action bar are fine in a full-screen room and absurd in a 280×250 window,
 * where together they take half the height and leave the video the other half.
 *
 * Derived from the window's own box rather than the viewport, because the two
 * are unrelated: a 300px floating window on a 2560px screen is a small room.
 */
export type MeetingDensity = "tight" | "compact" | "regular"

export type DensityBox = { width: number; height: number }

/**
 * Title-bar height per density. The window is a flex column, so this is the
 * only place it is decided — nothing computes `100% - header` any more.
 *
 * Every control in the bar is 32px in every density (see
 * `MeetingActionButton`); what changes is the air around it: 6, 8 and 12px
 * above and below. `tight` is exactly the 44px touch target the controls
 * expand to on a coarse pointer, so nothing is clipped there either.
 */
export const HEADER_HEIGHT: Record<MeetingDensity, number> = {
  tight: 44,
  compact: 48,
  regular: 56,
}

/**
 * The same heights as Tailwind classes, for a shell that cannot write an
 * inline style. Tailwind cannot read a number, so the two tables are spelled
 * out side by side and `density.test.ts` pins that they agree.
 */
export const HEADER_HEIGHT_CLASS: Record<MeetingDensity, string> = {
  tight: "h-11",
  compact: "h-12",
  regular: "h-14",
}

/**
 * Action-bar height per density. Same 32px controls, with 8, 12 and 16px of
 * air. Going lower than 48 buys pixels the video cannot use: below roughly a
 * 16:9 slice the grid starts dropping people into the overflow chip anyway.
 */
export const CONTROLS_HEIGHT: Record<MeetingDensity, number> = {
  tight: 48,
  compact: 56,
  regular: 64,
}

/**
 * Both axes, and the tighter one wins.
 *
 * Width alone is not enough: a short wide window is just as starved, because
 * what eats the video there is the chrome's HEIGHT. Keyed so the default
 * floating window (360×307, see `WINDOW_DEFAULT_HEIGHT`) lands on `compact`
 * and only a window near its minimum goes `tight` — the step should be
 * something you have to ask for by dragging, not something the default state
 * sits on. Full screen goes through the same table: on a phone the viewport IS
 * a small room, and `regular` chrome there was what pushed the video out.
 */
export const densityFor = ({ width, height }: DensityBox): MeetingDensity => {
  if (width < 330 || height < 300) {
    return "tight"
  }
  if (width < 620 || height < 460) {
    return "compact"
  }
  return "regular"
}
