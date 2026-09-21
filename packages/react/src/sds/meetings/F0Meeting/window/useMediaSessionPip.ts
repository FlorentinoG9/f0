import { useEffect, useRef } from "react"
import {
  useF0MeetingRoster,
  useF0MeetingStable,
} from "../providers/F0MeetingProvider"
import { useMeetingSurface } from "../providers/MeetingSurfaceProvider"

/**
 * The call actions of the Media Session API, typed locally: `lib.dom` still
 * lists only the playback ones, and the microphone/camera setters are newer
 * than the type of `MediaSession` it ships.
 */
type MediaSessionLike = {
  setActionHandler: (action: string, handler: (() => void) | null) => void
  setMicrophoneActive?: (active: boolean) => void
  setCameraActive?: (active: boolean) => void
}

const getMediaSession = (): MediaSessionLike | null =>
  typeof navigator === "undefined"
    ? null
    : ((navigator as Navigator & { mediaSession?: MediaSessionLike })
        .mediaSession ?? null)

/** Older Chromes throw on an action they do not know rather than ignore it. */
const setHandler = (
  session: MediaSessionLike,
  action: string,
  handler: (() => void) | null
): void => {
  try {
    session.setActionHandler(action, handler)
  } catch {
    // Unsupported action: the browser simply offers no button for it.
  }
}

/**
 * Registers the call with the browser's media session while it is connected.
 *
 * Two things come out of it. The browser's own UI (the tab strip's media
 * control, the OS media overlay) gets mute, camera and hang-up buttons that
 * drive the runtime. And with `enterpictureinpicture` registered, Chromium
 * moves the call into its picture-in-picture window BY ITSELF when the user
 * switches tab, whatever mode the call is in — which is the whole point: a
 * call you cannot see is a call you talk over. That action is the ONLY way
 * into PiP: like Meet, it is where the call goes when you leave, not a place
 * you send it, so there is no button and `setMode` does not know it.
 *
 * Everything is cleared on disconnect, so a finished call leaves no handlers
 * behind to fire on the next thing the tab plays.
 */
export const useMediaSessionPip = (): void => {
  const { status, localMedia } = useF0MeetingRoster()
  const { setMicrophoneEnabled, setCameraEnabled, leave } = useF0MeetingStable()
  const { enterPictureInPicture, pipSupport } = useMeetingSurface()

  const connected = status === "connected"
  const microphoneOn = localMedia.microphone.enabled
  const cameraOn = localMedia.camera.enabled
  // Handlers are registered once per connection and read the toggles through
  // a ref, so a mute does not tear every handler down and put it back.
  const mediaRef = useRef({ microphoneOn, cameraOn })
  mediaRef.current = { microphoneOn, cameraOn }

  // The handler runs with a user activation, so it can open either kind: the
  // Document window where there is one, a floating `<video>` where there is
  // not. Only a browser with neither has nothing to answer with.
  const autoEnter = pipSupport !== "none"

  useEffect(() => {
    const session = getMediaSession()
    if (!session || !connected) {
      return
    }
    const handlers: Record<string, () => void> = {
      togglemicrophone: () =>
        setMicrophoneEnabled(!mediaRef.current.microphoneOn),
      togglecamera: () => setCameraEnabled(!mediaRef.current.cameraOn),
      hangup: () => leave(),
    }
    if (autoEnter) {
      handlers.enterpictureinpicture = enterPictureInPicture
    }
    for (const [action, handler] of Object.entries(handlers)) {
      setHandler(session, action, handler)
    }
    return () => {
      for (const action of Object.keys(handlers)) {
        setHandler(session, action, null)
      }
    }
  }, [
    connected,
    autoEnter,
    setMicrophoneEnabled,
    setCameraEnabled,
    leave,
    enterPictureInPicture,
  ])

  useEffect(() => {
    const session = getMediaSession()
    if (!session || !connected) {
      return
    }
    try {
      session.setMicrophoneActive?.(microphoneOn)
      session.setCameraActive?.(cameraOn)
    } catch {
      // A browser that has the method but not the feature behind it.
    }
  }, [connected, microphoneOn, cameraOn])
}
