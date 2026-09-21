import { motionTokens } from "@factorialco/f0-core"
import { type Transition } from "motion/react"
import { EASE_OUT_SWIFT } from "@/lib/motion/f0-motion"

/**
 * The room's motion vocabulary. Same rule as the chat — short ease-out tweens,
 * zero overshoot — plus one that is specific to video:
 *
 * NEVER use motion's `layout` on anything containing a `<video>`. The FLIP it
 * performs animates `scale`, and the video content visibly warps mid-flight.
 * Animate x / y / width / height explicitly instead.
 */

/**
 * Surface mode change (floating ↔ fullscreen ↔ inline ↔ minimized) and the
 * window settling into a corner. The shell's `base` token, because the window
 * moves alongside the application frame's own panels and the seam between
 * them is where two durations would show.
 */
export const modeTransition = {
  duration: motionTokens.duration.base,
  ease: EASE_OUT_SWIFT,
} as const satisfies Transition

/**
 * The same move as a CSS transition. The window writes its rect straight to
 * the DOM (a gesture owns it, and a motion value would be overwritten on the
 * next render), so it transitions in CSS — from the same numbers, or the
 * window and everything it animates beside would drift apart.
 */
export const modeTransitionCss: string = ["left", "top", "width", "height"]
  .map(
    (property) =>
      `${property} ${Math.round(modeTransition.duration * 1000)}ms cubic-bezier(${EASE_OUT_SWIFT.join(",")})`
  )
  .join(", ")

/** A tile moving or resizing because the grid re-solved. */
export const tileTransition: Transition = {
  duration: motionTokens.duration.base,
  ease: EASE_OUT_SWIFT,
}

/** Someone joined. */
export const tileEnterTransition: Transition = {
  duration: motionTokens.duration.fast,
  ease: EASE_OUT_SWIFT,
}

/** Someone left. */
export const tileExitTransition: Transition = {
  duration: motionTokens.duration.micro,
  ease: "easeIn",
}
