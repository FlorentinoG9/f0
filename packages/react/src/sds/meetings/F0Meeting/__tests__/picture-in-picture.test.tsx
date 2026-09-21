import { act, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, userEvent, within, zeroRender } from "@/testing/test-utils"
import { F0Meeting } from "../F0Meeting"
import {
  type F0MeetingParticipant,
  type F0MeetingRuntime,
  type F0MeetingStatus,
  type F0MeetingSurfaceDestination,
} from "../types"
import {
  MODE_STORAGE_KEY,
  PLACEMENT_STORAGE_KEY,
} from "../window/window-constants"
import { measure } from "./measure"

/* ------------------------------------------------------------------ *
 * Browser stand-ins
 * ------------------------------------------------------------------ */

type Listener = (event: Event) => void

/**
 * What `documentPictureInPicture.requestWindow()` resolves with: a window with
 * its own empty document. jsdom cannot open one, so this is a document plus
 * the handful of window members the surface touches.
 */
const createPipWindow = () => {
  const listeners = new Map<
    string,
    Set<{ listener: Listener; once: boolean }>
  >()
  const pipDocument = document.implementation.createHTMLDocument("pip")
  // A created document has no window. Testing Library's role queries read
  // `ownerDocument.defaultView.getComputedStyle`, so lend it the main one.
  Object.defineProperty(pipDocument, "defaultView", { value: window })
  const pipWindow = {
    document: pipDocument,
    innerWidth: 360,
    innerHeight: 307,
    addEventListener: (
      type: string,
      listener: Listener,
      options?: { once?: boolean }
    ) => {
      const set = listeners.get(type) ?? new Set()
      set.add({ listener, once: Boolean(options?.once) })
      listeners.set(type, set)
    },
    removeEventListener: (type: string, listener: Listener) => {
      for (const entry of listeners.get(type) ?? []) {
        if (entry.listener === listener) {
          listeners.get(type)?.delete(entry)
        }
      }
    },
    dispatch: (type: string) => {
      for (const entry of listeners.get(type) ?? []) {
        if (entry.once) {
          listeners.get(type)?.delete(entry)
        }
        entry.listener(new Event(type))
      }
    },
    close: vi.fn(() => pipWindow.dispatch("pagehide")),
    focus: vi.fn(),
    resizeTo: vi.fn(),
  }
  return pipWindow
}

type PipWindow = ReturnType<typeof createPipWindow>

let pipWindow: PipWindow
let requestWindow: ReturnType<typeof vi.fn>

// Own property rather than `vi.stubGlobal`: unstubbing all globals would also
// take the setup file's `matchMedia` and `ResizeObserver` with it.
const installDocumentPip = (): void => {
  pipWindow = createPipWindow()
  requestWindow = vi.fn(async () => pipWindow)
  Object.defineProperty(window, "documentPictureInPicture", {
    configurable: true,
    value: { requestWindow },
  })
}

const uninstallDocumentPip = (): void => {
  delete (window as { documentPictureInPicture?: unknown })
    .documentPictureInPicture
}

const setActionHandler = vi.fn()
const setMicrophoneActive = vi.fn()
const setCameraActive = vi.fn()

const installMediaSession = (): void => {
  Object.defineProperty(navigator, "mediaSession", {
    configurable: true,
    value: { setActionHandler, setMicrophoneActive, setCameraActive },
  })
}

const uninstallMediaSession = (): void => {
  delete (navigator as { mediaSession?: unknown }).mediaSession
}

/** The action handlers the call registered, by action name. */
const registeredHandlers = (): Map<string, (() => void) | null> => {
  const handlers = new Map<string, (() => void) | null>()
  for (const [action, handler] of setActionHandler.mock.calls) {
    handlers.set(action as string, handler as (() => void) | null)
  }
  return handlers
}

/**
 * What Chromium does when the user leaves the tab of a page that is capturing
 * a camera or a microphone: it fires the `enterpictureinpicture` action. That
 * is the only way into picture-in-picture — there is no button.
 */
