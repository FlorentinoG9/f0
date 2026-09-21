import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderHook } from "@/testing/test-utils"
import { soloSeed } from "../mocks/mockSeeds"
import { useMockMeetingRuntime } from "../mocks/useMockMeetingRuntime"

const track = (kind: string) => ({
  kind,
  stop: vi.fn(),
  getSettings: () => ({ deviceId: `${kind}-device` }),
  enabled: true,
})

let videoTracks: ReturnType<typeof track>[] = []
let audioTracks: ReturnType<typeof track>[] = []
let lastConstraints: MediaStreamConstraints | undefined

const stream = () =>
  ({
    getTracks: () => [...videoTracks, ...audioTracks],
    getVideoTracks: () => videoTracks,
    getAudioTracks: () => audioTracks,
  }) as unknown as MediaStream

beforeEach(() => {
  videoTracks = [track("video")]
  audioTracks = []
  lastConstraints = undefined
  vi.stubGlobal("navigator", {
    ...navigator,
    mediaDevices: {
      getUserMedia: vi.fn(async (constraints: MediaStreamConstraints) => {
        lastConstraints = constraints
        if (constraints.audio && !constraints.video) {
          audioTracks = [track("audio")]
          return stream()
        }
        return stream()
      }),
      enumerateDevices: vi.fn(async () => []),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  })
})

afterEach(() => vi.unstubAllGlobals())

/** Renders and lets the mount-time device enumeration settle. */
const setup = async (seed: Partial<typeof soloSeed> = {}) => {
  const rendered = renderHook(() =>
    useMockMeetingRuntime({ ...soloSeed, audio: false, ...seed })
  )
  await act(async () => {})
  return rendered
}

describe("local media", () => {
  it("captures nothing on its own", async () => {
    await setup()
    expect(lastConstraints).toBeUndefined()
  })

  it("opens the microphone on connect when the seed says it is a real call", async () => {
    // Chromium's automatic picture-in-picture only follows a tab that is
    // capturing camera or microphone. A mock that shows the mic "on" while
    // holding no stream never qualifies, and the huddle demo never left the tab.
    const { result } = await setup({ captureMicrophone: true })

    expect(lastConstraints?.audio).toMatchObject({ echoCancellation: true })
    expect(lastConstraints?.video).toBeUndefined()
    expect(result.current.runtime.localMedia.microphone.enabled).toBe(true)

    // Hanging up gives it back, like every other local track.
    const opened = [...audioTracks]
    act(() => result.current.runtime.leave())
    opened.forEach((entry) => expect(entry.stop).toHaveBeenCalled())
  })

  it("opens the camera without asking for the microphone", async () => {
    // Asking for audio here was free to write and cost a feedback loop: the mic
    // picked up the synthesized voices through the speakers, the monitor
    // metered them, and you ended up in the speaking set.
    const { result } = await setup()
    await act(async () => {
      await result.current.drivers.enableLocalCamera()
    })

    expect(lastConstraints).toBeDefined()
    expect(lastConstraints?.audio).toBeUndefined()
    expect(lastConstraints?.video).toBeTruthy()
  })

  it("asks for echo cancellation when it does open the microphone", async () => {
    const { result } = await setup()
    await act(async () => {
      result.current.runtime.setMicrophoneEnabled(true)
    })

    const audio = lastConstraints?.audio
    expect(audio).toMatchObject({ echoCancellation: true })
  })

  it("stops every local track when you hang up", async () => {
    // Hanging up does not unmount the hook — the frame keeps the runtime alive
    // and only flips `status` — so nothing else was giving the camera back and
    // the laptop's light stayed on.
    const { result } = await setup()
    await act(async () => {
      await result.current.drivers.enableLocalCamera()
    })
    const opened = [...videoTracks]
    expect(opened.length).toBeGreaterThan(0)

    act(() => result.current.runtime.leave())

    opened.forEach((entry) => expect(entry.stop).toHaveBeenCalled())
    expect(result.current.runtime.status).toBe("disconnected")
  })

  it("reports the device it actually opened, not the one it asked for", async () => {
    const { result } = await setup()
    await act(async () => {
      await result.current.drivers.enableLocalCamera()
    })
    // Opening the default camera passes no id, so without reading the settings
    // back the picker had nothing to tick.
    expect(result.current.runtime.localMedia.camera.selectedDeviceId).toBe(
      "video-device"
    )
  })

  it("offers devices before any permission has been granted", async () => {
    // They used to be enumerated only inside a successful `openCamera`, so both
    // chevrons stayed hidden until you turned the camera on — and the
    // microphone picker was unreachable for anyone who never did.
    const { result } = await setup()
    expect(
      result.current.runtime.localMedia.microphone.devices?.length
    ).toBeGreaterThan(0)
    expect(
      result.current.runtime.localMedia.camera.devices?.length
    ).toBeGreaterThan(0)
  })

  it("wires a real handler to the microphone picker", async () => {
    // It used to be a `() => Promise.resolve()` stub that existed only to make
    // the chevron render.
    const { result } = await setup()
    expect(
      result.current.runtime.localMedia.microphone.selectDevice
    ).toBeTypeOf("function")
  })
})
