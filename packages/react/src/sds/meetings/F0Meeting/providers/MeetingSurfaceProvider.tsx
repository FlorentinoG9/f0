"use client"

import { breakpoints } from "@factorialco/f0-core"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useMediaQuery } from "usehooks-ts"
import { usePersistedState } from "@/lib/persisted-state"
import { tileKey } from "../layout/tiles"
import {
  f0MeetingSurfaceDestinations,
  type F0MeetingFocusIntent,
  type F0MeetingSurfaceDestination,
  type F0MeetingSurfaceMode,
  type F0Rect,
} from "../types"
import { viewportRect } from "../window/panel"
import { resolvePlacement } from "../window/placement"
import {
  usePictureInPicture,
  type PipSupport,
} from "../window/usePictureInPicture"
import { useWindowPlacement } from "../window/useWindowPlacement"
import {
  MINIMIZED_HEIGHT,
  MINIMIZED_WIDTH,
  MODE_STORAGE_KEY,
  WINDOW_DEFAULT_HEIGHT,
  WINDOW_DEFAULT_WIDTH,
} from "../window/window-constants"
import {
  useF0MeetingRosterOptional,
  type F0MeetingRoster,
} from "./F0MeetingProvider"

/** Modes worth remembering across reloads. `inline` depends on the route. */
const PERSISTED_MODES = new Set<F0MeetingSurfaceDestination>([
  "fullscreen",
  "floating",
  "minimized",
  "panel",
])

const isDestination = (value: unknown): value is F0MeetingSurfaceDestination =>
  typeof value === "string" &&
  (f0MeetingSurfaceDestinations as readonly string[]).includes(value)

/**
 * The stored mode is scoped to its room. It exists so the SAME call survives a
 * reload — not so a preference outlives the call that produced it: minimizing
 * one huddle must not make the next one open minimized, ignoring the host's
 * `defaultMode`.
 */
type StoredMode = { roomId: string; mode: F0MeetingSurfaceDestination }

const isStoredMode = (value: unknown): value is StoredMode =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as StoredMode).roomId === "string" &&
  isDestination((value as StoredMode).mode)

/**
 * Which `<video>` to float when only video PiP exists: what the user pinned,
 * else whoever is talking, else the first remote camera, else anything.
 */
const pickPipVideo = (
  videos: ReadonlyMap<string, HTMLVideoElement>,
  focusIntent: F0MeetingFocusIntent,
  roster: F0MeetingRoster | null
): HTMLVideoElement | null => {
  if (focusIntent.type === "pinned") {
    const pinned = videos.get(focusIntent.key)
    if (pinned) {
      return pinned
    }
  }
  const speaker = roster?.signals?.getSpeakers()[0]
  const speaking = speaker ? videos.get(tileKey(speaker, "camera")) : undefined
  if (speaking) {
    return speaking
  }
  for (const participant of roster?.participants ?? []) {
    const camera = participant.isLocal
      ? undefined
      : videos.get(tileKey(participant.id, "camera"))
    if (camera) {
      return camera
    }
  }
  return videos.values().next().value ?? null
}

export type MeetingSurfaceContextValue = {
  /** What the user chose. Never mutated by the environment. */
  mode: F0MeetingSurfaceDestination
  /**
   * What actually renders. A small viewport or an unmounted inline slot derives
   * a different mode without destroying the user's preference; so does an open
   * picture-in-picture window, which is `pip` for as long as it is open.
   */
  effectiveMode: F0MeetingSurfaceMode
  setMode: (mode: F0MeetingSurfaceDestination) => void
  /** Absolute rect the window animates to, in viewport coordinates. */
  rect: F0Rect
  isDragging: boolean
  setIsDragging: (dragging: boolean) => void
  /** Commit an absolute rect after a drag (re-anchors and snaps). */
  settleRect: (rect: F0Rect) => void
  /** Commit a resize, keeping the current anchor. */
  resizeRect: (rect: F0Rect) => void
  /** True below the md breakpoint: no dragging, pill instead of window. */
  isCompactViewport: boolean
  /**
   * The frame's content area. `panel` mode does NOT use it — there the room is
   * the side panel's content and the panel places itself. It is what a window
   * sizes itself against when it has to sit BESIDE the panel (see
   * `fitToContent`), and the viewport when no frame published one.
   */
  panelArea: F0Rect
  /**
   * Whether there is a side panel for the call to be the content of.
   *
   * Registered by the application frame, the same way `F0MeetingSlot`
   * registers a rect for `inline`. A call rendered on its own — a story, a
   * test, a host with no frame — has nowhere to dock, so `panel` derives to
   * `floating` and the switch stops offering it.
   */
  hasPanelSlot: boolean
  setPanelSlot: (available: boolean) => void
  /** Registered by `F0MeetingSlot` so `inline` knows where to fly to. */
  setInlineRect: (rect: F0Rect | null) => void
  /**
   * The application frame's content region, published by the frame itself. The
   * side panel lives inside it — between the navigation and the content —
   * rather than on top of the whole viewport.
   */
  setFrameRect: (rect: F0Rect | null) => void
  /** What the user asked the spotlight to do, if anything. */
  focusIntent: F0MeetingFocusIntent
  setFocusIntent: (intent: F0MeetingFocusIntent) => void
  /** Whether the in-call side panel is open, and on which tab. */
  isSidePanelOpen: boolean
  setSidePanelOpen: (open: boolean) => void
  activeTabId: string | null
  setActiveTabId: (id: string) => void
  announce: (message: string) => void
  liveMessage: string
  /** What the browser offers for picture-in-picture, after the host's opt-out. */
  pipSupport: PipSupport
  /** The Document PiP window, while the room renders inside it. */
  pipWindow: Window | null
  /**
   * Move the call into the browser's picture-in-picture. Deliberately not a
   * destination of `setMode`: the only caller is the browser itself, from the
   * Media Session `enterpictureinpicture` action when the tab is left — so the
   * call follows you out of the tab the way Meet's does, and never by a button.
   */
  enterPictureInPicture: () => void
  exitPictureInPicture: () => void
  /**
   * Every live `<video>` by tile key, kept by `TileVideo`, so video PiP has an
   * element to hand to the browser.
   */
  registerVideo: (key: string, element: HTMLVideoElement | null) => void
}

