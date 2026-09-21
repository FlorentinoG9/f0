import { act } from "@testing-library/react"
import { createPortal } from "react-dom"
import { describe, expect, it, vi } from "vitest"
import { zeroRender } from "@/testing/test-utils"
import { useMeasuredBox } from "../layout/useMeasuredBox"

type Entry = { contentRect: { width: number; height: number } }
type Callback = (entries: Entry[]) => void

/**
 * A window that is not this one, the way a Document Picture-in-Picture window
 * is: its own `ResizeObserver` and its own frame clock.
 */
const createForeignWindow = () => {
  const callbacks: Callback[] = []
  const observed: Element[] = []
  const frames: FrameRequestCallback[] = []
  const view = {
    ResizeObserver: class {
      constructor(callback: Callback) {
        callbacks.push(callback)
      }
      observe(element: Element) {
        observed.push(element)
      }
      disconnect() {}
    },
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    }),
    cancelAnimationFrame: vi.fn(),
  }
  return { view, callbacks, observed, frames }
}

const Measured = ({ into }: { into: HTMLElement }) => {
  const [ref, box] = useMeasuredBox<HTMLDivElement>()
  return createPortal(
    <div ref={ref} data-testid="box">
      {box.width}x{box.height}
    </div>,
    into
  )
}

describe("useMeasuredBox in another window", () => {
  it("observes with, and schedules on, the element's own window", () => {
    const foreign = createForeignWindow()
    const pipDocument = document.implementation.createHTMLDocument("pip")
    Object.defineProperty(pipDocument, "defaultView", { value: foreign.view })
    const mainObserver = vi.spyOn(window, "ResizeObserver")
    const mainFrame = vi.spyOn(window, "requestAnimationFrame")

    zeroRender(<Measured into={pipDocument.body} />)

    // The observer belongs to the PiP window and watches the PiP element…
    expect(foreign.callbacks).toHaveLength(1)
    expect(foreign.observed[0]?.ownerDocument).toBe(pipDocument)
    expect(mainObserver).not.toHaveBeenCalled()

    // …and its report is applied on the PiP window's frame, which keeps
    // running while the tab is hidden, not on the opener's, which does not.
    act(() => {
      foreign.callbacks[0]?.([{ contentRect: { width: 320, height: 200 } }])
    })
    expect(foreign.view.requestAnimationFrame).toHaveBeenCalledTimes(1)
    expect(mainFrame).not.toHaveBeenCalled()
    act(() => {
      foreign.frames[0]?.(0)
    })
    expect(pipDocument.body.textContent).toBe("320x200")

    mainObserver.mockRestore()
    mainFrame.mockRestore()
  })
})
