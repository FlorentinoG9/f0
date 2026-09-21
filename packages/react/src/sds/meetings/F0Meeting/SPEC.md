# F0Meeting — design spec

Working notes for the headless meeting surface: what it is, why it is shaped this way, how it
maps onto LiveKit, and what is still open. The Storybook page
(`__stories__/F0Meeting.mdx`) documents **how to use it**; this documents **why it is like that**
and **what is missing**, which is what you need to pick the concept back up months later.

Status: designed and built in F0, verified against `livekit-client` 2.17.0 and the factorial
backend **by reading the source**. Never run against a live LiveKit server.

---

## 1. What it is, and what it is not

A video room that owns layout, chrome and window behaviour, and owns **nothing** about
transport. The host provides participants, tracks, connection state and the actions that change
them; F0 renders.

**F0 never imports a transport SDK — not even for types.** A unit test
(`__tests__/F0Meeting.contract.test.ts`) fails if one appears. The coupling comes back the moment
somebody needs a LiveKit type "just for a second", and by then every consumer has inherited it.

This is the same split as `F0Chat`/`aiChat`: a runtime object of plain data plus callbacks,
injected by the host.

---

## 2. The contract

`F0MeetingRuntime` (see `types.ts`) carries two conventions that do most of the design work.

**Optional callbacks are capability detection.** Omit `setScreenShareEnabled` and the
screen-share button does not exist. Omit `startRecording` and there is no recording. A host says
what it supports by not passing what it lacks.

**`capabilities` is a different thing — permissions.** Omitting `startRecording` means "this
deployment has no recording". `canRecord: false` means "recording exists, but not for you", and
that renders as a **disabled control with a reason**, never as a control that quietly vanishes.
A disabled button with an explanation is a worse day; a missing button is a bug report.

### Why bindings and not `MediaStreamTrack`

```ts
type F0MeetingBinding = (element: HTMLMediaElement) => () => void
```

The obvious contract — hand F0 a `MediaStreamTrack` and let it assign `srcObject` — breaks
adaptive streaming. LiveKit's `track.attach(element)` **registers the element**: it observes its
size and visibility to pick the simulcast layer and to pause off-screen video. Assigning
`srcObject` skips all of that, and the room silently downloads full-resolution video for
thumbnails.

So F0 asks for an imperative binding and calls it in a layout effect. `bindingKey` decides when
to re-attach: F0 re-runs attach **only** when that string changes, never on `binding`'s identity,
which hosts rebuild on every transport event.

### High-frequency state is not in the contract's object graph

`signals` is an external store read through `useSyncExternalStore`, not a field on the runtime.
With a dozen participants LiveKit emits audio levels at 10–20 Hz; routing that through context
would re-render the whole tree a hundred times a second. `createMeetingSignalStore()` is exported
so hosts never implement subscribe/getSnapshot themselves.

---

## 3. The four invariants

Everything else is negotiable. These are not.

1. **A `<video>` element is never unmounted while its track exists.** Remounting shows a black
   frame and forces a simulcast renegotiation. This is why mode changes only move a rect, why the
   window lives in a portal and never reparents, and why `inline` mode "teleports by
   measurement" instead of moving the node. Two deliberate exceptions: a tile paged out of the
   grid (§4), and entering or leaving Document Picture-in-Picture (§5), which renders the room into
   a **different document** — a node cannot be moved across documents without remounting, so the
   one black frame there is the price of the window.
2. **Audio lives outside the grid**, one `<audio>` per remote track, in
   `components/audio/MeetingAudioRenderer.tsx`. A muted participant's tile can never double up
   the audio, and layout changes can never interrupt it.
3. **High-frequency signals bypass context** (see above). The leaves subscribe:
   `SpeakingIndicator` and `ConnectionQualityBars` each read the store on their own, so an audio
   burst repaints five `<div>`s instead of the tile, the grid and the control bar.
4. **Layout is absolute rects computed in JS, not CSS grid.** That is what lets tiles animate
   `x/y/width/height`. A FLIP would animate `scale`, and scaling a `<video>` visibly warps it.

---

## 4. Layout

### The grid solver (`layout/grid-solver.ts`)

For each `rows × cols` split, the tile takes **the shape of its own cell**, clamped to
`[TILE_ASPECT_MIN, TILE_ASPECT_MAX]` = `[0.5, 2]`. Inside the range the tile _is_ the cell, so
the block covers the container completely instead of letterboxing a fixed 16:9 box inside every
cell and centring the leftovers.

