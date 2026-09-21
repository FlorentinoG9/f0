"use client"

import { createContext, useContext, type ReactNode } from "react"

/**
 * Where the overlay primitives portal by default when nobody passes them a
 * `container`.
 *
 * Radix portals to `document.body` — the MAIN document's body. A subtree
 * rendered into another document (a Document Picture-in-Picture window) would
 * open its menus and tooltips back in the tab the user just left. Mounting
 * this provider around that subtree, with the other document's body, sends
 * them where the trigger is.
 *
 * `null` means "no opinion": with no provider mounted nothing changes.
 */
const PortalContainerContext = createContext<HTMLElement | null>(null)

export const PortalContainerProvider = ({
  container,
  children,
}: {
  container: HTMLElement | null
  children: ReactNode
}): ReactNode => (
  <PortalContainerContext.Provider value={container}>
    {children}
  </PortalContainerContext.Provider>
)

export const usePortalContainer = (): HTMLElement | null =>
  useContext(PortalContainerContext)