const MeetingSurfaceContext = createContext<MeetingSurfaceContextValue | null>(
  null
)

export const MeetingSurfaceProvider = ({
  defaultMode = "fullscreen",
  roomId = "",
  pictureInPicture = true,
  children,
}: {
  defaultMode?: F0MeetingSurfaceDestination
  /** Scopes the remembered mode. A different meeting starts at `defaultMode`. */
  roomId?: string
  pictureInPicture?: boolean
  children: ReactNode
}): ReactNode => {
  const [stored, setStored] = usePersistedState<StoredMode>({
    key: MODE_STORAGE_KEY,
    fallback: { roomId, mode: defaultMode },
    validate: isStoredMode,
    shouldWrite: (value) => PERSISTED_MODES.has(value.mode),
  })

  // Restore only what belongs to this call; anything else starts fresh.
  const mode = stored.roomId === roomId ? stored.mode : defaultMode

  const [inlineRect, setInlineRect] = useState<F0Rect | null>(null)
  const [hasPanelSlot, setPanelSlot] = useState(false)
  const [frameRect, setFrameRect] = useState<F0Rect | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [focusIntent, setFocusIntent] = useState<F0MeetingFocusIntent>({
    type: "auto",
  })
  const [isSidePanelOpen, setSidePanelOpen] = useState(false)
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [liveMessage, setLiveMessage] = useState("")

  const pip = usePictureInPicture()
  const pipSupport: PipSupport = pictureInPicture ? pip.support : "none"
  const isDocumentPip = pip.pipWindow !== null

  const videosRef = useRef(new Map<string, HTMLVideoElement>())
  const registerVideo = useCallback(
    (key: string, element: HTMLVideoElement | null) => {
      if (element) {
        videosRef.current.set(key, element)
      } else {
        videosRef.current.delete(key)
      }
    },
    []
  )

  // Read at call time through a ref so `enterPictureInPicture` keeps one
  // identity: the media session handler is registered against it, and a new
  // function per speaker change would tear it down and put it back.
  const roster = useF0MeetingRosterOptional()
  const pickRef = useRef({ focusIntent, roster })
  pickRef.current = { focusIntent, roster }
  const pipRef = useRef(pip)
  pipRef.current = pip

  const enterPictureInPicture = useCallback(() => {
    const controls = pipRef.current
    if (pipSupport === "document") {
      if (controls.pipWindow) {
        return
      }
      // Rejected without a user gesture, or when another PiP window is open.
      // Either way the call is exactly where it was.
      void controls
        .open({ width: WINDOW_DEFAULT_WIDTH, height: WINDOW_DEFAULT_HEIGHT })
        .catch(() => undefined)
      return
    }
    if (pipSupport === "video" && !controls.pipVideo) {
      const { focusIntent: intent, roster: current } = pickRef.current
      const video = pickPipVideo(videosRef.current, intent, current)
      if (video) {
        void controls.openVideo(video).catch(() => undefined)
      }
    }
  }, [pipSupport])

  const exitPictureInPicture = useCallback(() => {
    const controls = pipRef.current
    if (controls.pipWindow) {
      controls.close()
    } else if (controls.pipVideo) {
      controls.closeVideo()
    }
  }, [])

  // Hanging up from the PiP window: the call is over, so the window goes and
  // the tab comes back. A host may keep the runtime mounted after the call
  // (factorial does, to show the ended state), so this cannot wait for the
  // surface to unmount.
  const status = roster?.status
  useEffect(() => {
    if (!isDocumentPip) {
      return
    }
    if (status === "disconnected" || status === "error") {
      pipRef.current.pipWindow?.close()
      window.focus()
    }
  }, [status, isDocumentPip])

  const setMode = useCallback(
    (next: F0MeetingSurfaceDestination) => {
      // Any destination is a way out of the PiP window too: the mode switch
      // is not drawn there, but the frame's presenter can still ask.
      pipRef.current.pipWindow?.close()
      setStored({ roomId, mode: next })
    },
    [setStored, roomId]
  )

  const {
    placement,
    viewport,
    rect: floatingRect,
    settle,
    resize,
  } = useWindowPlacement()

  const isCompactViewport = useMediaQuery(`(max-width: ${breakpoints.md}px)`, {
    initializeWithValue: true,
  })

  // The environment never mutates the stored mode — it only derives a
  // different one, so returning to desktop restores what the user picked.
  const effectiveMode = useMemo<F0MeetingSurfaceMode>(() => {
    // The window is open: the room is in it, whatever the user picked before.
    // Closing it falls straight back to that pick, because nothing here moved.
    if (isDocumentPip) {
      return "pip"
    }
    if (mode === "inline" && !inlineRect) {
      return "floating"
    }
    // Same rule, for the same reason: a place that isn't there is not a place.
    if (mode === "panel" && !hasPanelSlot) {
      return "floating"
    }
    if (
      isCompactViewport &&
      (mode === "floating" || mode === "inline" || mode === "panel")
    ) {
      return "minimized"
    }
    return mode
  }, [isDocumentPip, mode, inlineRect, hasPanelSlot, isCompactViewport])

  /** The frame's content region, or the viewport when nobody published one. */
  const panelArea = useMemo(
    () => frameRect ?? viewportRect(viewport),
    [frameRect, viewport]
  )

  // `panel` is absent on purpose: that mode renders no window at all, so it has
  // no rect to compute. The room is the side panel's content and the panel
  // decides where it goes — see `MeetingPanelContent`. `pip` likewise: the
  // browser owns that window's rect.
  const rect = useMemo<F0Rect>(() => {
    if (effectiveMode === "fullscreen") {
      return { x: 0, y: 0, width: viewport.width, height: viewport.height }
    }
    if (effectiveMode === "inline" && inlineRect) {
      return inlineRect
    }
    if (effectiveMode === "minimized") {
      return isCompactViewport
        ? { x: 0, y: 0, width: viewport.width, height: MINIMIZED_HEIGHT }
        : resolvePlacement(
            { ...placement, width: MINIMIZED_WIDTH, height: MINIMIZED_HEIGHT },
            viewport,
            MINIMIZED_WIDTH,
            MINIMIZED_HEIGHT
          )
    }
    return floatingRect
  }, [
    effectiveMode,
    viewport,
    inlineRect,
    isCompactViewport,
    placement,
    floatingRect,
  ])

  const announce = useCallback((message: string) => {
    setLiveMessage(message)
  }, [])

  const value = useMemo<MeetingSurfaceContextValue>(
    () => ({
      mode,
      effectiveMode,
      setMode,
      rect,
      isDragging,
      setIsDragging,
      settleRect: settle,
      resizeRect: resize,
      hasPanelSlot,
      setPanelSlot,
      isCompactViewport,
      setInlineRect,
      setFrameRect,
      focusIntent,
      setFocusIntent,
      isSidePanelOpen,
      setSidePanelOpen,
      activeTabId,
      setActiveTabId,
      announce,
      liveMessage,
      panelArea,
      pipSupport,
      pipWindow: pip.pipWindow,
      enterPictureInPicture,
      exitPictureInPicture,
      registerVideo,
    }),
    [
      mode,
      effectiveMode,
      setMode,
      rect,
      isDragging,
      settle,
      resize,
      hasPanelSlot,
      isCompactViewport,
      focusIntent,
      isSidePanelOpen,
      activeTabId,
      announce,
      liveMessage,
      panelArea,
      pipSupport,
      pip.pipWindow,
      enterPictureInPicture,
      exitPictureInPicture,
      registerVideo,
    ]
  )

  return (
    <MeetingSurfaceContext.Provider value={value}>
      {children}
    </MeetingSurfaceContext.Provider>
  )
}

export const useMeetingSurface = (): MeetingSurfaceContextValue => {
  const context = useContext(MeetingSurfaceContext)
  if (!context) {
    throw new Error(
      "useMeetingSurface must be used within a MeetingSurfaceProvider"
    )
  }
  return context
}

/**
 * The same state, for consumers that render whether or not a call exists — the
 * application frame reads this to decide how much width to reserve, and there
 * is no provider at all when `runtime` is null.
 */
export const useMeetingSurfaceOptional =
  (): MeetingSurfaceContextValue | null => useContext(MeetingSurfaceContext)