Cameras render with `object-cover`, so a squarer tile **crops the sides** and a flatter one crops
top and bottom. The range is a trade, and "moderate crop" is the side we chose: the tighter
`[0.6, 16/9]` left a 1280×720 room with three people covering 75% of it and a 600×800 panel with a
hole beside a lone tile. At `[0.5, 2]` a portrait column keeps a third of the camera's width and
a 2:1 tile loses 11% of its height — both still a face — and the same rooms cover 95%+. This is
what Google Meet's Dynamic layouts (March 2025) do: _"a more flexible tile aspect ratio"_,
_"portrait tiles"_, _"optimized tile placement logic to enable much more efficient layouts that
minimize unused space"_.

**Selection is coverage within a tolerance of maximin.** Every split whose smallest tile is at
least `COVERAGE_TOLERANCE` (85%) of the best possible smallest tile is in the pool, and the pool is
decided on total area. Pure maximin — the person in the worst seat decides — picked three stacked
2:1 tiles in a 600×800 panel over two-on-one because its worst tile was a few percent bigger, and
left a fifth of the panel empty; below the tolerance the worst seat really is paying for the
wallpaper, so those splits are out. With adaptive shapes, filling the container well _is_ the
conventional layout, so 2→1×2, 4→2×2, 6→2×3, 9→3×3 and 12→3×4 all fall out of it. Tests lock
those. A shape tie-break survives for genuine ties, by log-distance to 16:9, so the result is
deterministic across a pixel of resize. `grid-fill.contract.test.ts` pins coverage ≥ 85% for
every shipped room shape and count; its three exemptions are floors, not selection.

Rows are sized **independently** so each spans the full width — see §8 for why an incomplete last
row must spread rather than leave the missing cells as a hole.

The grid never lays out more than `GRID_MAX_TILES` (16), whatever the display. Past sixteen the
tiles are a mosaic rather than a room, and a 4K display would otherwise happily seat forty. The
overflow chip is one of the sixteen cells, so a big room shows fifteen faces and "+N", and the
speaker promotion (`layout/speaker-order.ts`) still swaps someone off-page in when they talk. The
whole pipeline — cap, two-pass gap, floors, chip cell, "never +1" — is `planGrid` in
`layout/plan-grid.ts`, pure, so the component and the tests run the same code.

### The escape hatch

`F0MeetingParticipant.preventCrop` letterboxes that person instead of filling. Cropping the sides
is safe for a centred face and **not** safe for someone signing — it takes their hands with it.
Meet ships the same opt-out as _"Show my full video to others"_. Without it, adaptive shapes
would introduce an accessibility regression that a fixed 16:9 did not have.

### Spotlight (`layout/spotlight-solver.ts`)

A camera spotlight takes the shape of its box (clamped). A **screen share takes the whole box**
and letterboxes inside its own tile, so the bands are exactly the part of the picture that is
missing — the room around it is untouched. Cropping a presentation hides content, which is a worse
failure than a band. The bands take the tile's own plate — see §Theme.

A spotlight means **the room is focused on something** — a pin, or a screen share the auto-focus
picked up. It is _not_ a fallback for a big room. It used to be forced whenever the grid could not
seat everyone, and that threw away a perfectly good 16-up grid at thirty people to show one large
tile beside a column of 42px slivers; the grid has its own overflow cell, so fifteen faces and a
"+15" is both the better room and what §Capacity already promised. The one exception is a container
so small the grid cannot seat even two, where a spotlight is the only honest layout.

The strip caps at `STRIP_MAX_TILES` (6). The width floor alone is not a limit: a fullscreen room
seated sixteen thumbnails at 76px across, and a mosaic of smudges tells you less than a number.

The **side** strip (containers past `STRIP_SIDE_ASPECT`) had two faults of its own. Its floor was
checked as `slotHeight * maxAspect >= STRIP_MIN_TILE_WIDTH` — whether a thumbnail _could_ be 72px
wide, which a 299px column can always satisfy — so twenty people got twenty slots 42px tall; it now
requires the thumbnail to FILL the column, which is the rule the bottom strip gets for free from
`STRIP_HEIGHT_MIN`. And it reserved the column budget while centring narrower thumbnails inside it,
leaving 170–450px of unusable void between the spotlight and the strip. The column is now the
thumbnails' actual width, flush to the edge, and the leftover goes to the spotlight.

### Never "+1"

A chip standing for **one** person costs the same slot as that person's tile and tells you less.
Where the strip has a slot, the arithmetic guarantees "+2" or more (the chip takes a thumbnail's
place). Where it has none, there is nothing to give back, so the room drops out of spotlight into
a plain two-up grid.

