import { useEffect, useRef, useState } from "react";
import { fmt2 } from "../lib/date";

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
  const ref = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout>>();
  const didInit = useRef(false);

  // Jump to the starting value once, without animating — a smooth scroll on
  // mount would read as the picker "searching" for the current amount.
  useEffect(() => {
    const el = ref.current;
    if (!el || didInit.current) return;
    didInit.current = true;
    el.scrollTop = index * ITEM_HEIGHT;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleScroll() {
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const el = ref.current;
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
      ref={ref}
      onScroll={handleScroll}
      role="listbox"
      aria-label={ariaLabel}
      style={{
        height: ITEM_HEIGHT * VISIBLE_ROWS,
        paddingTop: ITEM_HEIGHT * PAD_ROWS,
        paddingBottom: ITEM_HEIGHT * PAD_ROWS,
      }}
    >
      {values.map((v, i) => (
        <div
          key={v}
          className={`wheel-item${i === index ? " is-selected" : ""}`}
          style={{ height: ITEM_HEIGHT, lineHeight: `${ITEM_HEIGHT}px` }}
          role="option"
          aria-selected={i === index}
          onClick={() => ref.current?.scrollTo({ top: i * ITEM_HEIGHT, behavior: "smooth" })}
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

  return (
    <div className="wheel-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="wheel-modal">
        <div className="wheel-title">{title}</div>
        <div className="wheel-readout count-value">
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
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onDone(amount)}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
