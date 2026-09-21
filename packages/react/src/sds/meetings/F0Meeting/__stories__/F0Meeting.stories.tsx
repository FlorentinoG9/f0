import type { Meta, StoryObj } from "@storybook/react-vite"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { Desktop, Ellipsis, Record, Settings } from "@/icons/app"
import { cn } from "@/lib/utils"
import { MeetingAudioRenderer } from "../components/audio/MeetingAudioRenderer"
import { MeetingNotes } from "../components/panel/MeetingNotes"
import { MeetingRoomChat } from "../components/panel/MeetingRoomChat"
import { MeetingTranscript } from "../components/panel/MeetingTranscript"
import { F0Meeting } from "../F0Meeting"
import { F0MeetingRoom } from "../F0MeetingRoom"
import {
  CONTROLS_HEIGHT,
  densityFor,
  HEADER_HEIGHT,
  type MeetingDensity,
} from "../layout/density"
import { deterministic } from "../mocks/deterministic"
import {
  fiftyPeopleSeed,
  longNamesSeed,
  oneToOneSeed,
  roomOf,
  screenShareSeed,
  sixPeopleSeed,
  soloSeed,
  thirtyPeopleSeed,
  twelvePeopleSeed,
  type MockMeetingSeed,
  type MockPerson,
} from "../mocks/mockSeeds"
import {
  useMockMeetingRuntime,
  type MockMeetingDrivers,
} from "../mocks/useMockMeetingRuntime"
import { useMockRoomChat, type MockRoomMessage } from "../mocks/useMockRoomChat"
import { F0MeetingProvider } from "../providers/F0MeetingProvider"
import { MeetingDensityProvider } from "../providers/MeetingDensityProvider"
import {
  MeetingSurfaceProvider,
  useMeetingSurface,
} from "../providers/MeetingSurfaceProvider"
import {
  type F0MeetingActionInput,
  type F0MeetingRuntime,
  type F0MeetingSidePanel,
  type F0MeetingSurfaceDestination,
  type F0MeetingTranscriptSegment,
} from "../types"
import { WINDOW_MIN_HEIGHT, WINDOW_MIN_WIDTH } from "../window/window-constants"

const meta: Meta = {
  title: "F0Meeting",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Headless video room. The host owns the transport (LiveKit in factorial); F0 owns the grid, the controls and the window.",
      },
    },
  },
  tags: ["experimental", "!autodocs"],
}

export default meta

/* ------------------------------------------------------------------ *
 * Parameters
 * ------------------------------------------------------------------ */

const videoA11y = {
  // A live camera has no captions to offer, so axe reports `video-caption` on
  // every room. Disabling the rule is forbidden repo-wide (it leaves no trace;
  // see `a11yRuleSuppression.test.ts`), so the gap is recorded as a todo: axe
  // still runs and reports, it just does not block.
  a11y: { test: "todo" },
}

/** Nothing moves in these, so Chromatic can diff them. */
const snapshot = { ...videoA11y, chromatic: { pauseAnimationAtEnd: true } }

/** Real camera, real gestures, real time: not for a snapshot. */
const live = { ...videoA11y, chromatic: { disableSnapshot: true } }

const withDescription = (story: string) => ({
  docs: { description: { story } },
})

/** Stories share one localStorage key for the surface mode. */
const resetSurfaceState = (): void => {
  localStorage.removeItem("ONE-meeting-mode")
  localStorage.removeItem("ONE-meeting-window")
}

/* ------------------------------------------------------------------ *
 * Seeds
 * ------------------------------------------------------------------ */

const solo = deterministic(soloSeed)
const oneToOne = deterministic(oneToOneSeed, { cameras: "static" })
const six = deterministic(sixPeopleSeed, { cameras: "static" })
const twelve = deterministic(twelvePeopleSeed, { cameras: "static" })
const thirty = deterministic(thirtyPeopleSeed)
const fifty = deterministic(fiftyPeopleSeed)
const longNames = deterministic(longNamesSeed, { cameras: "static" })
const share = deterministic(screenShareSeed, { cameras: "static" })

