import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { screen, zeroRender } from "@/testing/test-utils"
import { F0Meeting } from "../F0Meeting"
import { CONTROLS_HEIGHT, HEADER_HEIGHT } from "../layout/density"
import { type F0MeetingRuntime, type F0MeetingStatus } from "../types"
import {
  PLACEMENT_STORAGE_KEY,
  WINDOW_MIN_HEIGHT,
  WINDOW_MIN_WIDTH,
} from "../window/window-constants"

const runtime: F0MeetingRuntime = {
  room: {
    id: "room",
    title: "Design huddle",
    avatar: { type: "team", name: "Design" },
  },
  status: "connected" as F0MeetingStatus,
  localParticipantId: "me",
  participants: [{ id: "me", name: "Me", isLocal: true, tracks: [] }],
  localMedia: {
    microphone: { enabled: true },
    camera: { enabled: false },
  },
  leave: () => {},
  setMicrophoneEnabled: () => {},
  setCameraEnabled: () => {},
}

/** Opens the window at a given size by seeding the placement it restores. */
const renderAt = (width: number, height: number) => {
  localStorage.setItem(
    PLACEMENT_STORAGE_KEY,
    JSON.stringify({ corner: "br", dx: 24, dy: 24, width, height })
  )
  return zeroRender(
    <F0Meeting runtime={runtime} defaultMode="floating">
      <p>app</p>
    </F0Meeting>
  )
}

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

/** Full screen takes the viewport, so the viewport is what gets sized. */
const renderFullscreenAt = (width: number, height: number) => {
  setViewport(width, height)
  return zeroRender(
    <F0Meeting runtime={runtime} defaultMode="fullscreen">
      <p>app</p>
    </F0Meeting>
  )
}

const titleBar = (): HTMLElement => {
  const bar = screen.getByTestId("meeting-window").firstElementChild
  if (!(bar instanceof HTMLElement)) {
    throw new Error("title bar not found")
  }
  return bar
}

const controlBar = (): HTMLElement => screen.getByTestId("meeting-control-bar")

/**
 * The window's chrome follows the window, not the viewport.
 *
 * jsdom lays nothing out, so these read the heights the components WRITE —
 * which is the point: they are inline styles from one table rather than a
 * `h-20` in one file and a `calc(100% - 3.75rem)` in another that has to be
 * kept in step with it by hand.
 */
describe("the window's chrome at different sizes", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    setViewport(viewport.width, viewport.height)
  })

  it("draws full-size chrome in a roomy window", () => {
    renderAt(800, 600)

    expect(titleBar().style.height).toBe(`${HEADER_HEIGHT.regular}px`)
    expect(controlBar().style.height).toBe(`${CONTROLS_HEIGHT.regular}px`)
  })

  it("gives the video back its half in a window near the minimum", () => {
    renderAt(WINDOW_MIN_WIDTH, WINDOW_MIN_HEIGHT)

    expect(titleBar().style.height).toBe(`${HEADER_HEIGHT.tight}px`)
    expect(controlBar().style.height).toBe(`${CONTROLS_HEIGHT.tight}px`)
  })

  it("shrinks for a short WIDE window too, not only a narrow one", () => {
    // The trap a width-only rule falls into: plenty of room across, none at
    // all down, and the chrome eating what little height there is.
    renderAt(900, 280)

    expect(titleBar().style.height).toBe(`${HEADER_HEIGHT.tight}px`)
    expect(controlBar().style.height).toBe(`${CONTROLS_HEIGHT.tight}px`)
  })

  it("treats full screen on a phone as the small room it is", () => {
    // Full screen used to be pinned to `regular`, which drew desktop chrome
    // into a 360px-wide room. The viewport goes through the same table.
    renderFullscreenAt(360, 640)

    expect(titleBar().style.height).toBe(`${HEADER_HEIGHT.compact}px`)
    expect(titleBar().style.height).not.toBe(`${HEADER_HEIGHT.regular}px`)
    expect(controlBar().style.height).toBe(`${CONTROLS_HEIGHT.compact}px`)
  })

  it("keeps the full chrome for full screen on a desktop", () => {
    renderFullscreenAt(1440, 900)

    expect(titleBar().style.height).toBe(`${HEADER_HEIGHT.regular}px`)
    expect(controlBar().style.height).toBe(`${CONTROLS_HEIGHT.regular}px`)
  })

  it("shows the room's avatar when there is room for it", () => {
    renderAt(800, 600)
    expect(screen.getByTestId("meeting-room-avatar")).toBeInTheDocument()
  })

  it("drops the avatar rather than crowd the title", () => {
    renderAt(WINDOW_MIN_WIDTH, WINDOW_MIN_HEIGHT)

    expect(screen.queryByTestId("meeting-room-avatar")).toBeNull()
    // Whatever else goes, the name stays: it is what the bar is for.
    expect(screen.getByTestId("meeting-window")).toHaveTextContent(
      "Design huddle"
    )
  })
})

describe("the controls' chrome", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("draws Leave as the one red control", () => {
    renderAt(800, 600)
    // The critical variant's own foreground, not a default button relabelled.
    expect(screen.getByRole("button", { name: /leave/i })).toHaveClass(
      "text-f1-foreground-critical"
    )
  })

  it("names the toolbar for what it holds, not after the window", () => {
    renderAt(800, 600)
    // The window is already "Meeting window"; a toolbar with the same name
    // reads as the same thing twice to a screen reader.
    expect(
      screen.getByRole("toolbar", { name: "Meeting controls" })
    ).toBeInTheDocument()
    expect(screen.queryByRole("toolbar", { name: "Meeting window" })).toBeNull()
  })
})