`SPOTLIGHT_ONLY_WIDTH` is deliberately low (200px) and `STRIP_HEIGHT_MIN` small (48px): a strip
that gives up early is what left a 1:1 call in a floating window showing one huge portrait tile
next to a "+1" standing for the only other person in the call.

### Capacity

`minTileWidthFor` is **container-relative** (`clamp(width/5, 88, 320)`), not a fixed floor. A
fixed floor either fills a fullscreen room with unreadable thumbnails or leaves a small window
able to show two people. Desktop sizes reach `GRID_MAX_TILES` (16); a 360×224 floating window
seats 12 at the 88×48 floors (`grid-capacity.test.ts` pins both through `planGrid`).

> Calibration note: Meet's picture-in-picture shows **4** tiles. We show 12 in the floating
> window. Deliberate, but it is the next density question to revisit.

### The label follows the tile

A 16px name on a 90px thumbnail _is_ the thumbnail. `ParticipantTile` takes its laid-out `width`
and derives everything that scales from it: the font (`labelFontFor`, 11–18px), the chip's insets
and padding (via the `--tile-w` custom property), the avatar size, the meter and the connection
bars. The chip has three regimes: the full name from `LABEL_SHORT_WIDTH` (160px), the first name
alone down to `LABEL_HIDE_WIDTH` (96px) — "You" alone for the local person — and the icon only
below that. The "· Sharing screen" suffix is its own non-shrinking span and needs
`SHARE_SUFFIX_MIN_WIDTH` (320px); the name is what truncates, never the indicator. `compact` is
not a prop: it is `width < COMPACT_TILE_WIDTH`, the same rule for the tile and the overflow chip
beside it, so the two never disagree.

Invariant 1 has one deliberate exception here: a tile paged **out** of the grid — past the cap, or
displaced by the speaker promotion — unmounts its `<video>`, because a video nobody can see is
the one that is not worth a renegotiation.

---

## 5. The surface

### Three modes, one button each

`panel` (the side panel, docked on the **left** of the content — not configurable) · `floating` ·
`fullscreen`, in the window header (`components/chrome/MeetingModeSwitch.tsx`).

The switch is a `role="group"` of plain buttons, deliberately **not** a toggle group. A toggle
group says "pick one of three" and draws all three, including the one you are looking at — a
button that does nothing. This one offers only the _destinations_: the mode you are in is
omitted, and `panel` is offered only where a slot exists (`hasPanelSlot`, registered by the
application frame). Standalone — a story, a test, a host with no frame — `panel` derives to
`floating`, the same rule `inline` has for a slot nobody registered.

`minimized` still exists but has **no button**: it is derived automatically below the `md`
breakpoint, where the switch collapses to a single pill ⇄ fullscreen toggle.

An earlier round implemented OS-style edge snapping instead (pointer zones, dwell, drag preview).
It worked, and it was wrong: it turned a state change into an exercise in aim. Dragging and
resizing survive, but only _within_ floating mode — they are no longer the way into the other
modes.

### Living next to the chat

The call's side panel and the chat's compete for the same slot and may never share it. The rule
lives in one place, `patterns/ApplicationFrame/MeetingPanelPresenter.tsx`, and it is a single
invariant rather than an arbitration:

> The call is in `panel` mode exactly while it owns the panel's content.

The panel already has the semantics for it — one slot, last write wins. The mode becoming
`panel` is the one event that docks the call: the presenter hands `present()` a module-level,
referentially stable element (see `MeetingPanelContent`) and remembers whether the panel was
open. Everything that takes the slot away afterwards — the AI chat opening, a conversation being
presented, the panel being closed with the call still in it — arrives as the same observation,
"the content is no longer ours", and gets the same answer: the call pops out to `floating` rather
than fighting for the space. Hanging up puts the panel back the way it was.

An earlier version enumerated the cases in an effect in `ApplicationFrame/index.tsx` and decided
by "who just arrived". It could not be written as two effects (they fire on the same state and
undo each other), and it turned out not to need writing at all: ownership of the content already
encodes the answer.

So the meeting is **not** exclusive with the chat in general — a huddle floats happily beside an
open conversation — but it _is_ exclusive with it for the panel slot.

### Panel geometry