const leaveTheTab = async (): Promise<void> => {
  const handler = registeredHandlers().get("enterpictureinpicture")
  expect(handler, "enterpictureinpicture handler").toBeTypeOf("function")
  await act(async () => {
    handler?.()
  })
}

/* ------------------------------------------------------------------ *
 * The call
 * ------------------------------------------------------------------ */

const person = (
  id: string,
  { isLocal = false, camera = true } = {}
): F0MeetingParticipant => ({
  id,
  name: `Person ${id}`,
  isLocal,
  tracks: [
    {
      id: `${id}:mic`,
      kind: "microphone",
      bindingKey: `${id}:mic:0`,
      muted: false,
      live: true,
    },
    ...(camera
      ? [
          {
            id: `${id}:cam`,
            kind: "camera" as const,
            bindingKey: `${id}:cam:0`,
            muted: false,
            live: true,
          },
        ]
      : []),
  ],
})

const setMicrophoneEnabled = vi.fn()
const setCameraEnabled = vi.fn()
const leave = vi.fn()

const buildRuntime = (
  overrides: Partial<F0MeetingRuntime> = {}
): F0MeetingRuntime => ({
  room: { id: "room", title: "Design huddle" },
  status: "connected" as F0MeetingStatus,
  localParticipantId: "me",
  participants: [
    person("me", { isLocal: true, camera: false }),
    person("a"),
    person("b"),
  ],
  localMedia: {
    microphone: {
      enabled: true,
      devices: [{ id: "mic-a", label: "Mic A" }],
      selectDevice: () => {},
    },
    camera: { enabled: false },
  },
  leave,
  setMicrophoneEnabled,
  setCameraEnabled,
  ...overrides,
})

const renderCall = ({
  runtime = buildRuntime(),
  defaultMode = "floating" as F0MeetingSurfaceDestination,
  pictureInPicture,
}: {
  runtime?: F0MeetingRuntime
  defaultMode?: F0MeetingSurfaceDestination
  pictureInPicture?: boolean
} = {}) => {
  measure(800, 600)
  localStorage.setItem(
    PLACEMENT_STORAGE_KEY,
    JSON.stringify({ corner: "br", dx: 24, dy: 24, width: 800, height: 600 })
  )
  return zeroRender(
    <F0Meeting
      runtime={runtime}
      defaultMode={defaultMode}
      pictureInPicture={pictureInPicture}
    >
      <p>app</p>
    </F0Meeting>
  )
}

/**
 * Elements of the PiP document are not `instanceof` the main window's
 * `HTMLElement`, so jest-dom's matchers refuse them: assertions on that side
 * read the DOM directly, and `getBy*` throwing is the presence check.
 */
const enterPip = async (): Promise<HTMLElement> => {
  await leaveTheTab()
  await waitFor(() =>
    expect(
      within(pipWindow.document.body).getByTestId("meeting-grid")
    ).toBeTruthy()
  )
  return pipWindow.document.body
}

/** The same rule as `control-sizes.render.test.tsx`: drawn at `md`. */
const isMd = (button: HTMLElement): boolean =>
  button.classList.contains("h-8") ||
  button.className.includes("[&_.main]:h-8") ||
  Boolean(button.parentElement?.classList.contains("h-8"))

const modeSwitch = () => screen.getByRole("group", { name: "Meeting position" })

beforeEach(() => {
  // Reset here, not in `afterEach`: the previous test's unmount (RTL's cleanup
  // runs after this file's after-hooks) clears its handlers through the same
  // mock, and those calls must not be read as this test's registrations.
  vi.clearAllMocks()
  setActionHandler.mockReset()
  localStorage.clear()
  installDocumentPip()
  installMediaSession()
})

afterEach(() => {
  uninstallDocumentPip()
  uninstallMediaSession()
  document.documentElement.removeAttribute("lang")
  document.documentElement.removeAttribute("dir")
  document.documentElement.className = ""
  document.head.querySelector("#pip-test-style")?.remove()
})

/* ------------------------------------------------------------------ *
 * Nobody chooses it
 * ------------------------------------------------------------------ */

