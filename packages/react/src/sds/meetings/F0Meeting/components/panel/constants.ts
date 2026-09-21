/**
 * Width of the in-call side panel, in px.
 *
 * It is why the panel is fullscreen-only: beside the grid in a floating window
 * or a docked panel it would leave the video a sliver, so `core:chat`
 * (`useSynthesizedActions`) and `F0MeetingRoom` both gate on fullscreen.
 *
 * Tailwind cannot read a number, so the class is spelled out next to it. The
 * two must agree.
 */
export const SIDE_PANEL_WIDTH = 420

export const SIDE_PANEL_WIDTH_CLASS = "w-[420px]"
