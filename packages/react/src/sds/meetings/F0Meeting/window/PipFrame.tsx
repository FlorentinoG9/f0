import { useEffect, useState } from "react"
import { PortalContainerProvider } from "@/lib/portal-container"
import { cn } from "@/lib/utils"
import { MeetingHeader } from "../components/chrome/MeetingHeader"
import { F0MeetingRoom } from "../F0MeetingRoom"
import {
  densityFor,
  HEADER_HEIGHT_CLASS,
  type DensityBox,
} from "../layout/density"
import { useMeetingChrome } from "../providers/MeetingChromeProvider"
import { MeetingDensityProvider } from "../providers/MeetingDensityProvider"

/**
 * The PiP window's inner size, kept current through its own `resize`. Read
 * from the window rather than measured with a `ResizeObserver`: the observer
 * would belong to the opener's realm, and the window's size is a fact the
 * window already knows.
 */
const usePipWindowBox = (pipWindow: Window): DensityBox => {
  const [box, setBox] = useState<DensityBox>(() => ({
    width: pipWindow.innerWidth,
    height: pipWindow.innerHeight,
  }))

  useEffect(() => {
    const onResize = (): void =>
      setBox({ width: pipWindow.innerWidth, height: pipWindow.innerHeight })
    onResize()
    pipWindow.addEventListener("resize", onResize)
    return () => pipWindow.removeEventListener("resize", onResize)
  }, [pipWindow])

  return box
}

/**
 * The room AS THE PICTURE-IN-PICTURE WINDOW'S CONTENT.
 *
 * Like `MeetingPanelContent`, everything `FloatingWindow` draws is absent — the
 * card, the rect, the drag and resize gestures — because the browser owns
 * this window and does all of that itself. What is left is a title bar with
 * one way back to the tab, and the room with its full control bar.
 *
 * Rendered through a portal into the OTHER document, so two things have to be
 * said explicitly. Overlays (the device picker, tooltips) must open in this
 * document rather than back in the tab, which is what the portal-container
 * provider does. And the header height is a class, not an inline style, from
 * the same density table the other shells use.
 */
export const PipFrame = ({ pipWindow }: { pipWindow: Window }) => {
  const { actions, actionOrder, sidePanel, overlay } = useMeetingChrome()
  const density = densityFor(usePipWindowBox(pipWindow))

  return (
    <PortalContainerProvider container={pipWindow.document.body}>
      <MeetingDensityProvider density={density}>
        <div
          data-testid="meeting-window"
          data-mode="pip"
          // `fixed inset-0`: the window IS the viewport, and the body has no
          // height of its own to fill.
          className="fixed inset-0 flex flex-col bg-f1-background text-f1-foreground"
        >
          <div
            className={cn(
              "relative flex shrink-0 items-center gap-2",
              HEADER_HEIGHT_CLASS[density],
              density === "tight" ? "px-2" : "px-3"
            )}
          >
            <MeetingHeader />
          </div>
          <div className="relative min-h-0 flex-1">
            <F0MeetingRoom
              actions={actions}
              actionOrder={actionOrder}
              sidePanel={sidePanel}
              overlay={overlay}
            />
          </div>
        </div>
      </MeetingDensityProvider>
    </PortalContainerProvider>
  )
}
