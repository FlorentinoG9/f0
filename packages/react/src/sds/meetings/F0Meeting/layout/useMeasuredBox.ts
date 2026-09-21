import { useEffect, useMemo, useRef, useState } from "react"
import { round4 } from "../utils/aspect"

export type MeasuredBox = { width: number; height: number }

/**
 * Measures an element with a ResizeObserver, coalesced to one frame and rounded
 * to 4px. Container measurement (not viewport media queries) is what lets the
 * same room render correctly in fullscreen and in a 300px floating window.
 *
 * Observer and frame come from the element's OWN window, not this module's.
 * The room also renders into a Document Picture-in-Picture window: another
 * document, whose elements the opener's observer never reports, and whose
 * frames keep running while the tab is hidden — exactly when the opener's
 * `requestAnimationFrame` is paused. Measured from here, the PiP grid stayed
 * at 0×0 and drew nothing.
 */
export const useMeasuredBox = <T extends HTMLElement>(): [
  React.RefObject<T>,
  MeasuredBox,
] => {
  const ref = useRef<T>(null)
  const [raw, setRaw] = useState<MeasuredBox>({ width: 0, height: 0 })

  useEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }

    const view = element.ownerDocument.defaultView ?? window
    const Observer = view.ResizeObserver ?? ResizeObserver
    let frame = 0
    const observer = new Observer((entries) => {
      const entry = entries[0]
      if (!entry) {
        return
      }
      const { width, height } = entry.contentRect
      view.cancelAnimationFrame(frame)
      frame = view.requestAnimationFrame(() => {
        setRaw((previous) =>
          previous.width === width && previous.height === height
            ? previous
            : { width, height }
        )
      })
    })

    observer.observe(element)
    return () => {
      view.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  const box = useMemo(
    () => ({ width: round4(raw.width), height: round4(raw.height) }),
    [raw.width, raw.height]
  )

  return [ref, box]
}
