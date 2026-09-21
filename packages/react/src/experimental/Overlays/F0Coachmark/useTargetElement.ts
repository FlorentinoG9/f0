import { useEffect, useRef, useState } from "react"
import type { CoachmarkTarget } from "./types"

const isDev = process.env.NODE_ENV !== "production"

/**
 * WHETHER AN ELEMENT IS DRAWN, rather than merely in the document.
 *
 * A coachmark's whole job is geometric — it lights a box and hangs a panel off
 * it — and `display: none` leaves an element in the DOM with no box at all.
 * `getBoundingClientRect()` on one is all zeros, which is not "no answer" but a
 * perfectly valid-looking rect at the top-left corner of the viewport: the
 * spotlight cuts a 16px hole out of the page there, the panel follows it, and
 * the reader is looking at a walkthrough pointing at nothing.
 *
 * That is not a hypothetical. A layout that has ONE element for a thing in each
 * of its shapes — the Home rail's widget as a card in the column and as a glyph
 * in the collapsed strip — keeps both mounted and hides the one it is not
 * showing, so a selector matching the pair has to pick the drawn one.
 *
 * `checkVisibility()` with no options is exactly that question — has this
 * element a box — and deliberately NOT the stronger ones: `visibility: hidden`
 * and `opacity: 0` both keep their geometry, so a target that is mid-fade is
 * still somewhere worth pointing, and an animation would otherwise re-resolve
 * the coachmark frame by frame as it crossed zero.
 *
 * Where the method is missing (older Safari, and jsdom) an element counts as
 * drawn: the old behaviour, which is wrong only in the case this exists for.
 */
const isDrawn = (element: HTMLElement): boolean =>
  typeof element.checkVisibility === "function"
    ? element.checkVisibility()
    : true

/**
 * The element a target names, or `null` when nothing DRAWN matches it. Shared
 * with `guidance.ts`, so a step is kept or dropped by the same rule the panel
 * is anchored by.
 */
export const resolveTarget = (target: CoachmarkTarget): HTMLElement | null => {
  if (typeof target !== "string") {
    // An element handed to us can be unmounted while the coachmark is queued;
    // anchoring to a detached node would park the panel at 0,0.
    return target.isConnected && isDrawn(target) ? target : null
  }

  return (
    [...document.querySelectorAll<HTMLElement>(target)].find(isDrawn) ?? null
  )
}

/** How many DRAWN elements a selector matches — for the ambiguity warning. */
const drawnMatchCount = (target: CoachmarkTarget): number =>
  typeof target === "string"
    ? [...document.querySelectorAll<HTMLElement>(target)].filter(isDrawn).length
    : 1

/**
 * Resolve a coachmark's target to a live DOM element, and keep it resolved.
 *
 * Returns `null` while nothing matches, which is a normal state rather than an
 * error: a coachmark opened during app start-up regularly names an element that
 * mounts a moment later, and an element can also disappear while the coachmark
 * is still queued behind another one. Both directions are handled by
 * re-resolving on DOM changes, so the panel appears when its target does and
 * hides when it goes away — instead of pointing at nothing.
 *
 * The observer only lives as long as one coachmark is on screen, and it re-runs
 * a single `querySelectorAll` per mutation batch (batches are already coalesced
 * into one microtask by `MutationObserver`).
 *
 * IT ALSO WATCHES THE `hidden` ATTRIBUTE, because a target can stop being drawn
 * without a single node moving — a rail that collapses hides its column and
 * shows its strip, and both were already mounted. `hidden` and nothing else:
 * `style` and `class` change on every animated frame, and an observer woken
 * that often would re-run its selector for the whole of every transition.
 */
export const useTargetElement = (
  target: CoachmarkTarget | undefined
): HTMLElement | null => {
  const [element, setElement] = useState<HTMLElement | null>(null)
  // Mirrors the state so the observer can skip re-renders when nothing moved.
  // A ref rather than an effect-local variable: the effect re-runs when a step
  // changes the target, and it has to compare against the element that is
  // currently on screen, not against a fresh `null`.
  const resolved = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const sync = (next: HTMLElement | null) => {
      if (next === resolved.current) {
        return
      }
      resolved.current = next
      setElement(next)
    }

    if (target === undefined || typeof document === "undefined") {
      sync(null)
      return
    }

    sync(resolveTarget(target))

    if (isDev) {
      if (resolved.current === null && typeof target === "string") {
        console.warn(
          `[f0] coachmarks: no element matches the selector "${target}" yet. ` +
            `The coachmark will show as soon as one does.`
        )
      }

      // Only the DRAWN matches are counted: a layout that keeps one element per
      // shape and hides the shape it is not in matches twice by design, and
      // warning about that would be asking it to stop doing the thing that makes
      // the selector work in both.
      const matches = drawnMatchCount(target)
      if (matches > 1) {
        console.warn(
          `[f0] coachmarks: the selector "${String(target)}" matched ${matches} elements. ` +
            `Anchoring to the first one — use a selector that matches exactly one.`
        )
      }
    }

    const observer = new MutationObserver(() => sync(resolveTarget(target)))
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden"],
    })
    return () => observer.disconnect()
  }, [target])

  return element
}