The panel is a card inset by `PANEL_GAP` (4px, matching the chat's `p-1`) inside the slot the
frame reserves. Crucially it is positioned against the **frame's content area**, not the
viewport, so it lands between the navigation and the content. `ApplicationFrame` publishes that
rect with a `ResizeObserver`; padding lives inside the measured box, so animating it cannot feed
back.

Resizing is live and incremental, like the chat's `ResizeHandle` — deltas committed on every
`mousemove`, not a rect painted to the DOM and committed on release. That needs a flag separate
from `isDragging`, which means "a gesture owns the DOM"; here the rect still comes from React.

### Theme

The surface is light, on `bg-f1-special-page` — the same token as the chat panel it sits flush
against.

Every cell of the room — participant tile and "+N" chip alike — is one plate: `bg-f1-background`
in light, `bg-f1-background-secondary` in dark, with a `border-f1-border-secondary` outline, which
is what separates a tile from the surface now that neither is dark. **The exception is a tile with
no video**: an avatar floating on the light surface reads as a hole in the grid, so in light mode
that tile keeps a dark plate (`bg-f1-foreground`) and the name on it goes light.

**Anything painted on top of video** is the other exception: the name chip takes the dark plate
because it fights arbitrary imagery rather than the theme. When the camera is off there is no
imagery to fight, the chip drops its plate, and the dark tile underneath carries the contrast. The
connection bars use `bg-current` so they inherit whichever of the two the chip is in.

### Picture-in-Picture

What Google Meet does when you switch tab: the call follows you, in an OS-level window that stays
on top of everything, with the grid and the **full `md` control bar** — not a thumbnail with a
mute button. `pip` is a mode in `F0MeetingSurfaceMode` so the header, the announcements and the
action `modes` filter all treat it as one, but it is a place the call _goes_, never one it is
_in_ — and never one you send it to. There is no button; `setMode` and `defaultMode` take an
`F0MeetingSurfaceDestination`, which excludes it; the only caller of `enterPictureInPicture` is the
browser, from the Media Session action below, from whatever mode the call is in. The user's chosen
`mode` is untouched while the window is open; `effectiveMode` is `pip` exactly while `pipWindow`
exists, so closing the window falls straight back to whatever the user had — including `panel`,
which the frame's presenter re-docks (it ignores the loss of the panel slot while
`effectiveMode === "pip"`, or it would treat the call leaving as an eviction and send it to
`floating`).

**Mechanics** (`window/usePictureInPicture.ts`, `window/PipFrame.tsx`). `enterPictureInPicture`
calls `documentPictureInPicture.requestWindow({ width, height })` at `WINDOW_DEFAULT_WIDTH ×
WINDOW_DEFAULT_HEIGHT`, then dresses the empty document: every stylesheet's `cssRules` copied into
a `<style>` (a cross-origin sheet throws on `cssRules` and is linked instead), and `lang`, `dir`,
the root's `class` (`dark` lives there — `darkMode: "class"`) and `data-*` attributes mirrored.
The surface then `createPortal`s a `PipFrame` into `pipWindow.document.body`: a title bar with the
room's name, the timer and one "back to the tab" button, and `F0MeetingRoom` under a
`MeetingDensityProvider` fed from the window's own `innerWidth/innerHeight`. `pagehide` on the PiP
window is the one event it fires on the way out, whether the user closed it or we did; the surface
unmounting (the call ended) closes it, so no empty window is left behind.

**Two things stay in the tab.** The `<audio>` elements — `MeetingAudioRenderer` moved out of
`F0MeetingRoom` into the surface's body-level portal for exactly this, because a media element
moved to another document stops, and the panel renders the room too so it had to be one instance
regardless of mode — and the live region. The `<video>` elements do move, and remount: see
invariant 1.

**Overlays.** Radix portals to `document.body` — the main document's. The device picker or a
tooltip opened from the PiP window would appear back in the tab. `lib/portal-container.tsx` is a
context the `ui` primitives (`dropdown-menu`, `popover`, `tooltip`) read as their default
`container`; `PipFrame` provides the PiP body. Additive: with no provider nothing changes, and an
explicit `container` prop still wins. The overflow menu goes through
`experimental/Navigation/Dropdown`, which forwards `container` only when given, so the default
covers it.

**The only way in** (`window/useMediaSessionPip.ts`). While `status === "connected"` the surface
registers Media Session handlers: `togglemicrophone`, `togglecamera`, `hangup` → the runtime, and
— unless the host set `pictureInPicture={false}` or the browser has neither PiP API —
`enterpictureinpicture` → `enterPictureInPicture`, which is what lets Chromium move the call by
itself when the tab is left and bring it back when the tab is. The handler runs with a user
activation, so it opens the Document window where there is one and floats a `<video>` where there
is not. `setMicrophoneActive`/`setCameraActive` follow the local media. Every call is in
`try/catch`: older Chromes throw on an action they do not know. All handlers are cleared on
disconnect. Whether Chromium fires the action at all is its own policy: the page has to be
capturing a camera or a microphone, and the user can turn automatic picture-in-picture off per
site.

**Fallback matrix.**