describe("picture-in-picture cannot be forced", () => {
  it("has no button anywhere in the room, in any mode", () => {
    for (const mode of ["floating", "fullscreen"] as const) {
      // The same room remembers its mode across mounts; each pass is a new one.
      localStorage.clear()
      const { unmount } = renderCall({ defaultMode: mode })
      expect(
        screen.queryByRole("button", { name: /picture.in.picture/i })
      ).toBeNull()
      // The switch offers exactly the other places: no panel without a frame,
      // never the mode you are in, never pip.
      const offered = within(modeSwitch())
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label"))
      expect(offered).toEqual(
        mode === "floating"
          ? ["Fill the screen"]
          : ["Show in a floating window"]
      )
      unmount()
    }
  })

  it("enters from whatever mode the call is in, and comes back to it", async () => {
    renderCall({ defaultMode: "fullscreen" })
    await enterPip()
    // The fullscreen surface is gone from the tab: the room is in one place.
    expect(screen.queryByTestId("meeting-window")).toBeNull()

    act(() => pipWindow.dispatch("pagehide"))

    await waitFor(() =>
      expect(screen.getByTestId("meeting-window")).toHaveAttribute(
        "data-mode",
        "fullscreen"
      )
    )
  })
})

/* ------------------------------------------------------------------ *
 * Document Picture-in-Picture
 * ------------------------------------------------------------------ */

