import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Messages } from "@/icons/app"
import { screen, zeroRender } from "@/testing/test-utils"
import {
  ACTION_SIZE,
  MEDIA_CONTROL_SIZE,
  OVERFLOW_SLOT,
} from "../components/controls/collapse-actions"
import { F0Meeting } from "../F0Meeting"
import { MeetingPanelContent } from "../MeetingPanelContent"
import { F0MeetingProvider } from "../providers/F0MeetingProvider"
import { MeetingSurfaceProvider } from "../providers/MeetingSurfaceProvider"
import {
  type F0MeetingAction,
  type F0MeetingRuntime,
  type F0MeetingSurfaceDestination,
} from "../types"
import { PLACEMENT_STORAGE_KEY } from "../window/window-constants"
import { measure } from "./measure"

const runtime: F0MeetingRuntime = {
  room: { id: "room", title: "Design huddle" },
  status: "connected",
  localParticipantId: "me",
  participants: [{ id: "me", name: "Me", isLocal: true, tracks: [] }],
  localMedia: {
    // A picker on the mic, so the fused control draws both of its halves.
    microphone: {
      enabled: true,
      devices: [{ id: "a", label: "Mic A" }],
      selectDevice: () => {},
    },
    camera: { enabled: false },
  },
  leave: () => {},
  setMicrophoneEnabled: () => {},
  setCameraEnabled: () => {},
  // A toggle that is not a media control, so the bar holds every kind of
  // button it can draw.
  setScreenShareEnabled: () => {},
}

type Size = readonly [width: number, height: number]

/** The smallest window the user can reach, and a desktop. */
const SIZES: readonly Size[] = [
  [280, 250],
  [1440, 900],
]
const MODES: readonly F0MeetingSurfaceDestination[] = [
  "floating",
  "panel",
  "fullscreen",
  "minimized",
]

const viewport = { width: window.innerWidth, height: window.innerHeight }

const setViewport = (width: number, height: number): void => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  })
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: height,
  })
}

/**
 * Renders the room's chrome in a mode at a size. Each mode is sized by a
 * different authority: a floating window by its placement, full screen by the
 * viewport, a panel by the box the panel gives it, and a pill by nobody.
 */
const renderIn = (mode: F0MeetingSurfaceDestination, [width, height]: Size) => {
  measure(width, height)
  setViewport(width, height)

  if (mode === "panel") {
    return zeroRender(
      <F0MeetingProvider runtime={runtime}>
        <MeetingSurfaceProvider defaultMode="panel" roomId="room">
          <MeetingPanelContent />
        </MeetingSurfaceProvider>
      </F0MeetingProvider>
    )
  }

  if (mode === "floating") {
    localStorage.setItem(
      PLACEMENT_STORAGE_KEY,
      JSON.stringify({ corner: "br", dx: 24, dy: 24, width, height })
    )
  }
  return zeroRender(
    <F0Meeting runtime={runtime} defaultMode={mode}>
      <p>app</p>
    </F0Meeting>
  )
}

/** Every button in the title bar and the control bar, once. */
const chromeButtons = (): HTMLElement[] => {
  const header = screen.getByTestId("meeting-window").firstElementChild
  const bar = screen.queryByTestId("meeting-control-bar")
  const buttons = new Set<HTMLElement>()
  for (const root of [header, bar]) {
    root
      ?.querySelectorAll("button")
      .forEach((button) => buttons.add(button as HTMLElement))
  }
  return [...buttons]
}

/**
 * Whether a button is drawn at `md`. `F0Button` writes it as `[&_.main]:h-8`,
 * `F0ButtonToggle` as a plain `h-8`, and the fused media control sizes its two
 * halves from its own `h-8` box.
 */
const isMd = (button: HTMLElement): boolean =>
  button.classList.contains("h-8") ||
  button.className.includes("[&_.main]:h-8") ||
  Boolean(button.parentElement?.classList.contains("h-8"))

describe("every control is md, in every mode and density", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    setViewport(viewport.width, viewport.height)
  })

  it.each(MODES.flatMap((mode) => SIZES.map((size) => [mode, size] as const)))(
    "%s at %o",
    (mode, size) => {
      renderIn(mode, size)
      const buttons = chromeButtons()

      expect(buttons.length).toBeGreaterThan(0)
      for (const button of buttons) {
        expect(isMd(button), button.outerHTML).toBe(true)
        // Neither the `sm` the title bar used to drop to nor the `lg` the bar
        // used to grow to.
        expect(button.className).not.toMatch(/\bh-(6|10)\b/)
      }
    }
  )

  it("asks capacity with the size it draws", () => {
    expect(ACTION_SIZE).toBe(32)
    expect(OVERFLOW_SLOT).toBe(32)
  })
})

describe("the fused media control", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    setViewport(viewport.width, viewport.height)
  })

  it("is drawn at the width the bar's arithmetic says", () => {
    renderIn("floating", [1440, 900])

    const toggle = screen.getByRole("button", { name: /turn off microphone/i })
    const picker = screen.getByRole("button", { name: /select microphone/i })

    // 40 + 1 hairline + 28, inside a 1px border.
    expect(toggle).toHaveClass("w-10")
    expect(picker).toHaveClass("w-7")
    expect(toggle.parentElement).toHaveClass("h-8", "border")
    expect(MEDIA_CONTROL_SIZE).toBe(40 + 1 + 28 + 2)
  })
})

describe("what a toggle carries besides its icon", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    setViewport(viewport.width, viewport.height)
  })

  const renderWith = (actions: F0MeetingAction[]) => {
    measure(1440, 900)
    setViewport(1440, 900)
    return zeroRender(
      <F0Meeting runtime={runtime} defaultMode="fullscreen" actions={actions}>
        <p>app</p>
      </F0Meeting>
    )
  }

  it("shows the unread count and says it in the name", () => {
    renderWith([
      {
        id: "inbox",
        label: "Inbox",
        icon: Messages,
        pressed: false,
        onClick: () => {},
        badge: 3,
      },
    ])

    expect(screen.getByTestId("meeting-action-badge")).toHaveTextContent("3")
    // The count is part of the button's own name: a screen reader walking the
    // toolbar hears it on the control, not as a stray "3" after it.
    expect(
      screen.getByRole("button", { name: /inbox · 3 unread/i })
    ).toBeInTheDocument()
  })

  it("draws a dot for activity without a count", () => {
    renderWith([
      {
        id: "inbox",
        label: "Inbox",
        icon: Messages,
        pressed: false,
        onClick: () => {},
        badge: "dot",
      },
    ])

    expect(screen.getByTestId("meeting-action-badge")).toBeEmptyDOMElement()
    expect(screen.getByRole("button", { name: "Inbox" })).toBeInTheDocument()
  })

  it("hands a disabled toggle's reason to the tooltip", () => {
    renderWith([
      {
        id: "record",
        label: "Record",
        icon: Messages,
        pressed: false,
        onClick: () => {},
        disabled: true,
        disabledReason: "Only the host can record",
      },
    ])

    // The tooltip strips the native `title` from its trigger so the browser
    // does not draw a second bubble: a toggle with no `title` is one whose
    // reason reached the tooltip rather than being dropped on the floor.
    const toggle = screen.getByRole("button", { name: "Record" })
    expect(toggle).toBeDisabled()
    expect(toggle).not.toHaveAttribute("title")
  })
})