| Browser                         | `pipSupport` | What `enterPictureInPicture` does                                                                                                                                                     |
| ------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chromium ≥ 116                  | `document`   | The window above, with the whole room                                                                                                                                                 |
| Firefox, Safari, older Chromium | `video`      | `requestPictureInPicture()` on ONE `<video>` — the pinned tile, else the speaker, else the first remote camera — the room stays in the tab; the browser's own overlay is the way back |
| Neither                         | `none`       | Nothing: no `enterpictureinpicture` handler is registered                                                                                                                             |

`TileVideo` registers its element with the surface by tile key (`registerVideo`) so the fallback
has something to hand to the browser. `pictureInPicture={false}` on the host makes every browser
`none`.

---

## 6. Mapping onto LiveKit

Verified against `livekit-client` 2.17.0 and `factorial/frontend/src/modules/meetings`.

The core pattern is already in production: `VideoTrack/index.tsx:65-77` does
`track.attach(el)` / `track.detach(el)`, which is `F0MeetingBinding` exactly.

| F0                             | LiveKit                                                | Note                   |
| ------------------------------ | ------------------------------------------------------ | ---------------------- |
| `F0MeetingBinding`             | `track.attach()` / `detach()`                          | already in use         |
| `bindingKey`                   | `` `${publication.trackSid}:${track.mediaStreamID}` `` | both exist             |
| `muted` / `live`               | `publication.isMuted` / `isSubscribed`                 |                        |
| `width` / `height`             | `publication.dimensions`                               |                        |
| `participant.id`               | `Participant.identity`                                 | **is the employee id** |
| `name` / `avatar`              | resolved by the adapter from the meeting's attendees   | see below              |
| `isAgent`                      | `Participant.kind === ParticipantKind.AGENT`           |                        |
| `signals`                      | `audioLevel`, `isSpeaking`, `ConnectionQuality`        |                        |
| `status` / `disconnectReason`  | `Room.state`, `DisconnectReason`                       |                        |
| `audioBlocked` / `unlockAudio` | `room.canPlaybackAudio` / `room.startAudio()`          |                        |
| mic / camera / screen          | `localParticipant.set*Enabled()`                       | already in use         |
| devices                        | `Room.getLocalDevices()`                               | already in use         |
| reactions / raise hand         | data channel — `canPublishData` grant is already there |                        |
| room audio                     | `RoomAudioRenderer` ≙ `MeetingAudioRenderer`           |                        |

**`Participant.name` is useless.** The backend sets `token.name = identity`
(`LivekitService#create_token`), so it is the employee id. Names and avatars come from the
meeting's attendees, which is what the current tile already does.

**Adaptive stream gets better, not worse.** The room already runs `adaptiveStream: true,
dynacast: true`. Because F0 renders **no `<video>` at all** for anyone in the "+N" chip, those
tracks have no attached element and LiveKit pauses them by itself. The manual
`IntersectionObserver` subscription management in `VideoTrack/index.tsx:94-114` should **not** be
ported — it would fight a layout that already knows who is visible.

**Animating tile size does not thrash the encoder.** `RemoteVideoTrack` observes the element with
a `ResizeObserver` debounced at 100ms (`REACTION_DELAY`). Tile transitions run 220–300ms, so a
relayout costs one or two layer re-evaluations, not one per frame.

### What the adapter still needs from the backend

| #   | Gap                         | Impact                                                                                         | Fix                                                                                                                                                                                                               |
| --- | --------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Token TTL is 10 minutes** | **High** — a reconnect later in a call fails, because LiveKit needs a valid token to reconnect | Raise the TTL to the meeting duration, or have `reconnect()` refetch `getOrCreateMeetingsRoom`                                                                                                                    |
| 2   | `muteParticipant`           | Medium                                                                                         | `LivekitService#mute_microphone` **already exists**; expose it over GraphQL. The client token has no `roomAdmin`, and should not get one                                                                          |
| 3   | `preventCrop`               | Medium                                                                                         | Participant attributes is the natural home, but `setAttributes()` needs the `canUpdateOwnMetadata` grant, which the token lacks. Alternative with no backend work: an employee preference resolved by the adapter |
| 4   | `removeParticipant`         | Low                                                                                            | No backend method. Optional in the contract — omit it and the action disappears                                                                                                                                   |
| 5   | Recording                   | Low                                                                                            | No Egress at all. Optional in the contract — omit it and the button does not exist                                                                                                                                |

Only #1 blocks production. #4 and #5 are precisely the case the "optional callback = capability"
rule exists for.

---

## 7. Huddles: the call as a fact of the conversation