const preventCrop = deterministic(
  {
    ...sixPeopleSeed,
    others: sixPeopleSeed.others.map((person, index) =>
      index === 0 ? { ...person, preventCrop: true } : person
    ),
  },
  { cameras: "static" }
)

const halfInvited = deterministic({
  ...sixPeopleSeed,
  others: sixPeopleSeed.others.map((person, index) => ({
    ...person,
    presence: index % 2 === 1 ? ("invited" as const) : ("joined" as const),
  })),
})

/* ------------------------------------------------------------------ *
 * Scaffolding
 * ------------------------------------------------------------------ */

/** The providers and the room, filling whatever holds them. */
const MockRoom = ({
  seed,
  density = "regular",
  mode = "inline",
  sidePanel,
  children,
}: {
  seed: MockMeetingSeed
  /** The shell normally publishes this; a bare box has to say what it is. */
  density?: MeetingDensity
  mode?: F0MeetingSurfaceDestination
  sidePanel?: F0MeetingSidePanel
  children?: ReactNode
}) => {
  const { runtime } = useMockMeetingRuntime(seed)
  return (
    <MeetingDensityProvider density={density}>
      <F0MeetingProvider runtime={runtime}>
        <MeetingSurfaceProvider defaultMode={mode} roomId={seed.room.id}>
          <F0MeetingRoom sidePanel={sidePanel} />
          {/* A bare room has no surface, so it mounts its own audio. */}
          <MeetingAudioRenderer />
          {children}
        </MeetingSurfaceProvider>
      </F0MeetingProvider>
    </MeetingDensityProvider>
  )
}

const RoomBox = ({
  width = "100%",
  height = 560,
  caption,
  children,
}: {
  width?: number | string
  height?: number
  caption?: string
  children: ReactNode
}) => (
  <div className="flex max-w-full flex-col items-center gap-2">
    <div
      className="max-w-full overflow-hidden rounded-xl border border-solid border-f1-border-secondary bg-f1-special-page"
      style={{ width, height }}
    >
      {children}
    </div>
    {caption ? (
      <p className="text-sm text-f1-foreground-secondary">{caption}</p>
    ) : null}
  </div>
)

