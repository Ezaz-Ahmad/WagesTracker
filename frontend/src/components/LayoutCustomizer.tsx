import {
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  HOME_WIDGET_DETAILS,
  TAB_LABELS,
  useLayoutPreferences,
  type HomeWidgetId,
} from "../context/LayoutPreferencesContext";
import { useDismissTransition } from "../lib/useDismissTransition";
import { useFlipAnimation } from "../lib/useFlipAnimation";
import { useFocusTrap } from "../lib/useFocusTrap";
import type { Screen } from "../lib/types";
import { ArrowDownIcon, ArrowUpIcon, CloseIcon, EyeOffIcon, GripIcon, PlusIcon, SlidersIcon } from "./icons";
import { Overlay } from "./Overlay";

interface SortableItem {
  id: string;
  label: string;
  description?: string;
}

function SortableList({
  items,
  label,
  onMove,
  onHide,
  onAnnounce,
}: {
  items: SortableItem[];
  label: string;
  onMove: (id: string, index: number) => void;
  onHide?: (id: string) => void;
  onAnnounce: (message: string) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const touchDrag = useRef<{ id: string; moved: boolean } | null>(null);
  const listRef = useFlipAnimation<HTMLUListElement>(items.map((item) => item.id).join("|"));

  const move = (id: string, targetIndex: number) => {
    const item = items.find((candidate) => candidate.id === id);
    const currentIndex = items.findIndex((candidate) => candidate.id === id);
    const nextIndex = Math.max(0, Math.min(targetIndex, items.length - 1));
    if (!item || currentIndex === nextIndex) return;
    onMove(id, nextIndex);
    onAnnounce(`${item.label} moved to position ${nextIndex + 1} of ${items.length}.`);
  };

  const indexAtPointer = (clientY: number): number => {
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-sort-id]") ?? []);
    const firstAfterPointer = rows.findIndex((row) => clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2);
    return firstAfterPointer < 0 ? Math.max(0, rows.length - 1) : firstAfterPointer;
  };

  const startNativeDrag = (event: ReactDragEvent<HTMLLIElement>, id: string) => {
    setDraggingId(id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  };

  const startTouchDrag = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (event.pointerType === "mouse") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    touchDrag.current = { id, moved: false };
    setDraggingId(id);
  };

  const continueTouchDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!touchDrag.current) return;
    event.preventDefault();
    touchDrag.current.moved = true;
    move(touchDrag.current.id, indexAtPointer(event.clientY));
  };

  const finishTouchDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!touchDrag.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    touchDrag.current = null;
    setDraggingId(null);
  };

  return (
    <ul ref={listRef} className="layout-sort-list" aria-label={label}>
      {items.map((item, index) => (
        <li
          key={item.id}
          className={`layout-sort-row${draggingId === item.id ? " is-dragging" : ""}`}
          draggable
          data-sort-id={item.id}
          data-flip-key={item.id}
          onDragStart={(event) => startNativeDrag(event, item.id)}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
          onDragEnter={() => { if (draggingId && draggingId !== item.id) move(draggingId, index); }}
          onDragEnd={() => setDraggingId(null)}
        >
          <button
            type="button"
            className="layout-drag-handle"
            aria-label={`Drag to reorder ${item.label}`}
            title="Drag to reorder"
            onPointerDown={(event) => startTouchDrag(event, item.id)}
            onPointerMove={continueTouchDrag}
            onPointerUp={finishTouchDrag}
            onPointerCancel={finishTouchDrag}
          >
            <GripIcon />
          </button>
          <span className="layout-sort-position" aria-hidden="true">{index + 1}</span>
          <span className="layout-sort-copy">
            <strong>{item.label}</strong>
            {item.description && <span>{item.description}</span>}
          </span>
          <span className="layout-sort-actions">
            <button
              type="button"
              className="layout-row-action"
              onClick={() => move(item.id, index - 1)}
              disabled={index === 0}
              aria-label={`Move ${item.label} up`}
              title="Move up"
            >
              <ArrowUpIcon />
            </button>
            <button
              type="button"
              className="layout-row-action"
              onClick={() => move(item.id, index + 1)}
              disabled={index === items.length - 1}
              aria-label={`Move ${item.label} down`}
              title="Move down"
            >
              <ArrowDownIcon />
            </button>
            {onHide && (
              <button
                type="button"
                className="layout-row-action layout-hide-action"
                onClick={() => onHide(item.id)}
                aria-label={`Hide ${item.label}`}
                title="Hide widget"
              >
                <EyeOffIcon />
              </button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function LayoutCustomizer({ onClose }: { onClose: () => void }) {
  const {
    homeWidgetOrder,
    hiddenHomeWidgets,
    tabOrder,
    moveHomeWidget,
    setHomeWidgetVisible,
    moveTab,
    resetHome,
    resetTabs,
  } = useLayoutPreferences();
  const [panel, setPanel] = useState<"dashboard" | "tabs">("dashboard");
  const [announcement, setAnnouncement] = useState("");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { closing, requestClose } = useDismissTransition(220);
  const dismiss = () => requestClose(onClose);
  const dialogRef = useFocusTrap<HTMLDivElement>(true, dismiss, closeButtonRef);

  const hidden = new Set(hiddenHomeWidgets);
  const visibleWidgets = homeWidgetOrder.filter((id) => !hidden.has(id));
  const hiddenWidgets = homeWidgetOrder.filter((id) => hidden.has(id));
  const widgetItems = visibleWidgets.map((id) => ({ id, ...HOME_WIDGET_DETAILS[id] }));
  const tabItems = tabOrder.map((id) => ({ id, label: TAB_LABELS[id], description: id === "home" ? "Your personalised dashboard" : undefined }));

  const hideWidget = (id: string) => {
    const widgetId = id as HomeWidgetId;
    setHomeWidgetVisible(widgetId, false);
    setAnnouncement(`${HOME_WIDGET_DETAILS[widgetId].label} hidden. You can add it back below.`);
  };

  const showWidget = (id: HomeWidgetId) => {
    setHomeWidgetVisible(id, true);
    setAnnouncement(`${HOME_WIDGET_DETAILS[id].label} added to the end of your dashboard.`);
  };

  return (
    <Overlay>
      <div className={`layout-customizer-backdrop${closing ? " is-closing" : ""}`} onClick={dismiss}>
        <div
          ref={dialogRef}
          className={`layout-customizer${closing ? " is-closing" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="layout-customizer-title"
          aria-describedby="layout-customizer-description"
          tabIndex={-1}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="layout-customizer-grabber" aria-hidden="true" />
          <header className="layout-customizer-head">
            <span className="layout-customizer-icon" aria-hidden="true"><SlidersIcon size={20} /></span>
            <div>
              <h2 id="layout-customizer-title">Customise your layout</h2>
              <p id="layout-customizer-description">Drag items into place or use the arrow buttons. Changes save automatically.</p>
            </div>
            <button ref={closeButtonRef} type="button" className="layout-customizer-close" onClick={dismiss} aria-label="Close layout customisation">
              <CloseIcon />
            </button>
          </header>

          <div className="layout-customizer-tabs" role="tablist" aria-label="Layout area">
            <button type="button" role="tab" aria-selected={panel === "dashboard"} aria-controls="layout-dashboard-panel" id="layout-dashboard-tab" onClick={() => setPanel("dashboard")}>Dashboard</button>
            <button type="button" role="tab" aria-selected={panel === "tabs"} aria-controls="layout-tabs-panel" id="layout-tabs-tab" onClick={() => setPanel("tabs")}>Tab bar</button>
          </div>

          <div className="layout-customizer-body">
            {panel === "dashboard" ? (
              <section id="layout-dashboard-panel" role="tabpanel" aria-labelledby="layout-dashboard-tab">
                <div className="layout-panel-intro">
                  <div><strong>Home widgets</strong><span>Hide anything you don't need. You can add it back at any time.</span></div>
                  <button type="button" onClick={() => { resetHome(); setAnnouncement("Dashboard restored to its default layout."); }}>Reset</button>
                </div>
                {widgetItems.length > 0 ? (
                  <SortableList
                    key="dashboard-widgets"
                    items={widgetItems}
                    label="Visible Home widgets"
                    onMove={(id, index) => moveHomeWidget(id as HomeWidgetId, index)}
                    onHide={hideWidget}
                    onAnnounce={setAnnouncement}
                  />
                ) : (
                  <div className="layout-empty-visible"><strong>Your dashboard is clear</strong><span>Add a widget below whenever you need it.</span></div>
                )}

                {hiddenWidgets.length > 0 && (
                  <div className="layout-hidden-section">
                    <h3>Hidden widgets</h3>
                    <div className="layout-hidden-list">
                      {hiddenWidgets.map((id) => (
                        <button type="button" key={id} onClick={() => showWidget(id)} aria-label={`Add ${HOME_WIDGET_DETAILS[id].label} to dashboard`}>
                          <PlusIcon /><span><strong>{HOME_WIDGET_DETAILS[id].label}</strong><small>Add to dashboard</small></span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            ) : (
              <section id="layout-tabs-panel" role="tabpanel" aria-labelledby="layout-tabs-tab">
                <div className="layout-panel-intro">
                  <div><strong>Tab order</strong><span>Your bottom bar, desktop sidebar and swipe order all stay in sync.</span></div>
                  <button type="button" onClick={() => { resetTabs(); setAnnouncement("Tab bar restored to its default order."); }}>Reset</button>
                </div>
                <SortableList
                  key="navigation-tabs"
                  items={tabItems}
                  label="App tabs"
                  onMove={(id, index) => moveTab(id as Screen, index)}
                  onAnnounce={setAnnouncement}
                />
              </section>
            )}
          </div>

          <p className="visually-hidden" aria-live="polite" aria-atomic="true">{announcement}</p>
          <footer className="layout-customizer-footer">
            <span><span className="layout-saved-dot" aria-hidden="true" />Saved on this device</span>
            <button type="button" className="btn btn-primary" onClick={dismiss}>Done</button>
          </footer>
        </div>
      </div>
    </Overlay>
  );
}
