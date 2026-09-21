import { useCallback, useEffect, useRef, useState } from "react"

/**
 * The Document Picture-in-Picture API (Chromium 116+), typed locally: it is
 * not in `lib.dom`, and F0 needs exactly one method of it.
 */
type DocumentPictureInPicture = {
  requestWindow: (options?: {
    width?: number
    height?: number
  }) => Promise<Window>
}

type WindowWithDocumentPip = Window & {
  documentPictureInPicture?: DocumentPictureInPicture
}

export type PipSupport = "document" | "video" | "none"

/**
 * What the browser offers, best first. Document PiP is the real thing — a
 * window with the whole room in it. Video PiP is one `<video>` floating with
 * the browser's own controls, and it is what Firefox and Safari have.
 */
export const detectPipSupport = (): PipSupport => {
  if (
    typeof window !== "undefined" &&
    "documentPictureInPicture" in window &&
    (window as WindowWithDocumentPip).documentPictureInPicture
  ) {
    return "document"
  }
  if (
    typeof document !== "undefined" &&
    "pictureInPictureEnabled" in document &&
    document.pictureInPictureEnabled
  ) {
    return "video"
  }
  return "none"
}

/**
 * The PiP document starts empty: no stylesheets, no `lang`, no theme class.
 * Copying the rules (rather than linking the sheets) is what keeps Tailwind's
 * utilities and the theme tokens working; a sheet the page cannot read across
 * origins is linked instead.
 */
const copyStyleSheets = (from: Document, to: Document): void => {
  for (const sheet of Array.from(from.styleSheets)) {
    try {
      const rules = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join("")
      const style = to.createElement("style")
      style.textContent = rules
      to.head.appendChild(style)
    } catch {
      // A cross-origin sheet throws on `cssRules`; the link still loads it.
      if (!sheet.href) {
        continue
      }
      const link = to.createElement("link")
      link.rel = "stylesheet"
      link.href = sheet.href
      if (sheet.media.mediaText) {
        link.media = sheet.media.mediaText
      }
      to.head.appendChild(link)
    }
  }
}

/**
 * `dark` is a class on the root (`darkMode: "class"`), `dir` decides the
 * logical properties, `lang` the hyphenation and the screen reader's voice.
 * Every `data-*` on the root rides along so a host theming by attribute keeps
 * working too.
 */
const mirrorDocument = (from: Document, to: Document): void => {
  const source = from.documentElement
  const target = to.documentElement
  if (source.lang) {
    target.lang = source.lang
  }
  if (source.dir) {
    target.dir = source.dir
  }
  target.className = source.className
  for (const { name, value } of Array.from(source.attributes)) {
    if (name.startsWith("data-")) {
      target.setAttribute(name, value)
    }
  }
  to.body.className = from.body.className
}

export type PictureInPictureControls = {
  support: PipSupport
  /** The Document PiP window while it is open. */
  pipWindow: Window | null
  /** The `<video>` currently floating in video PiP. */
  pipVideo: HTMLVideoElement | null
  open: (size: { width: number; height: number }) => Promise<Window | null>
  close: () => void
  openVideo: (video: HTMLVideoElement) => Promise<void>
  closeVideo: () => void
}

/**
 * Owns the browser side of picture-in-picture: opening the window, dressing
 * its document, and noticing when it goes away. `pipWindow` and `pipVideo`
 * are non-null exactly while the browser shows them; what renders into the
 * window is the surface's business.
 */
export const usePictureInPicture = (): PictureInPictureControls => {
  const [pipWindow, setPipWindow] = useState<Window | null>(null)
  const [pipVideo, setPipVideo] = useState<HTMLVideoElement | null>(null)

  const open = useCallback(
    async ({ width, height }: { width: number; height: number }) => {
      const api = (window as WindowWithDocumentPip).documentPictureInPicture
      if (!api) {
        return null
      }
      const opened = await api.requestWindow({ width, height })
      copyStyleSheets(document, opened.document)
      mirrorDocument(document, opened.document)
      // `pagehide` is the one event a PiP window fires on the way out, whether
      // the user closed it or the page did.
      opened.addEventListener(
        "pagehide",
        () => setPipWindow((current) => (current === opened ? null : current)),
        { once: true }
      )
      setPipWindow(opened)
      return opened
    },
    []
  )

  const close = useCallback(() => {
    pipWindow?.close()
  }, [pipWindow])

  const openVideo = useCallback(async (video: HTMLVideoElement) => {
    video.addEventListener(
      "leavepictureinpicture",
      () => setPipVideo((current) => (current === video ? null : current)),
      { once: true }
    )
    await video.requestPictureInPicture()
    setPipVideo(video)
  }, [])

  const closeVideo = useCallback(() => {
    if (document.pictureInPictureElement) {
      void document.exitPictureInPicture()
    }
  }, [])

  // The call ending unmounts the surface. Leaving an empty PiP window behind
  // would be a window with nothing in it and no way to tell what it was — and
  // whoever hung up from it is brought back to the tab, where the app is.
  const pipWindowRef = useRef(pipWindow)
  pipWindowRef.current = pipWindow
  useEffect(
    () => () => {
      if (!pipWindowRef.current) {
        return
      }
      pipWindowRef.current.close()
      window.focus()
    },
    []
  )

  return {
    support: detectPipSupport(),
    pipWindow,
    pipVideo,
    open,
    close,
    openVideo,
    closeVideo,
  }
}