const Stage = ({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) => (
  <div
    className={cn(
      "flex flex-wrap items-start justify-center gap-6 bg-f1-background-secondary p-6",
      className
    )}
  >
    {children}
  </div>
)

/**
 * Renders the room inside a fixed box instead of the real surface, which
 * portals to `document.body` and would cover the docs page. Everything below
 * the window chrome is identical.
 */
const BoxedRoom = ({
  width,
  height,
  caption,
  ...room
}: Parameters<typeof MockRoom>[0] & {
  width?: number | string
  height?: number
  caption?: string
}) => (
  <RoomBox width={width} height={height} caption={caption}>
    <MockRoom {...room} />
  </RoomBox>
)

const Room = (props: Parameters<typeof BoxedRoom>[0]) => (
  <Stage>
    <BoxedRoom {...props} />
  </Stage>
)

const ToolbarButton = ({
  children,
  onClick,
}: {
  children: ReactNode
  onClick: () => void
}) => (
  <button
    type="button"
    className="w-fit rounded-md bg-f1-background px-3 py-1.5 text-sm font-medium"
    onClick={onClick}
  >
    {children}
  </button>
)

/** A room with the mock's drivers exposed as buttons above it. */
const DrivenRoom = ({
  seed,
  height = 480,
  toolbar,
}: {
  seed: MockMeetingSeed
  height?: number
  toolbar: (drivers: MockMeetingDrivers, runtime: F0MeetingRuntime) => ReactNode
}) => {
  const { runtime, drivers } = useMockMeetingRuntime(seed)
  return (
    <div className="flex flex-col gap-3 bg-f1-background-secondary p-6">
      <div className="flex flex-wrap gap-2">{toolbar(drivers, runtime)}</div>
      <RoomBox height={height}>
        <F0MeetingProvider runtime={runtime}>
          <MeetingSurfaceProvider defaultMode="inline" roomId={seed.room.id}>
            <F0MeetingRoom />
            <MeetingAudioRenderer />
          </MeetingSurfaceProvider>
        </F0MeetingProvider>
      </RoomBox>
    </div>
  )
}

const PageBehind = () => (
  <div className="h-screen space-y-3 bg-f1-background p-10">
    <div className="h-6 w-64 rounded bg-f1-background-secondary" />
    {Array.from({ length: 14 }, (_, index) => (
      <div
        key={index}
        className="h-3 rounded bg-f1-background-secondary"
        style={{ width: `${45 + ((index * 13) % 45)}%` }}
      />
    ))}
  </div>
)

const SurfaceStory = ({
  seed,
  defaultMode,
  actions,
  actionOrder,
}: {
  seed: MockMeetingSeed
  defaultMode: F0MeetingSurfaceDestination
  actions?: F0MeetingActionInput[]
  actionOrder?: string[]
}) => {
  const { runtime } = useMockMeetingRuntime(seed)
  return (
    <F0Meeting
      runtime={runtime}
      defaultMode={defaultMode}
      actions={actions}
      actionOrder={actionOrder}
    >
      <PageBehind />
    </F0Meeting>
  )
}

/* ------------------------------------------------------------------ *
 * Grid
 * ------------------------------------------------------------------ */

export const Solo: StoryObj = {
  parameters: snapshot,
  render: () => <Room seed={solo} />,
}

export const OneToOne: StoryObj = {
  parameters: {
    ...snapshot,
    ...withDescription(
      "Two people auto-focus the remote participant — the room's only implicit spotlight rule besides screen shares."
    ),
  },
  render: () => <Room seed={oneToOne} />,
}

export const SixParticipants: StoryObj = {
  parameters: snapshot,
  render: () => <Room seed={six} />,
}

export const TwelveParticipants: StoryObj = {
  parameters: {
    ...snapshot,
    ...withDescription(
      "Above seven tiles the previous Factorial implementation rendered nothing at all: its layouts were written out by hand, one function per count."
    ),
  },
  render: () => <Room seed={twelve} />,
}

export const ThirtyParticipants: StoryObj = {
  parameters: {
    ...snapshot,
    ...withDescription(
      "The solver seats as many as clear the container-relative floor and puts the rest in the +N chip, which takes a cell like any other. The cut-off follows the container rather than a fixed page size."
    ),
  },
  render: () => <Room seed={thirty} />,
}

export const FiftyParticipants: StoryObj = {
  parameters: {
    ...snapshot,
    ...withDescription(
      "Fifty people in a 960×540 box. Nobody in the chip has a `<video>`, so with adaptive stream on, the transport pauses their tracks by itself."
    ),
  },
  render: () => <Room seed={fifty} width={960} height={540} />,
}

export const GridFill: StoryObj<{ count: number }> = {
  args: { count: 5 },
  argTypes: {
    count: { control: { type: "range", min: 1, max: 16, step: 1 } },
  },
  parameters: {
    ...snapshot,
    ...withDescription(
      "One 960×540 box, one to sixteen people. Rows are sized independently and each row spans the full width on its own, so an incomplete last row spreads its tiles instead of leaving the missing cells as a hole: three people fill the room, they do not sit beside an empty square. The aspect clamp is the only thing allowed to leave space."
    ),
  },
  render: function Render({ count }) {
    const seed = useMemo(() => deterministic(roomOf(count)), [count])
    return (
      <Room seed={seed} width={960} height={540} caption={`${count} people`} />
    )
  },
}

const RESPONSIVE_WIDTHS = [320, 480, 720, 1280] as const

export const ResponsiveRoom: StoryObj<{ width: number }> = {
  args: { width: 720 },
  argTypes: {
    width: { control: "select", options: [...RESPONSIVE_WIDTHS] },
  },
  parameters: {
    ...snapshot,
    ...withDescription(
      "The same seven people at four widths, each box 16:9 plus the control bar at that density. Density, gap, corner radius and the name label all scale with the measured room, never with the viewport."
    ),
  },
  render: function Render({ width }) {
    const video = Math.round((width * 9) / 16)
    const density = densityFor({
      width,
      height: video + CONTROLS_HEIGHT.regular,
    })
    const height = video + CONTROLS_HEIGHT[density]
    const seed = useMemo(() => deterministic(roomOf(7)), [])
    return (
      <Room
        seed={seed}
        width={width}
        height={height}
        density={density}
        caption={`${width}×${height} · ${density}`}
      />
    )
  },
}

const LONG_NAME_SIZES = [
  { width: 320, height: 220 },
  { width: 640, height: 360 },
  { width: 960, height: 540 },
]

export const LongNames: StoryObj = {
  parameters: {
    ...snapshot,
    ...withDescription(
      "Forty-character names at three sizes. The label truncates with an ellipsis and gives way to the pin control and the share suffix; it never wraps to a second line or spills out of its chip."
    ),
  },
  render: () => (
    <Stage>
      {LONG_NAME_SIZES.map(({ width, height }) => (
        <BoxedRoom
          key={width}
          seed={longNames}
          width={width}
          height={height}
          density={densityFor({ width, height })}
          caption={`${width}×${height}`}
        />
      ))}
    </Stage>
  ),
}

export const Portrait: StoryObj = {
  parameters: {
    ...snapshot,
    ...withDescription(
      "A 420×900 box — the shape of a docked side panel — with 3, 7 and 12 people. Tiles take the shape of their cell, so they go portrait rather than stacking 16:9 slivers, and the height floor keeps a tall column from seating forty."
    ),
  },
  render: () => (
    <Stage>
      {[3, 7, 12].map((count) => (
        <BoxedRoom
          key={count}
          seed={deterministic(roomOf(count))}
          width={420}
          height={900}
          density={densityFor({ width: 420, height: 900 })}
          caption={`${count} people`}
        />
      ))}
    </Stage>
  ),
}

export const MinimumFloatingSize: StoryObj = {
  parameters: {
    ...snapshot,
    ...withDescription(
      `The smallest window a user can drag to: \`WINDOW_MIN_WIDTH × WINDOW_MIN_HEIGHT\` (${WINDOW_MIN_WIDTH}×${WINDOW_MIN_HEIGHT}). The strip at the top stands in for the title bar, which belongs to the window, so the room gets exactly what it would get there: tight density, a 16:9 slice of video and a control bar that clears a 32px button.`
    ),
  },
  render: () => {
    const density = densityFor({
      width: WINDOW_MIN_WIDTH,
      height: WINDOW_MIN_HEIGHT,
    })
    return (
      <Stage>
        <RoomBox
          width={WINDOW_MIN_WIDTH}
          height={WINDOW_MIN_HEIGHT}
          caption={`${WINDOW_MIN_WIDTH}×${WINDOW_MIN_HEIGHT} · ${density}`}
        >
          <div className="flex h-full flex-col">
            <div
              className="shrink-0 border-0 border-b border-solid border-f1-border-secondary"
              style={{ height: HEADER_HEIGHT[density] }}
            />
            <div className="min-h-0 flex-1">
              <MockRoom seed={six} density={density} />
            </div>
          </div>
        </RoomBox>
      </Stage>
    )
  },
}

export const Ultrawide: StoryObj = {
  parameters: {
    ...snapshot,
    chromatic: { ...snapshot.chromatic, viewports: [2560] },
    ...withDescription(
      "2560×1080, with one person and with five. The aspect clamp stops a single tile at 16:9 rather than stretching it across the whole width, and five people get a full-width row each rather than a 16:9 block centred in the void."
    ),
  },
  render: () => (
    <div className="flex flex-col items-start gap-6 overflow-x-auto bg-f1-background-secondary py-6">
      <BoxedRoom seed={solo} width={2560} height={1080} caption="1 person" />
      <BoxedRoom
        seed={deterministic(roomOf(5), { cameras: "static" })}
        width={2560}
        height={1080}
        caption="5 people"
      />
    </div>
  ),
}

export const TinyContainer: StoryObj = {
  parameters: {
    ...snapshot,
    ...withDescription(
      "At 320px the room spotlights one person, keeps as many thumbnails as fit underneath, and collapses the control bar. Every one of those decisions comes from the measured container, never from the viewport."
    ),
  },
  render: () => (
    <Room
      seed={six}
      width={320}
      height={220}
      density={densityFor({ width: 320, height: 220 })}
    />
  ),
}

export const PreventCrop: StoryObj = {
  parameters: {
    ...snapshot,
    ...withDescription(
      "Tiles take the shape of their cell and crop the sides to fill it — safe for a centred face, not for someone signing. Marta has `preventCrop`, so her tile letterboxes the whole picture on the tile's own plate instead. The person owns the preference; F0 only honours it."
    ),
  },
  render: () => <Room seed={preventCrop} width={960} height={540} />,
}

/* ------------------------------------------------------------------ *
 * Screen share
 * ------------------------------------------------------------------ */

export const ScreenShare: StoryObj = {
  parameters: {
    ...snapshot,
    ...withDescription(
      "The share is 21:9 on purpose. Its tile takes the whole stage and letterboxes the picture inside itself on black, so the dark is exactly the part of the screen that is missing — the room around it stays light."
    ),
  },
  render: () => <Room seed={share} />,
}

export const ScreenShareInGrid: StoryObj = {
  parameters: {
    ...snapshot,
    ...withDescription(
      "The same share, un-pinned: a spotlight is something the user can dismiss, and dismissing it is remembered — the auto rule does not re-focus a share it has already seen. The share then sits in the grid as one tile among the others, still letterboxed inside its own cell."
    ),
  },
  render: () => <Room seed={share} width={960} height={540} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const unpin = await canvas.findByRole("button", { name: /unpin/i })
    await userEvent.hover(unpin)
    await userEvent.click(unpin)
    await waitFor(() =>
      expect(canvas.queryByRole("button", { name: /unpin/i })).toBeNull()
    )
  },
}

