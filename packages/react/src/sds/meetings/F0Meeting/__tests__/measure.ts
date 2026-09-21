import { vi } from "vitest"

type Stub = { callback: ResizeObserverCallback; target: Element }

/** Every observer alive, so a second `measure` reaches the mounted room. */
const live = new Set<Stub>()
let size = { width: 0, height: 0 }

const report = (stub: Stub) =>
  stub.callback(
    [
      {
        target: stub.target,
        contentRect: { ...size },
      } as unknown as ResizeObserverEntry,
    ],
    stub as unknown as ResizeObserver
  )

/**
 * jsdom has no layout, so the room measures 0x0 and lays nothing out. Reporting
 * a box from `observe` is what makes the grid testable at all — and this is the
 * only place the real complaint ("with lots of people the tiles float around in
 * odd places") can be checked end to end.
 *
 * Calling it again after a render is a resize: every observer that is still
 * mounted is told the new box. Wrap that call in `act`.
 */
export const measure = (width: number, height: number): void => {
  size = { width, height }

  vi.stubGlobal(
    "ResizeObserver",
    class {
      callback: ResizeObserverCallback
      stub: Stub | null = null
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
      }
      observe(target: Element) {
        this.stub = { callback: this.callback, target }
        live.add(this.stub)
        report(this.stub)
      }
      unobserve() {}
      disconnect() {
        if (this.stub) {
          live.delete(this.stub)
        }
      }
    }
  )
  // The measurement is coalesced to a frame; run it now so the layout exists by
  // the time `render` returns.
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0)
    return 0
  })
  vi.stubGlobal("cancelAnimationFrame", () => {})

  for (const stub of live) {
    report(stub)
  }
}
