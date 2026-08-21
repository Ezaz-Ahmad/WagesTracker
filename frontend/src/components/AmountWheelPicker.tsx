import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { fmt2 } from "../lib/date";
import { useDismissTransition } from "../lib/useDismissTransition";
import { useFocusTrap } from "../lib/useFocusTrap";

const ITEM_HEIGHT = 40;
const VISIBLE_ROWS = 5; // odd, so exactly one row sits centered
const PAD_ROWS = Math.floor(VISIBLE_ROWS / 2);
const MAX_DOLLARS = 500;
// Nickel increments rather than whole cents — a fuel cost or tip is never
// going to need penny precision, and this keeps the cents wheel a short,
// comfortably flickable 20 rows instead of 100.
const CENTS_STEP = 5;

const DOLLAR_VALUES = Array.from({ length: MAX_DOLLARS + 1 }, (_, i) => i);
const CENT_VALUES = Array.from({ length: 100 / CENTS_STEP }, (_, i) => i * CENTS_STEP);

function WheelColumn({
  values,
  index,
  onSettle,
  format,
  ariaLabel,
}: {
  values: number[];
  index: number;
  onSettle: (index: number) => void;
  format: (v: number) => string;
  ariaLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const settleTimer = useRef<ReturnType<typeof setTimeout>>();
  const rafId = useRef<number>();
  const didInit = useRef(false);
  const idPrefix = useId();
  const optionId = (i: number) => `${idPrefix}-opt-${i}`;

  // Moves the selection by `delta` rows (or to an absolute `to` index),
  // scrolling smoothly to the new position and reporting it the same way a
  // settled scroll gesture does — this is what makes the wheel fully
  // keyboard-operable instead of pointer/touch-only.
  function moveSelection(next: number) {
    const clamped = Math.max(0, Math.min(values.length - 1, next));
    const el = containerRef.current;
    el?.scrollTo({ top: clamped * ITEM_HEIGHT, behavior: "smooth" });
    onSettle(clamped);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveSelection(index + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveSelection(index - 1);
        break;
      case "PageDown":
        e.preventDefault();
        moveSelection(index + 5);
        break;
      case "PageUp":
        e.preventDefault();
        moveSelection(index - 5);
        break;
      case "Home":
        e.preventDefault();
        moveSelection(0);
        break;
      case "End":
        e.preventDefault();
        moveSelection(values.length - 1);
        break;
      default:
        break;
    }
  }

  // Jump to the starting value once, without animating — a smooth scroll on
  // mount would read as the picker "searching" for the current amount.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || didInit.current) return;
    didInit.current = true;
    el.scrollTop = index * ITEM_HEIGHT;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The wheel's actual "feel" — every row's tilt/scale/fade is driven live
  // off the real scroll position, every frame, for as long as the picker is
  // open. Riding on the browser's own scroll physics (momentum, snap,
  // rubber-band overscroll) rather than reimplementing it in JS is what
  // makes this track a finger exactly instead of feeling like a canned
  // animation layered on top of a plain list.
  useEffect(() => {
    function tick() {
      const el = containerRef.current;
      if (el) {
        const offset = el.scrollTop / ITEM_HEIGHT;
        const lo = Math.max(0, Math.floor(offset) - PAD_ROWS - 1);
        const hi = Math.min(values.length - 1, Math.ceil(offset) + PAD_ROWS + 1);
        for (let i = lo; i <= hi; i++) {
          const item = itemRefs.current[i];
          if (!item) continue;
          const distance = i - offset;
          const abs = Math.min(Math.abs(distance), 2.4);
          const scale = 1 - abs * 0.16;
          const opacity = Math.max(0.16, 1 - abs * 0.42);
          const rotate = distance * 20;
          item.style.transform = `perspective(260px) rotateX(${rotate}deg) scale(${scale})`;
          item.style.opacity = String(opacity);
        }
      }
      rafId.current = requestAnimationFrame(tick);
    }
    rafId.current = requestAnimationFrame(tick);
    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleScroll() {
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const el = containerRef.current;
      if (!el) return;
      const nextIndex = Math.max(0, Math.min(values.length - 1, Math.round(el.scrollTop / ITEM_HEIGHT)));
      // Native scroll-snap usually lands exactly on a row already; this just
      // corrects the rare case it's a pixel or two off, so the reported
      // value always matches what's visually centered.
      if (Math.abs(el.scrollTop - nextIndex * ITEM_HEIGHT) > 1) {
        el.scrollTo({ top: nextIndex * ITEM_HEIGHT, behavior: "smooth" });
      }
      onSettle(nextIndex);
    }, 100);
  }

  return (
    <div
      className="wheel-col"
      ref={containerRef}
      onScroll={handleScroll}
      onKeyDown={handleKeyDown}
      role="listbox"
      aria-label={ariaLabel}
      // Roving-focus-via-aria-activedescendant: the scrollable listbox
      // itself is the one Tab stop, and arrow/Home/End/PageUp/PageDown
      // (handleKeyDown above) move the reported selection, mirroring what
      // flicking or tapping a row already does — the wheel has no
      // keyboard-only dead ends.
      tabIndex={0}
      aria-activedescendant={optionId(index)}
      style={{
        height: ITEM_HEIGHT * VISIBLE_ROWS,
        paddingTop: ITEM_HEIGHT * PAD_ROWS,
        paddingBottom: ITEM_HEIGHT * PAD_ROWS,
      }}
    >
      {values.map((v, i) => (
        <div
          key={v}
          id={optionId(i)}
          ref={(el) => {
            itemRefs.current[i] = el;
          }}
          className={`wheel-item${i === index ? " is-selected" : ""}`}
          style={{ height: ITEM_HEIGHT, lineHeight: `${ITEM_HEIGHT}px` }}
          role="option"
          aria-selected={i === index}
          onClick={() => moveSelection(i)}
        >
          {format(v)}
        </div>
      ))}
    </div>
  );
}

/**
 * A spin-to-pick dollar amount, in the same spirit as the native sign-in/
 * sign-out time pickers — choosing a value instead of typing one on a
 * number keyboard. Used for fuel cost and the weekly "other earnings"
 * amount. Flick or tap a row in either wheel; the running total shows above
 * as you go, and "Done" commits it.
 */
export function AmountWheelPicker({
  title,
  currency,
  initialAmount,
  onDone,
  onCancel,
}: {
  title: string;
  currency: string;
  initialAmount: number;
  onDone: (amount: number) => void;
  onCancel: () => void;
}) {
  const initialDollarIndex = Math.max(0, Math.min(MAX_DOLLARS, Math.floor(initialAmount)));
  const initialCentsRaw = Math.round((initialAmount - Math.floor(initialAmount)) * 100);
  const initialCentIndex = Math.max(0, Math.min(CENT_VALUES.length - 1, Math.round(initialCentsRaw / CENTS_STEP)));

  const [dollarIndex, setDollarIndex] = useState(initialDollarIndex);
  const [centIndex, setCentIndex] = useState(initialCentIndex);
  const amount = DOLLAR_VALUES[dollarIndex] + CENT_VALUES[centIndex] / 100;

  // Cancel/Done/backdrop-tap all play a quick scale+fade-out first, then call
  // the real prop — by the time the parent unmounts this (clearing whichever
  // state was driving it), the modal is already invisible instead of
  // snapping away mid-frame. See the hook for why this can't just be a plain
  // callback.
  const { closing, requestClose } = useDismissTransition(180);

  // Focus trapping, Escape-to-cancel, and focus restoration on close —
  // shared with every other modal in the app (ConfirmProvider, account
  // deletion). Escape maps to the same requestClose(onCancel) path Cancel
  // and the backdrop tap already use, so there's exactly one cancel route.
  const trapRef = useFocusTrap<HTMLDivElement>(true, () => requestClose(onCancel));

  // A small tactile "pop" on the readout every time a wheel actually
  // settles on a new value — skipped on first mount so it doesn't fire the
  // instant the picker opens.
  const [bump, setBump] = useState(false);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setBump(true);
    const t = setTimeout(() => setBump(false), 220);
    return () => clearTimeout(t);
  }, [amount]);

  // Rendered via a portal straight into <body>, bypassing wherever this
  // component happens to sit in the tree. EntryScreen renders inside
  // App.tsx's animated screen subtree, which can carry an entrance transform
  // — and per the CSS spec, ANY transformed ancestor becomes the containing
  // block for a `position: fixed` descendant instead of the real viewport.
  // Without the portal, this modal was centering and clamping itself against
  // that scrollable track's box, not the screen — hence the huge gap above
  // the wheel and having to scroll the page to reach the buttons below it.
  return createPortal(
    <div
      className={`wheel-backdrop${closing ? " is-closing" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => requestClose(onCancel)}
    >
      <div
        ref={trapRef}
        className={`wheel-modal${closing ? " is-closing" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="wheel-title">{title}</div>
        <div className={`wheel-readout count-value${bump ? " is-bump" : ""}`}>
          {currency}
          {fmt2(amount)}
        </div>
        <div className="wheel-columns">
          <div className="wheel-selection-band" aria-hidden="true" />
          <WheelColumn values={DOLLAR_VALUES} index={dollarIndex} onSettle={setDollarIndex} format={(v) => String(v)} ariaLabel="Dollars" />
          <div className="wheel-dot" aria-hidden="true">.</div>
          <WheelColumn
            values={CENT_VALUES}
            index={centIndex}
            onSettle={setCentIndex}
            format={(v) => String(v).padStart(2, "0")}
            ariaLabel="Cents"
          />
        </div>
        <div className="wheel-actions">
          <button type="button" className="btn btn-secondary" onClick={() => requestClose(onCancel)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => requestClose(() => onDone(amount))}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