export const ShareYourScreen: StoryObj = {
  parameters: {
    ...live,
    ...withDescription(
      "Press the screen button in the control bar: the mock calls the real `getDisplayMedia`, so you pick an actual window or display. The captured size drives the layout, so a 16:10 laptop screen letterboxes differently from an ultrawide — and the bands are black, as in Meet. Stopping from the browser's own sharing bar ends the tile too."
    ),
  },
  render: () => <Room seed={sixPeopleSeed} />,
}

/* ------------------------------------------------------------------ *
 * Presence
 * ------------------------------------------------------------------ */

export const Presence: StoryObj = {
  parameters: {
    ...snapshot,
    ...withDescription(
      "Half the room is still `invited`: they hold a tile that says so, publish nothing, and do not count toward the people in the call. LiveKit does not know them — they come from the host's own attendee list."
    ),
  },
  render: () => <Room seed={halfInvited} />,
}

/** People not in the six-person seed, to walk in one at a time. */
const NEWCOMERS: MockPerson[] = thirtyPeopleSeed.others
  .slice(6)
  .map((person) => ({ ...person, camera: false }))

const ADD_REMOVE_SEED = deterministic({
  ...sixPeopleSeed,
  room: { ...sixPeopleSeed.room, id: "mock-add-and-remove" },
  others: [
    ...sixPeopleSeed.others,
    { ...(thirtyPeopleSeed.others[5] as MockPerson), presence: "invited" },
  ],
})

