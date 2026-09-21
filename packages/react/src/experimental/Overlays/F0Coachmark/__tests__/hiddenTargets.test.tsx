import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  act,
  screen,
  waitFor,
  zeroRender as render,
  zeroRenderHook as renderHook,
} from "@/testing/test-utils"
import { CoachmarkProvider } from "../CoachmarkProvider"
import { defineStepByStepCoachmarkGuidance } from "../guidance"
import { coachmarks } from "../imperative"
import { resolveTarget, useTargetElement } from "../useTargetElement"

/**
 * jsdom draws nothing, so it ships no `checkVisibility` — every element would
 * otherwise count as visible and there would be nothing here to test. This is
 * the one thing the real method says that this suite depends on: an element
 * under a `hidden` ancestor has no box.
 */
const stubCheckVisibility = () =>
  vi
    .spyOn(HTMLElement.prototype, "checkVisibility")
    .mockImplementation(function (this: HTMLElement) {
      return this.closest("[hidden]") === null
    })

/**
 * Raw nodes these tests put on the page, so they can be taken off again without
 * emptying `body` — React's own containers are down there too, and clearing the
 * lot out from under Testing Library's cleanup throws on the way out.
 */
let sandbox: HTMLElement | undefined

/** A pair of elements for one name — as a layout with two shapes renders it. */
const renderBothShapes = ({ cardHidden }: { cardHidden: boolean }) => {
  sandbox = document.createElement("div")
  sandbox.innerHTML = `
    <aside ${cardHidden ? "hidden" : ""}><div class="target" id="card"></div></aside>
    <div class="target" id="glyph"></div>
  `
  document.body.appendChild(sandbox)
}

/** One shape, hidden: a name with nothing drawn under it. */
const renderHiddenOnly = (html: string) => {
  sandbox = document.createElement("div")
  sandbox.innerHTML = html
  document.body.appendChild(sandbox)
}

describe("a target that is mounted but not drawn", () => {
  beforeEach(() => {
    // jsdom has no `checkVisibility` to spy on until one exists to replace.
    Object.defineProperty(HTMLElement.prototype, "checkVisibility", {
      configurable: true,
      writable: true,
      value: () => true,
    })
    stubCheckVisibility()
    coachmarks.closeAll()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    sandbox?.remove()
    sandbox = undefined
  })

  describe("resolveTarget", () => {
    it("passes over the hidden match and takes the drawn one", () => {
      renderBothShapes({ cardHidden: true })

      expect(resolveTarget(".target")).toBe(document.getElementById("glyph"))
    })

    it("takes the first match when both are drawn", () => {
      renderBothShapes({ cardHidden: false })

      expect(resolveTarget(".target")).toBe(document.getElementById("card"))
    })

    it("resolves to nothing when every match is hidden", () => {
      renderHiddenOnly(`<aside hidden><div class="target"></div></aside>`)

      expect(resolveTarget(".target")).toBeNull()
    })

    it("refuses an element handed over directly once it stops being drawn", () => {
      renderBothShapes({ cardHidden: true })
      const card = document.getElementById("card") as HTMLElement

      expect(card.isConnected).toBe(true)
      expect(resolveTarget(card)).toBeNull()
    })
  })

  describe("useTargetElement", () => {
    it("anchors to the drawn shape rather than the hidden one", async () => {
      renderBothShapes({ cardHidden: true })

      const { result } = renderHook(() => useTargetElement(".target"))

      await waitFor(() =>
        expect(result.current).toBe(document.getElementById("glyph"))
      )
    })

    /**
     * THE CASE A CHILD-LIST OBSERVER MISSES. A rail that collapses hides the
     * column it already had — not a node added or removed anywhere, just an
     * attribute — and a coachmark that did not re-resolve there would keep
     * pointing at a card that no longer has a box.
     */
    it("re-resolves when its element stops being drawn where it stands", async () => {
      renderBothShapes({ cardHidden: false })
      const { result } = renderHook(() => useTargetElement(".target"))

      await waitFor(() =>
        expect(result.current).toBe(document.getElementById("card"))
      )

      act(() => {
        document.querySelector("aside")?.setAttribute("hidden", "")
      })

      await waitFor(() =>
        expect(result.current).toBe(document.getElementById("glyph"))
      )
    })
  })

  describe("a walkthrough over a page with hidden shapes", () => {
    it("lights the drawn shape the selector names", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      render(
        <CoachmarkProvider>
          <aside hidden>
            <button className="target">Card</button>
          </aside>
          <button className="target">Glyph</button>
        </CoachmarkProvider>
      )

      act(() => {
        coachmarks.open({ targetElement: ".target", title: "Over here" })
      })

      expect(await screen.findByRole("dialog")).toHaveAccessibleName(
        "Over here"
      )
      // The ambiguity warning counts what is DRAWN: one shape on screen is not
      // an ambiguous selector, however many shapes are mounted behind it.
      expect(warn).not.toHaveBeenCalledWith(
        expect.stringContaining("matched 2 elements")
      )
    })

    it("leaves out a step whose only target is hidden", async () => {
      const guidance = defineStepByStepCoachmarkGuidance({
        lookForTargetsMs: 0,
        steps: [
          { targetElement: "#here", title: "On screen" },
          { targetElement: "#stowed", title: "Mounted, not drawn" },
        ],
      })

      render(
        <CoachmarkProvider>
          <button id="here">Here</button>
          <aside hidden>
            <button id="stowed">Stowed</button>
          </aside>
        </CoachmarkProvider>
      )

      act(() => {
        guidance.start()
      })

      const dialog = await screen.findByRole("dialog")
      expect(dialog).toHaveAccessibleName("On screen")
      // A ONE-STEP walkthrough, which is what a walkthrough with nowhere to put
      // its second step is: the step it kept ends it, and the step pointing at a
      // box-less element is never offered.
      expect(screen.getByRole("button", { name: "Got it" })).toBeInTheDocument()
      expect(screen.queryByRole("button", { name: "Next" })).toBeNull()
      expect(screen.queryByText("Mounted, not drawn")).toBeNull()
    })
  })
})