Scope so far: **1:1 in DMs**. A call is one item in the chat transcript
(`F0ChatCallMessage`) that MUTATES through `ringing → live → ended`, or lands on `missed`. One
call, one line in the history — not a live card plus a log line afterwards.

The chat renders it as a compact `F0MeetingCard`, natively rather than through a host render-prop:
the transcript is virtualized and a node of unknown height injected by the host is exactly what
throws off Virtuoso's measurements.

Starting a call needs **nothing** from the chat contract. The header action is host-provided and
`F0ChatHeaderAction.channelTypes` already restricts it to `["dm"]`, so F0Chat still knows nothing
about meetings.

### Two chats, not one

This is the thing to get right, and the easy mistake to make.

|                     | Transport                                          | Lifetime           | Carries                              |
| ------------------- | -------------------------------------------------- | ------------------ | ------------------------------------ |
| **The call's chat** | LiveKit data channels (`useChat`, topic `lk.chat`) | dies with the room | what is said _during_ the call       |
| **The huddle card** | a GetStream message in the DM                      | permanent          | how you find out, and how you get in |

They are not alternatives. The call's chat is the one in the room's side panel; LiveKit's own
documentation is explicit that "message history is not persisted and will be lost if the component
is refreshed". The card is the durable half, and it is what puts the call in the conversation's
history.

