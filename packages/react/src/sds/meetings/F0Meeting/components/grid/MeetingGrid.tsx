import { AnimatePresence, motion } from "motion/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useReducedMotion } from "@/lib/a11y"
import { resolveAutoFocus } from "../../layout/auto-focus"
import {
  SPEAKER_PROMOTION_HOLD_MS,
  TILE_ASPECT_MAX,
  TILE_ASPECT_MIN,
  gapFor,
  gapForTile,
  radiusForTile,
} from "../../layout/constants"
import { cornerChipRect, type GridPlan, planGrid } from "../../layout/plan-grid"
import { reorderForSpeakers } from "../../layout/speaker-order"
import {
  type SpotlightSolution,
  solveSpotlight,
} from "../../layout/spotlight-solver"
import { buildTiles, type F0MeetingTile } from "../../layout/tiles"
import { useMeasuredBox } from "../../layout/useMeasuredBox"
import { useF0MeetingRoster } from "../../providers/F0MeetingProvider"
import { useMeetingSurface } from "../../providers/MeetingSurfaceProvider"
import { useMeetingSpeakers } from "../../providers/useMeetingSignal"
import { type F0Rect } from "../../types"
import {
  tileEnterTransition,
  tileExitTransition,
  tileTransition,
} from "../../utils/meeting-motion"
import { OverflowTile } from "./OverflowTile"
import { ParticipantTile } from "./ParticipantTile"

type PlacedTile = {
  tile: F0MeetingTile
  rect: F0Rect
  /** Corner radius in px, scaled to this tile's own width. */
  radius: number
}

type GridLayout = {
  placed: PlacedTile[]
  overflow: F0MeetingTile[]
  overflowRect: F0Rect | null
  /** Matched to whatever the chip ends up sitting next to. */
  overflowRadius: number
  focusKey: string | null
}

const EMPTY_LAYOUT: GridLayout = {
  placed: [],
  overflow: [],
  overflowRect: null,
  overflowRadius: 0,
  focusKey: null,
}

/** When the last speaker spoke, and the clock it was read against. */
type SpeakerEpoch = {
  now: number
  lastSpokenAt: Readonly<Record<string, number>>
}

const INITIAL_EPOCH: SpeakerEpoch = { now: 0, lastSpokenAt: {} }

const sameKeys = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((key) => b.has(key))

/**
 * Lays the room out with absolute rects computed in JS rather than CSS grid.
 * That is what lets tiles animate between layouts by x/y/width/height — a FLIP
 * would animate `scale`, and scaling a `<video>` visibly warps its content.
 *
 * The grid itself is `planGrid`, pure and tested on its own. What lives here
 * is WHO goes where: the spotlight, the focus and the speaker order.
 */