describe("Document Picture-in-Picture", () => {
  it("moves the room, grid and full control bar into the PiP window", async () => {
    renderCall()
    const body = await enterPip()

    expect(requestWindow).toHaveBeenCalledWith({ width: 360, height: 307 })
    expect(
      within(body).getByTestId("meeting-window").getAttribute("data-mode")
    ).toBe("pip")
    expect(within(body).getByTestId("meeting-control-bar")).toBeTruthy()
    expect(
      within(body).getByRole("button", { name: /turn off microphone/i })
    ).toBeTruthy()
    // The floating window is gone from the tab: the room is in one place.
    expect(screen.queryByTestId("meeting-window")).toBeNull()
  })

  it("dresses the empty document: styles, language, direction and theme", async () => {
    const style = document.createElement("style")
    style.id = "pip-test-style"
    style.textContent = ".pip-probe { color: red; }"
    document.head.appendChild(style)
    document.documentElement.lang = "es"
    document.documentElement.dir = "rtl"
    document.documentElement.classList.add("dark")

    renderCall()
    await enterPip()

    // One <style> per sheet of the tab, in order; the probe is the last one.
    const copied = Array.from(pipWindow.document.head.querySelectorAll("style"))
    expect(copied.length).toBeGreaterThan(0)
    expect(
      copied.some((style) => style.textContent?.includes(".pip-probe"))
    ).toBe(true)
    expect(pipWindow.document.documentElement.lang).toBe("es")
    expect(pipWindow.document.documentElement.dir).toBe("rtl")
    expect(pipWindow.document.documentElement.classList.contains("dark")).toBe(
      true
    )
  })

  it("keeps the audio and the live region in the tab", async () => {
    renderCall()
    await enterPip()

    // Two remote microphones, both still playing from the main document. An
    // <audio> moved to another document stops.
    expect(document.querySelectorAll("audio")).toHaveLength(2)
    expect(pipWindow.document.querySelectorAll("audio")).toHaveLength(0)
    expect(
      document.querySelector('[data-f0-meeting-layer] [aria-live="polite"]')
    ).toBeInTheDocument()
  })

  it("draws the header with one md button back to the tab, and no mode switch", async () => {
    renderCall()
    const body = await enterPip()

    const back = within(body).getByRole("button", { name: "Back to the tab" })
    expect(isMd(back)).toBe(true)
    expect(
      within(body).queryByRole("group", { name: "Meeting position" })
    ).toBeNull()
    for (const button of Array.from(body.querySelectorAll("button"))) {
      expect(isMd(button), button.outerHTML).toBe(true)
    }
  })

  it("opens the device picker inside the PiP document, not back in the tab", async () => {
    renderCall()
    const body = await enterPip()

    await userEvent.click(
      within(body).getByRole("button", { name: "Select microphone" })
    )

    await waitFor(() => expect(within(body).getByRole("menu")).toBeTruthy())
    expect(within(body).getByRole("menuitem", { name: "Mic A" })).toBeTruthy()
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("returns to the previous mode when the window closes, and never persists pip", async () => {
    renderCall()
    await enterPip()

    const stored = localStorage.getItem(MODE_STORAGE_KEY)
    expect(stored ?? "").not.toContain("pip")

    act(() => pipWindow.dispatch("pagehide"))

    await waitFor(() =>
      expect(screen.getByTestId("meeting-window")).toHaveAttribute(
        "data-mode",
        "floating"
      )
    )
    expect(localStorage.getItem(MODE_STORAGE_KEY) ?? "").not.toContain("pip")
  })

  it("closes the window from the back button and focuses the tab", async () => {
    const focus = vi.spyOn(window, "focus").mockImplementation(() => {})
    renderCall()
    const body = await enterPip()

    await userEvent.click(
      within(body).getByRole("button", { name: "Back to the tab" })
    )

    expect(pipWindow.close).toHaveBeenCalled()
    expect(focus).toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.getByTestId("meeting-window")).toHaveAttribute(
        "data-mode",
        "floating"
      )
    )
    focus.mockRestore()
  })

  it("asks the browser only once while the window is open", async () => {
    renderCall()
    await enterPip()

    await leaveTheTab()

    expect(requestWindow).toHaveBeenCalledTimes(1)
  })

  it("closes the window and brings the tab back when the call goes away", async () => {
    const focus = vi.spyOn(window, "focus").mockImplementation(() => {})
    const { unmount } = renderCall()
    await enterPip()

    unmount()

    expect(pipWindow.close).toHaveBeenCalled()
    expect(focus).toHaveBeenCalled()
    focus.mockRestore()
  })

  // A host may keep the runtime mounted after the call to show the ended
  // state; hanging up from the PiP window must still close it and bring the
  // tab back, without waiting for an unmount that may never come.
  it("closes the window and brings the tab back when you hang up from it", async () => {
    const focus = vi.spyOn(window, "focus").mockImplementation(() => {})
    const { rerender } = renderCall()
    await enterPip()

    rerender(
      <F0Meeting
        runtime={buildRuntime({ status: "disconnected" })}
        defaultMode="floating"
      >
        <p>app</p>
      </F0Meeting>
    )

    await waitFor(() => expect(pipWindow.close).toHaveBeenCalled())
    expect(focus).toHaveBeenCalled()
    focus.mockRestore()
  })

  it("does nothing when the host turns it off, but keeps the call actions", () => {
    renderCall({ pictureInPicture: false })

    const handlers = registeredHandlers()
    expect(handlers.has("enterpictureinpicture")).toBe(false)
    expect(handlers.get("togglemicrophone")).toBeTypeOf("function")
    expect(handlers.get("hangup")).toBeTypeOf("function")
    expect(requestWindow).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ *
 * Media Session
 * ------------------------------------------------------------------ */

describe("the media session", () => {
  it("registers enterpictureinpicture and the call actions while connected", async () => {
    renderCall()

    const handlers = registeredHandlers()
    expect(handlers.get("enterpictureinpicture")).toBeTypeOf("function")
    expect(handlers.get("togglemicrophone")).toBeTypeOf("function")
    expect(handlers.get("togglecamera")).toBeTypeOf("function")
    expect(handlers.get("hangup")).toBeTypeOf("function")

    await leaveTheTab()
    expect(requestWindow).toHaveBeenCalled()

    handlers.get("togglemicrophone")?.()
    expect(setMicrophoneEnabled).toHaveBeenCalledWith(false)
    handlers.get("togglecamera")?.()
    expect(setCameraEnabled).toHaveBeenCalledWith(true)
    handlers.get("hangup")?.()
    expect(leave).toHaveBeenCalled()

    expect(setMicrophoneActive).toHaveBeenCalledWith(true)
    expect(setCameraActive).toHaveBeenCalledWith(false)
  })

  it("clears every handler on disconnect", () => {
    const { rerender } = renderCall()
    setActionHandler.mockClear()

    rerender(
      <F0Meeting
        runtime={buildRuntime({ status: "disconnected" })}
        defaultMode="floating"
      >
        <p>app</p>
      </F0Meeting>
    )

    const cleared = registeredHandlers()
    for (const action of [
      "enterpictureinpicture",
      "togglemicrophone",
      "togglecamera",
      "hangup",
    ]) {
      expect(cleared.get(action), action).toBeNull()
    }
  })

  it("survives a browser that throws on an unknown action", () => {
    setActionHandler.mockImplementation((action: string) => {
      if (action === "enterpictureinpicture") {
        throw new TypeError("unknown action")
      }
    })
    expect(() => renderCall()).not.toThrow()
  })
})

/* ------------------------------------------------------------------ *
 * Video PiP fallback, and no PiP at all
 * ------------------------------------------------------------------ */

describe("without Document Picture-in-Picture", () => {
  /** Called with the `<video>` the browser was asked to float. */
  const requestPictureInPicture = vi.fn((video: HTMLVideoElement) => {
    floating = video
  })
  const exitPictureInPicture = vi.fn(async () => {})
  let floating: HTMLVideoElement | null = null

  beforeEach(() => {
    uninstallDocumentPip()
    floating = null
    Object.defineProperty(document, "pictureInPictureEnabled", {
      configurable: true,
      value: true,
    })
    Object.defineProperty(document, "pictureInPictureElement", {
      configurable: true,
      get: () => floating,
    })
    Object.defineProperty(document, "exitPictureInPicture", {
      configurable: true,
      value: exitPictureInPicture,
    })
    Object.defineProperty(
      HTMLVideoElement.prototype,
      "requestPictureInPicture",
      {
        configurable: true,
        value(this: HTMLVideoElement) {
          requestPictureInPicture(this)
          return Promise.resolve()
        },
      }
    )
  })

  afterEach(() => {
    delete (document as { pictureInPictureEnabled?: unknown })
      .pictureInPictureEnabled
    delete (document as { pictureInPictureElement?: unknown })
      .pictureInPictureElement
    delete (document as { exitPictureInPicture?: unknown }).exitPictureInPicture
    delete (HTMLVideoElement.prototype as { requestPictureInPicture?: unknown })
      .requestPictureInPicture
  })

  it("floats the first remote camera's <video> and leaves the room in the tab", async () => {
    renderCall()

    await leaveTheTab()

    await waitFor(() =>
      expect(requestPictureInPicture).toHaveBeenCalledTimes(1)
    )
    expect(floating?.closest("[data-participant-id]")).toHaveAttribute(
      "data-participant-id",
      "a"
    )
    // The room did not move: same window, same mode.
    expect(screen.getByTestId("meeting-window")).toHaveAttribute(
      "data-mode",
      "floating"
    )
  })

  it("floats one video at a time, and again after the browser lets it go", async () => {
    renderCall()
    await leaveTheTab()
    await waitFor(() =>
      expect(requestPictureInPicture).toHaveBeenCalledTimes(1)
    )

    // Still floating: a second request is not a second window.
    await leaveTheTab()
    expect(requestPictureInPicture).toHaveBeenCalledTimes(1)

    // The browser reports the exit; the next tab switch floats it again.
    act(() => {
      floating?.dispatchEvent(new Event("leavepictureinpicture"))
      floating = null
    })
    await leaveTheTab()
    await waitFor(() =>
      expect(requestPictureInPicture).toHaveBeenCalledTimes(2)
    )
  })

  it("registers nothing to enter with when the browser has neither", () => {
    delete (document as { pictureInPictureEnabled?: unknown })
      .pictureInPictureEnabled
    renderCall()

    expect(registeredHandlers().has("enterpictureinpicture")).toBe(false)
    expect(registeredHandlers().get("hangup")).toBeTypeOf("function")
  })
})
