import { useShiftTimer } from "../lib/useShiftTimer";

const ACTIVE_COLOR = "var(--color-accent)";
const INACTIVE_COLOR = "oklch(52% 0.13 150)";

export function ShiftButton({
  active,
  onStart,
  onEnd,
  busy,
}: {
  active: boolean;
  onStart: () => void;
  onEnd: () => void;
  busy: boolean;
}) {
  return (
    <button
      type="button"
      className={`btn cta-circle${active ? " is-active" : ""}`}
      disabled={busy}
      onClick={active ? onEnd : onStart}
      style={{ background: active ? ACTIVE_COLOR : INACTIVE_COLOR }}
    >
      {active ? "Sign out" : "Sign in"}
    </button>
  );
}

export function ElapsedTimer({ active, signIn }: { active: boolean; signIn: string | null }) {
  const label = useShiftTimer(active, signIn);
  if (!active) return null;
  return <div className="elapsed-timer">{label}</div>;
}