export const MeetingGrid = () => {
  const { participants } = useF0MeetingRoster()
  const speakers = useMeetingSpeakers()
  const { focusIntent, setFocusIntent, isDragging } = useMeetingSurface()
  const shouldReduceMotion = useReducedMotion()
  const [containerRef, box] = useMeasuredBox<HTMLDivElement>()

  const tiles = useMemo(() => buildTiles(participants), [participants])

  // State, not a ref written during render: the resolve below is then a pure
  // function of what it reads, and React may replay a render without the set
  // drifting under it.
  const [seenShareKeys, setSeenShareKeys] = useState<ReadonlySet<string>>(
    () => new Set()
  )

  const focus = useMemo(
    () => resolveAutoFocus({ tiles, intent: focusIntent, seenShareKeys }),
    [tiles, focusIntent, seenShareKeys]
  )

  useEffect(() => {
    // A share the resolve has just focused is an EVENT, and the surface's
    // intent is where events land: as a pin it survives the roster changing
    // under it — before, anyone toggling their mic rebuilt the tiles and the
    // share silently dropped back into the grid.
    const key = focus.focusKey
    const freshShare =
      key !== null && !seenShareKeys.has(key) && focus.seenShareKeys.has(key)
    if (freshShare) {
      setFocusIntent({ type: "pinned", key })
    }
    if (!sameKeys(focus.seenShareKeys, seenShareKeys)) {
      setSeenShareKeys(focus.seenShareKeys)
    }
  }, [focus, seenShareKeys, setFocusIntent])

  useEffect(() => {
    if (focus.clearIntent) {
      setFocusIntent({ type: "auto" })
    }
  }, [focus.clearIntent, setFocusIntent])

  // Read through a ref so the handler is stable: every tile receives it, and a
  // new function on each focus change re-rendered the whole room.
  const focusKeyRef = useRef(focus.focusKey)
  useEffect(() => {
    focusKeyRef.current = focus.focusKey
  }, [focus.focusKey])

  const handleToggleFocus = useCallback(
    (key: string) => {
      // Un-focusing has to be expressible, not just "stop pinning": in a
      // one-to-one the auto rule would re-focus the same person immediately,
      // which is what made this button a no-op.
      setFocusIntent(
        focusKeyRef.current === key ? { type: "none" } : { type: "pinned", key }
      )
    },
    [setFocusIntent]
  )

  // The clock lives in state so the order below is a pure memo: `Date.now()`
  // inside it made the layout depend on when it happened to run.
  const [speakerEpoch, setSpeakerEpoch] = useState<SpeakerEpoch>(INITIAL_EPOCH)
  useEffect(() => {
    if (speakers.length === 0) {
      return
    }
    const now = Date.now()
    setSpeakerEpoch((previous) => {
      const lastSpokenAt = { ...previous.lastSpokenAt }
      for (const id of speakers) {
        lastSpokenAt[id] = now
      }
      return { now, lastSpokenAt }
    })
  }, [speakers])

  const plan = useMemo<GridPlan | null>(
    () =>
      box.width > 0 && box.height > 0 && tiles.length > 0
        ? planGrid({ box, tileCount: tiles.length })
        : null,
    [box, tiles.length]
  )

  const spotlightLayout = useMemo<GridLayout | null>(() => {
    if (!plan) {
      return null
    }

    // A spotlight is for something the room is FOCUSED on — a pin, or a screen
    // share the auto-focus picked up. It used to be forced whenever the grid
    // could not seat everyone, and that is the bug behind "with lots of people
    // the tiles float around in odd places": a 30-person room threw away a
    // perfectly good 16-up grid to show one big tile beside a column of 42px
    // slivers. The grid has its own overflow cell, so 15 faces plus a "+15"
    // chip is both the better room and what §Capacity already describes.
    //
    // The exception is a container so small the grid cannot seat even two. There
    // a spotlight is the only honest layout, and it is what keeps the room from
    // rendering nothing but a chip.
    const forcedByFit = plan.capacity <= 1 && tiles.length > 1
    const speakingTile = forcedByFit
      ? tiles.find(
          (tile) =>
            tile.kind === "camera" && speakers.includes(tile.participant.id)
        )
      : undefined

    const focusKey =
      focus.focusKey ??
      (forcedByFit ? ((speakingTile ?? tiles[0])?.key ?? null) : null)
    const spotlight = focusKey
      ? tiles.find((tile) => tile.key === focusKey)
      : undefined
    if (!spotlight || !focusKey) {
      return null
    }

    const rest = tiles.filter((tile) => tile.key !== spotlight.key)
    const solveWith = (gap: number): SpotlightSolution =>
      solveSpotlight({
        stripCount: rest.length,
        width: box.width,
        height: box.height,
        gap,
        // The thumbnails take the shape of their own slot, exactly like the
        // grid's tiles: nearly square in a wide room, portrait in a side
        // panel. Pinning them to 16:9 was what left bands above and below
        // them in the panel while the strip claimed the full height.
        stripRange: { min: TILE_ASPECT_MIN, max: TILE_ASPECT_MAX },
        // A camera takes the shape of its box; a screen share fills the box
        // and letterboxes inside its own tile, so only the missing part of
        // the picture goes black.
        spotlightRange:
          spotlight.kind === "screenShare" || spotlight.participant.preventCrop
            ? undefined
            : { min: TILE_ASPECT_MIN, max: TILE_ASPECT_MAX },
      })

    // Two passes, like the grid: the gap follows the smallest tile in the
    // layout, which here is a thumbnail — not the tile of a grid solve the
    // room is about to discard.
    const provisionalGap = gapFor(box.width)
    const provisional = solveWith(provisionalGap)
    const gap = gapForTile(
      provisional.strip[0]?.width ?? provisional.spotlight.width
    )
    const solution = gap === provisionalGap ? provisional : solveWith(gap)

    // A chip standing for ONE person costs the same slot as that person's tile
    // and tells you less, so it never earns its place. Where the strip has a
    // slot the arithmetic below already guarantees at least "+2"; where it has
    // none there is nothing to give back, and the room is better off as a plain
    // two-up grid than as one huge tile beside a "+1".
    if (solution.strip.length === 0 && rest.length === 1) {
      return null
    }

    // The chip needs a cell of its own, so when the strip is full it takes
    // the last thumbnail's place instead of being appended past the edge.
    const hasOverflow = solution.stripOverflow > 0
    const stripSlots = hasOverflow
      ? Math.max(0, solution.strip.length - 1)
      : solution.strip.length

    const placed: PlacedTile[] = [
      {
        tile: spotlight,
        rect: solution.spotlight,
        radius: radiusForTile(solution.spotlight.width),
      },
    ]
    solution.strip.slice(0, stripSlots).forEach((rect, index) => {
      const tile = rest[index]
      if (tile) {
        // From each tile's OWN width, so the strip's thumbnails are rounded
        // to their size and not to the spotlight's.
        placed.push({ tile, rect, radius: radiusForTile(rect.width) })
      }
    })

    // Too narrow for a strip at all: the chip sits in the corner of the
    // spotlight rather than vanishing with the people it represents.
    const overflowRect = hasOverflow
      ? (solution.strip[stripSlots] ?? cornerChipRect(box, gap))
      : null

    return {
      placed,
      overflow: rest.slice(stripSlots),
      overflowRect,
      // From its own width, like the thumbnail whose slot it took — so it is
      // rounded exactly like the ones beside it.
      overflowRadius: radiusForTile(overflowRect?.width ?? 0),
      focusKey,
    }
  }, [plan, box, tiles, speakers, focus.focusKey])

  const pageSize = plan?.visibleCount ?? tiles.length
  const ordered = useMemo(
    () =>
      reorderForSpeakers({
        tiles,
        speakerIds: speakers,
        pageSize,
        lastSpokenAt: speakerEpoch.lastSpokenAt,
        now: speakerEpoch.now,
        holdMs: SPEAKER_PROMOTION_HOLD_MS,
      }),
    [tiles, speakers, pageSize, speakerEpoch]
  )

  const layout = useMemo<GridLayout>(() => {
    if (!plan) {
      return EMPTY_LAYOUT
    }
    if (spotlightLayout) {
      return spotlightLayout
    }

    const placed: PlacedTile[] = []
    plan.rects.forEach((rect, index) => {
      const tile = ordered[index]
      if (tile) {
        placed.push({ tile, rect, radius: plan.radius })
      }
    })

    return {
      placed,
      overflow: ordered.slice(plan.visibleCount),
      overflowRect: plan.chipRect,
      // The chip is one of these cells, so it takes the tiles' radius rather
      // than deriving its own: same number, by construction.
      overflowRadius: plan.radius,
      focusKey: null,
    }
  }, [plan, spotlightLayout, ordered])

  // While the window is being dragged the surface writes its transform straight
  // to the DOM; tiles easing towards rects that are already stale would trail
  // behind it.
  const instant = shouldReduceMotion || isDragging
  const transition = instant ? { duration: 0 } : tileTransition

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full"
      data-testid="meeting-grid"
    >
      <AnimatePresence initial={false}>
        {layout.placed.map(({ tile, rect, radius }) => (
          <motion.div
            key={tile.key}
            className="absolute left-0 top-0"
            initial={{
              opacity: 0,
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            }}
            animate={{
              opacity: 1,
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            }}
            exit={{
              opacity: 0,
              transition: instant ? { duration: 0 } : tileExitTransition,
            }}
            transition={{
              ...transition,
              opacity: instant ? { duration: 0 } : tileEnterTransition,
            }}
          >
            <ParticipantTile
              tile={tile}
              width={rect.width}
              radius={radius}
              isFocused={layout.focusKey === tile.key}
              canFocus={tiles.length > 1}
              onToggleFocus={handleToggleFocus}
            />
          </motion.div>
        ))}

        {layout.overflowRect && layout.overflow.length > 0 ? (
          <motion.div
            key="meeting-overflow"
            className="absolute left-0 top-0"
            initial={{ opacity: 0 }}
            animate={{
              opacity: 1,
              x: layout.overflowRect.x,
              y: layout.overflowRect.y,
              width: layout.overflowRect.width,
              height: layout.overflowRect.height,
            }}
            exit={{ opacity: 0 }}
            transition={transition}
          >
            <OverflowTile
              tiles={layout.overflow}
              width={layout.overflowRect.width}
              radius={layout.overflowRadius}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
