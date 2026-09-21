import { cn } from "@/lib/utils"

/**
 * A 44px hit area around a 32px control, on coarse pointers only.
 *
 * The ink stays 32px — the bar's width arithmetic and the design both count on
 * it — so the extra reach is a `::before` pseudo-element bleeding 6px past the
 * edges. `::before` and not `::after`, because `Action` already draws its ring
 * with `::after`; a media query and not `useMediaQuery`, so a server render and
 * the client agree on the first frame.
 *
 * Whatever holds these controls must leave 6px of room around them, or its
 * `overflow` clips the bleed: the control bar pads its row by exactly that.
 */
export type TouchTargetEdge = "all" | "left" | "right"

const BLEED =
  "[@media(pointer:coarse)]:before:absolute [@media(pointer:coarse)]:before:content-['']"

const EDGES: Record<TouchTargetEdge, string> = {
  all: "[@media(pointer:coarse)]:before:-inset-[6px]",
  // The halves of a fused control only reach outward. Bleeding into the
  // neighbour would let the small chevron steal the toggle's edge — the
  // misclick the fused shape was designed to avoid.
  left: "[@media(pointer:coarse)]:before:-inset-y-[6px] [@media(pointer:coarse)]:before:-left-[6px] [@media(pointer:coarse)]:before:right-0",
  right:
    "[@media(pointer:coarse)]:before:-inset-y-[6px] [@media(pointer:coarse)]:before:left-0 [@media(pointer:coarse)]:before:-right-[6px]",
}

/** For a control that takes `className` itself. */
export const touchTarget = (edge: TouchTargetEdge = "all"): string =>
  cn("relative", BLEED, EDGES[edge])

/**
 * For a parent whose direct children are buttons that drop `className` —
 * `F0Button` does. Direct children only, so a fused control nested in its own
 * box keeps the edge-aware version above.
 */
export const touchTargetChildren = (): string =>
  "[@media(pointer:coarse)]:[&>button]:before:absolute [@media(pointer:coarse)]:[&>button]:before:content-[''] [@media(pointer:coarse)]:[&>button]:before:-inset-[6px]"
