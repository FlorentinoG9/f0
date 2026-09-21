import { useEffect, useMemo, useRef } from "react"
import { F0Button } from "@/components/F0Button"
import { Cross } from "@/icons/app"
import { useI18n } from "@/lib/providers/i18n"
import { cn } from "@/lib/utils"
import { Tabs, type TabItem } from "@/patterns/Navigation/Tabs"
import { useMeetingSurface } from "../../providers/MeetingSurfaceProvider"
import { type F0MeetingSidePanel } from "../../types"
import { SIDE_PANEL_WIDTH_CLASS } from "./constants"

export type MeetingSidePanelProps = {
  panel: F0MeetingSidePanel
}

/**
 * The in-call panel: chat, transcript and notes beside the grid.
 *
 * F0 owns the bar, the selection and the close button because the control that
 * opens the panel lives in F0's own action bar and needs the tab labels and
 * unread counts. What goes inside each tab is entirely the host's.
 *
 * Only one tab is mounted at a time. That is deliberate for the chat tab in
 * particular: its transcript is virtualized, and measuring rows inside a
 * display:none subtree yields zero heights that the list then has to correct
 * on reveal.
 */
export const MeetingSidePanel = ({ panel }: MeetingSidePanelProps) => {
  const i18n = useI18n()
  const { isSidePanelOpen, setSidePanelOpen, activeTabId, setActiveTabId } =
    useMeetingSurface()
  const closeRef = useRef<HTMLButtonElement>(null)

  const tabs = panel.tabs
  const activeId =
    tabs.find((tab) => tab.id === activeTabId)?.id ??
    panel.defaultTabId ??
    tabs[0]?.id

  const active = useMemo(
    () => tabs.find((tab) => tab.id === activeId),
    [tabs, activeId]
  )

  /**
   * `TabItem` has no badge field, so an unread count cannot ride on the tab.
   * It is not lost: `core:chat` in the control bar sums `tab.badge` and shows
   * it there — which is the only place it matters, since a badge is the signal
   * that something arrived WHILE THE PANEL WAS CLOSED.
   */
  const tabItems = useMemo<TabItem[]>(
    () => tabs.map((tab) => ({ id: tab.id, label: tab.label })),
    [tabs]
  )

  // Opening a panel that nothing focuses leaves the keyboard where it was, on
  // a control that is now behind an overlay.
  useEffect(() => {
    if (isSidePanelOpen) {
      closeRef.current?.focus()
    }
  }, [isSidePanelOpen])

  if (!isSidePanelOpen || tabs.length === 0) {
    return null
  }

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col overflow-hidden rounded-xl border border-solid border-f1-border-secondary bg-f1-background pt-2",
        SIDE_PANEL_WIDTH_CLASS
      )}
      // Named after what is in it, so "Chat" is not read out over the notes.
      aria-label={active?.label ?? i18n.meeting.chatPanel}
      data-testid="meeting-side-panel"
    >
      <div className="flex shrink-0 items-center">
        <Tabs
          tabs={tabItems}
          activeTabId={activeId}
          setActiveTabId={setActiveTabId}
        />

        {/* The same bottom rule the tabs draw under themselves, continued to
            the edge so the close button sits on the tab bar rather than beside
            it. */}
        <div className="flex h-[48px] flex-grow items-center justify-end border-0 border-b border-solid border-f1-border-secondary pb-2 pr-3">
          <F0Button
            ref={closeRef}
            variant="outline"
            size="md"
            hideLabel
            icon={Cross}
            label={i18n.meeting.closePanel}
            onClick={() => setSidePanelOpen(false)}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {active?.content}
      </div>
    </aside>
  )
}
