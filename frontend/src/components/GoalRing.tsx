type GoalRingProps = {
  /** 0-100 target fill percentage. Drives the ring via a CSS custom property
   * so both the entrance sweep and later updates can be plain CSS animations
   * (see .goal-ring-fill in app.css) instead of a JS-measured transition. */
  pct: number;
  size?: number;
  strokeWidth?: number;
  /** Big text in the center, e.g. "4/7". */
  value: string;
};

/** Compact animated circular progress ring — used on the Home screen's
 * "Days logged" / "Weeks on goal" stat tiles so a plain fraction reads as an
 * at-a-glance visual instead of just two numbers. */
export function GoalRing({ pct, size = 60, strokeWidth = 7, value }: GoalRingProps) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  const offset = c * (1 - clamped / 100);

  return (
    <div
      className="goal-ring"
      style={{
        width: size,
        height: size,
        ["--ring-circumference" as string]: `${c}px`,
        ["--ring-offset-target" as string]: `${offset}px`,
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="goal-ring-svg">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-neutral-200)" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={c}
          className="goal-ring-fill"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="goal-ring-center count-value" style={{ fontSize: size * 0.24 }}>
        {value}
      </div>
    </div>
  );
}