export const AddAndRemovePeople: StoryObj = {
  parameters: {
    ...snapshot,
    ...withDescription(
      "The mock's drivers, as buttons. `join` and `leave` are what a real `participant_joined` / `participant_left` does; `admit` lets the invited person in, which bumps their generation so their tracks attach exactly as a republish would. Each change is announced once in the live region."
    ),
  },
  render: function Render() {
    const [nextIndex, setNextIndex] = useState(0)
    return (
      <DrivenRoom
        seed={ADD_REMOVE_SEED}
        toolbar={(drivers, runtime) => {
          const present = new Set(
            runtime.participants.map((participant) => participant.id)
          )
          const next = NEWCOMERS.find((person) => !present.has(person.id))
          const last = [...runtime.participants]
            .reverse()
            .find(
              (participant) =>
                !participant.isLocal && participant.presence !== "invited"
            )
          const invited = runtime.participants.filter(
            (participant) => participant.presence === "invited"
          )
          return (
            <>
              <ToolbarButton
                onClick={() => {
                  if (next) {
                    drivers.join(next)
                    setNextIndex(nextIndex + 1)
                  }
                }}
              >
                Join
              </ToolbarButton>
              <ToolbarButton
                onClick={() => {
                  if (last) {
                    drivers.leave(last.id)
                  }
                }}
              >
                Leave
              </ToolbarButton>
              <ToolbarButton
                onClick={() => invited.forEach((p) => drivers.admit(p.id))}
              >
                Admit
              </ToolbarButton>
            </>
          )
        }}
      />
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const tiles = () => canvas.getAllByTestId("meeting-participant-tile").length
    // The grid lays out only once it has measured its box, a frame after
    // mount: counting synchronously found nothing on a cold CI browser.
    const before = (await canvas.findAllByTestId("meeting-participant-tile"))
      .length
    await userEvent.click(canvas.getByRole("button", { name: "Join" }))
    await waitFor(() => expect(tiles()).toBe(before + 1))
  },
}

/* ------------------------------------------------------------------ *
 * Surface
 * ------------------------------------------------------------------ */

export const FloatingWindow: StoryObj = {
  parameters: {
    ...snapshot,
    ...withDescription(
      "Drag it by the header and resize it from any edge or corner. Dropping it near a corner snaps flush, and the placement is stored as an anchor so resizing the browser keeps it there. The buttons in the header are the destinations: fullscreen here, plus the side panel where an application frame provides one."
    ),
  },
  beforeEach: resetSurfaceState,
  render: () => <SurfaceStory seed={six} defaultMode="floating" />,
}

export const MinimizedPill: StoryObj = {
  parameters: {
    ...snapshot,
    ...withDescription(
      "The same window at pill size: only the pinned actions survive, and the overflow menu is dropped rather than squeezed in."
    ),
  },
  beforeEach: resetSurfaceState,
  render: () => <SurfaceStory seed={six} defaultMode="minimized" />,
}

export const SidePanel: StoryObj = {
  parameters: {
    ...snapshot,
    ...withDescription(
      '`defaultMode="panel"` with nothing to dock into. Standalone there is no application frame, so no panel slot is registered and the mode derives to `floating` — the switch does not offer a destination that is not there. The docked call, with the content narrowing beside it, lives in the ApplicationFrame stories.'
    ),
  },
  beforeEach: resetSurfaceState,
  render: () => <SurfaceStory seed={six} defaultMode="panel" />,
}

export const Fullscreen: StoryObj = {
  parameters: {
    ...snapshot,
    ...withDescription(
      "The only modal mode. The rest of the page is made `inert` — unfocusable and out of the accessibility tree — rather than wrapped in a focus trap. Escape returns to the floating window and never hangs up."
    ),
  },
  beforeEach: resetSurfaceState,
  render: () => <SurfaceStory seed={six} defaultMode="fullscreen" />,
}

/* ------------------------------------------------------------------ *
 * Side panel
 * ------------------------------------------------------------------ */

const PANEL_SEED = deterministic({
  ...sixPeopleSeed,
  room: { ...sixPeopleSeed.room, id: "mock-with-side-panel" },
  notes:
    "Onboarding flow\n- Drop-off is on step 2, not step 1\n- Move the invite to the end?",
})

const SAMPLE_CHAT: MockRoomMessage[] = [
  {
    id: "c1",
    participantId: "p1",
    text: "Can everyone see the deck?",
    at: "2026-01-12T09:02:10.000Z",
  },
  {
    id: "c2",
    participantId: "p3",
    text: "Yes — slide 4 has the numbers we talked about.",
    at: "2026-01-12T09:02:41.000Z",
  },
  {
    id: "c3",
    participantId: "me",
    text: "Looks good. I'll take notes.",
    at: "2026-01-12T09:03:05.000Z",
  },
]

const SAMPLE_TRANSCRIPT: F0MeetingTranscriptSegment[] = [
  {
    id: "t1",
    participantId: "p1",
    text: "Let's start with the onboarding flow.",
    at: "2026-01-12T09:01:12.000Z",
    isFinal: true,
  },
  {
    id: "t2",
    participantId: "p5",
    text: "The drop-off is on the second step, not the first.",
    at: "2026-01-12T09:01:40.000Z",
    isFinal: true,
  },
  {
    id: "t3",
    participantId: "p3",
    text: "So if we move the invite to the end",
    at: "2026-01-12T09:02:02.000Z",
    isFinal: false,
  },
]

/** The panel starts closed; a story about the panel wants it open. */
const OpenSidePanel = () => {
  const { setSidePanelOpen } = useMeetingSurface()
  useEffect(() => {
    setSidePanelOpen(true)
  }, [setSidePanelOpen])
  return null
}

export const WithSidePanel: StoryObj = {
  parameters: {
    ...snapshot,
    ...withDescription(
      "Chat, transcript and notes through the three exported panel components — `MeetingRoomChat`, `MeetingTranscript`, `MeetingNotes`. F0 owns the tab bar, the selection and the close button; the host owns what is inside each tab. The chat tab's `badge` shows on the control-bar button, the only place an unread count matters. Fullscreen-only: at 420px the panel would leave the video a sliver anywhere else."
    ),
  },
  beforeEach: resetSurfaceState,
  render: function Render() {
    const chat = useMockRoomChat(PANEL_SEED.room.id, "me", SAMPLE_CHAT)
    const [notes, setNotes] = useState(PANEL_SEED.notes ?? "")
    const sidePanel: F0MeetingSidePanel = {
      defaultTabId: "chat",
      tabs: [
        {
          id: "chat",
          label: "Chat",
          badge: 2,
          content: (
            <MeetingRoomChat messages={chat.messages} onSend={chat.send} />
          ),
        },
        {
          id: "transcript",
          label: "Transcript",
          content: <MeetingTranscript segments={SAMPLE_TRANSCRIPT} />,
        },
        {
          id: "notes",
          label: "Notes",
          content: <MeetingNotes value={notes} onChange={setNotes} />,
        },
      ],
    }
    return (
      <Room
        seed={PANEL_SEED}
        width={1280}
        height={640}
        mode="fullscreen"
        sidePanel={sidePanel}
      >
        <OpenSidePanel />
      </Room>
    )
  },
}

/* ------------------------------------------------------------------ *
 * States
 * ------------------------------------------------------------------ */

export const Reconnecting: StoryObj = {
  parameters: {
    ...snapshot,
    ...withDescription(
      "Tiles stay mounted and the last frame freezes. Clearing the grid for a two-second ICE restart reads as the call having dropped."
    ),
  },
  render: () => (
    <DrivenRoom
      seed={six}
      toolbar={(drivers) => (
        <ToolbarButton onClick={() => drivers.simulateReconnect(4000)}>
          Simulate a 4s reconnect
        </ToolbarButton>
      )}
    />
  ),
}

export const PermissionDenied: StoryObj = {
  parameters: {
    ...snapshot,
    ...withDescription(
      "A denied camera is a state, not an exception. The control is disabled with a reason instead of failing silently into a black tile."
    ),
  },
  render: () => (
    <DrivenRoom
      seed={oneToOne}
      height={420}
      toolbar={(drivers) => (
        <ToolbarButton onClick={() => drivers.denyPermission("camera")}>
          Deny the camera
        </ToolbarButton>
      )}
    />
  ),
}

/* ------------------------------------------------------------------ *
 * Theme and direction
 * ------------------------------------------------------------------ */

export const Dark: StoryObj = {
  ...SixParticipants,
  parameters: {
    ...snapshot,
    ...withDescription(
      "Every cell is the secondary surface in dark mode — there is no separate dark plate for a tile without video, because the surface is already dark."
    ),
  },
  decorators: [
    (Story) => (
      <div className="dark bg-f1-background">
        <Story />
      </div>
    ),
  ],
}

export const RTL: StoryObj = {
  ...SixParticipants,
  parameters: {
    ...snapshot,
    ...withDescription(
      "Right-to-left. The name chip, the pin control and the control bar use logical properties, so they mirror without a second set of classes; the video itself does not."
    ),
  },
  decorators: [
    (Story) => (
      <div dir="rtl">
        <Story />
      </div>
    ),
  ],
}

/* ------------------------------------------------------------------ *
 * Extensibility
 * ------------------------------------------------------------------ */

export const CustomActions: StoryObj = {
  parameters: {
    ...snapshot,
    ...withDescription(
      "The bar is the host's. F0 synthesizes the core controls from the runtime; anything else is merged in by id, so relabelling the mic is a patch rather than a reimplementation."
    ),
  },
  beforeEach: resetSurfaceState,
  render: function Render() {
    const [notes, setNotes] = useState(false)
    return (
      <SurfaceStory
        seed={six}
        defaultMode="floating"
        actionOrder={["core:microphone", "core:camera", "notes"]}
        actions={[
          // A patch: only the id and what changes.
          { id: "core:microphone", label: "Silence me" },
          {
            id: "notes",
            label: "Notes",
            icon: Settings,
            pressed: notes,
            onClick: () => setNotes((value) => !value),
            group: "collab",
            priority: 55,
          },
          {
            id: "record",
            label: "Record",
            icon: Record,
            group: "system",
            priority: 30,
          },
          {
            id: "layout",
            label: "Change layout",
            icon: Desktop,
            group: "system",
            priority: 20,
          },
          {
            id: "more",
            label: "Something else",
            icon: Ellipsis,
            group: "system",
            priority: 5,
          },
        ]}
      />
    )
  },
}

export const InApplicationFrame: StoryObj = {
  parameters: {
    ...live,
    ...withDescription(
      "The huddle flow: start a call from a conversation, minimize it, and keep using the app. The window lives in a portal, so navigating never unmounts the video."
    ),
  },
  beforeEach: resetSurfaceState,
  render: function Render() {
    const [isLive, setIsLive] = useState(false)
    const { runtime } = useMockMeetingRuntime(sixPeopleSeed)

    return (
      <F0Meeting runtime={isLive ? runtime : null} defaultMode="floating">
        <div className="flex h-screen bg-f1-background">
          <nav className="w-60 shrink-0 space-y-2 border-r border-solid border-f1-border-secondary p-4">
            <div className="h-4 w-28 rounded bg-f1-background-secondary" />
            {["Design", "Product", "Marta", "Aiko"].map((name) => (
              <div
                key={name}
                className="rounded-md px-2 py-1.5 text-sm text-f1-foreground-secondary"
              >
                {name}
              </div>
            ))}
          </nav>
          <main className="flex-1 p-8">
            <div className="mb-4 flex items-center gap-3">
              <h2 className="text-lg font-medium">Design</h2>
              <button
                type="button"
                className="rounded-md bg-f1-background-secondary px-3 py-1.5 text-sm font-medium"
                onClick={() => setIsLive((value) => !value)}
              >
                {isLive ? "Leave huddle" : "Start huddle"}
              </button>
            </div>
            <PageBehind />
          </main>
        </div>
      </F0Meeting>
    )
  },
}

export const WithRealCamera: StoryObj = {
  parameters: {
    ...live,
    ...withDescription(
      "Your real camera drives the local tile, and each remote tile re-renders it with a different crop and hue so the room is full of genuinely human video. Requires a click: the browser will not grant a camera without a gesture."
    ),
  },
  beforeEach: resetSurfaceState,
  render: () => (
    <DrivenRoom
      seed={sixPeopleSeed}
      height={520}
      toolbar={(drivers) => (
        <ToolbarButton onClick={() => void drivers.enableLocalCamera()}>
          {drivers.hasLocalCamera ? "Camera on" : "Use my camera"}
        </ToolbarButton>
      )}
    />
  ),
}
