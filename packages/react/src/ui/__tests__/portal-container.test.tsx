import { afterEach, describe, expect, it } from "vitest"
import { PortalContainerProvider } from "@/lib/portal-container"
import { screen, userEvent, zeroRender } from "@/testing/test-utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/ui/tooltip"

const containers = new Set<HTMLElement>()

const createContainer = (): HTMLElement => {
  const container = document.createElement("div")
  container.setAttribute("data-testid", "portal-target")
  document.body.appendChild(container)
  containers.add(container)
  return container
}

afterEach(() => {
  containers.forEach((container) => container.remove())
  containers.clear()
})

/**
 * The overlay primitives portal to `document.body` unless told otherwise. A
 * subtree rendered into ANOTHER document (a picture-in-picture window) has to
 * be able to tell all of them at once, or its menus open back in the tab.
 */
describe("PortalContainerProvider", () => {
  it("is where a dropdown menu opens by default", async () => {
    const container = createContainer()
    zeroRender(
      <PortalContainerProvider container={container}>
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PortalContainerProvider>
    )

    await userEvent.click(screen.getByRole("button", { name: "Open" }))

    expect(container).toContainElement(await screen.findByRole("menu"))
  })

  it("is where a popover opens by default", async () => {
    const container = createContainer()
    zeroRender(
      <PortalContainerProvider container={container}>
        <Popover>
          <PopoverTrigger>Open</PopoverTrigger>
          <PopoverContent>Body</PopoverContent>
        </Popover>
      </PortalContainerProvider>
    )

    await userEvent.click(screen.getByRole("button", { name: "Open" }))

    expect(container).toContainElement(await screen.findByRole("dialog"))
  })

  it("is where a tooltip opens by default", async () => {
    const container = createContainer()
    zeroRender(
      <PortalContainerProvider container={container}>
        <TooltipProvider>
          <Tooltip open>
            <TooltipTrigger>Hover</TooltipTrigger>
            <TooltipContent>Hint</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </PortalContainerProvider>
    )

    expect(container).toContainElement(await screen.findByRole("tooltip"))
  })

  it("yields to an explicit container on the content", async () => {
    const fromContext = createContainer()
    const explicit = createContainer()
    zeroRender(
      <PortalContainerProvider container={fromContext}>
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent container={explicit}>
            <DropdownMenuItem>Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PortalContainerProvider>
    )

    await userEvent.click(screen.getByRole("button", { name: "Open" }))

    const menu = await screen.findByRole("menu")
    expect(explicit).toContainElement(menu)
    expect(fromContext).not.toContainElement(menu)
  })

  it("changes nothing when no provider is mounted", async () => {
    const container = createContainer()
    zeroRender(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    await userEvent.click(screen.getByRole("button", { name: "Open" }))

    const menu = await screen.findByRole("menu")
    expect(container).not.toContainElement(menu)
    expect(document.body).toContainElement(menu)
  })
})