Wiring the panel's chat tab to the DM would quietly promise that what you type during a call
survives it. It does not — and factorial's existing room already does this correctly
(`modules/meetings/components/Chat/index.tsx` uses LiveKit's `useChat`).

`MeetingRoomChat` is deliberately plainer than `F0Chat`: no reactions, no threads, no receipts, no
history. Rendering the full conversation surface over a transport that has none of those would
promise all of them.

### The two transports, and who owns what

GetStream carries the _fact_ that a call exists and its state, because it already fans messages
out to both sides over its websocket. LiveKit carries the call itself and, crucially, **dictates
the state**.

```
you press call
  │
  ├─→ startHuddle(channelId)
  │     backend: 1. LiveKit room `huddle_<channelId>` + token
  │              2. Stream message upsert, f0_call_state: ringing
  │              3. returns { serverUrl, token, roomName, messageId }
  │
  ├─→ the frontend mounts F0Meeting with the LiveKit adapter
  │
  └─→ Stream's websocket delivers the message to BOTH sides
        → the mapper turns it into F0ChatCallMessage → card with Join
        → they press Join → same (idempotent) mutation → token → they enter

LiveKit webhooks → backend → PATCH the same Stream message:
  participant_joined → state: live, participants
  participant_left   → participants
  room_finished      → state: ended (or missed) + duration
```

**The state comes from LiveKit's webhooks, not from the caller's browser.** If that tab dies,
`room_finished` still arrives and the card settles on `ended`. The other way round, cards stay
stuck on "in progress" forever — the classic failure of this pattern.

### What already fits

- **`upsert_system_message`** (`providers/base.rb:152`), implemented with
  `update_message_partial` (`stream/provider.rb:235`). The _upsert_ already exists to rewrite an
  existing message — it is how membership bursts coalesce — which is exactly the path a card
  mutating in place needs.
- **The `f0_*` convention**: custom fields ride untyped on the Stream message and the mapper
  reads them (`streamChatMappers/index.ts:409`). A call adds `f0_call_state`,
  `f0_call_started_at`, `f0_call_participants`.
- **`Providers::SystemEvent`** is provider-agnostic (`system_event.rb`): it gains `CallStarted`
  and `CallUpdated`, and no Stream-specific name leaves the provider.
- **Participant domain events already exist** (`meetings/events/participants/{joined,left}.rb`).
  Communications can consume them the way it already consumes membership events, so Meetings never
  has to know Communications exists.

### What is still missing

| #   | Gap                                      | Why                                                                                                                                                                                                        |
| --- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6   | **A room without a `Meetings::Meeting`** | `Rooms#get_or_create` requires a `meeting_id` **and** an `Attendee` (`repositories/rooms.rb:12-25`). A DM huddle has neither: it needs a `huddle_<channelId>` path authorized by Stream channel membership |
| 7   | Somewhere to put the call state          | `SystemMessage` is a `T::Struct` with `members`/`remaining_count` and nothing else. Either it gains optional fields, or a sibling `CallMessage` appears                                                    |
| 8   | The webhook consumer                     | The DTO exists (`dtos/webhooks/livekit.rb`) but nothing translates `room_finished` into a patch of the Stream message. This is the piece the paragraph above rests on                                      |
| 9   | Idempotency of `startHuddle`             | Two people pressing at once must not create two messages or two rooms. Natural key: a message id derived from the channel plus the room                                                                    |

**Gap #1 (the 10-minute token TTL) escalates from "worth fixing" to blocking here**: the receiver
asks for their token minutes after the caller did, so joining a call that has been running for a
while fails outright.

### What the mock does, and what it deliberately does not

`patterns/ApplicationFrame/mocks/useMockHuddle.ts` drives both directions. It lives in the frame
rather than in either mock package because the frame is what a real host is: the only thing that
sees both worlds. The chat mock knows nothing about rooms and the meeting mock knows nothing about
conversations — the same separation the production adapters will have.

Two details worth keeping if this is ever rewritten:

- The other side enters through `drivers.join(...)`, **not** by growing the seed. The mock reads
  its roster only when the room id changes, so a growing seed updates the card and leaves the room
  empty. Going through the driver is also the path a real `participant_joined` takes.
- `startedBy` is derived from the call's DIRECTION, never from its phase. Reading the phase made
  an incoming call claim you had started it the moment you answered.

There is **no ringing UI**: no sound, no timeout, no accept/decline surface. The receiving side is
the card in the conversation and nothing else, which is what Slack does. The WhatsApp model would
be a surface of its own.

---

## 8. Presence, focus and the panel

Three things the design round added, each of which fixed something real.

### Presence: people who have not arrived

`F0MeetingParticipant.presence` is `"invited" | "joined"`, absent meaning joined. An `invited`
person holds a tile that reads "Waiting…", publishes nothing, and does **not** count toward "N
people in the call". LiveKit does not know them — they come from the host's own attendee list,
which is why this cannot be derived from the transport.

They are excluded from the spotlight rule below: blowing an empty "waiting" plate up to fill the
room while the person who IS there sits in a thumbnail is exactly what a ringing call must not
look like.

### Focus is an intent, not a key

```ts
type F0MeetingFocusIntent =
  | { type: "auto" } // F0 decides
  | { type: "pinned"; key: string } // the user pinned someone
  | { type: "none" } // the user dismissed the spotlight
```

A plain `string | null` cannot tell "nobody has pinned anything" apart from "the user dismissed
it". In a one-to-one the auto rule spotlights the remote person, so clearing the pin fell straight
back into it and re-focused them in the same render — **the pin button was a no-op**. The three
states make dismissal expressible. A freshly started screen share still overrides `none`: that is
an event, not a preference.

### The grid fills the container

Rows are distributed as evenly as possible and **each row spans the full width on its own**, so an
incomplete last row spreads its tiles rather than leaving the missing cells as a hole. Three people
fill the room; they do not sit beside an empty square.

The aspect clamp is the one thing allowed to leave space. Where filling completely would need a
tile flatter than `TILE_ASPECT_MAX`, the row widens as far as the clamp allows and the remainder is
centred — the alternative is `object-cover` taking the sides off someone's face.

Whether the room needs a spotlight is decided by **focus**, not by head count: a pin or a screen
share. The old `SPOTLIGHT_ASPECT` constant guessed from the container's shape and forced a
two-person call in a side panel into a spotlight; the version after it forced one on any room the
grid could not seat whole, which was worse in the other direction. See §Spotlight.

The floor is checked **inside** the search, not after it. Picking the largest-area split and then
rejecting it for being too small is what pushed people into the chip who fit perfectly well: at
1912x852 sixteen people have a clean 4x4 at 358px, but 6+5+5 wins on area at 305px, fails the 320px
floor, and took the whole count down with it — so the room showed fourteen and a "+2". It also made
capacity non-monotonic, twenty people fitting in a room that could not seat sixteen.

The floor has a **height** as well as a width (`minTileHeightFor`). A width-only floor let a tall
narrow panel stack 45 tiles of 97x55 — a 16:9 tile 97 across _is_ 55 tall, so every one of them
passed. Its ceiling is lower than the width's (180 vs 320) because a room is usually wider than it
is tall, and matching them would make height the only constraint that ever bites.

### The side panel

`sidePanel` is `{ tabs, defaultTabId }` rather than a bare `ReactNode`: F0 owns whether the panel
is open, because the button that opens it lives in F0's own control bar and needs the tab labels
and the unread badge. Only the selected tab is mounted — a virtualized transcript measured inside
a `display:none` subtree yields zero heights it then has to correct on reveal.

It is fullscreen-only. At `SIDE_PANEL_WIDTH` (420px, `components/panel/constants.ts`) it would
leave the video a sliver anywhere else, so `core:chat` carries `modes: ["fullscreen"]` and the
control and the surface agree. Tailwind cannot read a number, so the width class is spelled out
next to the constant and the two must agree.

The panel's `aria-label` is the **active tab's** label, not "Chat": someone landing on the notes
with a screen reader should not be told they are in the chat. The unread `badge` never rides on
the tab itself (`TabItem` has no badge) — it is summed onto the `core:chat` button, which is the
only place it matters, since a badge means something arrived _while the panel was closed_.

### What the live region says

One polite `aria-live` region for the whole call (`components/chrome/MeetingLiveRegion.tsx`),
mounted once in the portal so it survives every mode. It throttles to one message per two seconds
and coalesces a burst to the **last** message: a busy call produces joins, leaves and window moves
in bursts, and reading every one aloud makes the room unusable with a screen reader.

What feeds it (`providers/useRosterAnnouncements.ts`): who joined, who left, and where the call
went (`meeting.participantJoined` / `participantLeft` / `movedTo*`). Only the differences — nobody
is read the roster of the room they walked into — never the local participant, and someone still
`invited` is neither a join now nor a leave when the host drops them; arriving is the join. Window
moves come from `FloatingWindow` itself (`movedToCorner`).

---

## 9. Open decisions

- **Fullscreen and the banner.** Undecided whether fullscreen should cover the app banner or sit
  below it. The frame's content rect is already wired, so it is a one-line change once decided.
- **Density vs Meet.** They show 4 tiles in PiP; we show 9 in the floating window.
- **`PanelLeft` icon.** The generated icon set has no side-panel glyph, so the panel mode uses
  `Kanban` (two columns) as the closest shape. Icons come from `@factorialco/f0-core/assets` and
  `generate-icons` wipes the directory, so this needs a design request, not a local file.
- **Performance spike, still open.** The cost of animating `width`/`height` with ~25 live
  `<video>` elements has not been measured. Adaptive shapes make it slightly more relevant, since
  tiles now change proportion as well as size.
- **Recording consent.** Who owns the legal copy, and whether F0 should block the room until it
  is acknowledged. `F0MeetingRecording.consentNotice` exists but nothing enforces it.
- **Declared, not rendered yet.** These are in `types.ts` (and some in the LiveKit table above),
  a host can fill them in today, and nothing in the room reads them. They stay in the contract on
  purpose — removing them would make every adapter change twice — but do not assume they show:
  - `F0MeetingParticipant.subtitle`, `isAgent`, `isConnecting`. The tile shows name, mute state,
    share state and connection quality, nothing else.
  - `F0MeetingParticipant.raisedHandAt`. Your own `core:raiseHand` toggle reads it for its
    pressed state; nobody else's hand is shown anywhere, and `meeting.handRaised` has no reader.
  - `F0MeetingRoomInfo.origin`. The header has no "back to where this came from" link.
  - **Reactions**: `sendReaction` / `reactions`. `hasReactions` is computed and unused; there is
    no picker and nothing animates.
  - **Recording control**: `startRecording` / `stopRecording` / `capabilities.canRecord`. The
    recording _state_ renders (`RecordingBanner`, with `consentNotice`); the _control_ does not
    exist.
  - **Moderation**: `muteParticipant` / `removeParticipant` and `canMuteOthers` /
    `canRemoveParticipants` / `canModerate`. `hasModeration` is computed and unused; tiles have no
    moderation menu.
  - `disconnectReason`. The end state has one copy for every reason.
- **One call at a time.** The surface assumes a single active meeting. Nothing enforces it, and
  per-DM huddles make it easy to trigger: calling from a second DM should ask before dropping the
  first.
- **Picture-in-picture, what is left.** Built (§5) and entered by hand in Chromium from factorial.
  Two things that testing found: the grid and the bar measured themselves with the OPENER's
  `ResizeObserver` and `requestAnimationFrame`, which never report an element of the PiP document
  and are paused while the tab is hidden, so the window drew its controls over an empty room —
  `useMeasuredBox` now takes both from the element's own window; and hanging up from the window
  left it open, so the surface closes it and focuses the tab when the status goes terminal.
  Still unverified: Radix's focus handling with a menu open in the PiP document, and whether
  Chromium fires `enterpictureinpicture` for a huddle whose microphone track is stopped on mute
  (LiveKit's default) — the auto-PiP policy wants live capture.
- **Huddles in groups.** The contract does not prevent it (`participants` is an array), but "who
  is in the call" in a group of twenty is a different design problem.
- **A crossed ownership boundary.** `F0Chat` (platform-ai-building-blocks) renders
  `F0MeetingCard` (experimental). The alternative — a host render-prop — avoids the crossing at
  the cost of an unknown-height row inside a virtualized transcript. Worth a decision from both
  owners rather than leaving it implicit.
